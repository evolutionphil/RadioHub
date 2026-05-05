import { WebSocket } from 'ws';
import crypto from 'crypto';
import { CastSession, Station, UserDevice } from '../shared/mongo-schemas';
import { logger } from '../utils/logger';

interface CastClient {
  socket: WebSocket;
  sessionId: string;
  role: 'mobile' | 'tv';
  userId: string;
  deviceId?: string;
}

export type CastCommand = 'play' | 'pause' | 'resume' | 'stop' | 'change_station' | 'volume_up' | 'volume_down' | 'set_volume';

export interface CastCommandPayload {
  sessionId: string;
  command: CastCommand;
  data?: {
    stationId?: string;
    volume?: number;
  };
}

export class CastService {
  private clients: Map<string, CastClient> = new Map();
  private sessionClients: Map<string, { mobile?: string; tv?: string }> = new Map();

  private generatePairingCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateSessionId(): string {
    return `cast_${crypto.randomBytes(16).toString('hex')}`;
  }

  async createSession(userId: string, mobileDeviceId?: string): Promise<{ sessionId: string; pairingCode: string }> {
    await CastSession.updateMany(
      { userId, status: { $in: ['waiting_for_pair', 'paired'] } },
      { $set: { status: 'expired' } }
    );

    const sessionId = this.generateSessionId();
    const pairingCode = this.generatePairingCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await CastSession.create({
      sessionId,
      pairingCode,
      userId,
      mobileDeviceId,
      status: 'waiting_for_pair',
      isPlaying: false,
      expiresAt,
      lastActivityAt: new Date(),
    });

    logger.log(`📺 CAST: Session created ${sessionId} with code ${pairingCode}`);
    return { sessionId, pairingCode };
  }

  async pairSession(pairingCode: string, tvDeviceId: string, tvUserId?: string): Promise<{ sessionId: string; userId: string } | null> {
    const session = await CastSession.findOne({
      pairingCode,
      status: 'waiting_for_pair',
      expiresAt: { $gt: new Date() },
    });

    if (!session) return null;

    session.tvDeviceId = tvDeviceId;
    session.status = 'paired';
    session.pairedAt = new Date();
    session.lastActivityAt = new Date();
    await session.save();

    const mobileClientId = this.sessionClients.get(session.sessionId)?.mobile;
    if (mobileClientId) {
      this.sendToClient(mobileClientId, {
        type: 'cast:paired',
        sessionId: session.sessionId,
        tvDeviceId,
      });
    }

    logger.log(`📺 CAST: Session ${session.sessionId} paired with TV ${tvDeviceId}`);
    return { sessionId: session.sessionId, userId: session.userId.toString() };
  }

  async sendCommand(sessionId: string, command: CastCommand, data?: any, fromRole?: 'mobile' | 'tv', userId?: string): Promise<boolean> {
    const session = await CastSession.findOne({
      sessionId,
      status: { $in: ['paired', 'active'] },
      expiresAt: { $gt: new Date() },
    });

    if (!session) return false;

    if (fromRole === 'mobile' && userId && session.userId.toString() !== userId) return false;
    if (fromRole !== 'mobile' && fromRole !== 'tv') return false;

    if (command === 'play' || command === 'change_station') {
      if (data?.stationId) {
        const station = await Station.findById(data.stationId).select('name slug url_resolved favicon').lean();
        if (station) {
          session.currentStation = {
            stationId: data.stationId,
            name: (station as any).name,
            slug: (station as any).slug,
            streamUrl: (station as any).url_resolved || (station as any).url,
            favicon: (station as any).favicon,
          };
        }
      }
      session.isPlaying = true;
      session.status = 'active';
    } else if (command === 'pause') {
      session.isPlaying = false;
    } else if (command === 'resume') {
      session.isPlaying = true;
    } else if (command === 'stop') {
      session.isPlaying = false;
      session.currentStation = undefined;
    }

    session.lastActivityAt = new Date();
    await session.save();

    const targetRole = fromRole === 'mobile' ? 'tv' : 'mobile';
    const clients = this.sessionClients.get(sessionId);
    const targetClientId = targetRole === 'tv' ? clients?.tv : clients?.mobile;

    if (targetClientId) {
      this.sendToClient(targetClientId, {
        type: `cast:${command}`,
        sessionId,
        data: command === 'play' || command === 'change_station' ? {
          station: session.currentStation,
        } : data,
      });
    }

    if (fromRole === 'mobile') {
      const mobileClientId = clients?.mobile;
      if (mobileClientId) {
        this.sendToClient(mobileClientId, {
          type: 'cast:command_ack',
          sessionId,
          command,
        });
      }
    }

    logger.log(`📺 CAST: Command '${command}' sent in session ${sessionId}`);
    return true;
  }

  async getSessionStatus(sessionId: string, userId?: string): Promise<any> {
    const session = await CastSession.findOne({ sessionId }).lean();
    if (!session) return null;

    if (userId && session.userId.toString() !== userId) return null;

    const clients = this.sessionClients.get(sessionId);
    return {
      sessionId: session.sessionId,
      status: session.status,
      isPlaying: session.isPlaying,
      currentStation: session.currentStation,
      mobileConnected: !!clients?.mobile,
      tvConnected: !!clients?.tv,
      createdAt: session.createdAt,
      pairedAt: session.pairedAt,
      expiresAt: session.expiresAt,
    };
  }

  async endSession(sessionId: string, userId?: string): Promise<boolean> {
    const session = await CastSession.findOne({ sessionId });
    if (!session) return false;

    if (userId && session.userId.toString() !== userId) return false;

    session.status = 'expired';
    session.isPlaying = false;
    await session.save();

    const clients = this.sessionClients.get(sessionId);
    if (clients?.tv) {
      this.sendToClient(clients.tv, { type: 'cast:session_ended', sessionId });
    }
    if (clients?.mobile) {
      this.sendToClient(clients.mobile, { type: 'cast:session_ended', sessionId });
    }

    this.sessionClients.delete(sessionId);
    logger.log(`📺 CAST: Session ${sessionId} ended`);
    return true;
  }

  async createDirectSession(userId: string, tvDeviceId: string, stationId?: string): Promise<{ sessionId: string } | null> {
    const device = await UserDevice.findOne({ userId, deviceId: tvDeviceId, isActive: true });
    if (!device) return null;

    await CastSession.updateMany(
      { userId, status: { $in: ['waiting_for_pair', 'paired'] } },
      { $set: { status: 'expired' } }
    );

    const sessionId = this.generateSessionId();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    let currentStation: any = undefined;
    if (stationId) {
      const station = await Station.findById(stationId).select('name slug url_resolved url favicon').lean();
      if (station) {
        currentStation = {
          stationId,
          name: (station as any).name,
          slug: (station as any).slug,
          streamUrl: (station as any).url_resolved || (station as any).url,
          favicon: (station as any).favicon,
        };
      }
    }

    await CastSession.create({
      sessionId,
      userId,
      tvDeviceId,
      mobileDeviceId: 'direct',
      status: 'active',
      isPlaying: !!stationId,
      currentStation,
      pairedAt: new Date(),
      expiresAt,
      lastActivityAt: new Date(),
    });

    device.lastSeenAt = new Date();
    await device.save();

    this.notifyTvDevice(tvDeviceId, {
      type: 'cast:direct_session',
      sessionId,
      currentStation,
      isPlaying: !!stationId,
    });

    logger.log(`📺 CAST: Direct session ${sessionId} created for TV ${tvDeviceId}`);
    return { sessionId };
  }

  private notifyTvDevice(tvDeviceId: string, message: any) {
    for (const [clientId, client] of this.clients) {
      if (client.role === 'tv' && client.deviceId === tvDeviceId) {
        this.sendToClient(clientId, message);
        return;
      }
    }
  }

  async getUserActiveSessions(userId: string): Promise<any[]> {
    const sessions = await CastSession.find({
      userId,
      status: { $in: ['waiting_for_pair', 'paired', 'active'] },
      expiresAt: { $gt: new Date() },
    }).lean();

    return sessions.map(s => ({
      sessionId: s.sessionId,
      pairingCode: s.status === 'waiting_for_pair' ? s.pairingCode : undefined,
      status: s.status,
      isPlaying: s.isPlaying,
      currentStation: s.currentStation,
      tvDeviceId: s.tvDeviceId,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));
  }

  registerClient(clientId: string, socket: WebSocket, sessionId: string, role: 'mobile' | 'tv', userId: string, deviceId?: string) {
    this.clients.set(clientId, { socket, sessionId, role, userId, deviceId });

    if (!this.sessionClients.has(sessionId)) {
      this.sessionClients.set(sessionId, {});
    }
    const sc = this.sessionClients.get(sessionId)!;
    if (role === 'mobile') sc.mobile = clientId;
    else sc.tv = clientId;

    const otherRole = role === 'mobile' ? 'tv' : 'mobile';
    const otherClientId = otherRole === 'tv' ? sc.tv : sc.mobile;
    if (otherClientId) {
      this.sendToClient(otherClientId, {
        type: 'cast:peer_connected',
        sessionId,
        peerRole: role,
      });
    }

    logger.log(`📺 CAST: ${role} client registered for session ${sessionId}`);
  }

  removeClient(clientId: string) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const sc = this.sessionClients.get(client.sessionId);
    if (sc) {
      if (sc.mobile === clientId) sc.mobile = undefined;
      if (sc.tv === clientId) sc.tv = undefined;

      const otherRole = client.role === 'mobile' ? 'tv' : 'mobile';
      const otherClientId = otherRole === 'tv' ? sc.tv : sc.mobile;
      if (otherClientId) {
        this.sendToClient(otherClientId, {
          type: 'cast:peer_disconnected',
          sessionId: client.sessionId,
          peerRole: client.role,
        });
      }

      if (!sc.mobile && !sc.tv) {
        this.sessionClients.delete(client.sessionId);
      }
    }

    this.clients.delete(clientId);
    logger.log(`📺 CAST: ${client.role} client disconnected from session ${client.sessionId}`);
  }

  // If a client can't keep up, drop the connection instead of buffering frames in ws internal buffer
  private static WS_BUFFER_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2MB

  private sendToClient(clientId: string, message: any) {
    const client = this.clients.get(clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) return;
    if ((client.socket as any).bufferedAmount > CastService.WS_BUFFER_THRESHOLD_BYTES) {
      try { client.socket.close(1013, 'slow consumer'); } catch {}
      this.removeClient(clientId);
      return;
    }
    try { client.socket.send(JSON.stringify(message)); } catch {}
  }

  async handleNowPlaying(sessionId: string, nowPlaying: any) {
    const clients = this.sessionClients.get(sessionId);
    if (clients?.mobile) {
      this.sendToClient(clients.mobile, {
        type: 'cast:now_playing',
        sessionId,
        data: nowPlaying,
      });
    }
  }
}

export const castService = new CastService();

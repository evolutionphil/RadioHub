import { type Express } from "express";
import { type WebSocketServer, type WebSocket } from 'ws';
import { AuthToken, CastSession } from '../../shared/mongo-schemas';
import { castService } from '../services/cast-service';
import { logger } from '../utils/logger';

export function registerCastRoutes(app: Express, castWss: WebSocketServer, deps: any) {
  const { requireAuth } = deps;

  castWss.on('connection', async (socket: WebSocket, request) => {
    const clientId = `cast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    const role = url.searchParams.get('role') as 'mobile' | 'tv';
    const token = url.searchParams.get('token');
    const deviceId = url.searchParams.get('deviceId');

    if (!sessionId || !role || !token || !['mobile', 'tv'].includes(role)) {
      socket.send(JSON.stringify({ type: 'error', message: 'Missing required params: sessionId, role, token' }));
      socket.close(4001, 'Invalid parameters');
      return;
    }

    let userId: string | null = null;
    try {
      const tokenDoc = await AuthToken.findOne({ token, isRevoked: false, expiresAt: { $gt: new Date() } });
      if (!tokenDoc) {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
        socket.close(4002, 'Authentication failed');
        return;
      }
      userId = tokenDoc.userId.toString();
    } catch (err) {
      socket.send(JSON.stringify({ type: 'error', message: 'Authentication error' }));
      socket.close(4002, 'Authentication failed');
      return;
    }

    const session = await CastSession.findOne({ sessionId, expiresAt: { $gt: new Date() } });
    if (!session) {
      socket.send(JSON.stringify({ type: 'error', message: 'Session not found or expired' }));
      socket.close(4003, 'Session not found');
      return;
    }

    if (role === 'mobile' && session.userId.toString() !== userId) {
      socket.send(JSON.stringify({ type: 'error', message: 'Not authorized for this session' }));
      socket.close(4004, 'Not authorized');
      return;
    }

    if (role === 'tv') {
      if (!session.tvDeviceId || (deviceId && session.tvDeviceId !== deviceId)) {
        socket.send(JSON.stringify({ type: 'error', message: 'TV device not paired with this session' }));
        socket.close(4004, 'Not authorized');
        return;
      }
      if (!['paired', 'active'].includes(session.status)) {
        socket.send(JSON.stringify({ type: 'error', message: 'Session not yet paired' }));
        socket.close(4003, 'Not paired');
        return;
      }
    }

    castService.registerClient(clientId, socket, sessionId, role, userId, deviceId || undefined);

    socket.send(JSON.stringify({
      type: 'cast:connected',
      clientId,
      sessionId,
      role,
      status: session.status,
      currentStation: session.currentStation,
      isPlaying: session.isPlaying,
    }));

    socket.on('message', async (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString());

        switch (msg.type) {
          case 'cast:command':
            await castService.sendCommand(sessionId, msg.command, msg.data, role, userId!);
            break;

          case 'cast:now_playing':
            await castService.handleNowPlaying(sessionId, msg.data);
            break;

          case 'cast:heartbeat':
            socket.send(JSON.stringify({ type: 'cast:heartbeat_ack', timestamp: Date.now() }));
            break;

          default:
            socket.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
        }
      } catch (err) {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    socket.on('close', () => {
      castService.removeClient(clientId);
    });

    socket.on('error', () => {
      castService.removeClient(clientId);
    });
  });

  // ==================== CAST REST API Endpoints ====================

  app.post('/api/cast/session/create', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;

      if (sessionUserId) {
        userId = sessionUserId;
      } else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { mobileDeviceId } = req.body || {};
      const result = await castService.createSession(userId, mobileDeviceId);

      res.json({
        success: true,
        sessionId: result.sessionId,
        pairingCode: result.pairingCode,
        wsUrl: `/ws/cast?sessionId=${result.sessionId}&role=mobile&token=YOUR_TOKEN`,
        expiresIn: '24 hours',
      });
    } catch (error: any) {
      console.error('[CAST] Create session error:', error.message);
      res.status(500).json({ error: 'Failed to create cast session' });
    }
  });

  const pairingAttempts = new Map<string, { count: number; resetAt: number }>();
  const PAIRING_MAX_ATTEMPTS = 5;
  const PAIRING_WINDOW_MS = 15 * 60 * 1000;
  // Hard-cap map size to protect against IP spray attacks that would otherwise grow
  // this map unboundedly between cleanup sweeps. Map iteration order = insertion order,
  // so keys().next() returns the oldest entry for eviction.
  const PAIRING_ATTEMPTS_MAX = 50_000;
  const evictOldestPairing = () => {
    if (pairingAttempts.size >= PAIRING_ATTEMPTS_MAX) {
      const oldest = pairingAttempts.keys().next().value;
      if (oldest !== undefined) pairingAttempts.delete(oldest);
    }
  };
  // Clean expired entries more frequently (every 5min instead of 1h) to limit memory growth.
  const _pairingCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of pairingAttempts) {
      if (now > data.resetAt) pairingAttempts.delete(ip);
    }
  }, 5 * 60 * 1000);
  // unref so this timer doesn't block SIGTERM-driven graceful shutdown.
  if (typeof (_pairingCleanupTimer as any).unref === 'function') (_pairingCleanupTimer as any).unref();

  app.post('/api/cast/session/pair', async (req: any, res) => {
    try {
      const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || 'unknown';
      const now = Date.now();
      const attempts = pairingAttempts.get(clientIp);
      if (attempts) {
        if (now > attempts.resetAt) {
          pairingAttempts.set(clientIp, { count: 1, resetAt: now + PAIRING_WINDOW_MS });
        } else if (attempts.count >= PAIRING_MAX_ATTEMPTS) {
          return res.status(429).json({ error: 'Too many pairing attempts. Try again later.' });
        } else {
          attempts.count++;
        }
      } else {
        evictOldestPairing();
        pairingAttempts.set(clientIp, { count: 1, resetAt: now + PAIRING_WINDOW_MS });
      }

      const { pairingCode, deviceId, deviceName, platform } = req.body;

      if (!pairingCode || !deviceId) {
        return res.status(400).json({ error: 'pairingCode and deviceId are required' });
      }

      const result = await castService.pairSession(pairingCode, deviceId);

      if (!result) {
        return res.status(404).json({ error: 'Invalid pairing code or session expired' });
      }

      res.json({
        success: true,
        sessionId: result.sessionId,
        wsUrl: `/ws/cast?sessionId=${result.sessionId}&role=tv&token=YOUR_TOKEN&deviceId=${deviceId}`,
        message: 'Successfully paired with mobile device',
      });
    } catch (error: any) {
      console.error('[CAST] Pair session error:', error.message);
      res.status(500).json({ error: 'Failed to pair session' });
    }
  });

  app.post('/api/cast/command', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const { sessionId, command, data } = req.body;

      if (!sessionId || !command) {
        return res.status(400).json({ error: 'sessionId and command are required' });
      }

      const validCommands = ['play', 'pause', 'resume', 'stop', 'change_station', 'volume_up', 'volume_down', 'set_volume'];
      if (!validCommands.includes(command)) {
        return res.status(400).json({ error: `Invalid command. Valid: ${validCommands.join(', ')}` });
      }

      const success = await castService.sendCommand(sessionId, command, data, 'mobile', userId);

      if (!success) {
        return res.status(404).json({ error: 'Session not found, not active, or not authorized' });
      }

      res.json({ success: true, command, sessionId });
    } catch (error: any) {
      console.error('[CAST] Command error:', error.message);
      res.status(500).json({ error: 'Failed to send command' });
    }
  });

  app.get('/api/cast/session/:sessionId/status', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const { sessionId } = req.params;
      const status = await castService.getSessionStatus(sessionId, userId);

      if (!status) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({ success: true, ...status });
    } catch (error: any) {
      console.error('[CAST] Status error:', error.message);
      res.status(500).json({ error: 'Failed to get session status' });
    }
  });

  app.get('/api/cast/sessions', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const sessions = await castService.getUserActiveSessions(userId);
      res.json({ success: true, sessions });
    } catch (error: any) {
      console.error('[CAST] Sessions error:', error.message);
      res.status(500).json({ error: 'Failed to get sessions' });
    }
  });
}

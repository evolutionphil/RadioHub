import { WebSocket } from 'ws';
import { StreamMetadataService } from './stream-metadata';
import { logger } from '../utils/logger';

interface MetadataClient {
  id: string;
  socket: WebSocket;
  currentStream?: string;
  lastMetadata?: string;
}

export class RealtimeMetadataService {
  private static readonly MAX_CLIENTS = 200;
  private clients: Map<string, MetadataClient> = new Map();
  private streamMetadataService: StreamMetadataService;
  private pushIntervals: Map<string, NodeJS.Timeout> = new Map();
  
  constructor() {
    this.streamMetadataService = new StreamMetadataService();
  }

  addClient(clientId: string, socket: WebSocket) {
    if (this.clients.size >= RealtimeMetadataService.MAX_CLIENTS) {
      logger.log(`⚠️ REALTIME METADATA: Max clients (${RealtimeMetadataService.MAX_CLIENTS}) reached, rejecting ${clientId}`);
      socket.close(1013, 'Server at capacity');
      return;
    }

    logger.log(`🎵 REALTIME METADATA: Client connected ${clientId} (total: ${this.clients.size + 1})`);
    
    const client: MetadataClient = {
      id: clientId,
      socket,
    };
    
    this.clients.set(clientId, client);
    
    this.sendToClient(clientId, {
      action: 'connected',
      data: { message: 'Real-time metadata service ready' }
    });

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(clientId, message);
      } catch (error) {
        logger.log('❌ Invalid message from client:', error);
      }
    });

    socket.on('close', () => {
      this.removeClient(clientId);
    });

    socket.on('error', (err) => {
      logger.log(`❌ REALTIME METADATA: Socket error for ${clientId}:`, err.message);
      this.removeClient(clientId);
    });
  }

  removeClient(clientId: string) {
    const client = this.clients.get(clientId);
    if (client) {
      if (client.currentStream) {
        this.stopTrackingForClient(clientId);
      }
      
      this.clients.delete(clientId);
      logger.log(`🎵 REALTIME METADATA: Client disconnected ${clientId} (remaining: ${this.clients.size})`);
    }
  }

  private handleClientMessage(clientId: string, message: any) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.action) {
      case 'trackStream':
        this.trackStreamForClient(clientId, message.streamUrl);
        break;
      case 'stopTracking':
        this.stopTrackingForClient(clientId);
        break;
      default:
        logger.log('❌ Unknown action:', message.action);
    }
  }

  private trackStreamForClient(clientId: string, streamUrl: string) {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (client.currentStream) {
      this.stopTrackingForClient(clientId);
    }

    client.currentStream = streamUrl;
    this.streamMetadataService.subscribe(streamUrl, clientId);

    const pushKey = clientId;
    const intervalId = setInterval(() => {
      const cl = this.clients.get(clientId);
      if (!cl || !cl.currentStream) {
        clearInterval(intervalId);
        this.pushIntervals.delete(pushKey);
        return;
      }

      const metadata = this.streamMetadataService.getMetadata(cl.currentStream);
      if (metadata && (metadata.title || metadata.artist)) {
        const metadataStr = JSON.stringify(metadata);
        if (metadataStr !== cl.lastMetadata) {
          cl.lastMetadata = metadataStr;
          this.sendToClient(clientId, {
            action: 'setTitle',
            data: {
              title: metadata.title || metadata.station || 'Live Stream',
              artist: metadata.artist,
              station: metadata.station,
              genre: metadata.genre,
              raw: metadata
            }
          });
        }
      }
    }, 3000);

    this.pushIntervals.set(pushKey, intervalId);
  }

  private stopTrackingForClient(clientId: string) {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (client.currentStream) {
      this.streamMetadataService.unsubscribe(client.currentStream, clientId);
      client.currentStream = undefined;
      client.lastMetadata = undefined;
    }

    const intervalId = this.pushIntervals.get(clientId);
    if (intervalId) {
      clearInterval(intervalId);
      this.pushIntervals.delete(clientId);
    }
  }

  private sendToClient(clientId: string, message: any) {
    const client = this.clients.get(clientId);
    if (client && client.socket.readyState === WebSocket.OPEN) {
      try {
        client.socket.send(JSON.stringify(message));
      } catch (error) {
        logger.log(`❌ Failed to send to client ${clientId}:`, error);
        this.removeClient(clientId);
      }
    }
  }

  cleanup() {
    for (const intervalId of this.pushIntervals.values()) {
      clearInterval(intervalId);
    }
    this.pushIntervals.clear();
    
    this.streamMetadataService.cleanup();
    
    for (const client of this.clients.values()) {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.close();
      }
    }
    this.clients.clear();
    
    logger.log('🧹 REALTIME METADATA: Service cleaned up');
  }
}

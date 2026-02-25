import { WebSocket } from 'ws';
import { StreamMetadataService } from './stream-metadata';
import { logger } from '../utils/logger';

interface MetadataClient {
  id: string;
  socket: WebSocket;
  currentStream?: string;
  lastMetadata?: any;
}

export class RealtimeMetadataService {
  private clients: Map<string, MetadataClient> = new Map();
  private streamMetadataService: StreamMetadataService;
  private metadataIntervals: Map<string, NodeJS.Timeout> = new Map();
  
  constructor() {
    this.streamMetadataService = new StreamMetadataService();
  }

  addClient(clientId: string, socket: WebSocket) {
    logger.log(`🎵 REALTIME METADATA: Client connected ${clientId}`);
    
    const client: MetadataClient = {
      id: clientId,
      socket,
    };
    
    this.clients.set(clientId, client);
    
    // Send welcome message
    this.sendToClient(clientId, {
      action: 'connected',
      data: { message: 'Real-time metadata service ready' }
    });

    // Handle client messages
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(clientId, message);
      } catch (error) {
        logger.log('❌ Invalid message from client:', error);
      }
    });

    // Handle client disconnect
    socket.on('close', () => {
      this.removeClient(clientId);
    });
  }

  removeClient(clientId: string) {
    const client = this.clients.get(clientId);
    if (client) {
      // Stop metadata tracking for this client
      if (client.currentStream) {
        this.stopTrackingStream(client.currentStream, clientId);
      }
      
      this.clients.delete(clientId);
      logger.log(`🎵 REALTIME METADATA: Client disconnected ${clientId}`);
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

  private async trackStreamForClient(clientId: string, streamUrl: string) {
    const client = this.clients.get(clientId);
    if (!client) return;

    logger.log(`🎯 REALTIME: Tracking metadata for stream: ${streamUrl}`);
    
    // Stop previous tracking
    if (client.currentStream) {
      this.stopTrackingStream(client.currentStream, clientId);
    }

    client.currentStream = streamUrl;
    
    // Start immediate metadata fetch
    this.fetchAndSendMetadata(clientId, streamUrl);
    
    // Set up polling for real-time updates (every 10 seconds for fresh metadata)
    const intervalId = setInterval(() => {
      this.fetchAndSendMetadata(clientId, streamUrl);
    }, 10000);
    
    this.metadataIntervals.set(`${clientId}-${streamUrl}`, intervalId);
  }

  private async fetchAndSendMetadata(clientId: string, streamUrl: string) {
    const client = this.clients.get(clientId);
    if (!client || client.currentStream !== streamUrl) return;

    try {
      const mockStation = { 
        url: streamUrl, 
        url_resolved: streamUrl,
        _id: `stream-${streamUrl.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}`
      };
      
      const metadata = await this.streamMetadataService.getStationMetadata(mockStation);
      
      if (metadata && (metadata.title || metadata.artist)) {
        // Only send if metadata has changed
        const metadataString = JSON.stringify(metadata);
        const lastMetadataString = JSON.stringify(client.lastMetadata);
        
        if (metadataString !== lastMetadataString) {
          logger.log(`🎵 REALTIME: New metadata for ${streamUrl}:`, metadata);
          
          client.lastMetadata = metadata;
          
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
    } catch (error) {
      logger.log(`❌ REALTIME: Metadata fetch error for ${streamUrl}:`, error);
      
      this.sendToClient(clientId, {
        action: 'reportError',
        data: {
          type: 'SERVER_HTTP_ERROR',
          detail: `Failed to fetch metadata: ${error.message}`
        }
      });
    }
  }

  private stopTrackingForClient(clientId: string) {
    const client = this.clients.get(clientId);
    if (!client || !client.currentStream) return;

    this.stopTrackingStream(client.currentStream, clientId);
    client.currentStream = undefined;
    client.lastMetadata = undefined;
  }

  private stopTrackingStream(streamUrl: string, clientId: string) {
    const intervalKey = `${clientId}-${streamUrl}`;
    const intervalId = this.metadataIntervals.get(intervalKey);
    
    if (intervalId) {
      clearInterval(intervalId);
      this.metadataIntervals.delete(intervalKey);
      logger.log(`🛑 REALTIME: Stopped tracking ${streamUrl} for client ${clientId}`);
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

  // Cleanup method
  cleanup() {
    // Clear all intervals
    for (const intervalId of this.metadataIntervals.values()) {
      clearInterval(intervalId);
    }
    this.metadataIntervals.clear();
    
    // Close all client connections
    for (const client of this.clients.values()) {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.close();
      }
    }
    this.clients.clear();
    
    logger.log('🧹 REALTIME METADATA: Service cleaned up');
  }
}
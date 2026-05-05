// Custom real-time metadata client (inspired by Radiolise but built for our platform)

import { logger } from '@/lib/logger';

interface MetadataCallback {
  (data: { title?: string; artist?: string; station?: string; genre?: string; error?: string }): void;
}

interface MetadataSubscription {
  unsubscribe(): void;
}

interface MetadataClient {
  subscribe(callback: MetadataCallback): MetadataSubscription;
  trackStream(streamUrl?: string): void;
  disconnect(): void;
}

interface MetadataClientOptions {
  url?: string;
  reconnect?: boolean;
  reconnectDelay?: number;
  onSocketError?: (code: number) => void;
}

export const ErrorTypes = {
  MALFORMED_PAYLOAD: 'MALFORMED_PAYLOAD',
  SERVER_UNREACHABLE: 'SERVER_UNREACHABLE',
  SERVER_HTTP_ERROR: 'SERVER_HTTP_ERROR',
  NON_ICY_RESOURCE: 'NON_ICY_RESOURCE',
} as const;

export function createMetadataClient(options: MetadataClientOptions): MetadataClient {
  const {
    url = getWebSocketUrl(),
    reconnect = true,
    reconnectDelay = 2000,
    onSocketError
  } = options;

  let socket: WebSocket | null = null;
  let isConnecting = false;
  let shouldReconnect = true;
  let currentStreamUrl: string | undefined;
  const subscribers = new Set<MetadataCallback>();
  let reconnectTimeoutId: number | null = null;
  let reconnectAttempts = 0;
  const maxReconnectDelay = 30000;

  function getWebSocketUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    return `${protocol}//${host}/ws/metadata`;
  }

  function emit(data: { title?: string; artist?: string; station?: string; genre?: string; error?: string }) {
    subscribers.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('❌ Metadata callback error:', error);
      }
    });
  }

  function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (socket?.readyState === WebSocket.OPEN || isConnecting) {
        resolve();
        return;
      }

      isConnecting = true;
      logger.log('🎵 METADATA: Connecting to WebSocket server...');

      try {
        socket = new WebSocket(url);
        
        socket.onopen = () => {
          logger.log('✅ METADATA: WebSocket connected');
          isConnecting = false;
          reconnectAttempts = 0;
          
          // If we have a current stream, start tracking it
          if (currentStreamUrl) {
            sendMessage({ action: 'trackStream', streamUrl: currentStreamUrl });
          }
          
          resolve();
        };

        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            handleMessage(message);
          } catch (error) {
            console.error('❌ METADATA: Invalid message format:', error);
            emit({ error: ErrorTypes.MALFORMED_PAYLOAD });
          }
        };

        socket.onclose = (event) => {
          logger.log(`🔌 METADATA: WebSocket disconnected (code: ${event.code})`);
          isConnecting = false;
          socket = null;
          
          if (onSocketError) {
            onSocketError(event.code);
          }

          // Auto-reconnect if enabled
          if (shouldReconnect && reconnect) {
            scheduleReconnect();
          }
        };

        socket.onerror = (error) => {
          console.error('❌ METADATA: WebSocket error:', error);
          isConnecting = false;
          reject(error);
          emit({ error: ErrorTypes.SERVER_UNREACHABLE });
        };

      } catch (error) {
        isConnecting = false;
        reject(error);
        emit({ error: ErrorTypes.SERVER_UNREACHABLE });
      }
    });
  }

  function scheduleReconnect() {
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
    }
    
    reconnectAttempts++;
    const delay = Math.min(reconnectDelay * Math.pow(2, reconnectAttempts - 1), maxReconnectDelay);
    
    reconnectTimeoutId = window.setTimeout(() => {
      if (shouldReconnect) {
        logger.log(`🔄 METADATA: Reconnect attempt ${reconnectAttempts} (delay: ${delay}ms)`);
        connect().catch(console.error);
      }
    }, delay);
  }

  function handleMessage(message: any) {
    switch (message.action) {
      case 'connected':
        logger.log('🎵 METADATA: Service ready');
        break;
        
      case 'setTitle':
        const { title, artist, station, genre } = message.data;
        logger.log('🎵 METADATA: Real-time update:', message.data);
        emit({ title, artist, station, genre });
        break;
        
      case 'reportError':
        const { type, detail } = message.data;
        logger.log('❌ METADATA: Server error:', type, detail);
        emit({ error: type });
        break;
        
      default:
        logger.log('❓ METADATA: Unknown message type:', message.action);
    }
  }

  function sendMessage(message: any) {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      logger.log('⚠️ METADATA: Socket not ready, queuing message');
      // Connect and then send the message
      connect().then(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      }).catch(console.error);
    }
  }

  // Auto-connect on creation
  connect().catch(console.error);

  return {
    subscribe(callback: MetadataCallback): MetadataSubscription {
      subscribers.add(callback);
      logger.log(`🎵 METADATA: Subscriber added (total: ${subscribers.size})`);
      
      return {
        unsubscribe() {
          subscribers.delete(callback);
          logger.log(`🎵 METADATA: Subscriber removed (total: ${subscribers.size})`);
        }
      };
    },

    trackStream(streamUrl?: string) {
      currentStreamUrl = streamUrl;
      
      if (streamUrl) {
        logger.log(`🎯 METADATA: Tracking stream for real-time metadata: ${streamUrl}`);
        sendMessage({ action: 'trackStream', streamUrl });
      } else {
        logger.log('🛑 METADATA: Stopped tracking stream');
        sendMessage({ action: 'stopTracking' });
      }
    },

    disconnect() {
      shouldReconnect = false;
      
      if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
      }
      
      if (socket) {
        socket.close();
        socket = null;
      }
      
      subscribers.clear();
      logger.log('🧹 METADATA: Client disconnected and cleaned up');
    }
  };
}
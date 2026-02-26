import { type WebSocket } from 'ws';
import { logger } from '../utils/logger';

interface ChatClient {
  ws: WebSocket;
  userId: string;
  connectedAt: Date;
}

class ChatService {
  // userId → Set of WebSocket clients (user can have multiple tabs/devices)
  private clients = new Map<string, Set<ChatClient>>();

  /** Register a new WebSocket connection for a user */
  addClient(userId: string, ws: WebSocket): ChatClient {
    const client: ChatClient = { ws, userId, connectedAt: new Date() };
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(client);
    logger.log(`💬 CHAT: User ${userId} connected (${this.clients.get(userId)!.size} tabs)`);
    return client;
  }

  /** Remove a WebSocket connection */
  removeClient(userId: string, client: ChatClient) {
    const set = this.clients.get(userId);
    if (set) {
      set.delete(client);
      if (set.size === 0) {
        this.clients.delete(userId);
        logger.log(`💬 CHAT: User ${userId} disconnected (all tabs closed)`);
      }
    }
  }

  /** Check if a user is online */
  isOnline(userId: string): boolean {
    return this.clients.has(userId) && this.clients.get(userId)!.size > 0;
  }

  /** Get all online user IDs */
  getOnlineUsers(): string[] {
    return Array.from(this.clients.keys());
  }

  /** Send a payload to all connections of a specific user */
  sendToUser(userId: string, payload: object): boolean {
    const set = this.clients.get(userId);
    if (!set || set.size === 0) return false;

    const data = JSON.stringify(payload);
    let sent = false;
    for (const client of set) {
      try {
        if (client.ws.readyState === 1 /* OPEN */) {
          client.ws.send(data);
          sent = true;
        }
      } catch (err) {
        logger.error(`💬 CHAT: Failed to send to user ${userId}:`, err);
      }
    }
    return sent;
  }

  /** Broadcast to a list of user IDs */
  broadcastToUsers(userIds: string[], payload: object) {
    const data = JSON.stringify(payload);
    for (const uid of userIds) {
      const set = this.clients.get(uid);
      if (!set) continue;
      for (const client of set) {
        try {
          if (client.ws.readyState === 1) client.ws.send(data);
        } catch {}
      }
    }
  }
}

export const chatService = new ChatService();

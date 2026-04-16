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

  // userId → partnerId they are currently viewing (null = not in chat)
  private activeConversations = new Map<string, string>();

  private static MAX_CONNECTIONS_PER_USER = 5;
  // If a client can't keep up, drop the connection instead of buffering unbounded frames in ws internal buffer
  private static WS_BUFFER_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2MB

  private safeSend(ws: WebSocket, data: string): boolean {
    try {
      if (ws.readyState !== 1) return false;
      if ((ws as any).bufferedAmount > ChatService.WS_BUFFER_THRESHOLD_BYTES) {
        try { ws.close(1013, 'slow consumer'); } catch {}
        return false;
      }
      ws.send(data);
      return true;
    } catch {
      return false;
    }
  }

  /** Register a new WebSocket connection for a user */
  addClient(userId: string, ws: WebSocket): ChatClient {
    const client: ChatClient = { ws, userId, connectedAt: new Date() };
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    const set = this.clients.get(userId)!;
    if (set.size >= ChatService.MAX_CONNECTIONS_PER_USER) {
      const oldest = [...set].sort((a, b) => a.connectedAt.getTime() - b.connectedAt.getTime())[0];
      if (oldest) {
        try { oldest.ws.close(4003, "Too many connections"); } catch {}
        set.delete(oldest);
      }
    }
    set.add(client);
    logger.log(`💬 CHAT: User ${userId} connected (${set.size} tabs)`);
    return client;
  }

  /** Remove a WebSocket connection */
  removeClient(userId: string, client: ChatClient) {
    const set = this.clients.get(userId);
    if (set) {
      set.delete(client);
      if (set.size === 0) {
        this.clients.delete(userId);
        this.activeConversations.delete(userId);
        logger.log(`💬 CHAT: User ${userId} disconnected (all tabs closed)`);
      }
    }
  }

  /** Track which conversation a user is actively viewing */
  setActiveConversation(userId: string, partnerId: string | null) {
    if (partnerId) {
      this.activeConversations.set(userId, partnerId);
    } else {
      this.activeConversations.delete(userId);
    }
  }

  /** Get the partnerId a user is currently viewing, or null */
  getActiveConversation(userId: string): string | null {
    return this.activeConversations.get(userId) ?? null;
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
      if (this.safeSend(client.ws, data)) sent = true;
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
        this.safeSend(client.ws, data);
      }
    }
  }
}

export const chatService = new ChatService();

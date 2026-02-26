import type { Express } from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import { type WebSocketServer, type WebSocket } from 'ws';
import { DirectMessage, User, UserFollow, UserNotification } from "../../shared/mongo-schemas";
import { chatService } from "../services/chat-service";
import { logger } from "../utils/logger";

// ─── In-memory WS ticket store (userId, expires in 60s) ───────────────────────
const wsTickets = new Map<string, { userId: string; expiresAt: number }>();

// Cleanup expired tickets every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ticket, data] of wsTickets) {
    if (data.expiresAt < now) wsTickets.delete(ticket);
  }
}, 120_000);

// ─── Follow check helper ───────────────────────────────────────────────────────
async function canChat(userA: string, userB: string): Promise<boolean> {
  const [aFollowsB, bFollowsA] = await Promise.all([
    UserFollow.exists({ userId: userA, followingUserId: userB }),
    UserFollow.exists({ userId: userB, followingUserId: userA }),
  ]);
  return !!(aFollowsB || bFollowsA);
}

// ─── Route registration ───────────────────────────────────────────────────────
export function registerMessagesRoutes(app: Express, chatWss: WebSocketServer, deps: any) {
  const { requireAuth } = deps;

  // ── GET /api/messages/ws-ticket ─────────────────────────────────────────────
  // Returns a one-time ticket for WebSocket auth (expires in 60s)
  app.get("/api/messages/ws-ticket", requireAuth, (req, res) => {
    const userId = (req.session as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const ticket = crypto.randomBytes(32).toString("hex");
    wsTickets.set(ticket, { userId, expiresAt: Date.now() + 60_000 });
    res.json({ ticket });
  });

  // ── GET /api/messages/contacts ──────────────────────────────────────────────
  // Returns people the current user can chat with (follows them or they follow back)
  app.get("/api/messages/contacts", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as string;

      // People I follow
      const following = await UserFollow.find({ userId }).select("followingUserId").lean();
      // People who follow me
      const followers = await UserFollow.find({ followingUserId: userId }).select("userId").lean();

      const followingIds = following.map(f => f.followingUserId.toString());
      const followerIds = followers.map(f => f.userId.toString());
      const allContactIds = [...new Set([...followingIds, ...followerIds])].filter(id => id !== userId);

      const contacts = await User.find({ _id: { $in: allContactIds } })
        .select("username fullName avatar profileImageUrl")
        .lean();

      // Annotate with relationship
      const result = contacts.map(c => ({
        ...c,
        iFollow: followingIds.includes(c._id.toString()),
        followsMe: followerIds.includes(c._id.toString()),
        online: chatService.isOnline(c._id.toString()),
      }));

      res.json({ contacts: result });
    } catch (err) {
      logger.error("Failed to fetch contacts:", err);
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  // ── GET /api/messages/conversations ─────────────────────────────────────────
  app.get("/api/messages/conversations", requireAuth, async (req, res) => {
    try {
      const userId = new mongoose.Types.ObjectId((req.session as any).userId);

      const conversations = await DirectMessage.aggregate([
        { $match: { $or: [{ fromUserId: userId }, { toUserId: userId }] } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: {
              $cond: [
                { $lt: ["$fromUserId", "$toUserId"] },
                { a: "$fromUserId", b: "$toUserId" },
                { a: "$toUserId", b: "$fromUserId" },
              ],
            },
            lastMessage: { $first: "$$ROOT" },
            unreadCount: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ["$toUserId", userId] }, { $eq: ["$read", false] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { "lastMessage.createdAt": -1 } },
        { $limit: 50 },
      ]);

      const results = await Promise.all(
        conversations.map(async (conv) => {
          const partnerId =
            conv.lastMessage.fromUserId.toString() === userId.toString()
              ? conv.lastMessage.toUserId
              : conv.lastMessage.fromUserId;

          const partner = await User.findById(partnerId)
            .select("username fullName avatar profileImageUrl")
            .lean();

          return {
            partnerId: partnerId.toString(),
            partner,
            lastMessage: conv.lastMessage.content,
            lastMessageAt: conv.lastMessage.createdAt,
            unreadCount: conv.unreadCount,
            online: chatService.isOnline(partnerId.toString()),
          };
        })
      );

      res.json({ conversations: results });
    } catch (error) {
      logger.error("Failed to fetch conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // ── GET /api/messages/unread-count ──────────────────────────────────────────
  app.get("/api/messages/unread-count", requireAuth, async (req, res) => {
    try {
      const userId = new mongoose.Types.ObjectId((req.session as any).userId);
      const count = await DirectMessage.countDocuments({ toUserId: userId, read: false });
      res.json({ count });
    } catch {
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  });

  // ── GET /api/messages/conversation/:partnerId ────────────────────────────────
  app.get("/api/messages/conversation/:partnerId", requireAuth, async (req, res) => {
    try {
      const userId = new mongoose.Types.ObjectId((req.session as any).userId);
      let partnerId: mongoose.Types.ObjectId;
      try {
        partnerId = new mongoose.Types.ObjectId(req.params.partnerId);
      } catch {
        return res.status(400).json({ error: "Invalid partner ID" });
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      // Cursor-based pagination: before= message _id
      const before = req.query.before as string;

      const filter: any = {
        $or: [
          { fromUserId: userId, toUserId: partnerId },
          { fromUserId: partnerId, toUserId: userId },
        ],
      };
      if (before) {
        try {
          filter._id = { $lt: new mongoose.Types.ObjectId(before) };
        } catch {}
      }

      const messages = await DirectMessage.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      // Mark messages as read
      await DirectMessage.updateMany(
        { fromUserId: partnerId, toUserId: userId, read: false },
        { $set: { read: true } }
      );

      // Notify sender their messages were read via WS
      chatService.sendToUser(partnerId.toString(), {
        type: "chat:read",
        byUserId: userId.toString(),
      });

      const partner = await User.findById(partnerId)
        .select("username fullName avatar profileImageUrl")
        .lean();

      res.json({
        messages: messages.reverse(), // oldest first
        partner: partner ? { ...partner, online: chatService.isOnline(partnerId.toString()) } : null,
        hasMore: messages.length === limit,
      });
    } catch (error) {
      logger.error("Failed to fetch messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // ── POST /api/messages/send ──────────────────────────────────────────────────
  app.post("/api/messages/send", requireAuth, async (req, res) => {
    try {
      const fromUserId = (req.session as any).userId as string;
      const { toUserId, content } = req.body;

      if (!toUserId || !content?.trim()) {
        return res.status(400).json({ error: "toUserId and content are required" });
      }
      if (content.trim().length > 2000) {
        return res.status(400).json({ error: "Message too long (max 2000 chars)" });
      }

      let targetId: mongoose.Types.ObjectId;
      try {
        targetId = new mongoose.Types.ObjectId(toUserId);
      } catch {
        return res.status(400).json({ error: "Invalid toUserId" });
      }

      if (targetId.toString() === fromUserId) {
        return res.status(400).json({ error: "Cannot message yourself" });
      }

      // ── Follow check ──────────────────────────────────────────────────────
      const allowed = await canChat(fromUserId, targetId.toString());
      if (!allowed) {
        return res.status(403).json({
          error: "You can only message people you follow or who follow you",
        });
      }

      const targetUser = await User.findById(targetId).select("_id username fullName avatar profileImageUrl").lean();
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const fromObjId = new mongoose.Types.ObjectId(fromUserId);
      const message = await DirectMessage.create({
        fromUserId: fromObjId,
        toUserId: targetId,
        content: content.trim(),
        read: false,
      });

      // ── Get sender info for real-time push ───────────────────────────────
      const sender = await User.findById(fromObjId)
        .select("username fullName avatar profileImageUrl")
        .lean();

      const wsPayload = {
        type: "chat:message",
        message: {
          _id: message._id.toString(),
          fromUserId,
          toUserId: targetId.toString(),
          content: message.content,
          read: false,
          createdAt: message.createdAt,
        },
        sender,
      };

      // Push to recipient in real-time
      chatService.sendToUser(targetId.toString(), wsPayload);
      // Echo back to sender (other tabs)
      chatService.sendToUser(fromUserId, { ...wsPayload, echo: true });

      // ── In-app notification if recipient is offline ───────────────────────
      if (!chatService.isOnline(targetId.toString())) {
        try {
          await UserNotification.create({
            userId: targetId,
            type: "new_message",
            fromUserId: fromObjId,
            title: "New message",
            message: `${sender?.fullName || sender?.username || "Someone"} sent you a message`,
            read: false,
          });
        } catch {}
      }

      res.json({ success: true, message });
    } catch (error) {
      logger.error("Failed to send message:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // ── GET /api/messages/search-users ──────────────────────────────────────────
  // Only returns users that follow current user or current user follows (can-chat check)
  app.get("/api/messages/search-users", requireAuth, async (req, res) => {
    try {
      const q = (req.query.q as string)?.trim();
      if (!q || q.length < 2) return res.json({ users: [] });

      const userId = (req.session as any).userId as string;
      const userObjId = new mongoose.Types.ObjectId(userId);

      // Get IDs of people connected via follow
      const [following, followers] = await Promise.all([
        UserFollow.find({ userId: userObjId }).select("followingUserId").lean(),
        UserFollow.find({ followingUserId: userObjId }).select("userId").lean(),
      ]);

      const contactIds = [
        ...following.map(f => f.followingUserId),
        ...followers.map(f => f.userId),
      ];

      const users = await User.find({
        _id: { $in: contactIds },
        $or: [
          { username: { $regex: q, $options: "i" } },
          { fullName: { $regex: q, $options: "i" } },
        ],
      })
        .select("username fullName avatar profileImageUrl")
        .limit(10)
        .lean();

      const result = users.map(u => ({
        ...u,
        online: chatService.isOnline(u._id.toString()),
      }));

      res.json({ users: result });
    } catch {
      res.status(500).json({ error: "Search failed" });
    }
  });

  // ── GET /api/messages/online-status ─────────────────────────────────────────
  app.get("/api/messages/online-status", requireAuth, async (req, res) => {
    const userIds = ((req.query.userIds as string) || "").split(",").filter(Boolean);
    const status: Record<string, boolean> = {};
    for (const uid of userIds) status[uid] = chatService.isOnline(uid);
    res.json({ status });
  });

  // ── WebSocket Handler at /ws/chat ────────────────────────────────────────────
  chatWss.on("connection", async (socket: WebSocket, request) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const ticket = url.searchParams.get("ticket");

    // ── Validate ticket ────────────────────────────────────────────────────
    if (!ticket) {
      socket.send(JSON.stringify({ type: "error", message: "Missing ticket" }));
      socket.close(4001, "No ticket provided");
      return;
    }

    const ticketData = wsTickets.get(ticket);
    if (!ticketData || ticketData.expiresAt < Date.now()) {
      wsTickets.delete(ticket);
      socket.send(JSON.stringify({ type: "error", message: "Invalid or expired ticket" }));
      socket.close(4002, "Invalid ticket");
      return;
    }

    const userId = ticketData.userId;
    wsTickets.delete(ticket); // one-time use

    // ── Register connection ────────────────────────────────────────────────
    const client = chatService.addClient(userId, socket);

    // Notify user's contacts that they came online
    broadcastOnlineStatus(userId, true);

    socket.send(JSON.stringify({
      type: "chat:connected",
      userId,
      onlineUsers: chatService.getOnlineUsers(),
    }));

    // ── Incoming message handler ───────────────────────────────────────────
    socket.on("message", async (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString());

        switch (msg.type) {
          case "chat:typing": {
            if (!msg.toUserId) break;
            chatService.sendToUser(msg.toUserId, {
              type: "chat:typing",
              fromUserId: userId,
            });
            break;
          }

          case "chat:read": {
            if (!msg.fromUserId) break;
            // Mark all messages from fromUserId to this user as read in DB
            await DirectMessage.updateMany(
              {
                fromUserId: new mongoose.Types.ObjectId(msg.fromUserId),
                toUserId: new mongoose.Types.ObjectId(userId),
                read: false,
              },
              { $set: { read: true } }
            );
            chatService.sendToUser(msg.fromUserId, {
              type: "chat:read",
              byUserId: userId,
            });
            break;
          }

          case "chat:ping": {
            socket.send(JSON.stringify({ type: "chat:pong" }));
            break;
          }
        }
      } catch (err) {
        logger.error("CHAT WS message error:", err);
      }
    });

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on("close", () => {
      chatService.removeClient(userId, client);
      // Notify contacts if now fully offline
      if (!chatService.isOnline(userId)) {
        broadcastOnlineStatus(userId, false);
      }
    });

    socket.on("error", (err) => {
      logger.error(`CHAT WS error for user ${userId}:`, err);
    });
  });

  // ── Helper: broadcast online status to contacts ─────────────────────────────
  async function broadcastOnlineStatus(userId: string, online: boolean) {
    try {
      const userObjId = new mongoose.Types.ObjectId(userId);
      const [following, followers] = await Promise.all([
        UserFollow.find({ userId: userObjId }).select("followingUserId").lean(),
        UserFollow.find({ followingUserId: userObjId }).select("userId").lean(),
      ]);

      const contactIds = [
        ...following.map(f => f.followingUserId.toString()),
        ...followers.map(f => f.userId.toString()),
      ].filter(id => id !== userId);

      chatService.broadcastToUsers(contactIds, {
        type: "chat:online_status",
        userId,
        online,
      });
    } catch {}
  }
}

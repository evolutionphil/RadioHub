import type { Express } from "express";
import mongoose from "mongoose";
import { DirectMessage, User } from "../../shared/mongo-schemas";
import { logger } from "../utils/logger";

export function registerMessagesRoutes(app: Express, deps: any) {
  const { requireAuth } = deps;

  // GET /api/messages/conversations — list all conversations for current user
  app.get("/api/messages/conversations", requireAuth, async (req, res) => {
    try {
      const userId = new mongoose.Types.ObjectId((req.session as any).userId);

      // Aggregate conversations: latest message per partner
      const conversations = await DirectMessage.aggregate([
        {
          $match: {
            $or: [{ fromUserId: userId }, { toUserId: userId }],
          },
        },
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

      // Populate partner user info
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
          };
        })
      );

      res.json({ conversations: results });
    } catch (error) {
      logger.error("Failed to fetch conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // GET /api/messages/unread-count — total unread messages for badge
  app.get("/api/messages/unread-count", requireAuth, async (req, res) => {
    try {
      const userId = new mongoose.Types.ObjectId((req.session as any).userId);
      const count = await DirectMessage.countDocuments({ toUserId: userId, read: false });
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  });

  // GET /api/messages/conversation/:partnerId — messages with specific user
  app.get("/api/messages/conversation/:partnerId", requireAuth, async (req, res) => {
    try {
      const userId = new mongoose.Types.ObjectId((req.session as any).userId);
      let partnerId: mongoose.Types.ObjectId;
      try {
        partnerId = new mongoose.Types.ObjectId(req.params.partnerId);
      } catch {
        return res.status(400).json({ error: "Invalid partner ID" });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const skip = (page - 1) * limit;

      const messages = await DirectMessage.find({
        $or: [
          { fromUserId: userId, toUserId: partnerId },
          { fromUserId: partnerId, toUserId: userId },
        ],
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      // Mark messages from partner as read
      await DirectMessage.updateMany(
        { fromUserId: partnerId, toUserId: userId, read: false },
        { $set: { read: true } }
      );

      // Get partner info
      const partner = await User.findById(partnerId)
        .select("username fullName avatar profileImageUrl")
        .lean();

      res.json({
        messages: messages.reverse(), // oldest first
        partner,
        page,
      });
    } catch (error) {
      logger.error("Failed to fetch messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // POST /api/messages/send — send a message
  app.post("/api/messages/send", requireAuth, async (req, res) => {
    try {
      const userId = new mongoose.Types.ObjectId((req.session as any).userId);
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

      if (targetId.toString() === userId.toString()) {
        return res.status(400).json({ error: "Cannot message yourself" });
      }

      // Verify target user exists
      const targetUser = await User.findById(targetId).select("_id").lean();
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const message = await DirectMessage.create({
        fromUserId: userId,
        toUserId: targetId,
        content: content.trim(),
        read: false,
      });

      res.json({ success: true, message });
    } catch (error) {
      logger.error("Failed to send message:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // GET /api/messages/search-users — search users to start conversation
  app.get("/api/messages/search-users", requireAuth, async (req, res) => {
    try {
      const q = (req.query.q as string)?.trim();
      if (!q || q.length < 2) return res.json({ users: [] });

      const userId = (req.session as any).userId;

      const users = await User.find({
        _id: { $ne: userId },
        $or: [
          { username: { $regex: q, $options: "i" } },
          { fullName: { $regex: q, $options: "i" } },
        ],
      })
        .select("username fullName avatar profileImageUrl")
        .limit(10)
        .lean();

      res.json({ users });
    } catch (error) {
      res.status(500).json({ error: "Search failed" });
    }
  });
}

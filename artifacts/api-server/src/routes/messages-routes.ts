import type { Express } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import multer from "multer";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { type WebSocketServer, type WebSocket } from 'ws';
import { chatService } from "../services/chat-service";
import { logger } from "../utils/logger";
import { notificationStore, pgMarkConversationNotificationsRead, pgUpsertMessageNotification, } from "../data/postgres-notification-store";
import { pgFindUserById, userStore } from "../data/postgres-user-store";
import { engagementStore } from "../services/user-engagement-service";
import { pgFollowPage, pgIsFollowing } from "../data/postgres-engagement-store";
import { messageStore, pgConversationMessages, pgConversations, pgCreateMessage, pgMarkMessagesRead, pgMessageContacts, pgUnreadMessageCount, } from "../data/postgres-message-store";
function normalizeIp(ip: string | undefined): string {
    if (!ip)
        return 'unknown';
    // Treat an IPv4-mapped socket as IPv4 before applying the IPv6 subnet key.
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
export const messageRateLimitKey = (req: any): string =>
    req.session?.user?.userId || ipKeyGenerator(normalizeIp(req.ip));
// 20 messages per minute per user — allows normal chat while blocking spam
const messageSendLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    keyGenerator: messageRateLimitKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many messages sent. Please slow down." },
});
// 10 image uploads per 5 minutes per user
const imageUploadLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    keyGenerator: messageRateLimitKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many image uploads. Please wait a moment." },
});
// ─── In-memory WS ticket store (userId, expires in 60s) ───────────────────────
const wsTickets = new Map<string, {
    userId: string;
    expiresAt: number;
}>();
// Per-user live ticket tracking — revoke previous ticket when a user requests a new one
// (bounds memory at O(users) instead of O(ticket requests/minute)).
const userActiveTicket = new Map<string, string>();
// Hard cap to protect against malicious auth-then-request-ticket loops from many accounts.
const WS_TICKETS_MAX = 20000;
// Single helper: always delete ticket from both maps atomically to keep lifecycles symmetric.
function deleteWsTicket(ticket: string): void {
    const data = wsTickets.get(ticket);
    if (!data)
        return;
    wsTickets.delete(ticket);
    if (userActiveTicket.get(data.userId) === ticket) {
        userActiveTicket.delete(data.userId);
    }
}
function issueWsTicket(userId: string): string {
    // Revoke any previous ticket for this user (only one pending ticket at a time)
    const prior = userActiveTicket.get(userId);
    if (prior)
        deleteWsTicket(prior);
    // Evict oldest if over hard cap (Map iteration order = insertion order).
    // Use symmetric deletion so userActiveTicket's reverse mapping is also cleared.
    if (wsTickets.size >= WS_TICKETS_MAX) {
        const oldest = wsTickets.keys().next().value;
        if (oldest !== undefined)
            deleteWsTicket(oldest);
    }
    const ticket = crypto.randomBytes(32).toString("hex");
    wsTickets.set(ticket, { userId, expiresAt: Date.now() + 60000 });
    userActiveTicket.set(userId, ticket);
    return ticket;
}
// Cleanup expired tickets every 2 minutes — also sweeps orphaned userActiveTicket entries
// whose ticket no longer exists in wsTickets (defensive invariant cleanup).
// unref() so this background timer never blocks process exit during shutdown.
const _ticketCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ticket, data] of wsTickets) {
        if (data.expiresAt < now)
            deleteWsTicket(ticket);
    }
    for (const [uid, ticket] of userActiveTicket) {
        if (!wsTickets.has(ticket))
            userActiveTicket.delete(uid);
    }
}, 120000);
if (typeof (_ticketCleanupTimer as any).unref === 'function')
    (_ticketCleanupTimer as any).unref();
// ─── Session userId helper ─────────────────────────────────────────────────────
function getSessionUserId(req: any): string | null {
    return req.session?.user?.userId || null;
}
// PostgreSQL identity rows also contain credentials and billing data. Chat
// responses must use the same public projection as the former Mongo queries.
function publicChatUser(user: any): any | null {
    if (!user)
        return null;
    return {
        _id: String(user._id ?? user.id),
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar,
        profileImageUrl: user.profileImageUrl,
    };
}
async function markConversationNotificationsRead(userId: string, partnerId: string): Promise<void> {
    {
        await pgMarkConversationNotificationsRead(userId, partnerId);
    }
}
// ─── Follow check helper ───────────────────────────────────────────────────────
async function canChat(userA: string, userB: string): Promise<boolean> {
    {
        const [aFollowsB, bFollowsA] = await Promise.all([
            pgIsFollowing(userA, userB), pgIsFollowing(userB, userA),
        ]);
        return aFollowsB || bFollowsA;
    }
}
// ─── Route registration ───────────────────────────────────────────────────────
export function registerMessagesRoutes(app: Express, chatWss: WebSocketServer, deps: any) {
    const { requireAuth } = deps;
    // ── GET /api/messages/ws-ticket ─────────────────────────────────────────────
    // Returns a one-time ticket for WebSocket auth (expires in 60s)
    app.get("/api/messages/ws-ticket", requireAuth, (req, res) => {
        const userId = getSessionUserId(req);
        if (!userId)
            return void res.status(401).json({ error: "Not authenticated" });
        const ticket = issueWsTicket(userId);
        res.json({ ticket });
    });
    // ── GET /api/messages/contacts ──────────────────────────────────────────────
    // Returns people the current user can chat with (follows them or they follow back)
    app.get("/api/messages/contacts", requireAuth, async (req, res) => {
        try {
            const userId = getSessionUserId(req);
            if (!userId)
                return void res.status(401).json({ error: "Not authenticated" });
            {
                const contacts = (await pgMessageContacts(userId)).map((contact) => ({
                    ...contact, online: chatService.isOnline(String(contact._id)),
                }));
                return void res.json({ contacts });
            }
        }
        catch (err) {
            logger.error("Failed to fetch contacts:", err);
            res.status(500).json({ error: "Failed to fetch contacts" });
        }
    });
    // ── GET /api/messages/conversations ─────────────────────────────────────────
    app.get("/api/messages/conversations", requireAuth, async (req, res) => {
        try {
            const rawId = getSessionUserId(req);
            if (!rawId)
                return void res.status(401).json({ error: "Not authenticated" });
            {
                const conversations = (await pgConversations(rawId)).map((conversation) => ({
                    ...conversation, online: chatService.isOnline(conversation.partnerId),
                }));
                return void res.json({ conversations });
            }
        }
        catch (error) {
            logger.error("Failed to fetch conversations:", error);
            res.status(500).json({ error: "Failed to fetch conversations" });
        }
    });
    // ── GET /api/messages/unread-count ──────────────────────────────────────────
    app.get("/api/messages/unread-count", requireAuth, async (req, res) => {
        try {
            const rawId = getSessionUserId(req);
            if (!rawId)
                return void res.status(401).json({ error: "Not authenticated" });
            {
                return void res.json({ count: await pgUnreadMessageCount(rawId) });
            }
        }
        catch {
            res.status(500).json({ error: "Failed to fetch unread count" });
        }
    });
    // ── GET /api/messages/conversation/:partnerId ────────────────────────────────
    app.get("/api/messages/conversation/:partnerId", requireAuth, async (req, res) => {
        try {
            const rawId = getSessionUserId(req);
            if (!rawId)
                return void res.status(401).json({ error: "Not authenticated" });
            {
                const partnerId = req.params.partnerId;
                if (!/^[0-9a-f]{24}$/i.test(partnerId))
                    return void res.status(400).json({ error: "Invalid partner ID" });
                const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 50, 100));
                const before = req.query.before as string | undefined;
                const [messages, partner] = await Promise.all([
                    pgConversationMessages(rawId, partnerId, before, limit),
                    pgFindUserById(partnerId),
                ]);
                await Promise.all([
                    pgMarkMessagesRead(rawId, partnerId),
                    markConversationNotificationsRead(rawId, partnerId),
                ]);
                chatService.sendToUser(partnerId, { type: "chat:read", byUserId: rawId });
                return void res.json({
                    messages,
                    partner: partner ? { ...publicChatUser(partner), online: chatService.isOnline(partnerId) } : null,
                    hasMore: messages.length === limit,
                });
            }
        }
        catch (error) {
            logger.error("Failed to fetch messages:", error);
            res.status(500).json({ error: "Failed to fetch messages" });
        }
    });
    // ── POST /api/messages/upload-image ─────────────────────────────────────────
    const chatUploadsDir = path.resolve(process.cwd(), 'public', 'uploads', 'chat');
    fs.mkdir(chatUploadsDir, { recursive: true }).catch(() => { });
    const chatUpload = multer({
        storage: multer.diskStorage({
            destination: chatUploadsDir,
            filename: (_req, file, cb) => {
                const ext = path.extname(file.originalname) || '.jpg';
                cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
            }
        }),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
            cb(null, file.mimetype.startsWith('image/'));
        }
    });
    app.post("/api/messages/upload-image", requireAuth, imageUploadLimiter, chatUpload.single('image'), async (req: any, res) => {
        try {
            if (!req.file)
                return void res.status(400).json({ error: 'No image uploaded' });
            // Magic-byte validation — MIME header can be spoofed; file bytes cannot.
            const fh = await fs.open(req.file.path, 'r');
            const buf = Buffer.alloc(12);
            await fh.read(buf, 0, 12, 0);
            await fh.close();
            const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
            const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
            const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
            const isWebP = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
                && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
            if (!isJpeg && !isPng && !isGif && !isWebP) {
                await fs.unlink(req.file.path).catch(() => { });
                return void res.status(400).json({ error: 'Invalid image format' });
            }
            const imageUrl = `/uploads/chat/${req.file.filename}`;
            res.json({ imageUrl });
        }
        catch (error) {
            if (req.file?.path)
                await fs.unlink(req.file.path).catch(() => { });
            logger.error("Chat image upload failed:", error);
            res.status(500).json({ error: "Upload failed" });
        }
    });
    // ── POST /api/messages/send ──────────────────────────────────────────────────
    app.post("/api/messages/send", requireAuth, messageSendLimiter, async (req, res) => {
        try {
            const fromUserId = getSessionUserId(req);
            if (!fromUserId)
                return void res.status(401).json({ error: "Not authenticated" });
            const { toUserId, content, messageType, imageUrl } = req.body;
            if (!toUserId || typeof content !== 'string' || !content.trim()) {
                return void res.status(400).json({ error: "toUserId and content are required" });
            }
            if (content.trim().length > 2000) {
                return void res.status(400).json({ error: "Message too long (max 2000 chars)" });
            }
            if (typeof toUserId !== 'string' || !/^[a-f0-9]{24}$/i.test(toUserId)) {
                return void res.status(400).json({ error: 'Invalid toUserId' });
            }
            const targetId = toUserId.toLowerCase();
            if (targetId.toString() === fromUserId) {
                return void res.status(400).json({ error: "Cannot message yourself" });
            }
            const allowed = await canChat(fromUserId, targetId.toString());
            if (!allowed) {
                return void res.status(403).json({
                    error: "You can only message people you follow or who follow you",
                });
            }
            const targetUser: any = await pgFindUserById(targetId.toString());
            if (!targetUser) {
                return void res.status(404).json({ error: "User not found" });
            }
            const validType = ['text', 'image', 'emoji'].includes(messageType) ? messageType : 'text';
            const messageInput = {
                fromUserId, toUserId: targetId.toString(), content: content.trim(),
                messageType: validType, imageUrl: validType === 'image' && imageUrl ? imageUrl : undefined,
            };
            let message: any;
            {
                try {
                    message = await pgCreateMessage({
                        ...messageInput, ...(message?._id ? { id: message._id.toString() } : {}),
                        ...(message?.createdAt ? { createdAt: message.createdAt } : {}),
                    });
                }
                catch (error) {
                    throw error;
                }
            }
            const sender: any = await pgFindUserById(fromUserId);
            const wsPayload = {
                type: "chat:message",
                message: {
                    _id: message._id.toString(),
                    fromUserId,
                    toUserId: targetId.toString(),
                    content: message.content,
                    messageType: message.messageType || 'text',
                    imageUrl: message.imageUrl,
                    read: false,
                    createdAt: message.createdAt,
                },
                sender: publicChatUser(sender),
            };
            chatService.sendToUser(targetId.toString(), wsPayload);
            chatService.sendToUser(fromUserId, { ...wsPayload, echo: true });
            // Only notify if recipient is NOT currently viewing this conversation
            const recipientActiveWith = chatService.getActiveConversation(targetId.toString());
            const isViewingConversation = recipientActiveWith === fromUserId;
            if (!isViewingConversation) {
                try {
                    // Upsert: one unread notification per sender (10 messages → 1 notification)
                    const notificationInput = {
                        userId: targetId.toString(), fromUserId,
                        title: "Yeni mesaj",
                        message: `${sender?.fullName || sender?.username || "Someone"} size mesaj yazdı`,
                        createdAt: new Date(),
                    };
                    {
                        await pgUpsertMessageNotification({
                            ...notificationInput,
                        });
                    }
                    // WEB PUSH (2026-07-04): also notify the recipient's browser when
                    // they're not viewing the conversation — until now new messages
                    // produced only an in-app socket event + DB row, so users away
                    // from the tab never saw anything on their PC. Fire-and-forget;
                    // sendToUserAllChannels covers web push AND mobile push tokens.
                    void import('../services/pushNotificationService')
                        .then(({ PushNotificationService }) => PushNotificationService.sendToUserAllChannels(targetId.toString(), {
                        title: sender?.fullName || sender?.username || 'Mega Radio',
                        body: content.trim().substring(0, 120),
                        url: '/profile/messages',
                        tag: `dm-${fromUserId}`,
                    } as any))
                        .catch(() => { });
                    chatService.sendToUser(targetId.toString(), {
                        type: "notification:new_message",
                        fromUser: { _id: fromUserId, username: sender?.username, fullName: sender?.fullName, avatar: sender?.avatar || sender?.profileImageUrl },
                        preview: content.trim().substring(0, 60),
                    });
                }
                catch { }
            }
            res.json({ success: true, message });
        }
        catch (error) {
            logger.error("Failed to send message:", error);
            res.status(500).json({ error: "Failed to send message" });
        }
    });
    // ── GET /api/messages/search-users ──────────────────────────────────────────
    app.get("/api/messages/search-users", requireAuth, async (req, res) => {
        try {
            const q = (req.query.q as string)?.trim();
            if (!q || q.length < 2)
                return void res.json({ users: [] });
            const userId = getSessionUserId(req);
            if (!userId)
                return void res.status(401).json({ error: "Not authenticated" });
            {
                const users = (await pgMessageContacts(userId, q)).slice(0, 10).map((user) => ({
                    ...user, online: chatService.isOnline(String(user._id)),
                }));
                return void res.json({ users });
            }
        }
        catch {
            res.status(500).json({ error: "Search failed" });
        }
    });
    // ── GET /api/messages/online-status ─────────────────────────────────────────
    app.get("/api/messages/online-status", requireAuth, async (req, res) => {
        try {
            const userIds = ((req.query.userIds as string) || "").split(",").filter(Boolean);
            const status: Record<string, boolean> = {};
            for (const uid of userIds)
                status[uid] = chatService.isOnline(uid);
            res.json({ status });
        }
        catch (error) {
            logger.error("Failed to check online status:", error);
            res.status(500).json({ error: "Failed to check online status" });
        }
    });
    // ── WebSocket Handler at /ws/chat ────────────────────────────────────────────
    chatWss.on("connection", async (socket: WebSocket, request) => {
        try {
            const url = new URL(request.url || "", `http://${request.headers.host}`);
            const ticket = url.searchParams.get("ticket");
            if (!ticket) {
                socket.send(JSON.stringify({ type: "error", message: "Missing ticket" }));
                socket.close(4001, "No ticket provided");
                return;
            }
            const ticketData = wsTickets.get(ticket);
            if (!ticketData || ticketData.expiresAt < Date.now()) {
                deleteWsTicket(ticket);
                socket.send(JSON.stringify({ type: "error", message: "Invalid or expired ticket" }));
                socket.close(4002, "Invalid ticket");
                return;
            }
            const userId = ticketData.userId;
            deleteWsTicket(ticket);
            const client = chatService.addClient(userId, socket);
            broadcastOnlineStatus(userId, true);
            socket.send(JSON.stringify({
                type: "chat:connected",
                userId,
                onlineUsers: chatService.getOnlineUsers(),
            }));
            socket.on("message", async (rawData) => {
                try {
                    const msg = JSON.parse(rawData.toString());
                    switch (msg.type) {
                        case "chat:typing": {
                            if (!msg.toUserId)
                                break;
                            chatService.sendToUser(msg.toUserId, {
                                type: "chat:typing",
                                fromUserId: userId,
                            });
                            break;
                        }
                        case "chat:read": {
                            if (typeof msg.fromUserId !== "string" || !/^[0-9a-f]{24}$/i.test(msg.fromUserId))
                                break;
                            {
                                await pgMarkMessagesRead(userId, msg.fromUserId);
                            }
                            chatService.sendToUser(msg.fromUserId, {
                                type: "chat:read",
                                byUserId: userId,
                            });
                            break;
                        }
                        case "chat:active": {
                            // User opened/closed a conversation — track it to suppress duplicate notifications
                            const withId = msg.withUserId || null;
                            chatService.setActiveConversation(userId, withId);
                            // Immediately mark any pending notifications from that partner as read
                            if (withId) {
                                try {
                                    {
                                        await pgMarkConversationNotificationsRead(userId, withId);
                                    }
                                }
                                catch { }
                            }
                            break;
                        }
                        case "chat:ping": {
                            socket.send(JSON.stringify({ type: "chat:pong" }));
                            break;
                        }
                    }
                }
                catch (err) {
                    logger.error("CHAT WS message error:", err);
                }
            });
            socket.on("close", () => {
                chatService.setActiveConversation(userId, null);
                chatService.removeClient(userId, client);
                if (!chatService.isOnline(userId)) {
                    broadcastOnlineStatus(userId, false);
                }
            });
            socket.on("error", (err) => {
                logger.error(`CHAT WS error for user ${userId}:`, err);
                chatService.setActiveConversation(userId, null);
                chatService.removeClient(userId, client);
                if (!chatService.isOnline(userId)) {
                    broadcastOnlineStatus(userId, false);
                }
            });
        }
        catch (e: any) {
            // Never let a malformed chat WS upgrade crash the process
            console.error('⚠️ WS chat connection handler error (caught):', e?.message || e);
            try {
                socket.close(1011, 'internal error');
            }
            catch { }
        }
    });
    // ── Helper: broadcast online status to contacts ─────────────────────────────
    async function broadcastOnlineStatus(userId: string, online: boolean) {
        try {
            {
                // Fetch every page: the contacts search deliberately caps its result at
                // 100, which would silently omit presence updates for larger graphs.
                const contactIds = new Set<string>();
                await Promise.all((["following", "followers"] as const).map(async (direction) => {
                    let page = 1;
                    while (true) {
                        const result = await pgFollowPage(userId, direction, page, 500);
                        for (const entry of result[direction])
                            contactIds.add(String(entry.user._id));
                        if (page >= result.pagination.pages || !result[direction].length)
                            break;
                        page++;
                    }
                }));
                contactIds.delete(userId);
                chatService.broadcastToUsers([...contactIds], { type: "chat:online_status", userId, online });
                return;
            }
        }
        catch { }
    }
}

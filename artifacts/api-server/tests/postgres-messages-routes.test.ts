import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ipKeyGenerator } from "express-rate-limit";

const userId = "507f1f77bcf86cd799439011";
const partnerId = "507f1f77bcf86cd799439012";
const nextPageContactId = "507f1f77bcf86cd799439013";
const privateUser = {
  _id: partnerId, username: "listener", fullName: "Radio Listener",
  avatar: "/avatar.png", profileImageUrl: "/profile.png",
  email: "private@example.test", passwordHash: "secret-password-hash",
  resetPasswordToken: "secret-reset-token", resetPasswordExpires: new Date(),
  googleId: "private-social-id", role: "admin",
  pushSubscription: { endpoint: "private-push-endpoint" },
  subscription: { purchaseToken: "private-purchase-token" },
  source: { nestedSecret: "must-not-leave-server" },
};
const publicFields = ["_id", "avatar", "fullName", "profileImageUrl", "username"];
const readCalls: unknown[][] = [];
const notificationReadCalls: unknown[][] = [];
const followPageCalls: unknown[][] = [];
const sent: Array<{ userId: string; payload: any }> = [];
const broadcasts: Array<{ userIds: string[]; payload: any }> = [];
const socketHandlers: Record<string, (...args: any[]) => any> = {};
let connectionHandler: (...args: any[]) => any;
let requestedLimit: number;

const mongoMustNotRun = new Proxy({}, {
  get(_target, key) { throw new Error(`MongoDB call in PostgreSQL chat mode: ${String(key)}`); },
});
mock.module("@workspace/legacy-migration/mongo-schemas", {
  namedExports: { DirectMessage: mongoMustNotRun, User: mongoMustNotRun,
    UserFollow: mongoMustNotRun, UserNotification: mongoMustNotRun },
});
mock.module("express-rate-limit", {
  namedExports: { ipKeyGenerator, rateLimit: () => (_req: any, _res: any, next: () => void) => next() },
});
mock.module("fs/promises", { defaultExport: { mkdir: async () => {} } });
mock.module(new URL("../src/utils/logger.ts", import.meta.url).href, {
  namedExports: { logger: { log() {}, warn() {}, error() {} } },
});
mock.module(new URL("../src/data/postgres-user-store.ts", import.meta.url).href, {
  namedExports: { userStore: "postgres", pgFindUserById: async (id: string) => ({ ...privateUser, _id: id }) },
});
mock.module(new URL("../src/services/user-engagement-service.ts", import.meta.url).href, {
  namedExports: { engagementStore: "postgres" },
});
mock.module(new URL("../src/data/postgres-engagement-store.ts", import.meta.url).href, {
  namedExports: {
    pgIsFollowing: async () => true,
    pgFollowPage: async (...args: any[]) => {
      followPageCalls.push(args);
      const [, direction, page] = args;
      return { [direction]: [{ user: { _id: page === 1 ? partnerId : nextPageContactId } }],
        pagination: { page, pages: 2 } };
    },
  },
});
mock.module(new URL("../src/data/postgres-message-store.ts", import.meta.url).href, {
  namedExports: {
    messageStore: "postgres",
    pgConversationMessages: async (_user: string, _partner: string, _before: any, limit: number) => {
      requestedLimit = limit;
      return [{ _id: "507f1f77bcf86cd799439014", content: "Hello" }];
    },
    pgConversations: async () => [],
    pgCreateMessage: async (input: any) => ({ ...input, _id: "507f1f77bcf86cd799439014", createdAt: new Date() }),
    pgMarkMessagesRead: async (...args: unknown[]) => { readCalls.push(args); return 1; },
    pgMessageContacts: async () => [],
    pgUnreadMessageCount: async () => 0,
  },
});
mock.module(new URL("../src/data/postgres-notification-store.ts", import.meta.url).href, {
  namedExports: {
    notificationStore: "postgres",
    pgMarkConversationNotificationsRead: async (...args: unknown[]) => { notificationReadCalls.push(args); return 1; },
    pgUpsertMessageNotification: async () => ({}),
  },
});
mock.module(new URL("../src/services/chat-service.ts", import.meta.url).href, {
  namedExports: { chatService: {
    isOnline: () => true,
    sendToUser: (id: string, payload: any) => { sent.push({ userId: id, payload }); },
    getActiveConversation: () => userId,
    addClient: () => ({}),
    removeClient() {},
    setActiveConversation() {},
    getOnlineUsers: () => [userId],
    broadcastToUsers: (ids: string[], payload: any) => { broadcasts.push({ userIds: ids, payload }); },
  } },
});

let server: Server;
let baseUrl: string;
let rateKey: (request: any) => string;
before(async () => {
  const { registerMessagesRoutes, messageRateLimitKey } = await import("../src/routes/messages-routes.ts");
  rateKey = messageRateLimitKey;
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.session = { user: { userId } }; next(); });
  registerMessagesRoutes(app, {
    on(event: string, handler: (...args: any[]) => any) { if (event === "connection") connectionHandler = handler; },
  } as any, { requireAuth: (_req: any, _res: any, next: () => void) => next() });
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test('message limits use user identity or a normalized IPv6 subnet rather than a rotatable host address', () => {
  assert.equal(rateKey({session:{user:{userId}},ip:'2001:db8::1'}),userId);
  assert.equal(rateKey({ip:'2001:db8:abcd:1200::1'}),rateKey({ip:'2001:db8:abcd:12ff::2'}));
  assert.notEqual(rateKey({ip:'2001:db8:abcd:1200::1'}),rateKey({ip:'2001:db8:abcd:1300::1'}));
  assert.equal(rateKey({ip:'::ffff:192.0.2.1'}),rateKey({ip:'192.0.2.1'}));
});
after(async () => {
  // Run the registered socket lifecycle even though the transport is a stub.
  // All HTTP bodies are consumed below; close any remaining keep-alive sockets
  // before restoring module mocks. The runner can then terminate naturally.
  socketHandlers.close?.();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
  await new Promise<void>(resolve => setImmediate(resolve));
  mock.restoreAll();
});

test("conversation responses expose only public partner fields and preserve pagination contract", async () => {
  const response = await fetch(`${baseUrl}/api/messages/conversation/${partnerId}?limit=-3`);
  assert.equal(response.status, 200);
  const body: any = await response.json();
  assert.equal(requestedLimit, 1);
  assert.equal(body.hasMore, true);
  assert.equal(body.partner.online, true);
  assert.deepEqual(Object.keys(body.partner).sort(), [...publicFields, "online"].sort());
  assert.equal(body.partner._id, partnerId);
  assert.deepEqual(notificationReadCalls.at(-1), [userId, partnerId]);
});

test("message WebSocket sender payload never exposes credentials or source fields", async () => {
  sent.length = 0;
  const response = await fetch(`${baseUrl}/api/messages/send`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toUserId: partnerId, content: "Hello", messageType: "text" }),
  });
  assert.equal(response.status, 200);
  const body: any = await response.json();
  assert.equal(body.success, true);
  const delivered = sent.filter(item => item.payload.type === "chat:message");
  assert.equal(delivered.length, 2, "recipient delivery and sender echo");
  for (const { payload } of delivered) {
    assert.deepEqual(Object.keys(payload.sender).sort(), publicFields);
    assert.equal(payload.sender._id, userId);
    assert.equal(payload.message.content, "Hello");
  }
});

test("PostgreSQL WebSocket read receipts persist without calling MongoDB", async () => {
  const ticketResponse = await fetch(`${baseUrl}/api/messages/ws-ticket`);
  const { ticket } = await ticketResponse.json() as any;
  await connectionHandler({
    send() {}, close() {},
    on(event: string, callback: (...args: any[]) => any) { socketHandlers[event] = callback; },
  }, { url: `/ws/chat?ticket=${ticket}`, headers: { host: "localhost" } });
  readCalls.length = 0;
  await socketHandlers.message(Buffer.from(JSON.stringify({ type: "chat:read", fromUserId: partnerId })));
  assert.deepEqual(readCalls, [[userId, partnerId]]);
  await socketHandlers.message(Buffer.from(JSON.stringify({ type: "chat:read", fromUserId: { bad: "id" } })));
  assert.equal(readCalls.length, 1, "invalid IDs must not reach persistence");
});

test("PostgreSQL presence broadcasts include subsequent contact pages", async () => {
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(followPageCalls.filter(args => args[2] === 2).length, 2);
  assert.deepEqual(broadcasts.at(-1)?.userIds.sort(), [partnerId, nextPageContactId].sort());
  assert.equal(broadcasts.at(-1)?.payload.online, true);
});

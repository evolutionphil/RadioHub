import type { Express, Request, Response } from "express";
import express from "express";
import * as jose from "jose";
import mongoose from "mongoose";
import { User, IapEvent } from '@workspace/db-shared/mongo-schemas';
import { logger } from "../utils/logger";
import {
  PRODUCT_TO_PLAN,
  PLAN_FEATURES,
  type PremiumPlan,
} from "../services/iap-verify";

// =====================================================================
// Google Play Real-Time Developer Notifications (RTDN) via Pub/Sub Push
//
// Google pushes messages to this endpoint for every subscription and
// one-time-purchase lifecycle event.
//
// Auth layers:
//   1. ?token=<GOOGLE_PLAY_RTDN_SECRET>  — shared secret (mandatory).
//   2. Authorization: Bearer <Google OIDC JWT>  — verified against
//      Google's JWKS when GOOGLE_PLAY_PUBSUB_AUDIENCE is set.
//
// User lookup: Android apps call POST /api/user/subscription and store the
// purchaseToken in User.subscription.purchaseToken.  That field is the
// only identifier available in RTDN messages (no userId in the envelope).
//
// Race condition (PURCHASED before user calls /api/user/subscription):
//   → return 503; Pub/Sub retries with exponential back-off for up to 7 days.
//
// All other "user not found" cases (renewal, cancel, expire of a token we
// have never seen) → return 200 (ack so Pub/Sub doesn't retry forever).
//
// References:
//   https://developer.android.com/google/play/billing/rtdn-reference
//   https://cloud.google.com/pubsub/docs/push#authentication
// =====================================================================

// ── Subscription notificationType values ────────────────────────────
const SUB_RECOVERED              = 1;
const SUB_RENEWED                = 2;
const SUB_CANCELED               = 3;
const SUB_PURCHASED              = 4;
const SUB_ON_HOLD                = 5;
const SUB_IN_GRACE_PERIOD        = 6;
const SUB_RESTARTED              = 7;
// 8 = PRICE_CHANGE_CONFIRMED — no user impact
// 9 = DEFERRED — update expiresAt only
const SUB_PAUSED                 = 10;
// 11 = PAUSE_SCHEDULE_CHANGED — no user impact
const SUB_REVOKED                = 12;
const SUB_EXPIRED                = 13;

// ── One-time-purchase notificationType values ────────────────────────
const OTP_PURCHASED              = 1;
const OTP_CANCELED               = 2;   // refund

// ── Google JWKS endpoint for Pub/Sub push authentication ────────────
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
// jose.createRemoteJWKSet handles its own internal caching per instance;
// we keep a single instance to avoid creating a new HTTP fetcher per request.
let _googleJwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

function getGoogleJwks(): ReturnType<typeof jose.createRemoteJWKSet> {
  if (!_googleJwks) {
    _googleJwks = jose.createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  }
  return _googleJwks;
}

/**
 * Verify a Google-issued OIDC token from the Authorization header.
 * Returns true if valid, false if verification fails (caller decides whether
 * to reject or just warn based on configuration).
 */
async function verifyGoogleJwt(token: string, audience: string): Promise<boolean> {
  try {
    const JWKS = getGoogleJwks();
    await jose.jwtVerify(token, JWKS, {
      issuer: "https://accounts.google.com",
      audience,
    });
    return true;
  } catch (err: any) {
    logger.error("[play-rtdn] Google JWT verification failed:", err?.message || err);
    return false;
  }
}

// ── Pub/Sub message types ────────────────────────────────────────────

interface PubSubMessage {
  data: string;       // base64-encoded JSON
  messageId: string;
  publishTime: string;
}

interface PubSubEnvelope {
  message: PubSubMessage;
  subscription: string;
}

interface SubscriptionNotification {
  version: string;
  notificationType: number;
  purchaseToken: string;
  subscriptionId: string;
}

interface OneTimePurchaseNotification {
  version: string;
  notificationType: number;
  purchaseToken: string;
  sku: string;
}

interface VoidedPurchaseNotification {
  purchaseToken: string;
  purchaseType?: number;
  refundType?: number;
}

interface DeveloperNotification {
  version: string;
  packageName: string;
  eventTimeMillis: string;
  subscriptionNotification?: SubscriptionNotification;
  oneTimePurchaseNotification?: OneTimePurchaseNotification;
  voidedPurchaseNotification?: VoidedPurchaseNotification;
}

// ── Helpers ──────────────────────────────────────────────────────────

function decodeNotification(data: string): DeveloperNotification {
  const json = Buffer.from(data, "base64").toString("utf8");
  return JSON.parse(json) as DeveloperNotification;
}

function subscriptionIdToPlan(subscriptionId: string): PremiumPlan | undefined {
  // subscriptionId on Play Console (e.g. "megaradio_premium_yearly") may differ
  // slightly from the productId mapping key.  Try direct match first, then a
  // normalised match stripping version suffix numbers.
  const direct = PRODUCT_TO_PLAN[subscriptionId];
  if (direct) return direct;
  // Strip trailing digit suffix (e.g. "megaradio_premium_monthly1" → try "megaradio_premium_monthly")
  const stripped = subscriptionId.replace(/\d+$/, "");
  return PRODUCT_TO_PLAN[stripped];
}

async function safeAudit(input: {
  userId?: mongoose.Types.ObjectId | string | null;
  platform: "android";
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  result:
    | "success"
    | "replay_blocked"
    | "invalid_receipt"
    | "expired"
    | "apple_error"
    | "google_error"
    | "missing_credentials"
    | "bad_request"
    | "persist_error"
    | "fatal_error";
  providerCode?: string;
  statusCode: number;
  errorMessage?: string;
  plan?: string;
  expiresAt?: Date | null;
  isLifetime?: boolean;
  ip?: string;
  userAgent?: string;
  durationMs?: number;
}) {
  try {
    await IapEvent.create({
      userId: input.userId
        ? typeof input.userId === "string"
          ? new mongoose.Types.ObjectId(input.userId)
          : input.userId
        : null,
      platform: input.platform,
      productId: input.productId || "",
      transactionId: input.transactionId || "",
      originalTransactionId: input.originalTransactionId || "",
      result: input.result,
      providerCode: input.providerCode || "",
      statusCode: input.statusCode,
      errorMessage: input.errorMessage || "",
      plan: input.plan || "",
      expiresAt: input.expiresAt ?? null,
      isLifetime: input.isLifetime || false,
      ip: input.ip || "",
      userAgent: input.userAgent || "",
      durationMs: input.durationMs || 0,
    });
  } catch (err: any) {
    logger.error("[play-rtdn] audit write failed:", err?.message || err);
  }
}

// ── Route registration ────────────────────────────────────────────────

export function registerGooglePlayRtdnRoutes(app: Express) {
  // Raw-body capture is mounted in index-api.ts / index-web.ts BEFORE
  // express.json(), so req.body is already a Buffer here.

  app.post(
    "/api/webhooks/google-play-rtdn",
    async (req: Request, res: Response) => {
      const startedAt = Date.now();
      const ip =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.ip || "";
      const userAgent = (req.headers["user-agent"] as string) || "";

      // ── 1. Shared-secret auth ─────────────────────────────────────
      const expectedToken = process.env.GOOGLE_PLAY_RTDN_SECRET;
      if (!expectedToken) {
        logger.warn("[play-rtdn] GOOGLE_PLAY_RTDN_SECRET not configured — rejecting all requests");
        return void res.status(500).json({ error: "Webhook not configured" });
      }
      const providedToken = req.query.token as string | undefined;
      if (!providedToken || providedToken !== expectedToken) {
        logger.warn(`[play-rtdn] Invalid or missing ?token ip=${ip}`);
        return void res.status(401).json({ error: "Unauthorized" });
      }

      // ── 2. Optional Google OIDC JWT verification ──────────────────
      const audience = process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE;
      if (audience) {
        const authHeader = req.headers.authorization;
        const bearerToken = authHeader?.startsWith("Bearer ")
          ? authHeader.slice(7)
          : null;
        if (!bearerToken) {
          logger.warn("[play-rtdn] GOOGLE_PLAY_PUBSUB_AUDIENCE is set but no Bearer token in request");
          return void res.status(401).json({ error: "Missing authorization token" });
        }
        const valid = await verifyGoogleJwt(bearerToken, audience);
        if (!valid) {
          return void res.status(401).json({ error: "JWT verification failed" });
        }
      }

      // ── 3. Read raw body directly from Node.js stream ────────────────
      // Google Pub/Sub push sends requests with NO Content-Type and often no
      // Content-Length header. Express body-parser middlewares (express.json,
      // express.raw, etc.) all use the `content-length` / `transfer-encoding`
      // headers to decide whether to read the stream — if absent they call
      // next() immediately and req.body stays undefined.
      // Reading from the raw Node.js stream bypasses this check entirely and
      // captures every byte sent over the TCP connection regardless of headers.
      let rawBody: Buffer;
      if (Buffer.isBuffer(req.body) && (req.body as Buffer).length > 0) {
        // Safety path: if an upstream middleware already captured bytes, use them
        rawBody = req.body as Buffer;
      } else {
        rawBody = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        });
      }

      // Empty body = Google Play Console "send test notification" ping
      // (a bare HTTP POST with no payload used to verify endpoint reachability)
      if (rawBody.length === 0) {
        logger.log("[play-rtdn] Empty body (test ping from Google) — acking 200");
        return void res.status(200).json({ ok: true, skipped: "test_ping" });
      }

      const rawBodyStr = rawBody.toString("utf8");
      let envelope: PubSubEnvelope;
      try {
        envelope = JSON.parse(rawBodyStr) as PubSubEnvelope;
      } catch (err: any) {
        logger.warn(`[play-rtdn] JSON parse failed: ${err?.message || err} — preview=${rawBodyStr.slice(0, 200)}`);
        return void res.status(400).json({ error: "Invalid JSON body" });
      }

      if (!envelope?.message?.data) {
        // message present but no data = test notification with empty payload
        if (envelope?.message && !envelope.message.data) {
          logger.log("[play-rtdn] Test notification (message with no data) — acking");
          return void res.status(200).json({ ok: true, skipped: "test_notification" });
        }
        logger.warn("[play-rtdn] Missing message.data in Pub/Sub envelope");
        return void res.status(400).json({ error: "Invalid Pub/Sub envelope" });
      }

      let notification: DeveloperNotification;
      try {
        notification = decodeNotification(envelope.message.data);
      } catch (err: any) {
        logger.error("[play-rtdn] Failed to decode notification:", err?.message || err);
        return void res.status(400).json({ error: "Failed to decode notification" });
      }

      const messageId = envelope.message.messageId || "unknown";
      const eventTimeMs = Number(notification.eventTimeMillis || 0);
      const packageName = notification.packageName || "";

      logger.log(`[play-rtdn] Received messageId=${messageId} package=${packageName} ` +
        `sub=${!!notification.subscriptionNotification} otp=${!!notification.oneTimePurchaseNotification} ` +
        `voided=${!!notification.voidedPurchaseNotification}`);

      // ── 4. Route to correct handler ───────────────────────────────
      if (notification.subscriptionNotification) {
        return void await handleSubscriptionNotification(
          res, notification.subscriptionNotification, eventTimeMs, messageId, ip, userAgent, startedAt
        );
      }
      if (notification.oneTimePurchaseNotification) {
        return void await handleOneTimePurchaseNotification(
          res, notification.oneTimePurchaseNotification, eventTimeMs, messageId, ip, userAgent, startedAt
        );
      }
      if (notification.voidedPurchaseNotification) {
        return void await handleVoidedPurchaseNotification(
          res, notification.voidedPurchaseNotification, eventTimeMs, messageId, ip, userAgent, startedAt
        );
      }

      // Test notification or unrecognised shape — always ack
      logger.log(`[play-rtdn] Unrecognised notification shape messageId=${messageId} — acking`);
      return void res.status(200).json({ ok: true, skipped: "unrecognised_notification" });
    },
  );
}

// ── Subscription lifecycle handler ───────────────────────────────────

async function handleSubscriptionNotification(
  res: Response,
  sub: SubscriptionNotification,
  eventTimeMs: number,
  messageId: string,
  ip: string,
  userAgent: string,
  startedAt: number,
) {
  const { notificationType, purchaseToken, subscriptionId } = sub;
  const plan = subscriptionIdToPlan(subscriptionId);
  const productId = subscriptionId;

  logger.log(`[play-rtdn] subscriptionNotification type=${notificationType} subId=${subscriptionId} msgId=${messageId}`);

  // Locate user by purchaseToken
  const user = await User.findOne({
    "subscription.purchaseToken": purchaseToken,
  }).select("_id email subscription");

  if (!user) {
    // For PURCHASED events: user may not have called /api/user/subscription yet.
    // Return 503 → Pub/Sub retries.  All other types: ack (nothing to mutate).
    if (notificationType === SUB_PURCHASED) {
      logger.log(`[play-rtdn] SUB_PURCHASED but no user yet for token — returning 503 for Pub/Sub retry msgId=${messageId}`);
      await safeAudit({
        platform: "android",
        productId,
        result: "success",
        providerCode: `SUB_PURCHASED:no_user_retry`,
        statusCode: 503,
        errorMessage: "User not found — race condition, Pub/Sub will retry",
        ip,
        userAgent,
        durationMs: Date.now() - startedAt,
      });
      // 503 → Pub/Sub retries with exponential back-off
      return void res.status(503).json({ error: "User not yet registered, will retry" });
    }

    logger.log(`[play-rtdn] No user found for purchaseToken type=${notificationType} — acking msgId=${messageId}`);
    await safeAudit({
      platform: "android",
      productId,
      result: "success",
      providerCode: `sub_type_${notificationType}:no_user`,
      statusCode: 200,
      ip,
      userAgent,
      durationMs: Date.now() - startedAt,
    });
    return void res.status(200).json({ ok: true, skipped: "no_user_for_token" });
  }

  const userId = (user as any)._id as mongoose.Types.ObjectId;
  const existingSub: any = (user as any).subscription ?? {};

  // Out-of-order guard: compare eventTimeMillis against lastVerifiedAt.
  // Downgrades (cancel, revoke, expire, hold, pause) are ALWAYS applied.
  // Upgrades are skipped if we have a newer timestamp already.
  const isDowngrade = [SUB_CANCELED, SUB_ON_HOLD, SUB_PAUSED, SUB_REVOKED, SUB_EXPIRED].includes(notificationType);
  const storedMs = existingSub.lastVerifiedAt
    ? new Date(existingSub.lastVerifiedAt).getTime()
    : 0;
  if (!isDowngrade && eventTimeMs > 0 && storedMs > 0 && eventTimeMs < storedMs) {
    logger.log(`[play-rtdn] Stale upgrade skipped type=${notificationType} eventTime=${eventTimeMs} < stored=${storedMs} user=${userId}`);
    await safeAudit({
      userId,
      platform: "android",
      productId,
      result: "success",
      providerCode: `sub_type_${notificationType}:stale_skipped`,
      statusCode: 200,
      ip,
      userAgent,
      durationMs: Date.now() - startedAt,
    });
    return void res.status(200).json({ ok: true, skipped: "stale_event" });
  }

  // Build the $set update based on notificationType
  const setOps: Record<string, unknown> = {
    "subscription.lastVerifiedAt": new Date(),
    "subscription.platform": "android",
    "subscription.purchaseToken": purchaseToken,
    "subscription.productId": productId,
  };
  const unsetOps: Record<string, string> = {};

  let auditPlan = plan ?? existingSub.plan ?? "";
  let isLifetime = false;

  switch (notificationType) {
    case SUB_RECOVERED:
    case SUB_RENEWED:
    case SUB_RESTARTED:
    case SUB_IN_GRACE_PERIOD: {
      // Subscription is (or remains) active
      if (plan) setOps["subscription.plan"] = plan;
      setOps["subscription.isActive"] = true;
      setOps["subscription.subscriptionStatus"] = notificationType === SUB_IN_GRACE_PERIOD ? "past_due" : "active";
      setOps["subscription.cancelAtPeriodEnd"] = false;
      unsetOps["subscription.cancelledAt"] = "";
      break;
    }

    case SUB_PURCHASED: {
      // New subscription — plan and active state
      if (plan) setOps["subscription.plan"] = plan;
      setOps["subscription.isActive"] = true;
      setOps["subscription.subscriptionStatus"] = "active";
      setOps["subscription.cancelAtPeriodEnd"] = false;
      if (!existingSub.startedAt) setOps["subscription.startedAt"] = new Date();
      unsetOps["subscription.cancelledAt"] = "";
      break;
    }

    case SUB_CANCELED: {
      // Still active until period end; auto-renew disabled
      setOps["subscription.cancelAtPeriodEnd"] = true;
      setOps["subscription.subscriptionStatus"] = "active";
      // isActive stays true — user keeps access until expiry
      break;
    }

    case SUB_ON_HOLD: {
      // Payment failed; access suspended
      setOps["subscription.isActive"] = false;
      setOps["subscription.subscriptionStatus"] = "past_due";
      break;
    }

    case SUB_PAUSED: {
      // User paused; access suspended
      setOps["subscription.isActive"] = false;
      setOps["subscription.subscriptionStatus"] = "canceled";
      break;
    }

    case SUB_REVOKED: {
      // Immediate cancellation (refund/revoke from Play Console)
      setOps["subscription.plan"] = "none";
      setOps["subscription.isActive"] = false;
      setOps["subscription.subscriptionStatus"] = "canceled";
      setOps["subscription.cancelledAt"] = new Date();
      auditPlan = "none";
      break;
    }

    case SUB_EXPIRED: {
      // Grace period exhausted; access revoked
      setOps["subscription.plan"] = "none";
      setOps["subscription.isActive"] = false;
      setOps["subscription.subscriptionStatus"] = "canceled";
      auditPlan = "none";
      break;
    }

    default:
      // Types 8 (PRICE_CHANGE_CONFIRMED), 9 (DEFERRED), 11 (PAUSE_SCHEDULE_CHANGED)
      // — only update lastVerifiedAt, no state change
      logger.log(`[play-rtdn] No-op notificationType=${notificationType} — updating lastVerifiedAt only`);
  }

  try {
    const op: Record<string, unknown> = { $set: setOps };
    if (Object.keys(unsetOps).length) op.$unset = unsetOps;
    await User.findByIdAndUpdate(userId, op, { runValidators: true });
  } catch (err: any) {
    logger.error("[play-rtdn] DB write failed:", err?.message || err);
    await safeAudit({
      userId,
      platform: "android",
      productId,
      result: "persist_error",
      providerCode: `sub_type_${notificationType}`,
      statusCode: 500,
      errorMessage: String(err?.message || err).slice(0, 500),
      ip,
      userAgent,
      durationMs: Date.now() - startedAt,
    });
    return void res.status(500).json({ error: "DB write failed" });
  }

  const features = auditPlan ? (PLAN_FEATURES[auditPlan as PremiumPlan] ?? []) : [];
  logger.log(
    `[play-rtdn] ✅ subscriptionNotification type=${notificationType} user=${userId} subId=${subscriptionId} plan=${auditPlan} active=${setOps["subscription.isActive"] ?? "(unchanged)"}`,
  );

  await safeAudit({
    userId,
    platform: "android",
    productId,
    result: "success",
    providerCode: `sub_type_${notificationType}`,
    statusCode: 200,
    plan: auditPlan,
    isLifetime,
    ip,
    userAgent,
    durationMs: Date.now() - startedAt,
  });

  return void res.status(200).json({ ok: true, features });
}

// ── One-time-purchase handler (lifetime upgrade) ──────────────────────

async function handleOneTimePurchaseNotification(
  res: Response,
  otp: OneTimePurchaseNotification,
  eventTimeMs: number,
  messageId: string,
  ip: string,
  userAgent: string,
  startedAt: number,
) {
  const { notificationType, purchaseToken, sku } = otp;
  const plan = PRODUCT_TO_PLAN[sku];
  const isLifetime = plan === "premium_lifetime";

  logger.log(`[play-rtdn] oneTimePurchaseNotification type=${notificationType} sku=${sku} msgId=${messageId}`);

  const user = await User.findOne({
    "subscription.purchaseToken": purchaseToken,
  }).select("_id email subscription");

  if (!user) {
    // OTP_PURCHASED race — retry; OTP_CANCELED (refund) with no user — ack
    if (notificationType === OTP_PURCHASED) {
      await safeAudit({
        platform: "android",
        productId: sku,
        result: "success",
        providerCode: "OTP_PURCHASED:no_user_retry",
        statusCode: 503,
        errorMessage: "User not found — race condition",
        ip,
        userAgent,
        durationMs: Date.now() - startedAt,
      });
      return void res.status(503).json({ error: "User not yet registered, will retry" });
    }
    await safeAudit({
      platform: "android",
      productId: sku,
      result: "success",
      providerCode: `otp_type_${notificationType}:no_user`,
      statusCode: 200,
      ip,
      userAgent,
      durationMs: Date.now() - startedAt,
    });
    return void res.status(200).json({ ok: true, skipped: "no_user_for_token" });
  }

  const userId = (user as any)._id as mongoose.Types.ObjectId;
  const setOps: Record<string, unknown> = {
    "subscription.lastVerifiedAt": new Date(),
    "subscription.platform": "android",
    "subscription.purchaseToken": purchaseToken,
    "subscription.productId": sku,
  };
  const unsetOps: Record<string, string> = {};
  let auditPlan = plan ?? "none";

  if (notificationType === OTP_PURCHASED) {
    if (plan) setOps["subscription.plan"] = plan;
    setOps["subscription.isActive"] = true;
    setOps["subscription.subscriptionStatus"] = "active";
    if (isLifetime) {
      setOps["subscription.expiresAt"] = null; // lifetime = never expires
    }
    unsetOps["subscription.cancelledAt"] = "";
  } else if (notificationType === OTP_CANCELED) {
    // Refund — revoke entitlement
    setOps["subscription.plan"] = "none";
    setOps["subscription.isActive"] = false;
    setOps["subscription.subscriptionStatus"] = "canceled";
    setOps["subscription.cancelledAt"] = new Date();
    auditPlan = "none";
  }

  try {
    const op: Record<string, unknown> = { $set: setOps };
    if (Object.keys(unsetOps).length) op.$unset = unsetOps;
    await User.findByIdAndUpdate(userId, op, { runValidators: true });
  } catch (err: any) {
    logger.error("[play-rtdn] DB write failed (OTP):", err?.message || err);
    await safeAudit({
      userId,
      platform: "android",
      productId: sku,
      result: "persist_error",
      providerCode: `otp_type_${notificationType}`,
      statusCode: 500,
      errorMessage: String(err?.message || err).slice(0, 500),
      ip,
      userAgent,
      durationMs: Date.now() - startedAt,
    });
    return void res.status(500).json({ error: "DB write failed" });
  }

  const features = auditPlan ? (PLAN_FEATURES[auditPlan as PremiumPlan] ?? []) : [];
  logger.log(`[play-rtdn] ✅ oneTimePurchaseNotification type=${notificationType} user=${userId} sku=${sku} plan=${auditPlan} lifetime=${isLifetime}`);

  await safeAudit({
    userId,
    platform: "android",
    productId: sku,
    result: "success",
    providerCode: `otp_type_${notificationType}`,
    statusCode: 200,
    plan: auditPlan,
    isLifetime,
    ip,
    userAgent,
    durationMs: Date.now() - startedAt,
  });

  return void res.status(200).json({ ok: true, features });
}

// ── Voided purchase handler (refund / chargeback) ──────────────────────

async function handleVoidedPurchaseNotification(
  res: Response,
  voided: VoidedPurchaseNotification,
  eventTimeMs: number,
  messageId: string,
  ip: string,
  userAgent: string,
  startedAt: number,
) {
  const { purchaseToken } = voided;
  logger.log(`[play-rtdn] voidedPurchaseNotification msgId=${messageId}`);

  const user = await User.findOne({
    "subscription.purchaseToken": purchaseToken,
  }).select("_id email subscription");

  if (!user) {
    logger.log(`[play-rtdn] voidedPurchase — no user for token, acking msgId=${messageId}`);
    await safeAudit({
      platform: "android",
      result: "success",
      providerCode: "voided:no_user",
      statusCode: 200,
      ip,
      userAgent,
      durationMs: Date.now() - startedAt,
    });
    return void res.status(200).json({ ok: true, skipped: "no_user_for_token" });
  }

  const userId = (user as any)._id as mongoose.Types.ObjectId;

  try {
    await User.findByIdAndUpdate(userId, {
      $set: {
        "subscription.plan": "none",
        "subscription.isActive": false,
        "subscription.subscriptionStatus": "canceled",
        "subscription.cancelledAt": new Date(),
        "subscription.lastVerifiedAt": new Date(),
      },
    }, { runValidators: true });
  } catch (err: any) {
    logger.error("[play-rtdn] DB write failed (voided):", err?.message || err);
    await safeAudit({
      userId,
      platform: "android",
      result: "persist_error",
      providerCode: "voided",
      statusCode: 500,
      errorMessage: String(err?.message || err).slice(0, 500),
      ip,
      userAgent,
      durationMs: Date.now() - startedAt,
    });
    return void res.status(500).json({ error: "DB write failed" });
  }

  logger.log(`[play-rtdn] ✅ voidedPurchase — revoked user=${userId}`);

  await safeAudit({
    userId,
    platform: "android",
    result: "success",
    providerCode: "voided",
    statusCode: 200,
    plan: "none",
    ip,
    userAgent,
    durationMs: Date.now() - startedAt,
  });

  return void res.status(200).json({ ok: true });
}

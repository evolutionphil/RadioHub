import type { Express, Request, Response } from "express";
import express from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import * as jose from "jose";
import { User, IapEvent, AppleWebhookEvent } from "../shared/mongo-schemas";
import { logger } from "../utils/logger";
import {
  PRODUCT_TO_PLAN,
  PLAN_FEATURES,
  type PremiumPlan,
} from "../services/iap-verify";

// =====================================================================
// Apple App Store Server Notifications V2
//
// Apple POSTs `{ signedPayload: <JWS> }` for every subscription lifecycle
// event (renewal, refund, revoke, expire, billing failure, etc.). We MUST:
//   1. Verify the JWS signature using the leaf cert from header.x5c.
//   2. Walk the x5c chain and pin the root to Apple Root CA - G3.
//   3. Recursively verify the nested JWS (signedTransactionInfo,
//      signedRenewalInfo) the same way.
//   4. Idempotently mutate User.subscription based on notificationType.
//   5. Write an IapEvent audit row for every notification (success or fail).
//
// Reference:
//   https://developer.apple.com/documentation/appstoreservernotifications
//   https://www.apple.com/certificateauthority/
// =====================================================================

// Apple Root CA - G3 (production root for x5c chains in V2 notifications).
// Pinned at build time — if Apple ever rotates roots we'll have to update.
const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

const APPLE_ROOT_FINGERPRINT_SHA256 = (() => {
  const cert = new crypto.X509Certificate(APPLE_ROOT_CA_G3_PEM);
  return cert.fingerprint256;
})();

function der64ToPem(b64: string): string {
  const lines = b64.match(/.{1,64}/g)?.join("\n") || b64;
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----`;
}

/**
 * Verify a JWS compact-serialized string with x5c chain pinned to Apple Root CA.
 * Returns the decoded JSON payload, or throws if verification fails at any step.
 */
async function verifyAppleJws<T = any>(jws: string): Promise<T> {
  if (typeof jws !== "string" || !jws.includes(".")) {
    throw new Error("Invalid JWS: not a compact JWS string");
  }
  const headerB64 = jws.split(".")[0];
  let header: any;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid JWS: header is not valid base64url JSON");
  }
  const x5c: string[] | undefined = header?.x5c;
  if (!Array.isArray(x5c) || x5c.length < 2) {
    throw new Error("Invalid JWS: missing or short x5c chain");
  }

  // 1) Walk the chain — each cert must be signed by the next, and the last
  //    cert must match our pinned Apple Root CA G3 by SHA-256 fingerprint.
  const chain = x5c.map((b64) => new crypto.X509Certificate(der64ToPem(b64)));
  const root = chain[chain.length - 1];
  if (root.fingerprint256 !== APPLE_ROOT_FINGERPRINT_SHA256) {
    throw new Error(
      `Invalid JWS: x5c root fingerprint ${root.fingerprint256} does not match pinned Apple Root CA G3`,
    );
  }
  const now = Date.now();
  for (const cert of chain) {
    const notBefore = Date.parse(cert.validFrom);
    const notAfter = Date.parse(cert.validTo);
    if (Number.isFinite(notBefore) && now < notBefore) {
      throw new Error(`Cert not yet valid: ${cert.subject}`);
    }
    if (Number.isFinite(notAfter) && now > notAfter) {
      throw new Error(`Cert expired: ${cert.subject}`);
    }
  }
  for (let i = 0; i < chain.length - 1; i++) {
    if (!chain[i].verify(chain[i + 1].publicKey)) {
      throw new Error(`Cert chain broken at index ${i} (${chain[i].subject})`);
    }
  }

  // 2) Verify the JWS signature with the leaf cert's public key.
  const leafKey = await jose.importX509(chain[0].toString(), header.alg || "ES256");
  const { payload } = await jose.compactVerify(jws, leafKey);
  return JSON.parse(new TextDecoder().decode(payload)) as T;
}

interface NotificationPayload {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  data?: {
    bundleId?: string;
    environment?: "Sandbox" | "Production";
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
  signedDate?: number;
  version?: string;
}

interface TransactionInfo {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  bundleId: string;
  expiresDate?: number; // ms epoch
  purchaseDate: number;
  originalPurchaseDate: number;
  type: string;
  inAppOwnershipType?: string;
  revocationDate?: number;
  revocationReason?: number;
  environment: "Sandbox" | "Production";
}

interface RenewalInfo {
  originalTransactionId: string;
  autoRenewProductId?: string;
  productId: string;
  autoRenewStatus: 0 | 1;
  expirationIntent?: number;
  isInBillingRetryPeriod?: boolean;
  recentSubscriptionStartDate?: number;
}

const APPLE_NOTIFICATION_TYPES = new Set([
  "SUBSCRIBED",
  "DID_RENEW",
  "DID_CHANGE_RENEWAL_STATUS",
  "DID_CHANGE_RENEWAL_PREF",
  "OFFER_REDEEMED",
  "EXPIRED",
  "GRACE_PERIOD_EXPIRED",
  "DID_FAIL_TO_RENEW",
  "REFUND",
  "REFUND_DECLINED",
  "REFUND_REVERSED",
  "REVOKE",
  "CONSUMPTION_REQUEST",
  "PRICE_INCREASE",
  "RENEWAL_EXTENDED",
  "RENEWAL_EXTENSION",
  "TEST",
]);

export function registerAppleWebhookRoutes(app: Express) {
  // Apple POSTs JSON. We mount our own JSON body parser locally because some
  // server stacks tweak the global parser limits / verify hooks; this keeps
  // the webhook self-contained.
  const jsonParser = express.json({ limit: "1mb" });

  app.post(
    "/api/iap/apple-webhook",
    jsonParser,
    async (req: Request, res: Response) => {
      const startedAt = Date.now();
      const ip =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.ip ||
        "";
      const userAgent = (req.headers["user-agent"] as string) || "";

      const signedPayload: string | undefined = req.body?.signedPayload;
      if (!signedPayload || typeof signedPayload !== "string") {
        await safeAudit({
          platform: "ios",
          result: "bad_request",
          providerCode: "missing_signed_payload",
          statusCode: 400,
          errorMessage: "Missing signedPayload in body",
          ip,
          userAgent,
          durationMs: Date.now() - startedAt,
        });
        return void res.status(400).json({ error: "Missing signedPayload" });
      }

      let notification: NotificationPayload;
      try {
        notification = await verifyAppleJws<NotificationPayload>(signedPayload);
      } catch (err: any) {
        logger.error("[apple-webhook] JWS verification failed:", err?.message || err);
        await safeAudit({
          platform: "ios",
          result: "invalid_receipt",
          providerCode: "jws_verify_failed",
          statusCode: 401,
          errorMessage: String(err?.message || err).slice(0, 500),
          ip,
          userAgent,
          durationMs: Date.now() - startedAt,
        });
        // Apple retries on non-2xx, so respond 401 only for invalid signatures
        // (Apple won't retry forever on a permanent auth failure).
        return void res.status(401).json({ error: "Signature verification failed" });
      }

      const { notificationType, subtype, notificationUUID } = notification;

      // -----------------------------------------------------------------
      // App-binding check: every signed payload from Apple is cryptographically
      // valid for SOMEONE — we must reject ones not scoped to our bundle so a
      // misconfigured Apple-signed payload from another app can't grant entitlement
      // to our users. APPLE_EXPECTED_BUNDLE_IDS is a comma-separated allowlist.
      // -----------------------------------------------------------------
      const expectedBundles = (process.env.APPLE_EXPECTED_BUNDLE_IDS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const payloadBundle = notification.data?.bundleId || "";
      if (expectedBundles.length && payloadBundle && !expectedBundles.includes(payloadBundle)) {
        logger.error(`[apple-webhook] bundleId mismatch: got=${payloadBundle} expected=${expectedBundles.join("|")} uuid=${notificationUUID}`);
        await safeAudit({
          platform: "ios",
          result: "invalid_receipt",
          providerCode: "bundle_mismatch",
          statusCode: 401,
          errorMessage: `bundleId ${payloadBundle} not in allowlist`,
          ip,
          userAgent,
          durationMs: Date.now() - startedAt,
        });
        return void res.status(401).json({ error: "Bundle mismatch" });
      }
      if (!expectedBundles.length) {
        logger.warn(
          `[apple-webhook] APPLE_EXPECTED_BUNDLE_IDS not configured — skipping bundle check (defense-in-depth disabled). Set the env var to enable.`,
        );
      }

      // -----------------------------------------------------------------
      // Replay/idempotency check: insert into AppleWebhookEvent first; the
      // unique index on notificationUUID will reject duplicates with E11000.
      // We always 200-ack duplicates so Apple stops retrying.
      // -----------------------------------------------------------------
      if (notificationUUID) {
        try {
          await AppleWebhookEvent.create({
            notificationUUID,
            notificationType,
            subtype: subtype || "",
            signedDate: notification.signedDate ? new Date(notification.signedDate) : undefined,
            bundleId: payloadBundle,
            environment: notification.data?.environment || "",
          });
        } catch (err: any) {
          // E11000 duplicate key — already processed, just ack.
          if (err?.code === 11000) {
            logger.log(`[apple-webhook] duplicate notificationUUID=${notificationUUID} type=${notificationType} — short-circuit 200`);
            return void res.status(200).json({ ok: true, deduped: true });
          }
          logger.error("[apple-webhook] AppleWebhookEvent insert failed:", err?.message || err);
          // Don't fail the webhook on dedupe-store write errors; we'd rather
          // process twice than refuse a legitimate notification.
        }
      }

      if (!APPLE_NOTIFICATION_TYPES.has(notificationType)) {
        logger.log(`[apple-webhook] unknown notificationType=${notificationType} uuid=${notificationUUID}`);
        // Ack with 200 — Apple may add new types and we don't want infinite retries.
        await safeAudit({
          platform: "ios",
          result: "success",
          providerCode: `unknown:${notificationType}`,
          statusCode: 200,
          errorMessage: "",
          ip,
          userAgent,
          durationMs: Date.now() - startedAt,
        });
        return void res.status(200).json({ ok: true, ignored: true });
      }

      // TEST notifications carry no transaction data.
      if (notificationType === "TEST") {
        logger.log(`[apple-webhook] TEST received uuid=${notificationUUID}`);
        await safeAudit({
          platform: "ios",
          result: "success",
          providerCode: "test",
          statusCode: 200,
          errorMessage: "",
          ip,
          userAgent,
          durationMs: Date.now() - startedAt,
        });
        return void res.status(200).json({ ok: true });
      }

      // Decode nested JWS payloads with the same chain validation.
      let txnInfo: TransactionInfo | null = null;
      let renewalInfo: RenewalInfo | null = null;
      try {
        if (notification.data?.signedTransactionInfo) {
          txnInfo = await verifyAppleJws<TransactionInfo>(notification.data.signedTransactionInfo);
        }
        if (notification.data?.signedRenewalInfo) {
          renewalInfo = await verifyAppleJws<RenewalInfo>(notification.data.signedRenewalInfo);
        }
      } catch (err: any) {
        logger.error("[apple-webhook] nested JWS failed:", err?.message || err);
        await safeAudit({
          platform: "ios",
          result: "invalid_receipt",
          providerCode: "nested_jws_failed",
          statusCode: 401,
          errorMessage: String(err?.message || err).slice(0, 500),
          ip,
          userAgent,
          durationMs: Date.now() - startedAt,
        });
        return void res.status(401).json({ error: "Nested signature failed" });
      }

      const originalTransactionId =
        txnInfo?.originalTransactionId || renewalInfo?.originalTransactionId || "";
      const productId = txnInfo?.productId || renewalInfo?.productId || "";

      if (!originalTransactionId) {
        logger.log(`[apple-webhook] no originalTransactionId in ${notificationType}/${subtype} uuid=${notificationUUID}`);
        await safeAudit({
          platform: "ios",
          result: "bad_request",
          providerCode: `${notificationType}:no_otid`,
          statusCode: 200,
          errorMessage: "",
          ip,
          userAgent,
          durationMs: Date.now() - startedAt,
        });
        return void res.status(200).json({ ok: true, skipped: "no_originalTransactionId" });
      }

      // Locate the user we previously attached this transaction to. If we
      // never saw the receipt (user might have purchased on another platform
      // and never validated), we ack 200 — there's nothing to mutate.
      const user = await User.findOne({
        "subscription.originalTransactionId": originalTransactionId,
      }).select("_id email subscription");

      if (!user) {
        logger.log(`[apple-webhook] no matching user for txn=${originalTransactionId} type=${notificationType}`);
        await safeAudit({
          platform: "ios",
          result: "success",
          productId,
          originalTransactionId,
          providerCode: `${notificationType}:no_user`,
          statusCode: 200,
          errorMessage: "",
          ip,
          userAgent,
          durationMs: Date.now() - startedAt,
        });
        return void res.status(200).json({ ok: true, skipped: "no_user_for_transaction" });
      }

      const userId = (user as any)._id;
      const plan = PRODUCT_TO_PLAN[productId];
      const features = plan ? PLAN_FEATURES[plan as PremiumPlan] : [];

      // -----------------------------------------------------------------
      // Out-of-order guard: Apple sends notifications best-effort, so an old
      // SUBSCRIBED/DID_RENEW can arrive AFTER a newer REFUND/REVOKE. We
      // compare notification.signedDate against the lastSignedDate stamped on
      // the user's subscription. UPGRADES (SUBSCRIBED/DID_RENEW/etc.) are
      // skipped if the stored timestamp is newer. DOWNGRADES (REFUND/REVOKE/
      // EXPIRED) are always applied — safer to over-revoke than to leave a
      // refunded user entitled.
      // -----------------------------------------------------------------
      const incomingSignedDateMs = Number(notification.signedDate || 0);
      const storedSignedDateMs = Number(
        (user as any).subscription?.lastSignedDate
          ? new Date((user as any).subscription.lastSignedDate).getTime()
          : 0,
      );

      // Decide entitlement state from notificationType + subtype + txn fields.
      // We always re-derive isActive from the notification (never trust prior
      // state) so refunds/revokes immediately downgrade the user.
      let setOps: any = {
        "subscription.lastVerifiedAt": new Date(),
      };
      let unsetOps: any = {};
      let auditPlan = plan || "";

      const isRevocation =
        notificationType === "REFUND" ||
        notificationType === "REVOKE" ||
        (txnInfo?.revocationDate && txnInfo.revocationDate > 0);

      const isExpiration =
        notificationType === "EXPIRED" ||
        notificationType === "GRACE_PERIOD_EXPIRED" ||
        notificationType === "DID_FAIL_TO_RENEW";

      const isDowngrade = isRevocation || isExpiration;
      if (
        !isDowngrade &&
        incomingSignedDateMs > 0 &&
        storedSignedDateMs > 0 &&
        incomingSignedDateMs < storedSignedDateMs
      ) {
        logger.log(
          `[apple-webhook] stale upgrade ignored: type=${notificationType} signedDate=${incomingSignedDateMs} < stored=${storedSignedDateMs} user=${userId} txn=${originalTransactionId}`,
        );
        await safeAudit({
          userId,
          platform: "ios",
          productId,
          originalTransactionId,
          result: "success",
          providerCode: `${notificationType}:stale_skipped`,
          statusCode: 200,
          errorMessage: "",
          ip,
          userAgent,
          durationMs: Date.now() - startedAt,
        });
        return void res.status(200).json({ ok: true, skipped: "stale_event" });
      }
      if (incomingSignedDateMs > 0) {
        setOps["subscription.lastSignedDate"] = new Date(incomingSignedDateMs);
      }

      const isActiveNow =
        !isRevocation &&
        !isExpiration &&
        (txnInfo?.expiresDate ? txnInfo.expiresDate > Date.now() : true);

      if (isRevocation) {
        setOps["subscription.plan"] = "none";
        setOps["subscription.isActive"] = false;
        setOps["subscription.cancelledAt"] = new Date();
        auditPlan = "none";
      } else if (isExpiration) {
        setOps["subscription.plan"] = "none";
        setOps["subscription.isActive"] = false;
        if (txnInfo?.expiresDate) setOps["subscription.expiresAt"] = new Date(txnInfo.expiresDate);
        auditPlan = "none";
      } else if (
        notificationType === "SUBSCRIBED" ||
        notificationType === "DID_RENEW" ||
        notificationType === "OFFER_REDEEMED" ||
        notificationType === "DID_CHANGE_RENEWAL_PREF" ||
        notificationType === "REFUND_REVERSED" ||
        notificationType === "RENEWAL_EXTENDED" ||
        notificationType === "RENEWAL_EXTENSION"
      ) {
        if (plan) {
          setOps["subscription.plan"] = plan;
          setOps["subscription.isActive"] = isActiveNow;
          setOps["subscription.platform"] = "ios";
          setOps["subscription.productId"] = productId;
          setOps["subscription.originalTransactionId"] = originalTransactionId;
          setOps["subscription.transactionId"] = txnInfo?.transactionId || originalTransactionId;
          if (txnInfo?.expiresDate) setOps["subscription.expiresAt"] = new Date(txnInfo.expiresDate);
          if (notificationType === "SUBSCRIBED" || notificationType === "OFFER_REDEEMED") {
            setOps["subscription.startedAt"] = new Date(txnInfo?.purchaseDate || Date.now());
          }
          unsetOps["subscription.cancelledAt"] = "";
        }
      } else if (notificationType === "DID_CHANGE_RENEWAL_STATUS") {
        // autoRenewStatus 0 = user disabled auto-renew (still active until expiry).
        // We don't downgrade — just record the verified-at stamp.
      }

      try {
        const op: any = { $set: setOps };
        if (Object.keys(unsetOps).length) op.$unset = unsetOps;
        await User.findByIdAndUpdate(userId, op, { runValidators: true });
      } catch (err: any) {
        logger.error("[apple-webhook] DB write failed:", err?.message || err);
        await safeAudit({
          userId,
          platform: "ios",
          productId,
          originalTransactionId,
          transactionId: txnInfo?.transactionId,
          result: "persist_error",
          providerCode: notificationType,
          statusCode: 500,
          errorMessage: String(err?.message || err).slice(0, 500),
          ip,
          userAgent,
          durationMs: Date.now() - startedAt,
        });
        // Return 500 so Apple retries — we want the state to converge.
        return void res.status(500).json({ error: "DB write failed" });
      }

      logger.log(
        `[apple-webhook] ${notificationType}${subtype ? "/" + subtype : ""} user=${userId} txn=${originalTransactionId} plan=${auditPlan || "(unchanged)"} active=${isActiveNow}`,
      );

      await safeAudit({
        userId,
        platform: "ios",
        productId,
        transactionId: txnInfo?.transactionId,
        originalTransactionId,
        result: "success",
        providerCode: subtype ? `${notificationType}:${subtype}` : notificationType,
        statusCode: 200,
        errorMessage: "",
        plan: auditPlan,
        expiresAt: txnInfo?.expiresDate ? new Date(txnInfo.expiresDate) : null,
        isLifetime: false,
        ip,
        userAgent,
        durationMs: Date.now() - startedAt,
      });

      return void res.status(200).json({ ok: true, features });
    },
  );
}

async function safeAudit(input: {
  userId?: mongoose.Types.ObjectId | string | null;
  platform: "ios" | "android" | "unknown";
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
      userId:
        input.userId
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
    logger.error("[apple-webhook] audit write failed:", err?.message || err);
  }
}

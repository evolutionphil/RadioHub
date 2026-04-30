import type { Express, Request, Response } from "express";
import { JWT } from "google-auth-library";
import { User, AuthToken } from "../../shared/mongo-schemas";
import { logger } from "../utils/logger";

type Platform = "ios" | "android" | "tvos" | "macos";
type PremiumPlan =
  | "none"
  | "remove_ads"
  | "premium_monthly"
  | "premium_yearly"
  | "premium_lifetime";

const PRODUCT_TO_PLAN: Record<string, PremiumPlan> = {
  megaradio_remove_ads_yearly1: "remove_ads",
  megaradio_premium_monthly1: "premium_monthly",
  megaradio_premium_yearly: "premium_yearly",
  megaradio_premium_lifetime: "premium_lifetime",
};

const LIFETIME_PRODUCT_IDS = new Set<string>(["megaradio_premium_lifetime"]);

const PLAN_FEATURES: Record<PremiumPlan, string[]> = {
  none: [],
  remove_ads: ["remove_ads"],
  premium_monthly: ["remove_ads", "song_info", "spotify_link", "youtube_link", "hd_stream", "song_history", "stream_record"],
  premium_yearly: ["remove_ads", "song_info", "spotify_link", "youtube_link", "hd_stream", "song_history", "stream_record"],
  premium_lifetime: ["remove_ads", "song_info", "spotify_link", "youtube_link", "hd_stream", "song_history", "stream_record"],
};

const APPLE_PROD_URL = "https://buy.itunes.apple.com/verifyReceipt";
const APPLE_SANDBOX_URL = "https://sandbox.itunes.apple.com/verifyReceipt";

const APPLE_PLATFORMS: Platform[] = ["ios", "tvos", "macos"];

interface ValidationSuccess {
  valid: true;
  expiresAt: number | null;
  originalTransactionId: string;
  isLifetime: boolean;
  productId: string;
  environment?: "production" | "sandbox";
}

interface ValidationFailure {
  valid: false;
  error: string;
  code?: string | number;
}

type ValidationResult = ValidationSuccess | ValidationFailure;

let cachedGoogleClient: JWT | null = null;
function getGoogleAuthClient(): JWT | null {
  if (cachedGoogleClient) return cachedGoogleClient;
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const creds = JSON.parse(raw);
    if (!creds.client_email || !creds.private_key) {
      logger.error("[IAP] GOOGLE_PLAY_SERVICE_ACCOUNT_JSON missing client_email or private_key");
      return null;
    }
    cachedGoogleClient = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
    return cachedGoogleClient;
  } catch (err: any) {
    logger.error("[IAP] Failed to parse GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:", err?.message || err);
    return null;
  }
}

async function verifyAppleReceipt(receipt: string, productId: string): Promise<ValidationResult> {
  const sharedSecret = process.env.APPLE_IAP_SHARED_SECRET;
  if (!sharedSecret) {
    return { valid: false, error: "Apple shared secret not configured", code: "missing_apple_secret" };
  }

  const body = JSON.stringify({
    "receipt-data": receipt,
    password: sharedSecret,
    "exclude-old-transactions": true,
  });

  let env: "production" | "sandbox" = "production";
  let resp: any = null;

  try {
    const r = await fetch(APPLE_PROD_URL, { method: "POST", headers: { "content-type": "application/json" }, body });
    resp = await r.json();
  } catch (err: any) {
    return { valid: false, error: `Apple verifyReceipt request failed: ${err?.message || err}`, code: "apple_network" };
  }

  if (resp?.status === 21007) {
    env = "sandbox";
    try {
      const r2 = await fetch(APPLE_SANDBOX_URL, { method: "POST", headers: { "content-type": "application/json" }, body });
      resp = await r2.json();
    } catch (err: any) {
      return { valid: false, error: `Apple sandbox verifyReceipt failed: ${err?.message || err}`, code: "apple_sandbox_network" };
    }
  }

  if (!resp || resp.status !== 0) {
    return { valid: false, error: `Apple verifyReceipt status ${resp?.status}`, code: resp?.status ?? "apple_unknown" };
  }

  const isLifetime = LIFETIME_PRODUCT_IDS.has(productId);

  if (isLifetime) {
    const inApp: any[] = resp?.receipt?.in_app || [];
    const match = inApp.find((it) => it?.product_id === productId);
    if (!match) {
      return { valid: false, error: `Lifetime productId ${productId} not found in receipt`, code: "apple_not_in_receipt" };
    }
    if (match.cancellation_date_ms || match.cancellation_date) {
      return { valid: false, error: "Lifetime purchase was cancelled/refunded", code: "apple_cancelled" };
    }
    const origTxn = String(match.original_transaction_id || match.transaction_id || "");
    if (!origTxn) {
      return { valid: false, error: "Apple receipt missing original_transaction_id", code: "apple_no_txn" };
    }
    return {
      valid: true,
      expiresAt: null,
      originalTransactionId: origTxn,
      isLifetime: true,
      productId,
      environment: env,
    };
  }

  const latest: any[] = resp?.latest_receipt_info || resp?.receipt?.in_app || [];
  const matches = latest.filter((it) => it?.product_id === productId);
  if (!matches.length) {
    return { valid: false, error: `productId ${productId} not found in receipt`, code: "apple_not_in_receipt" };
  }
  const newest = matches.reduce((a, b) => {
    const ax = Number(a?.expires_date_ms || a?.purchase_date_ms || 0);
    const bx = Number(b?.expires_date_ms || b?.purchase_date_ms || 0);
    return bx > ax ? b : a;
  });

  if (newest?.cancellation_date_ms || newest?.cancellation_date) {
    return { valid: false, error: "Subscription was cancelled/refunded", code: "apple_cancelled" };
  }

  const expiresMs = Number(newest?.expires_date_ms || 0);
  if (!expiresMs) {
    return { valid: false, error: "Apple receipt has no expires_date_ms", code: "apple_no_expiry" };
  }
  if (expiresMs <= Date.now()) {
    return { valid: false, error: "Subscription expired", code: "expired" };
  }

  const origTxn = String(newest.original_transaction_id || newest.transaction_id || "");
  if (!origTxn) {
    return { valid: false, error: "Apple receipt missing original_transaction_id", code: "apple_no_txn" };
  }

  return {
    valid: true,
    expiresAt: expiresMs,
    originalTransactionId: origTxn,
    isLifetime: false,
    productId,
    environment: env,
  };
}

async function verifyGoogleReceipt(purchaseToken: string, productId: string): Promise<ValidationResult> {
  const client = getGoogleAuthClient();
  if (!client) {
    return { valid: false, error: "Google service account not configured", code: "missing_google_creds" };
  }
  const pkg = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  if (!pkg) {
    return { valid: false, error: "GOOGLE_PLAY_PACKAGE_NAME not configured", code: "missing_pkg" };
  }

  const isLifetime = LIFETIME_PRODUCT_IDS.has(productId);
  const path = isLifetime
    ? `applications/${encodeURIComponent(pkg)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`
    : `applications/${encodeURIComponent(pkg)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;

  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/${path}`;

  let data: any;
  try {
    const resp = await client.request<any>({ url });
    data = resp.data;
  } catch (err: any) {
    const status = err?.response?.status;
    const detail = err?.response?.data?.error?.message || err?.message || String(err);
    return { valid: false, error: `Google API error: ${detail}`, code: status || "google_error" };
  }

  if (isLifetime) {
    if (data?.purchaseState !== 0) {
      return { valid: false, error: `Lifetime purchaseState=${data?.purchaseState}`, code: "google_not_purchased" };
    }
    if (data?.consumptionState === 1) {
      return { valid: false, error: "Lifetime purchase has been consumed", code: "google_consumed" };
    }
    const orderId = String(data?.orderId || "");
    if (!orderId) {
      return { valid: false, error: "Google response missing orderId", code: "google_no_order_id" };
    }
    return {
      valid: true,
      expiresAt: null,
      originalTransactionId: orderId,
      isLifetime: true,
      productId,
    };
  }

  // Subscription: paymentState — 0=pending, 1=received, 2=free trial, 3=pending deferred upgrade/downgrade
  const paymentState = data?.paymentState;
  if (paymentState !== undefined && paymentState !== 1 && paymentState !== 2) {
    return { valid: false, error: `Google subscription paymentState=${paymentState} (not paid)`, code: "google_unpaid" };
  }
  // cancelReason: 0=user cancel, 1=system, 2=replaced, 3=developer
  // A future expiry with cancelReason !== undefined still grants access until expiry, so we allow it
  // but reject when cancelReason indicates a refund/revocation (presence of userCancellationTimeMillis means already revoked).
  if (data?.cancelReason === 1 && data?.expiryTimeMillis && Number(data.expiryTimeMillis) <= Date.now()) {
    return { valid: false, error: "Subscription cancelled by system (billing failure)", code: "google_billing_failure" };
  }

  const expiresMs = Number(data?.expiryTimeMillis || 0);
  if (!expiresMs) {
    return { valid: false, error: "Google subscription has no expiryTimeMillis", code: "google_no_expiry" };
  }
  if (expiresMs <= Date.now()) {
    return { valid: false, error: "Subscription expired", code: "expired" };
  }

  // For subscriptions, orderId can change on each renewal. linkedPurchaseToken connects upgrade/downgrade chains.
  // Use orderId as primary if available, fall back to purchaseToken for global uniqueness.
  const txnId = String(data?.orderId || data?.linkedPurchaseToken || purchaseToken);

  return {
    valid: true,
    expiresAt: expiresMs,
    originalTransactionId: txnId,
    isLifetime: false,
    productId,
  };
}

async function resolveAuthUserId(req: Request): Promise<string | null> {
  const session: any = (req as any).session;
  if (session?.user?.userId) return String(session.user.userId);
  if (session?.userId) return String(session.userId);

  const authHeader = req.headers["authorization"];
  const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  if (!bearer) return null;
  try {
    const tokenDoc = await AuthToken.findOne({
      token: bearer,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    }).select("userId");
    if (!tokenDoc) return null;
    return String(tokenDoc.userId);
  } catch (err) {
    logger.error("[IAP] Bearer token lookup failed:", err);
    return null;
  }
}

export function registerIapValidationRoutes(app: Express) {
  app.post("/api/iap/validate", async (req: Request, res: Response) => {
    try {
      const { platform, productId, receipt } = req.body || {};

      if (!platform || !["ios", "android", "tvos", "macos"].includes(platform)) {
        return res.status(400).json({
          valid: false,
          error: "platform must be one of: ios, android, tvos, macos",
        });
      }
      if (!productId || typeof productId !== "string") {
        return res.status(400).json({ valid: false, error: "productId is required" });
      }
      if (!PRODUCT_TO_PLAN[productId]) {
        return res.status(400).json({
          valid: false,
          error: `Unknown productId: ${productId}. Valid: ${Object.keys(PRODUCT_TO_PLAN).join(", ")}`,
        });
      }
      if (!receipt || typeof receipt !== "string") {
        return res.status(400).json({
          valid: false,
          error: "receipt is required (Apple base64 receipt-data or Google purchaseToken)",
        });
      }

      const platformTyped = platform as Platform;
      const result: ValidationResult = APPLE_PLATFORMS.includes(platformTyped)
        ? await verifyAppleReceipt(receipt, productId)
        : await verifyGoogleReceipt(receipt, productId);

      if (!result.valid) {
        return res.status(400).json(result);
      }

      const authedUserId = await resolveAuthUserId(req);
      const bodyUserId = typeof req.body?.userId === "string" ? req.body.userId : null;
      const targetUserId = authedUserId || null;

      if (bodyUserId && authedUserId && bodyUserId !== authedUserId) {
        logger.log(`[IAP] body.userId (${bodyUserId}) differs from auth user (${authedUserId}); using auth user`);
      }
      if (bodyUserId && !authedUserId) {
        logger.log(`[IAP] body.userId (${bodyUserId}) provided without auth header; ignoring for DB write`);
      }

      let attached = false;
      let attachError: string | null = null;
      const isAndroid = platformTyped === "android";

      if (targetUserId) {
        try {
          const plan = PRODUCT_TO_PLAN[result.productId];
          const expiresAtDate = result.isLifetime ? null : (result.expiresAt ? new Date(result.expiresAt) : null);

          // Global receipt-replay guard: reject if this transaction is already attached
          // to a DIFFERENT active user. Prevents one purchase from unlocking many accounts.
          // Match against both originalTransactionId and (Android) purchaseToken.
          const replayQuery: any = {
            _id: { $ne: targetUserId },
            "subscription.isActive": true,
            $or: [
              { "subscription.originalTransactionId": result.originalTransactionId },
            ],
          };
          if (isAndroid) {
            replayQuery.$or.push({ "subscription.purchaseToken": receipt });
          }
          const conflict = await User.findOne(replayQuery).select("_id").lean();
          if (conflict) {
            logger.log(`[IAP] Replay blocked: txn=${result.originalTransactionId} requested by user=${targetUserId}, owned by user=${(conflict as any)._id}`);
            return res.status(409).json({
              valid: false,
              error: "Receipt is already attached to another account",
              code: "receipt_replay",
            });
          } else {
            const existing = await User.findById(targetUserId).select("subscription").lean();
            const existingSub: any = (existing as any)?.subscription;
            const isSameTransaction =
              existingSub?.originalTransactionId &&
              existingSub.originalTransactionId === result.originalTransactionId &&
              existingSub.isActive;

            if (!isSameTransaction) {
              const update: any = {
                "subscription.plan": plan,
                "subscription.platform": platformTyped,
                "subscription.productId": result.productId,
                "subscription.transactionId": result.originalTransactionId,
                "subscription.originalTransactionId": result.originalTransactionId,
                "subscription.isActive": true,
                "subscription.lastVerifiedAt": new Date(),
                "subscription.expiresAt": expiresAtDate,
              };
              if (isAndroid) {
                update["subscription.purchaseToken"] = receipt;
                update.$unset = { "subscription.receipt": "" };
              } else {
                update["subscription.receipt"] = receipt;
              }
              if (!existingSub?.startedAt) update["subscription.startedAt"] = new Date();

              const { $unset, ...setFields } = update as any;
              const op: any = { $set: setFields };
              if ($unset) op.$unset = $unset;
              await User.findByIdAndUpdate(targetUserId, op, { runValidators: true });
            } else {
              const sameTxnSet: any = {
                "subscription.lastVerifiedAt": new Date(),
                "subscription.expiresAt": expiresAtDate,
              };
              const sameTxnUnset: any = {};
              // Migrate legacy Android records that stored token in `receipt`
              if (isAndroid && existingSub?.receipt && !existingSub?.purchaseToken) {
                sameTxnSet["subscription.purchaseToken"] = receipt;
                sameTxnUnset["subscription.receipt"] = "";
              }
              const sameTxnOp: any = { $set: sameTxnSet };
              if (Object.keys(sameTxnUnset).length) sameTxnOp.$unset = sameTxnUnset;
              await User.findByIdAndUpdate(targetUserId, sameTxnOp, { runValidators: true });
            }
            attached = true;
          }
        } catch (err: any) {
          attachError = err?.message || String(err);
          logger.error("[IAP] Failed to persist subscription:", attachError);
        }
      }

      return res.json({
        valid: true,
        expiresAt: result.expiresAt,
        originalTransactionId: result.originalTransactionId,
        isLifetime: result.isLifetime,
        productId: result.productId,
        plan: PRODUCT_TO_PLAN[result.productId],
        features: PLAN_FEATURES[PRODUCT_TO_PLAN[result.productId]],
        attachedToUser: attached,
        ...(attachError ? { attachError } : {}),
        ...(result.environment ? { environment: result.environment } : {}),
      });
    } catch (err: any) {
      logger.error("[IAP] /api/iap/validate fatal:", err?.message || err);
      return res.status(500).json({ valid: false, error: "Internal validation error" });
    }
  });
}

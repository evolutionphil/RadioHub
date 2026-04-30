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
    return {
      valid: true,
      expiresAt: null,
      originalTransactionId: String(match.original_transaction_id || match.transaction_id || ""),
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

  const expiresMs = Number(newest?.expires_date_ms || 0);
  if (!expiresMs) {
    return { valid: false, error: "Apple receipt has no expires_date_ms", code: "apple_no_expiry" };
  }
  if (expiresMs <= Date.now()) {
    return { valid: false, error: "Subscription expired", code: "expired" };
  }

  return {
    valid: true,
    expiresAt: expiresMs,
    originalTransactionId: String(newest.original_transaction_id || newest.transaction_id || ""),
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
    return {
      valid: true,
      expiresAt: null,
      originalTransactionId: String(data?.orderId || ""),
      isLifetime: true,
      productId,
    };
  }

  const expiresMs = Number(data?.expiryTimeMillis || 0);
  if (!expiresMs) {
    return { valid: false, error: "Google subscription has no expiryTimeMillis", code: "google_no_expiry" };
  }
  if (expiresMs <= Date.now()) {
    return { valid: false, error: "Subscription expired", code: "expired" };
  }

  return {
    valid: true,
    expiresAt: expiresMs,
    originalTransactionId: String(data?.orderId || data?.linkedPurchaseToken || purchaseToken),
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
      if (targetUserId) {
        try {
          const plan = PRODUCT_TO_PLAN[result.productId];
          const expiresAtDate = result.isLifetime ? null : (result.expiresAt ? new Date(result.expiresAt) : null);

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
              "subscription.receipt": receipt,
              "subscription.isActive": true,
              "subscription.lastVerifiedAt": new Date(),
              "subscription.expiresAt": expiresAtDate,
            };
            if (!existingSub?.startedAt) update["subscription.startedAt"] = new Date();
            await User.findByIdAndUpdate(targetUserId, { $set: update });
          } else {
            await User.findByIdAndUpdate(targetUserId, {
              $set: {
                "subscription.lastVerifiedAt": new Date(),
                "subscription.expiresAt": expiresAtDate,
              },
            });
          }
          attached = true;
        } catch (err: any) {
          logger.error("[IAP] Failed to persist subscription:", err?.message || err);
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
        ...(result.environment ? { environment: result.environment } : {}),
      });
    } catch (err: any) {
      logger.error("[IAP] /api/iap/validate fatal:", err?.message || err);
      return res.status(500).json({ valid: false, error: "Internal validation error" });
    }
  });
}

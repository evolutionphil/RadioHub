import type { Express, Request, Response } from "express";
import Stripe from "stripe";
import { Paddle, Environment } from "@paddle/paddle-node-sdk";
import { completeTvSubscription, createTvCode, getSubscriptionPlan, getTvCode, tvSubscriptionToken } from "../data/postgres-tv-store";
import { logger } from "../utils/logger";
import {
  pgApplySubscriptionEvent,
  pgFindSubscriptionUser,
  pgGetSubscription,
  pgRecordBillingEvent,
  pgUpsertSubscription,
} from "../data/postgres-billing-store";
import { pgFindUserById } from "../data/postgres-user-store";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const WEB_BASE_URL = process.env.WEB_BASE_URL || "https://www.themegaradio.com";

// ── Paddle config ─────────────────────────────────────────────────────────────
const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET;
// Set PAYMENT_PROVIDER=paddle to route new checkouts through Paddle.
// Stripe remains active for existing subscribers and can be re-enabled by
// switching back to PAYMENT_PROVIDER=stripe (or unsetting the variable).
const PAYMENT_PROVIDER: "stripe" | "paddle" = (process.env.PAYMENT_PROVIDER as any) || "stripe";
// Set PADDLE_ENVIRONMENT=sandbox to use Paddle sandbox for testing.
const PADDLE_ENV = process.env.PADDLE_ENVIRONMENT === "sandbox"
  ? Environment.sandbox
  : Environment.production;

function getPaddle(): Paddle | null {
  if (!PADDLE_API_KEY) return null;
  return new Paddle(PADDLE_API_KEY, { environment: PADDLE_ENV });
}

// DB-first Paddle price ID lookup (mirrors Stripe's stripePriceId approach).
// Falls back to env vars so Railway secrets still work as a safety net.
async function getPaddlePriceId(plan: string): Promise<string | null> {
  try {
    const doc = await getSubscriptionPlan(plan);
    if ((doc as any)?.paddlePriceId) return (doc as any).paddlePriceId as string;
  } catch {}
  // env var fallback
  switch (plan) {
    case "remove_ads":       return process.env.PADDLE_PRICE_REMOVE_ADS || null;
    case "premium_monthly":  return process.env.PADDLE_PRICE_MONTHLY    || null;
    case "premium_yearly":   return process.env.PADDLE_PRICE_ANNUAL     || null;
    case "premium_lifetime": return process.env.PADDLE_PRICE_LIFETIME   || null;
    default:                 return null;
  }
}

// Stripe plan → IAP plan value mapping. Keys are the Stripe price IDs from env.
const STRIPE_PRICE_TO_PLAN: Record<string, string> = {};

function getStripe(): Stripe | null {
  if (!STRIPE_SECRET_KEY) return null;
  return new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2026-04-22.dahlia" });
}

function buildPricePlanMap() {
  const monthly = process.env.STRIPE_PRICE_MONTHLY;
  const annual = process.env.STRIPE_PRICE_ANNUAL;
  const lifetime = process.env.STRIPE_PRICE_LIFETIME;
  if (monthly) STRIPE_PRICE_TO_PLAN[monthly] = "premium_monthly";
  if (annual) STRIPE_PRICE_TO_PLAN[annual] = "premium_yearly";
  if (lifetime) STRIPE_PRICE_TO_PLAN[lifetime] = "premium_lifetime";
}

buildPricePlanMap();

// Subscription plan → TV-normalised tier/period for TV app display
function normalizePlanForTv(plan: string) {
  switch (plan) {
    case "premium_monthly":
      return { tier: "premium", period: "monthly" };
    case "premium_yearly":
      return { tier: "premium", period: "annual" };
    case "premium_lifetime":
      return { tier: "premium", period: "lifetime" };
    case "remove_ads":
      return { tier: "free", period: null };
    default:
      return { tier: "free", period: null };
  }
}

function plainSubscriptionPatch(update: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(update).map(([key, candidate]) => [key.replace(/^subscription\./, ""), candidate]));
}

async function persistSubscription(
  userId: string,
  update: Record<string, any>,
): Promise<void> {
  await pgUpsertSubscription(userId, plainSubscriptionPatch(update));
}

function formatSubscriptionStatus(sub: Record<string, any>): Record<string, unknown> {
  const isPremium = !!sub.isActive && sub.plan && sub.plan !== "none" && sub.plan !== "remove_ads";
  if (!isPremium) return { tier: "free", status: "active" };
  const plan = sub.plan === "premium_monthly" ? "monthly" : sub.plan === "premium_yearly"
    ? "annual" : sub.plan === "premium_lifetime" ? "lifetime" : sub.plan;
  const valid = ["active", "past_due", "canceled", "trialing"];
  const status = valid.includes(sub.subscriptionStatus)
    ? sub.subscriptionStatus : sub.isActive ? "active" : "canceled";
  const cancelAtPeriodEnd = !!sub.cancelAtPeriodEnd;
  const response: Record<string, unknown> = {
    tier: "premium", plan, status, validUntil: sub.expiresAt ?? null, cancelAtPeriodEnd,
  };
  if (!cancelAtPeriodEnd && status !== "canceled") response.renewsAt = sub.renewsAt ?? sub.expiresAt ?? null;
  return response;
}

export function registerStripeSubscriptionRoutes(app: Express, deps: any) {
  const { requireAuth, requireAdmin } = deps;

  // Admin debug endpoint — shows Paddle config without exposing full secret
  app.get("/api/admin/paddle/debug", requireAdmin, async (_req: Request, res: Response) => {
    const apiKey = process.env.PADDLE_API_KEY || "";
    const clientToken = process.env.PADDLE_CLIENT_TOKEN || process.env.VITE_PADDLE_CLIENT_TOKEN || "";
    const plans: Record<string, string | null> = {};
    for (const plan of ["premium_monthly", "premium_yearly", "premium_lifetime", "remove_ads"]) {
      plans[plan] = await getPaddlePriceId(plan);
    }
    return void res.json({
      PAYMENT_PROVIDER,
      PADDLE_ENVIRONMENT: process.env.PADDLE_ENVIRONMENT || "production",
      apiKeyConfigured: !!apiKey,
      apiKeyPrefix: apiKey ? apiKey.slice(0, 16) + "..." : null,
      clientTokenConfigured: !!clientToken,
      clientTokenPrefix: clientToken ? clientToken.slice(0, 12) + "..." : null,
      plans,
    });
  });

  // ── CORS * for all TV-facing subscription endpoints ───────────────────────
  // These endpoints are called from Samsung Tizen / LG WebOS native apps and
  // from the web activation page on arbitrary preview origins. Bearer-token
  // auth is used (no cookies), so ACAO: * is safe and required.
  const TV_SUB_PATHS = [
    "/api/subscription/tv/code",
    "/api/subscription/tv/code/:code/status",
    "/api/subscription/status",
  ];
  const setCorsStarHeaders = (_req: Request, res: Response, next: () => void) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    next();
  };
  for (const path of TV_SUB_PATHS) {
    app.options(path, setCorsStarHeaders, (_req: Request, res: Response) => res.sendStatus(204));
    app.use(path, setCorsStarHeaders);
  }

  // ── TV device requests a 6-digit subscription PIN ──────────────────────────
  // Public (CORS *). The TV app shows this code and the user enters it on the
  // web activate page to link their subscription purchase.
  app.post("/api/subscription/tv/code", async (req: Request, res: Response) => {
    try {
      const { deviceId, platform = "other" } = req.body;
      if (!deviceId || typeof deviceId !== "string") {
        return void res.status(400).json({ error: "deviceId is required" });
      }
      if (!["tizen", "webos", "other"].includes(platform)) {
        return void res.status(400).json({ error: "platform must be tizen, webos, or other" });
      }

      const { code, expiresAt } = await createTvCode('subscription', deviceId, platform);

      logger.log(`[TV SUB] Code ${code} generated for device ${deviceId} (${platform})`);

      res.json({
        success: true,
        code,
        activationUrl: `${WEB_BASE_URL}/activate?code=${code}`,
        expiresIn: 600,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err: any) {
      logger.error("[TV SUB] Code generation error:", err.message);
      res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : "Failed to generate code" });
    }
  });

  // ── TV polls for subscription code status ──────────────────────────────────
  // Returns `pending` until the Stripe webhook fires and marks it `completed`.
  app.get("/api/subscription/tv/code/:code/status", async (req: Request, res: Response) => {
    try {
      const { code } = req.params;
      const { deviceId } = req.query as { deviceId?: string };

      // The web activate page sends deviceId=web-activate because it doesn't
      // know the TV's actual deviceId. In that case query by code only and
      // return a status-only response (no auth token — the browser doesn't need it).
      const webCaller = !deviceId || deviceId === 'web-activate';
      if (!webCaller && !deviceId) {
        return void res.status(400).json({ error: "deviceId query parameter is required" });
      }

      // Sort by _id desc: if an old expired doc exists with the same code
      // (6-digit reuse across sessions), we get the newest one first.
      const tvCode = await getTvCode('subscription', String(code), webCaller ? undefined : deviceId);
      if (!tvCode) {
        return void res.status(200).json({ status: "not_found" });
      }

      // Auto-expire overdue pending codes and return 200 expired (not 404 —
      // 404 causes TV to treat it as "still pending" and poll forever).
      if (tvCode.status === "expired") {
        return void res.json({ status: "expired" });
      }

      // Activated — build full response including a TV auth token so the TV can
      // auto-login the user without them entering credentials on the TV.
      // Web callers (web-activate page) only need the status field.
      if (tvCode.status === "completed" && tvCode.userId) {
        if (webCaller) {
          return void res.json({ status: "activated" });
        }

        const user = await pgFindUserById(String(tvCode.userId));

        const plan = user?.subscription?.plan || tvCode.plan || "none";
        const normalized = normalizePlanForTv(plan);

        // Mint a long-lived TV bearer token (90 days, same as mobile TV login)
        let token: string | undefined;
        try {
          token = await tvSubscriptionToken(tvCode.id, deviceId!) ?? undefined;
        } catch (tokenErr: any) {
          logger.error("[TV SUB] Failed to generate auth token:", tokenErr.message);
          // Don't fail the whole response — TV can still refresh later via /api/subscription/status
        }

        return void res.json({
          status: "activated",
          subscription: {
            tier: normalized.tier,
            plan: normalized.period ?? plan,
            validUntil: user?.subscription?.expiresAt ?? null,
          },
          user: {
            id: String(tvCode.userId),
            email: user?.email ?? "",
            token,
          },
        });
      }

      res.json({ status: "pending" });
    } catch (err: any) {
      logger.error("[TV SUB] Code status error:", err.message);
      res.status(500).json({ error: "Failed to check code status" });
    }
  });

  // ── Create Checkout Session (Stripe or Paddle) ────────────────────────────
  // PAYMENT_PROVIDER env var selects which provider handles new checkouts.
  // Stripe remains registered and available; switch back by unsetting the var.
  app.post("/api/subscription/checkout", requireAuth, async (req: Request, res: Response) => {
    const userId = (req.session as any)?.user?.userId || (req as any).userId;
    const { plan, tvCode } = req.body;

    const VALID_PLANS = ["remove_ads", "premium_monthly", "premium_yearly", "premium_lifetime"];
    if (!plan || !VALID_PLANS.includes(plan)) {
      return void res.status(400).json({ error: "Invalid plan. Supported: remove_ads, premium_monthly, premium_yearly, premium_lifetime" });
    }

    // Bind the checkout to this specific code issuance, not a reusable six-digit PIN.
    let validatedTvCodeId = '';
    if (tvCode) {
      const code = await getTvCode('subscription', tvCode);
      if (!code || code.status !== 'pending') {
        return void res.status(400).json({ error: "TV code is invalid or expired" });
      }
      validatedTvCodeId = code.id;
    }

    // ── Paddle branch ────────────────────────────────────────────────────────
    if (PAYMENT_PROVIDER === "paddle") {
      try {
        const paddle = getPaddle();
        if (!paddle) {
          return void res.status(503).json({ error: "Paddle is not configured on this server. Set PADDLE_API_KEY." });
        }

        const priceId = await getPaddlePriceId(plan);
        if (!priceId) {
          return void res.status(503).json({ error: `No Paddle price configured for plan: ${plan}. Go to Admin → Paddle Plans and add the Paddle Price ID.` });
        }

        // Validate the price ID exists in the correct Paddle environment
        // before sending it to the frontend. This surfaces "wrong price ID"
        // as a clear server-side error instead of a silent 400 inside the overlay.
        try {
          await paddle.prices.get(priceId);
        } catch (priceErr: any) {
          const env = process.env.PADDLE_ENVIRONMENT === "sandbox" ? "SANDBOX" : "PRODUCTION";
          logger.error(`[PADDLE] Price ID '${priceId}' not found in ${env} catalog:`, priceErr?.message);
          return void res.status(503).json({
            error: `Paddle price ID '${priceId}' not found in ${env} catalog. ` +
              `Check Admin → Paddle Plans and make sure the price IDs come from the ` +
              `${env} catalog at paddle.com (Catalog → Prices).`,
          });
        }

        // Paddle.js items-based checkout: do NOT pre-create a transaction.
        // Pre-created transactions start in "draft" status and Paddle's hosted
        // checkout page returns 404 for them. Passing the priceId to Paddle.js
        // directly lets Paddle.js create + complete the transaction in one step.
        const successUrl = tvCode
          ? `${WEB_BASE_URL}/activate/success?code=${tvCode}`
          : `${WEB_BASE_URL}/premium/success`;

        logger.log(`[PADDLE] Returning priceId for Paddle.js checkout: user=${userId}, plan=${plan}, priceId=${priceId}`);
        return void res.json({
          success: true,
          paddleCheckout: {
            priceId,
            customData: { userId: String(userId), plan, tvCode: tvCode || "", tvCodeId: validatedTvCodeId },
            successUrl,
            // Include the client-side token so the frontend never needs to
            // bake VITE_PADDLE_CLIENT_TOKEN into a build-time env var.
            clientToken: process.env.PADDLE_CLIENT_TOKEN || process.env.VITE_PADDLE_CLIENT_TOKEN || "",
            // Tell the frontend which environment to pass to Paddle.Environment.set().
            // Paddle.js v2 requires this call before Initialize() when using sandbox
            // tokens — without it, a test_ token is treated as production and errors.
            environment: process.env.PADDLE_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
          },
        });
      } catch (err: any) {
        logger.error("[PADDLE] Checkout error:", err.message);
        const userMessage = err?.code
          ? `Paddle error: ${err.message}`
          : "Failed to create Paddle checkout session";
        return void res.status(500).json({ error: userMessage });
      }
    }

    // ── Stripe branch (default) ──────────────────────────────────────────────
    try {
      const stripe = getStripe();
      if (!stripe) {
        return void res.status(503).json({ error: "Stripe is not configured on this server. Set STRIPE_SECRET_KEY or switch PAYMENT_PROVIDER=paddle." });
      }

      // Price ID: DB (admin-managed) takes precedence over env vars
      let priceId: string | null = null;
      try {
        const planDoc = await getSubscriptionPlan(plan);
        if (planDoc?.stripePriceId) priceId = planDoc.stripePriceId;
      } catch {}
      if (!priceId) {
        priceId =
          plan === "remove_ads"       ? process.env.STRIPE_PRICE_REMOVE_ADS || null :
          plan === "premium_monthly"  ? process.env.STRIPE_PRICE_MONTHLY    || null :
          plan === "premium_yearly"   ? process.env.STRIPE_PRICE_ANNUAL     || null :
          plan === "premium_lifetime" ? process.env.STRIPE_PRICE_LIFETIME   || null :
          null;
      }
      if (!priceId) {
        return void res.status(503).json({ error: `No Stripe price configured for plan: ${plan}. Set it in admin → Stripe Plans, or switch to PAYMENT_PROVIDER=paddle.` });
      }

      const user = await pgFindUserById(String(userId));
      if (!user) {
        return void res.status(404).json({ error: "User not found" });
      }

      // Reuse existing Stripe customer if present
      let customerId: string | undefined = user?.subscription?.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({ email: user.email, metadata: { userId: String(userId) } });
        customerId = customer.id;
        await persistSubscription(String(userId),
          { "subscription.stripeCustomerId": customerId },
        );
      }

      // Auto-detect checkout mode from the Stripe price type to avoid mode-mismatch 500s.
      let stripePrice: Stripe.Price;
      try {
        stripePrice = await stripe.prices.retrieve(priceId);
      } catch (priceErr: any) {
        logger.error("[STRIPE] Failed to retrieve price:", priceErr.message);
        return void res.status(503).json({ error: `Stripe price not found: ${priceId}. Check admin → Stripe Plans.` });
      }
      const mode: "payment" | "subscription" =
        stripePrice.type === "one_time" ? "payment" : "subscription";

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        customer: customerId,
        mode,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: tvCode
          ? `${WEB_BASE_URL}/activate/success?code=${tvCode}&session_id={CHECKOUT_SESSION_ID}`
          : `${WEB_BASE_URL}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: tvCode
          ? `${WEB_BASE_URL}/activate?code=${tvCode}`
          : `${WEB_BASE_URL}/premium`,
        metadata: { userId: String(userId), plan, tvCode: tvCode || "", tvCodeId: validatedTvCodeId },
      };
      if (mode === "subscription") {
        sessionParams.subscription_data = {
          metadata: { userId: String(userId), plan, tvCode: tvCode || "", tvCodeId: validatedTvCodeId },
        };
      }
      const session = await stripe.checkout.sessions.create(sessionParams);
      logger.log(`[STRIPE] Checkout session ${session.id} for user ${userId}, plan=${plan}, tvCode=${tvCode || "none"}`);
      res.json({ success: true, checkoutUrl: session.url });
    } catch (err: any) {
      logger.error("[STRIPE] Checkout error:", err.message);
      const userMessage = err?.type?.startsWith("Stripe")
        ? `Stripe error: ${err.message}`
        : "Failed to create checkout session";
      res.status(500).json({ error: userMessage });
    }
  });

  // ── Stripe Webhook ─────────────────────────────────────────────────────────
  // Must be registered BEFORE the JSON body-parser so we can read the raw body
  // for signature verification. Express raw body is available via req.body when
  // content-type is application/json and express.raw() runs first.
  app.post(
    "/api/webhooks/stripe",
    async (req: Request, res: Response) => {
      const stripe = getStripe();
      if (!stripe) return void res.status(503).json({ error: "Stripe webhook is not configured" });

      const sig = req.headers["stripe-signature"] as string;
      // rawBody is captured by the global express.json() verify callback.
      const rawBody = (req as any).rawBody || "";

      if (!STRIPE_WEBHOOK_SECRET) {
        logger.error("[TV SUB] STRIPE_WEBHOOK_SECRET not configured");
        return void res.status(503).json({ error: "Stripe webhook is not configured" });
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
      } catch (err: any) {
        logger.warn("[TV SUB] Webhook signature invalid:", err.message);
        return void res.status(400).json({ error: "Invalid signature" });
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const { userId, plan, tvCode, tvCodeId } = session.metadata || {};

        if (!userId || !plan) {
          logger.warn("[TV SUB] Webhook missing userId or plan in metadata");
          return void res.status(200).json({ received: true });
        }

        try {
          // For Stripe subscriptions, renewal is managed by Stripe webhooks.
          // We don't store a local expiresAt — subscription status is determined
          // by isActive + the Stripe customer portal / renewal events.
          const expiresAt: Date | null = null;

          const subscriptionUpdate = {
                "subscription.plan": plan,
                "subscription.platform": "stripe",
                "subscription.stripeCustomerId": session.customer as string,
                "subscription.stripeSubscriptionId": session.subscription as string || undefined,
                "subscription.isActive": true,
                "subscription.startedAt": new Date(),
                "subscription.expiresAt": expiresAt,
                "subscription.lastVerifiedAt": new Date(),
          };
          {
            const outcome = await pgApplySubscriptionEvent(userId, plainSubscriptionPatch(subscriptionUpdate), {
              provider: "stripe", providerEventId: event.id, userId,
              eventType: event.type, status: "processed", plan,
              amountMinor: session.amount_total, currency: session.currency,
              occurredAt: new Date(event.created * 1000), payload: event as any,
            }, {
              order: { field: "lastStripeEventTime", timestamp: event.created * 1000, isDowngrade: false },
            });
            if (outcome === "stale") return void res.status(200).json({ received: true, skipped: "stale_event" });
          }

          logger.log(`[TV SUB] Checkout notification processed for user ${userId}, plan=${plan}, stripeSessionId=${session.id}`);

          // The atomic payment receipt above also feeds the revenue dashboard.

          // Activate the TV code so the device can poll and get the result
          if (tvCode && (tvCodeId || session.created)) {
            await completeTvSubscription(tvCode, userId, plan, session.id, tvCodeId, session.created ? new Date(session.created * 1000) : undefined);
            logger.log(`[TV SUB] TV code ${tvCode} marked completed`);
          }
        } catch (err: any) {
          logger.error("[TV SUB] Webhook processing error:", err.message);
          return void res.status(503).set("Retry-After", "30").json({ error: "Webhook processing failed" });
        }
      }

      // ── Subscription lifecycle events ─────────────────────────────────────
      // These keep User.subscription.subscriptionStatus in sync so
      // GET /api/subscription/status never needs to call Stripe inline.
      if (event.type === "customer.subscription.updated") {
        try {
          await handleStripeSubscriptionUpdated(event.data.object, event);
        } catch (err: any) {
          logger.error("[STRIPE WEBHOOK] subscription.updated error:", err.message);
          return void res.status(503).set("Retry-After", "30").json({ error: "Webhook processing failed" });
        }
      }

      if (event.type === "invoice.payment_failed") {
        try {
          await handleStripeInvoicePaymentFailed(event.data.object, event);
        } catch (err: any) {
          logger.error("[STRIPE WEBHOOK] invoice.payment_failed error:", err.message);
          return void res.status(503).set("Retry-After", "30").json({ error: "Webhook processing failed" });
        }
      }

      if (event.type === "customer.subscription.deleted") {
        try {
          await handleStripeSubscriptionDeleted(event.data.object, event);
        } catch (err: any) {
          logger.error("[STRIPE WEBHOOK] subscription.deleted error:", err.message);
          return void res.status(503).set("Retry-After", "30").json({ error: "Webhook processing failed" });
        }
      }

      {
        await pgRecordBillingEvent({
          provider: "stripe", providerEventId: event.id, eventType: event.type,
          status: "processed", occurredAt: new Date(event.created * 1000), payload: event as any,
        });
      }

      res.status(200).json({ received: true });
    }
  );

  // ── Paddle Webhook ─────────────────────────────────────────────────────────
  // Handles transaction.completed (one-time payment and first subscription billing)
  // and subscription.activated / subscription.updated for recurring plans.
  app.post(
    "/api/webhooks/paddle",
    async (req: Request, res: Response) => {
      const paddle = getPaddle();
      if (!paddle) return void res.status(503).json({ error: "Paddle webhook is not configured" });

      const sig = req.headers["paddle-signature"] as string;
      // rawBody is captured by the global express.json() verify callback.
      const rawBody = (req as any).rawBody || JSON.stringify(req.body || {});

      if (!PADDLE_WEBHOOK_SECRET) {
        logger.error("[PADDLE] PADDLE_WEBHOOK_SECRET not configured");
        return void res.status(503).json({ error: "Paddle webhook is not configured" });
      }
      try {
        if (!sig || !(await paddle.webhooks.isSignatureValid(rawBody, PADDLE_WEBHOOK_SECRET, sig))) {
          return void res.status(400).json({ error: "Invalid signature" });
        }
      } catch (err: any) {
        logger.warn("[PADDLE] Webhook signature invalid:", err.message);
        return void res.status(400).json({ error: "Invalid signature" });
      }

      let event: any;
      try {
        event = JSON.parse(rawBody);
      } catch {
        return void res.status(400).json({ error: "Invalid JSON" });
      }

      const eventType: string = event?.event_type || "";
      const txnData = event?.data || {};
      logger.log(`[PADDLE] Webhook received: event_type=${eventType}, txn=${txnData?.id || "n/a"}`);

      if (eventType === "transaction.completed") {
        const customData = txnData.custom_data || {};
        const userId: string = customData.userId || "";
        const plan: string = customData.plan || "";
        const tvCode: string = customData.tvCode || "";

        if (!userId || !plan) {
          logger.warn("[PADDLE] transaction.completed missing userId/plan in custom_data");
          return void res.status(200).json({ received: true });
        }

        try {
          const subscriptionUpdate = {
                "subscription.plan": plan,
                "subscription.platform": "paddle",
                "subscription.paddleCustomerId": txnData.customer_id || undefined,
                "subscription.paddleSubscriptionId": txnData.subscription_id || undefined,
                "subscription.isActive": true,
                "subscription.startedAt": new Date(),
                "subscription.expiresAt": null,
                "subscription.lastVerifiedAt": new Date(),
          };
          {
            await pgApplySubscriptionEvent(userId, plainSubscriptionPatch(subscriptionUpdate), {
              provider: "paddle", providerEventId: String(event?.event_id || txnData.id), userId,
              eventType, status: "processed", plan,
              amountMinor: txnData.details?.totals?.total ? parseInt(txnData.details.totals.total, 10) : null,
              currency: txnData.currency_code || null, occurredAt: event.occurred_at ? new Date(event.occurred_at) : new Date(),
              payload: event,
            });
          }

          logger.log(`[PADDLE] Checkout notification processed: user=${userId}, plan=${plan}, txn=${txnData.id}`);

          // The atomic payment receipt above also feeds the revenue dashboard.

          if (tvCode && (customData.tvCodeId || txnData.created_at)) {
            await completeTvSubscription(tvCode, userId, plan, txnData.id, customData.tvCodeId, txnData.created_at ? new Date(txnData.created_at) : undefined);
            logger.log(`[PADDLE] TV code ${tvCode} marked completed`);
          }
        } catch (err: any) {
          logger.error("[PADDLE] Webhook processing error:", err.message);
          return void res.status(503).set("Retry-After", "30").json({ error: "Webhook processing failed" });
        }
      }

      res.status(200).json({ received: true });
    }
  );

  // ── Current subscription status ────────────────────────────────────────────
  // TV polls this every 5 minutes (silent background refresh). Must be <100 ms
  // → read from DB only, never call Stripe API inline.
  // Response shape matches the TV developer spec exactly.
  app.get("/api/subscription/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.user?.userId || (req as any).userId;
      const subscription = await pgGetSubscription(userId);
      if (!subscription && !await pgFindUserById(userId)) return void res.status(404).json({ error: "User not found" });
      res.json(formatSubscriptionStatus(subscription || {}));
    } catch (err: any) {
      logger.error("[TV SUB] Status error:", err.message);
      res.status(500).json({ error: "Failed to fetch subscription status" });
    }
  });
}

// ── Stripe subscription lifecycle webhook helpers ─────────────────────────────
// Exported so they can be called from the main webhook handler above.
// These keep User.subscription in sync with Stripe's subscription state so
// /api/subscription/status never needs to call Stripe inline.

export async function handleStripeSubscriptionUpdated(sub: any, event?: Stripe.Event): Promise<void> {
  // sub is a Stripe.Subscription object (already parsed from raw body)
  const stripeSubId: string | undefined = sub.id;
  const userId: string | undefined = sub.metadata?.userId;
  if (!stripeSubId) return;

  const VALID = ["active", "past_due", "canceled", "trialing"];
  const subscriptionStatus = VALID.includes(sub.status) ? sub.status : "active";
  const cancelAtPeriodEnd = !!sub.cancel_at_period_end;
  const isActive = ["active", "trialing", "past_due"].includes(sub.status);

  // current_period_end is a Unix timestamp (seconds)
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;

  const update: Record<string, unknown> = {
    "subscription.subscriptionStatus": subscriptionStatus,
    "subscription.cancelAtPeriodEnd": cancelAtPeriodEnd,
    "subscription.isActive": isActive,
    "subscription.expiresAt": periodEnd,
    "subscription.renewsAt": cancelAtPeriodEnd ? null : periodEnd,
    "subscription.lastVerifiedAt": new Date(),
  };

  await persistStripeLifecycle(stripeSubId, userId, update, event, !isActive);
  logger.log(`[STRIPE WEBHOOK] subscription.updated ${stripeSubId} → status=${subscriptionStatus} cancelAtPeriodEnd=${cancelAtPeriodEnd}`);
}

export async function handleStripeInvoicePaymentFailed(invoice: any, event?: Stripe.Event): Promise<void> {
  const stripeSubId: string | undefined =
    typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!stripeSubId) return;

  const update = { "subscription.subscriptionStatus": "past_due", "subscription.lastVerifiedAt": new Date() };
  await persistStripeLifecycle(stripeSubId, undefined, update, event, true);
  logger.log(`[STRIPE WEBHOOK] invoice.payment_failed → sub ${stripeSubId} marked past_due`);
}

export async function handleStripeSubscriptionDeleted(sub: any, event?: Stripe.Event): Promise<void> {
  const stripeSubId: string | undefined = sub.id;
  const userId: string | undefined = sub.metadata?.userId;
  if (!stripeSubId) return;

  const update = {
    "subscription.subscriptionStatus": "canceled",
    "subscription.isActive": false,
    "subscription.cancelAtPeriodEnd": false,
    "subscription.lastVerifiedAt": new Date(),
  };

  await persistStripeLifecycle(stripeSubId, userId, update, event, true);
  logger.log(`[STRIPE WEBHOOK] subscription.deleted ${stripeSubId} → canceled`);
}

async function persistStripeLifecycle(
  stripeSubscriptionId: string,
  metadataUserId: string | undefined,
  update: Record<string, unknown>,
  event: Stripe.Event | undefined,
  isDowngrade: boolean,
): Promise<void> {
  let userId = metadataUserId;
  if (!userId) {
    userId = await pgFindSubscriptionUser({ stripeSubscriptionId }) || undefined;
  }
  // A Stripe account may deliver events for customers this application has
  // never linked. There is no local entitlement to change in that case.
  if (!userId) return;

  if (event) {
    await pgApplySubscriptionEvent(userId, plainSubscriptionPatch(update), {
      provider: "stripe", providerEventId: event.id, userId,
      eventType: event.type, status: "processed", occurredAt: new Date(event.created * 1000),
      payload: event as any,
    }, {
      order: { field: "lastStripeEventTime", timestamp: event.created * 1000, isDowngrade },
    });
  } else {
    // Preserve direct helper callers that do not have a provider delivery ID.
    await pgUpsertSubscription(userId, plainSubscriptionPatch(update));
  }
}

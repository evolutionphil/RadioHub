import type { Express, Request, Response } from "express";
import Stripe from "stripe";
import { Paddle, Environment } from "@paddle/paddle-node-sdk";
import { User, TvSubscriptionCode, StripeSubscriptionPlan, StripeSaleEvent } from "@workspace/db-shared/mongo-schemas";
import { logger } from "../utils/logger";

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

function getPaddle(): Paddle | null {
  if (!PADDLE_API_KEY) return null;
  return new Paddle(PADDLE_API_KEY, { environment: Environment.production });
}

// DB-first Paddle price ID lookup (mirrors Stripe's stripePriceId approach).
// Falls back to env vars so Railway secrets still work as a safety net.
async function getPaddlePriceId(plan: string): Promise<string | null> {
  try {
    const doc = await StripeSubscriptionPlan.findOne({ planId: plan as any, isActive: true }).lean();
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

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function registerStripeSubscriptionRoutes(app: Express, deps: any) {
  const { requireAuth } = deps;

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

      // Rate-limit: max 5 codes per deviceId per hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentCount = await TvSubscriptionCode.countDocuments({
        deviceId,
        createdAt: { $gte: oneHourAgo },
      });
      if (recentCount >= 5) {
        return void res.status(429).json({ error: "Too many code requests. Try again in an hour." });
      }

      // Expire any still-pending codes for this device
      await TvSubscriptionCode.updateMany(
        { deviceId, status: "pending" },
        { $set: { status: "expired" } }
      );

      // Generate a unique 6-digit code
      let code: string = "";
      let attempts = 0;
      do {
        code = generateCode();
        const exists = await TvSubscriptionCode.findOne({
          code,
          status: "pending",
          expiresAt: { $gt: new Date() },
        });
        if (!exists) break;
        attempts++;
      } while (attempts < 10);

      if (attempts >= 10) {
        return void res.status(503).json({ error: "Unable to generate unique code. Try again." });
      }

      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await TvSubscriptionCode.create({
        code,
        deviceId,
        platform,
        status: "pending",
        expiresAt,
        createdAt: new Date(),
      });

      logger.log(`[TV SUB] Code ${code} generated for device ${deviceId} (${platform})`);

      res.json({ success: true, code, expiresIn: 600 });
    } catch (err: any) {
      logger.error("[TV SUB] Code generation error:", err.message);
      res.status(500).json({ error: "Failed to generate code" });
    }
  });

  // ── TV polls for subscription code status ──────────────────────────────────
  // Returns `pending` until the Stripe webhook fires and marks it `completed`.
  app.get("/api/subscription/tv/code/:code/status", async (req: Request, res: Response) => {
    try {
      const { code } = req.params;
      const { deviceId } = req.query as { deviceId?: string };

      if (!deviceId) {
        return void res.status(400).json({ error: "deviceId query parameter is required" });
      }

      const tvCode = await TvSubscriptionCode.findOne({ code, deviceId });

      if (!tvCode) {
        return void res.status(404).json({ status: "expired", message: "Code not found or expired" });
      }
      if (tvCode.expiresAt < new Date() && tvCode.status === "pending") {
        await TvSubscriptionCode.updateOne({ _id: tvCode._id }, { $set: { status: "expired" } });
        return void res.status(404).json({ status: "expired", message: "Code expired, request a new one" });
      }
      if (tvCode.status === "completed" && tvCode.userId) {
        const user = await User.findById(tvCode.userId).select("subscription").lean() as any;
        const plan = user?.subscription?.plan || "none";
        const normalized = normalizePlanForTv(plan);
        return void res.json({
          status: "completed",
          plan,
          ...normalized,
          expiresAt: user?.subscription?.expiresAt ?? null,
        });
      }
      if (tvCode.status === "expired") {
        return void res.status(404).json({ status: "expired", message: "Code expired, request a new one" });
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

    // Validate the TV code if provided
    if (tvCode) {
      const code = await TvSubscriptionCode.findOne({
        code: tvCode,
        status: "pending",
        expiresAt: { $gt: new Date() },
      });
      if (!code) {
        return void res.status(400).json({ error: "TV code is invalid or expired" });
      }
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
          return void res.status(503).json({ error: `No Paddle price configured for plan: ${plan}. Set it in admin → Stripe Plans (Paddle Price ID field).` });
        }

        const transaction = await paddle.transactions.create({
          items: [{ priceId, quantity: 1 }],
          customData: {
            userId: String(userId),
            plan,
            tvCode: tvCode || "",
          },
          // checkout.url is the post-payment redirect destination
          checkout: {
            url: tvCode
              ? `${WEB_BASE_URL}/activate/success?code=${tvCode}`
              : `${WEB_BASE_URL}/premium/success`,
          },
        });

        const checkoutUrl = transaction.checkout?.url;
        if (!checkoutUrl) {
          logger.error("[PADDLE] Transaction created but no checkout.url returned:", transaction.id);
          return void res.status(503).json({ error: "Paddle did not return a checkout URL. Check that prices are active." });
        }

        logger.log(`[PADDLE] Checkout txn ${transaction.id} for user ${userId}, plan=${plan}, tvCode=${tvCode || "none"}`);
        return void res.json({ success: true, checkoutUrl });
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
        const planDoc = await StripeSubscriptionPlan.findOne({ planId: plan, isActive: true }).lean();
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

      const user = await User.findById(userId).select("email subscription").lean() as any;
      if (!user) {
        return void res.status(404).json({ error: "User not found" });
      }

      // Reuse existing Stripe customer if present
      let customerId: string | undefined = user?.subscription?.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({ email: user.email, metadata: { userId: String(userId) } });
        customerId = customer.id;
        await User.updateOne({ _id: userId }, { $set: { "subscription.stripeCustomerId": customerId } });
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
        metadata: { userId: String(userId), plan, tvCode: tvCode || "" },
      };
      if (mode === "subscription") {
        sessionParams.subscription_data = {
          metadata: { userId: String(userId), plan, tvCode: tvCode || "" },
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
    // Raw body needed for HMAC verification — do NOT parse as JSON
    (req: Request, res: Response, next) => {
      if (req.headers["content-type"] === "application/json") {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          (req as any).rawBody = body;
          next();
        });
      } else {
        next();
      }
    },
    async (req: Request, res: Response) => {
      const stripe = getStripe();
      if (!stripe) return void res.status(200).json({ received: true });

      const sig = req.headers["stripe-signature"] as string;
      const rawBody = (req as any).rawBody || "";

      if (!STRIPE_WEBHOOK_SECRET) {
        logger.warn("[TV SUB] STRIPE_WEBHOOK_SECRET not set — skipping signature verification");
      } else {
        try {
          stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
        } catch (err: any) {
          logger.warn("[TV SUB] Webhook signature invalid:", err.message);
          return void res.status(400).json({ error: "Invalid signature" });
        }
      }

      let event: Stripe.Event;
      try {
        event = JSON.parse(rawBody) as Stripe.Event;
      } catch {
        return void res.status(400).json({ error: "Invalid JSON" });
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const { userId, plan, tvCode } = session.metadata || {};

        if (!userId || !plan) {
          logger.warn("[TV SUB] Webhook missing userId or plan in metadata");
          return void res.status(200).json({ received: true });
        }

        try {
          // For Stripe subscriptions, renewal is managed by Stripe webhooks.
          // We don't store a local expiresAt — subscription status is determined
          // by isActive + the Stripe customer portal / renewal events.
          const expiresAt: Date | null = null;

          await User.updateOne(
            { _id: userId },
            {
              $set: {
                "subscription.plan": plan,
                "subscription.platform": "stripe",
                "subscription.stripeCustomerId": session.customer as string,
                "subscription.stripeSubscriptionId": session.subscription as string || undefined,
                "subscription.isActive": true,
                "subscription.startedAt": new Date(),
                "subscription.expiresAt": expiresAt,
                "subscription.lastVerifiedAt": new Date(),
              },
            }
          );

          logger.log(`[TV SUB] Subscription activated for user ${userId}, plan=${plan}, stripeSessionId=${session.id}`);

          // Record sale event for revenue dashboard
          try {
            await StripeSaleEvent.create({
              userId: userId || null,
              plan,
              stripeSessionId: session.id,
              stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
              amount: session.amount_total ?? 0,
              currency: session.currency ?? "usd",
              isLifetime: plan === "premium_lifetime",
              tvCode: tvCode || undefined,
              createdAt: new Date(),
            });
          } catch (saleErr: any) {
            // Sale event write is best-effort — don't fail the webhook
            logger.warn("[TV SUB] Failed to record sale event:", saleErr.message);
          }

          // Activate the TV code so the device can poll and get the result
          if (tvCode) {
            await TvSubscriptionCode.updateMany(
              { code: tvCode, status: "pending" },
              {
                $set: {
                  status: "completed",
                  userId,
                  plan,
                  stripeSessionId: session.id,
                  completedAt: new Date(),
                },
              }
            );
            logger.log(`[TV SUB] TV code ${tvCode} marked completed`);
          }
        } catch (err: any) {
          logger.error("[TV SUB] Webhook processing error:", err.message);
        }
      }

      res.status(200).json({ received: true });
    }
  );

  // ── Paddle Webhook ─────────────────────────────────────────────────────────
  // Handles transaction.completed (one-time payment and first subscription billing)
  // and subscription.activated / subscription.updated for recurring plans.
  app.post(
    "/api/webhooks/paddle",
    (req: Request, res: Response, next) => {
      // Capture raw body for HMAC signature verification
      if (req.headers["content-type"]?.includes("application/json")) {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => { (req as any).rawBody = body; next(); });
      } else {
        next();
      }
    },
    async (req: Request, res: Response) => {
      const paddle = getPaddle();
      if (!paddle) return void res.status(200).json({ received: true });

      const sig = req.headers["paddle-signature"] as string;
      const rawBody = (req as any).rawBody || "";

      if (!PADDLE_WEBHOOK_SECRET) {
        logger.warn("[PADDLE] PADDLE_WEBHOOK_SECRET not set — skipping signature check");
      } else if (sig) {
        try {
          await paddle.webhooks.isSignatureValid(rawBody, PADDLE_WEBHOOK_SECRET, sig);
        } catch (err: any) {
          logger.warn("[PADDLE] Webhook signature invalid:", err.message);
          return void res.status(400).json({ error: "Invalid signature" });
        }
      }

      let event: any;
      try {
        event = JSON.parse(rawBody);
      } catch {
        return void res.status(400).json({ error: "Invalid JSON" });
      }

      const eventType: string = event?.event_type || "";
      const txnData = event?.data || {};

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
          await User.updateOne(
            { _id: userId },
            {
              $set: {
                "subscription.plan": plan,
                "subscription.platform": "paddle",
                "subscription.paddleCustomerId": txnData.customer_id || undefined,
                "subscription.paddleSubscriptionId": txnData.subscription_id || undefined,
                "subscription.isActive": true,
                "subscription.startedAt": new Date(),
                "subscription.expiresAt": null,
                "subscription.lastVerifiedAt": new Date(),
              },
            }
          );

          logger.log(`[PADDLE] Subscription activated: user=${userId}, plan=${plan}, txn=${txnData.id}`);

          // Record sale event for revenue dashboard
          try {
            await StripeSaleEvent.create({
              userId: userId || null,
              plan,
              stripeSessionId: txnData.id,     // reusing field — txn ID stored here
              stripeCustomerId: txnData.customer_id || undefined,
              amount: txnData.details?.totals?.total ? parseInt(txnData.details.totals.total, 10) : 0,
              currency: txnData.currency_code || "eur",
              isLifetime: plan === "premium_lifetime",
              tvCode: tvCode || undefined,
              createdAt: new Date(),
            });
          } catch (saleErr: any) {
            logger.warn("[PADDLE] Failed to record sale event:", saleErr.message);
          }

          if (tvCode) {
            await TvSubscriptionCode.updateMany(
              { code: tvCode, status: "pending" },
              {
                $set: {
                  status: "completed",
                  userId,
                  plan,
                  stripeSessionId: txnData.id,
                  completedAt: new Date(),
                },
              }
            );
            logger.log(`[PADDLE] TV code ${tvCode} marked completed`);
          }
        } catch (err: any) {
          logger.error("[PADDLE] Webhook processing error:", err.message);
        }
      }

      res.status(200).json({ received: true });
    }
  );

  // ── Current subscription status ────────────────────────────────────────────
  // Used by both TV and web to get the authenticated user's subscription.
  app.get("/api/subscription/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.user?.userId || (req as any).userId;
      const user = await User.findById(userId).select("subscription").lean() as any;

      if (!user) {
        return void res.status(404).json({ error: "User not found" });
      }

      const sub = user.subscription || {};
      const plan: string = sub.plan || "none";
      const normalized = normalizePlanForTv(plan);

      res.json({
        plan,
        platform: sub.platform || null,
        isActive: !!sub.isActive,
        expiresAt: sub.expiresAt || null,
        startedAt: sub.startedAt || null,
        ...normalized,
      });
    } catch (err: any) {
      logger.error("[TV SUB] Status error:", err.message);
      res.status(500).json({ error: "Failed to fetch subscription status" });
    }
  });
}

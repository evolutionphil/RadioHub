import type { Express, Request, Response } from "express";
import Stripe from "stripe";
import { StripeSubscriptionPlan, type StripePlanId } from "@workspace/db-shared/mongo-schemas";
import { logger } from "../utils/logger";

const DEFAULT_PLANS: Array<{ planId: StripePlanId; label: string; description: string }> = [
  { planId: "remove_ads",      label: "Remove Ads", description: "Ad-free listening, no premium extras" },
  { planId: "premium_monthly", label: "Monthly",    description: "Billed monthly, cancel anytime" },
  { planId: "premium_yearly",  label: "Annual",     description: "Best value — save vs monthly" },
  { planId: "premium_lifetime", label: "Lifetime",  description: "One-time payment, never pay again" },
];

// Seed default plans on first boot if collection is empty
async function seedDefaultPlans() {
  try {
    const count = await StripeSubscriptionPlan.countDocuments();
    if (count > 0) return;
    const envPriceIds: Record<StripePlanId, string | undefined> = {
      remove_ads: process.env.STRIPE_PRICE_REMOVE_ADS,
      premium_monthly: process.env.STRIPE_PRICE_MONTHLY,
      premium_yearly: process.env.STRIPE_PRICE_ANNUAL,
      premium_lifetime: process.env.STRIPE_PRICE_LIFETIME,
    };
    await StripeSubscriptionPlan.insertMany(
      DEFAULT_PLANS.map(p => ({
        planId: p.planId,
        stripePriceId: envPriceIds[p.planId] || "",
        label: p.label,
        description: p.description,
        currency: "usd",
        amount: 0,
        isActive: true,
        updatedAt: new Date(),
      }))
    );
    logger.log("[StripeConfig] Default subscription plans seeded");
  } catch (err: any) {
    logger.warn("[StripeConfig] Seed failed (non-critical):", err?.message);
  }
}

export function registerStripePlanAdminRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // Seed on registration (non-blocking)
  seedDefaultPlans().catch(() => {});

  // ── Public: /activate page fetches plan list ───────────────────────────────
  app.get("/api/subscription/plans", async (_req: Request, res: Response) => {
    try {
      const plans = await StripeSubscriptionPlan.find({ isActive: true })
        .select("planId label description currency amount")
        .lean();
      res.json({ plans });
    } catch (err: any) {
      // Fallback to hardcoded defaults so /activate always works
      res.json({
        plans: DEFAULT_PLANS.map(p => ({
          planId: p.planId,
          label: p.label,
          description: p.description,
          currency: "usd",
          amount: 0,
        })),
      });
    }
  });

  // ── Admin: list all plans (including inactive) ─────────────────────────────
  app.get("/api/admin/stripe-plans", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const plans = await StripeSubscriptionPlan.find().lean();
      res.json({ plans });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch plans" });
    }
  });

  // ── Admin: update a single plan ────────────────────────────────────────────
  app.put("/api/admin/stripe-plans/:planId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const planId = String(req.params.planId);
      const VALID_PLANS: StripePlanId[] = ["remove_ads", "premium_monthly", "premium_yearly", "premium_lifetime"];
      if (!VALID_PLANS.includes(planId as StripePlanId)) {
        return void res.status(400).json({ error: "Invalid planId" });
      }

      const { stripePriceId, label, description, currency, amount, isActive } = req.body;

      const update: Partial<{
        stripePriceId: string;
        label: string;
        description: string;
        currency: string;
        amount: number;
        isActive: boolean;
        updatedAt: Date;
      }> = { updatedAt: new Date() };

      if (typeof stripePriceId === "string") update.stripePriceId = stripePriceId.trim();
      if (typeof label === "string") update.label = label.trim();
      if (typeof description === "string") update.description = description.trim();
      if (typeof currency === "string") update.currency = currency.toLowerCase().trim();
      if (typeof amount === "number") update.amount = Math.round(amount);
      if (typeof isActive === "boolean") update.isActive = isActive;

      const plan = await StripeSubscriptionPlan.findOneAndUpdate(
        { planId: planId as any },
        { $set: update as any },
        { new: true, upsert: true }
      );

      logger.log(`[StripeConfig] Plan ${planId} updated by admin`);
      res.json({ success: true, plan });
    } catch (err: any) {
      logger.error("[StripeConfig] Update error:", err.message);
      res.status(500).json({ error: "Failed to update plan" });
    }
  });

  // ── Admin: verify a Stripe price ID against live Stripe ───────────────────
  app.post("/api/admin/stripe-plans/verify-price", requireAdmin, async (req: Request, res: Response) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return void res.status(503).json({ error: "STRIPE_SECRET_KEY not configured" });
    }
    try {
      const { priceId } = req.body;
      if (!priceId || typeof priceId !== "string") {
        return void res.status(400).json({ error: "priceId is required" });
      }
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });
      const price = await stripe.prices.retrieve(priceId);
      res.json({
        valid: true,
        currency: price.currency,
        unitAmount: price.unit_amount,
        recurring: (price as any).recurring ?? null,
        active: price.active,
        nickname: price.nickname,
      });
    } catch (err: any) {
      res.status(400).json({ valid: false, error: err?.message || "Price not found in Stripe" });
    }
  });
}

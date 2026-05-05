import type { Express, Request, Response } from "express";
import mongoose from "mongoose";
import { IapEvent, User } from "../shared/mongo-schemas";
import { logger } from "../utils/logger";

// Admin endpoints for the IAP audit log + admin-side subscription overrides.
// Mounted by server/routes.ts. All endpoints require admin auth via the
// `requireAdmin` middleware injected from the deps bag (same pattern as
// every other admin route module).

const VALID_RESULTS = new Set([
  "success",
  "replay_blocked",
  "invalid_receipt",
  "expired",
  "apple_error",
  "google_error",
  "missing_credentials",
  "bad_request",
  "persist_error",
  "fatal_error",
]);

const VALID_PLATFORMS = new Set(["ios", "android", "unknown"]);

function clampInt(v: any, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function registerAdminIapRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // -------------------------------------------------------------
  // GET /api/admin/iap-events
  // Filtered, paginated list of IAP audit events.
  // Query params:
  //   - userId          ObjectId
  //   - email           User email (resolved → userId)
  //   - result          one of IapEventResult
  //   - platform        ios|android|unknown
  //   - productId       string match
  //   - originalTransactionId  string match
  //   - from, to        ISO date range (createdAt)
  //   - page (1-based), limit (1..100)
  // -------------------------------------------------------------
  app.get("/api/admin/iap-events", requireAdmin, async (req: Request, res: Response) => {
    try {
      const page = clampInt(req.query.page, 1, 10000, 1);
      const limit = clampInt(req.query.limit, 1, 100, 50);
      const skip = (page - 1) * limit;

      const filter: any = {};

      if (req.query.userId && typeof req.query.userId === "string") {
        if (mongoose.isValidObjectId(req.query.userId)) {
          filter.userId = new mongoose.Types.ObjectId(req.query.userId);
        } else {
          // Invalid id → return empty rather than crashing the cast.
          return res.json({ items: [], total: 0, page, limit });
        }
      }

      if (req.query.email && typeof req.query.email === "string") {
        const emailUser = await User.findOne({ email: req.query.email.toLowerCase().trim() })
          .select("_id")
          .lean();
        if (!emailUser) {
          return res.json({ items: [], total: 0, page, limit });
        }
        filter.userId = (emailUser as any)._id;
      }

      if (req.query.result && typeof req.query.result === "string" && VALID_RESULTS.has(req.query.result)) {
        filter.result = req.query.result;
      }
      if (req.query.platform && typeof req.query.platform === "string" && VALID_PLATFORMS.has(req.query.platform)) {
        filter.platform = req.query.platform;
      }
      if (req.query.productId && typeof req.query.productId === "string") {
        filter.productId = req.query.productId;
      }
      if (req.query.originalTransactionId && typeof req.query.originalTransactionId === "string") {
        filter.originalTransactionId = req.query.originalTransactionId;
      }

      const from = parseDate(req.query.from);
      const to = parseDate(req.query.to);
      if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = from;
        if (to) filter.createdAt.$lte = to;
      }

      const [items, total] = await Promise.all([
        IapEvent.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        IapEvent.countDocuments(filter),
      ]);

      // Hydrate user email/fullName for the rows that have a userId so the
      // admin table can render "kim" without a second roundtrip.
      const userIds = Array.from(
        new Set(items.map((i: any) => i.userId).filter(Boolean).map(String)),
      );
      let userMap: Record<string, { email?: string; fullName?: string }> = {};
      if (userIds.length) {
        const users = await User.find({ _id: { $in: userIds } })
          .select("_id email fullName")
          .lean();
        userMap = users.reduce((acc: any, u: any) => {
          acc[String(u._id)] = { email: u.email, fullName: u.fullName };
          return acc;
        }, {});
      }

      const enriched = items.map((i: any) => ({
        ...i,
        user: i.userId ? userMap[String(i.userId)] || null : null,
      }));

      return res.json({ items: enriched, total, page, limit });
    } catch (err: any) {
      logger.error("[admin/iap-events] list failed:", err?.message || err);
      return res.status(500).json({ error: "Failed to load IAP events" });
    }
  });

  // -------------------------------------------------------------
  // GET /api/admin/iap-events/stats
  // Aggregate counts by `result` over a (default 7-day) window.
  // Used to power the small dashboard at the top of /admin/iap-events.
  // -------------------------------------------------------------
  app.get("/api/admin/iap-events/stats", requireAdmin, async (req: Request, res: Response) => {
    try {
      const days = clampInt(req.query.days, 1, 90, 7);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const rows = await IapEvent.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$result", count: { $sum: 1 } } },
      ]);

      const byResult: Record<string, number> = {};
      for (const r of rows) byResult[r._id] = r.count;

      const total = rows.reduce((s: number, r: any) => s + r.count, 0);
      return res.json({ days, since, total, byResult });
    } catch (err: any) {
      logger.error("[admin/iap-events] stats failed:", err?.message || err);
      return res.status(500).json({ error: "Failed to load IAP stats" });
    }
  });

  // -------------------------------------------------------------
  // POST /api/admin/users/:id/subscription/cancel
  // Admin override: revokes the user's active subscription. Keeps the
  // historical productId/transactionId fields so we can audit later, but
  // flips isActive=false and stamps cancelledAt=now. Lifetime grants can
  // also be cancelled this way (they have isActive=true + expiresAt=null).
  // -------------------------------------------------------------
  app.post(
    "/api/admin/users/:id/subscription/cancel",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
          return res.status(400).json({ error: "Invalid user id" });
        }
        const user = await User.findByIdAndUpdate(
          id,
          {
            $set: {
              "subscription.isActive": false,
              "subscription.cancelledAt": new Date(),
              "subscription.lastVerifiedAt": new Date(),
            },
          },
          { new: true, runValidators: true },
        ).select("subscription email fullName");
        if (!user) return res.status(404).json({ error: "User not found" });

        logger.log(`[admin] subscription cancelled for user=${id} by admin`);
        return res.json({ success: true, subscription: (user as any).subscription });
      } catch (err: any) {
        logger.error("[admin] subscription cancel failed:", err?.message || err);
        return res.status(500).json({ error: "Failed to cancel subscription" });
      }
    },
  );

  // -------------------------------------------------------------
  // POST /api/admin/users/:id/subscription/grant-lifetime
  // Admin override: grants the lifetime premium plan. Sets platform='admin'
  // so it's clear in the audit trail this didn't come from Apple/Google.
  // Clears any previously-set cancelledAt and (re-)sets isActive=true with
  // expiresAt=null (the canonical lifetime shape).
  // -------------------------------------------------------------
  app.post(
    "/api/admin/users/:id/subscription/grant-lifetime",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
          return res.status(400).json({ error: "Invalid user id" });
        }
        const user = await User.findByIdAndUpdate(
          id,
          {
            $set: {
              "subscription.plan": "premium_lifetime",
              "subscription.platform": "admin",
              "subscription.isActive": true,
              "subscription.startedAt": new Date(),
              "subscription.expiresAt": null,
              "subscription.lastVerifiedAt": new Date(),
            },
            $unset: {
              "subscription.cancelledAt": "",
            },
          },
          { new: true, runValidators: true },
        ).select("subscription email fullName");
        if (!user) return res.status(404).json({ error: "User not found" });

        logger.log(`[admin] lifetime granted to user=${id} by admin`);
        return res.json({ success: true, subscription: (user as any).subscription });
      } catch (err: any) {
        logger.error("[admin] grant-lifetime failed:", err?.message || err);
        return res.status(500).json({ error: "Failed to grant lifetime" });
      }
    },
  );
}

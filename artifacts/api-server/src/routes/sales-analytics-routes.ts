import type { Express, Request, Response } from "express";
import { IapEvent, StripeSaleEvent } from "@workspace/db-shared/mongo-schemas";
import { logger } from "../utils/logger";

function parseDateParam(val: unknown, fallback: Date): Date {
  if (typeof val !== "string") return fallback;
  const d = new Date(val);
  return isNaN(d.getTime()) ? fallback : d;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

export function registerSalesAnalyticsRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // ── GET /api/admin/sales ───────────────────────────────────────────────────
  // Query params:
  //   from        ISO date string (default: 30 days ago)
  //   to          ISO date string (default: now)
  //   platform    all | ios | android | stripe (default: all)
  //   plan        all | premium_monthly | premium_yearly | premium_lifetime (default: all)
  //   groupBy     day | week | month (default: day)
  app.get("/api/admin/sales", requireAdmin, async (req: Request, res: Response) => {
    try {
      const to = parseDateParam(req.query.to, new Date());
      const from = parseDateParam(req.query.from, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      const platform = (req.query.platform as string) || "all";
      const plan = (req.query.plan as string) || "all";
      const groupBy = (req.query.groupBy as string) || "day";

      const dateFormat =
        groupBy === "month" ? "%Y-%m" :
        groupBy === "week"  ? "%Y-W%V" :
        "%Y-%m-%d";

      const dateRange = { $gte: from, $lte: to };

      // ── IAP (iOS / Android) ──────────────────────────────────────────────
      const iapMatch: Record<string, any> = {
        createdAt: dateRange,
        result: "success",
      };
      if (platform !== "all" && platform !== "stripe") {
        iapMatch.platform = platform;
      }
      if (plan !== "all") {
        iapMatch.plan = plan;
      }

      const iapSummaryPromise =
        (platform === "stripe")
          ? Promise.resolve({ count: 0, byPlan: [], byPlatform: [], timeline: [] })
          : (async () => {
              const [count, byPlan, byPlatform, timeline] = await Promise.all([
                IapEvent.countDocuments(iapMatch),
                IapEvent.aggregate([
                  { $match: iapMatch },
                  { $group: { _id: "$plan", count: { $sum: 1 } } },
                  { $sort: { count: -1 } },
                ]).option({ maxTimeMS: 15000, allowDiskUse: true }),
                IapEvent.aggregate([
                  { $match: iapMatch },
                  { $group: { _id: "$platform", count: { $sum: 1 } } },
                ]).option({ maxTimeMS: 15000, allowDiskUse: true }),
                IapEvent.aggregate([
                  { $match: iapMatch },
                  {
                    $group: {
                      _id: { date: { $dateToString: { format: dateFormat, date: "$createdAt", timezone: "UTC" } }, plan: "$plan" },
                      count: { $sum: 1 },
                    },
                  },
                  { $sort: { "_id.date": 1 } },
                ]).option({ maxTimeMS: 15000, allowDiskUse: true }),
              ]);
              return { count, byPlan, byPlatform, timeline };
            })();

      // ── Stripe ───────────────────────────────────────────────────────────
      const stripeMatch: Record<string, any> = { createdAt: dateRange };
      if (plan !== "all") stripeMatch.plan = plan;

      const stripeSummaryPromise =
        (platform !== "all" && platform !== "stripe")
          ? Promise.resolve({ count: 0, totalAmount: 0, currency: "usd", byPlan: [], timeline: [] })
          : (async () => {
              const [count, revenue, byPlan, timeline] = await Promise.all([
                StripeSaleEvent.countDocuments(stripeMatch),
                StripeSaleEvent.aggregate([
                  { $match: stripeMatch },
                  { $group: { _id: "$currency", total: { $sum: "$amount" } } },
                ]).option({ maxTimeMS: 15000, allowDiskUse: true }),
                StripeSaleEvent.aggregate([
                  { $match: stripeMatch },
                  { $group: { _id: "$plan", count: { $sum: 1 }, total: { $sum: "$amount" } } },
                  { $sort: { count: -1 } },
                ]).option({ maxTimeMS: 15000, allowDiskUse: true }),
                StripeSaleEvent.aggregate([
                  { $match: stripeMatch },
                  {
                    $group: {
                      _id: { date: { $dateToString: { format: dateFormat, date: "$createdAt", timezone: "UTC" } }, plan: "$plan" },
                      count: { $sum: 1 },
                      amount: { $sum: "$amount" },
                    },
                  },
                  { $sort: { "_id.date": 1 } },
                ]).option({ maxTimeMS: 15000, allowDiskUse: true }),
              ]);
              const totalAmount = (revenue[0]?.total ?? 0) as number;
              const currency = (revenue[0]?._id ?? "usd") as string;
              return { count, totalAmount, currency, byPlan, timeline };
            })();

      // ── Recent sales (last 50) ────────────────────────────────────────────
      const recentPromise = (async () => {
        const recentIap = (platform === "stripe") ? [] : await IapEvent.find(iapMatch)
          .sort({ createdAt: -1 }).limit(50)
          .select("platform plan productId isTrial isLifetime createdAt")
          .lean();
        const recentStripe = (platform !== "all" && platform !== "stripe") ? [] : await StripeSaleEvent.find(stripeMatch)
          .sort({ createdAt: -1 }).limit(50)
          .select("plan amount currency isLifetime tvCode createdAt")
          .lean();
        return [
          ...recentIap.map((e: any) => ({
            source: "iap",
            platform: e.platform,
            plan: e.plan,
            productId: e.productId,
            isTrial: e.isTrial,
            isLifetime: e.isLifetime,
            amount: null,
            currency: null,
            createdAt: e.createdAt,
          })),
          ...recentStripe.map((e: any) => ({
            source: "stripe",
            platform: "stripe",
            plan: e.plan,
            productId: null,
            isTrial: false,
            isLifetime: e.isLifetime,
            amount: e.amount,
            currency: e.currency,
            tvCode: e.tvCode,
            createdAt: e.createdAt,
          })),
        ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 50);
      })();

      const [iap, stripe, recent] = await Promise.all([iapSummaryPromise, stripeSummaryPromise, recentPromise]);

      // Merge timelines into a unified series
      const timelineMap = new Map<string, { date: string; iapCount: number; stripeCount: number; stripeAmount: number }>();
      for (const row of iap.timeline) {
        const k = (row as any)._id.date;
        if (!timelineMap.has(k)) timelineMap.set(k, { date: k, iapCount: 0, stripeCount: 0, stripeAmount: 0 });
        timelineMap.get(k)!.iapCount += (row as any).count;
      }
      for (const row of stripe.timeline) {
        const k = (row as any)._id.date;
        if (!timelineMap.has(k)) timelineMap.set(k, { date: k, iapCount: 0, stripeCount: 0, stripeAmount: 0 });
        timelineMap.get(k)!.stripeCount += (row as any).count;
        timelineMap.get(k)!.stripeAmount += (row as any).amount ?? 0;
      }
      const timeline = Array.from(timelineMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      res.json({
        period: { from: from.toISOString(), to: to.toISOString() },
        summary: {
          totalSales: iap.count + stripe.count,
          iapSales: iap.count,
          stripeSales: stripe.count,
          stripeRevenue: stripe.totalAmount,       // smallest unit
          stripeCurrency: stripe.currency,
        },
        byPlan: (() => {
          const map = new Map<string, { plan: string; iapCount: number; stripeCount: number; stripeAmount: number }>();
          for (const r of iap.byPlan) {
            const k = (r as any)._id || "unknown";
            map.set(k, { plan: k, iapCount: (r as any).count, stripeCount: 0, stripeAmount: 0 });
          }
          for (const r of stripe.byPlan) {
            const k = (r as any)._id || "unknown";
            if (!map.has(k)) map.set(k, { plan: k, iapCount: 0, stripeCount: 0, stripeAmount: 0 });
            map.get(k)!.stripeCount = (r as any).count;
            map.get(k)!.stripeAmount = (r as any).total ?? 0;
          }
          return Array.from(map.values()).sort((a, b) => (b.iapCount + b.stripeCount) - (a.iapCount + a.stripeCount));
        })(),
        byPlatform: [
          ...iap.byPlatform.map((r: any) => ({ platform: r._id, count: r.count, source: "iap" })),
          ...(stripe.count > 0 ? [{ platform: "stripe", count: stripe.count, source: "stripe" }] : []),
        ],
        timeline,
        recentSales: recent,
      });
    } catch (err: any) {
      logger.error("[Sales] Error:", err.message);
      res.status(500).json({ error: "Failed to fetch sales data" });
    }
  });
}

import type { Express, Request, Response } from "express";
import { logger } from "../utils/logger";
import { pgSalesAnalytics } from "../data/postgres-billing-store";
function parseDateParam(val: unknown, fallback: Date): Date {
    if (typeof val !== "string")
        return fallback;
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
            const dateFormat = groupBy === "month" ? "%Y-%m" :
                groupBy === "week" ? "%Y-W%V" :
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
            const postgresAnalytics = pgSalesAnalytics({ from, to, platform, plan, groupBy });
            const iapSummaryPromise = postgresAnalytics.then((result) => result.iap);
            // ── Stripe ───────────────────────────────────────────────────────────
            const stripeMatch: Record<string, any> = { createdAt: dateRange };
            if (plan !== "all")
                stripeMatch.plan = plan;
            const stripeSummaryPromise = postgresAnalytics.then((result) => result.sales);
            // ── Recent sales (last 50) ────────────────────────────────────────────
            const recentPromise = (async () => {
                return (await postgresAnalytics).recent;
            })();
            const [iap, stripe, recent] = await Promise.all([iapSummaryPromise, stripeSummaryPromise, recentPromise]);
            // Merge timelines into a unified series
            const timelineMap = new Map<string, {
                date: string;
                iapCount: number;
                stripeCount: number;
                stripeAmount: number;
            }>();
            for (const row of iap.timeline) {
                const k = (row as any)._id.date;
                if (!timelineMap.has(k))
                    timelineMap.set(k, { date: k, iapCount: 0, stripeCount: 0, stripeAmount: 0 });
                timelineMap.get(k)!.iapCount += (row as any).count;
            }
            for (const row of stripe.timeline) {
                const k = (row as any)._id.date;
                if (!timelineMap.has(k))
                    timelineMap.set(k, { date: k, iapCount: 0, stripeCount: 0, stripeAmount: 0 });
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
                    stripeRevenue: stripe.totalAmount, // smallest unit
                    stripeCurrency: stripe.currency,
                },
                byPlan: (() => {
                    const map = new Map<string, {
                        plan: string;
                        iapCount: number;
                        stripeCount: number;
                        stripeAmount: number;
                    }>();
                    for (const r of iap.byPlan) {
                        const k = (r as any)._id || "unknown";
                        map.set(k, { plan: k, iapCount: (r as any).count, stripeCount: 0, stripeAmount: 0 });
                    }
                    for (const r of stripe.byPlan) {
                        const k = (r as any)._id || "unknown";
                        if (!map.has(k))
                            map.set(k, { plan: k, iapCount: 0, stripeCount: 0, stripeAmount: 0 });
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
        }
        catch (err: any) {
            logger.error("[Sales] Error:", err.message);
            res.status(500).json({ error: "Failed to fetch sales data" });
        }
    });
}

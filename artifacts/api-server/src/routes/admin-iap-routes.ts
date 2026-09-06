import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { logger } from "../utils/logger";
import { pgGetSubscription, pgIapAuditStats, pgListIapAuditEvents, pgRecordBillingEvent, pgUpsertSubscription } from "../data/postgres-billing-store";
import { pgFindUserByEmail, pgFindUserById } from "../data/postgres-user-store";
const isPublicUserId = (id: string) => /^[a-f0-9]{24}$/i.test(id);
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
    if (!Number.isFinite(n))
        return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
}
function parseDate(v: any): Date | null {
    if (!v)
        return null;
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
            let postgresUserId: string | undefined;
            if (req.query.userId && typeof req.query.userId === "string") {
                if (isPublicUserId(req.query.userId)) {
                    filter.userId = req.query.userId;
                    postgresUserId = req.query.userId;
                }
                else {
                    // Invalid id → return empty rather than crashing the cast.
                    return void res.json({ items: [], total: 0, page, limit });
                }
            }
            if (req.query.email && typeof req.query.email === "string") {
                const emailUser = await pgFindUserByEmail(req.query.email);
                if (!emailUser) {
                    return void res.json({ items: [], total: 0, page, limit });
                }
                filter.userId = String((emailUser as any)._id);
                postgresUserId = String((emailUser as any)._id);
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
                if (from)
                    filter.createdAt.$gte = from;
                if (to)
                    filter.createdAt.$lte = to;
            }
            {
                const result = await pgListIapAuditEvents({
                    userId: postgresUserId,
                    result: typeof req.query.result === "string" && VALID_RESULTS.has(req.query.result) ? req.query.result : undefined,
                    platform: typeof req.query.platform === "string" && VALID_PLATFORMS.has(req.query.platform) ? req.query.platform : undefined,
                    productId: typeof req.query.productId === "string" ? req.query.productId : undefined,
                    originalTransactionId: typeof req.query.originalTransactionId === "string" ? req.query.originalTransactionId : undefined,
                    from, to, page, limit,
                });
                return void res.json({ items: result.items, total: result.total, page, limit });
            }
        }
        catch (err: any) {
            logger.error("[admin/iap-events] list failed:", err?.message || err);
            return void res.status(500).json({ error: "Failed to load IAP events" });
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
            {
                const byResult = await pgIapAuditStats(since);
                const total = Object.values(byResult).reduce((sum, count) => sum + count, 0);
                return void res.json({ days, since, total, byResult });
            }
        }
        catch (err: any) {
            logger.error("[admin/iap-events] stats failed:", err?.message || err);
            return void res.status(500).json({ error: "Failed to load IAP stats" });
        }
    });
    // -------------------------------------------------------------
    // POST /api/admin/users/:id/subscription/cancel
    // Admin override: revokes the user's active subscription. Keeps the
    // historical productId/transactionId fields so we can audit later, but
    // flips isActive=false and stamps cancelledAt=now. Lifetime grants can
    // also be cancelled this way (they have isActive=true + expiresAt=null).
    // -------------------------------------------------------------
    app.post("/api/admin/users/:id/subscription/cancel", requireAdmin, async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id || "");
            if (!isPublicUserId(id)) {
                return void res.status(400).json({ error: "Invalid user id" });
            }
            const patch = { isActive: false, cancelledAt: new Date(), lastVerifiedAt: new Date() };
            let user: any = null;
            {
                await pgUpsertSubscription(id, patch);
                const identity = await pgFindUserById(id);
                user = identity ? { ...identity, subscription: await pgGetSubscription(id) } : null;
            }
            if (!user)
                return void res.status(404).json({ error: "User not found" });
            logger.log(`[admin] subscription cancelled for user=${id} by admin`);
            return void res.json({ success: true, subscription: (user as any).subscription });
        }
        catch (err: any) {
            logger.error("[admin] subscription cancel failed:", err?.message || err);
            return void res.status(500).json({ error: "Failed to cancel subscription" });
        }
    });
    // -------------------------------------------------------------
    // DELETE /api/admin/users/:id/subscription
    // Hard revoke: clears all subscription fields back to the default "none"
    // shape. Used by support to fully detach a user from a refunded/disputed
    // purchase or to clear a fraudulently-attached receipt that was caught by
    // the IAP audit log. Different from /cancel which preserves productId/txn
    // history. Writes an IapEvent with result='success', platform='unknown',
    // and providerCode='admin_revoke' so the action shows up in the audit log.
    // -------------------------------------------------------------
    app.delete("/api/admin/users/:id/subscription", requireAdmin, async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id || "");
            if (!isPublicUserId(id)) {
                return void res.status(400).json({ error: "Invalid user id" });
            }
            const before = await pgFindUserById(id);
            if (!before)
                return void res.status(404).json({ error: "User not found" });
            const prevSub: any = (before as any).subscription || {};
            const revokePatch = {
                plan: "none", isActive: false, cancelledAt: new Date(), lastVerifiedAt: new Date(),
                platform: null, productId: null, transactionId: null, originalTransactionId: null,
                receipt: null, purchaseToken: null, expiresAt: null, startedAt: null, isTrial: false,
            };
            let user: any = null;
            {
                await pgUpsertSubscription(id, revokePatch);
                const identity = await pgFindUserById(id);
                user = identity ? { ...identity, subscription: await pgGetSubscription(id) } : null;
            }
            if (!user)
                return void res.status(404).json({ error: "User not found" });
            // Audit row so the revoke shows up alongside Apple/Google IAP events.
            try {
                const auditPayload: any = {
                    userId: id,
                    platform: prevSub.platform === "android"
                        ? "android"
                        : prevSub.platform === "ios" || prevSub.platform === "macos" || prevSub.platform === "tvos"
                            ? "ios"
                            : "unknown",
                    productId: prevSub.productId || "",
                    transactionId: prevSub.transactionId || "",
                    originalTransactionId: prevSub.originalTransactionId || "",
                    result: "success",
                    providerCode: "admin_revoke",
                    statusCode: 200,
                    errorMessage: `Admin revoke (was plan=${prevSub.plan || "none"}, platform=${prevSub.platform || "none"})`,
                    plan: "none",
                    expiresAt: null,
                    isLifetime: false,
                    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
                        req.ip ||
                        "",
                    userAgent: (req.headers["user-agent"] as string) || "",
                };
                {
                    await pgRecordBillingEvent({
                        provider: prevSub.platform === "android" ? "google" : "apple",
                        providerEventId: `admin-revoke:${crypto.randomUUID()}`,
                        userId: id, eventType: "iap_audit", status: "success", plan: "none",
                        payload: { ...auditPayload, userId: id },
                    });
                }
            }
            catch (auditErr: any) {
                logger.error("[admin] revoke audit write failed:", auditErr?.message || auditErr);
            }
            logger.log(`[admin] subscription HARD-REVOKED user=${id} email=${(user as any).email} previousPlan=${prevSub.plan || "none"}`);
            return void res.json({
                success: true,
                subscription: (user as any).subscription,
                previousSubscription: {
                    plan: prevSub.plan,
                    platform: prevSub.platform,
                    productId: prevSub.productId,
                    originalTransactionId: prevSub.originalTransactionId,
                },
            });
        }
        catch (err: any) {
            logger.error("[admin] subscription revoke failed:", err?.message || err);
            return void res.status(500).json({ error: "Failed to revoke subscription" });
        }
    });
    // -------------------------------------------------------------
    // POST /api/admin/users/:id/subscription/grant-lifetime
    // Admin override: grants the lifetime premium plan. Sets platform='admin'
    // so it's clear in the audit trail this didn't come from Apple/Google.
    // Clears any previously-set cancelledAt and (re-)sets isActive=true with
    // expiresAt=null (the canonical lifetime shape).
    // -------------------------------------------------------------
    app.post("/api/admin/users/:id/subscription/grant-lifetime", requireAdmin, async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id || "");
            if (!isPublicUserId(id)) {
                return void res.status(400).json({ error: "Invalid user id" });
            }
            const grantPatch = {
                plan: "premium_lifetime", platform: "admin", isActive: true,
                startedAt: new Date(), expiresAt: null, lastVerifiedAt: new Date(), cancelledAt: null,
            };
            let user: any = null;
            {
                await pgUpsertSubscription(id, grantPatch);
                const identity = await pgFindUserById(id);
                user = identity ? { ...identity, subscription: await pgGetSubscription(id) } : null;
            }
            if (!user)
                return void res.status(404).json({ error: "User not found" });
            logger.log(`[admin] lifetime granted to user=${id} by admin`);
            return void res.json({ success: true, subscription: (user as any).subscription });
        }
        catch (err: any) {
            logger.error("[admin] grant-lifetime failed:", err?.message || err);
            return void res.status(500).json({ error: "Failed to grant lifetime" });
        }
    });
}

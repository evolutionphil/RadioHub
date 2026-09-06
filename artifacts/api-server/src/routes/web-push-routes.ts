import type { Express, Request, Response } from 'express';
import { PushNotificationService } from '../services/pushNotificationService';
import { logger } from '../utils/logger';
import { pgSetUserPushSubscription, userStore } from '../data/postgres-user-store';
/**
 * Web-push subscription routes (2026-07-04).
 *
 * The SPA's PushNotificationManager has ALWAYS posted the browser's push
 * subscription to POST /api/user/push-subscription and read the VAPID key
 * from GET /api/push/vapid-public-key — but neither route ever existed on
 * the server. Subscriptions were silently dropped (the client swallowed the
 * 404), `user.pushSubscription` stayed empty, and every
 * PushNotificationService.sendToUser() no-op'd: web push never worked.
 *
 * Requires VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars on the API service
 * (generate once with `npx web-push generate-vapid-keys`); the client falls
 * back to fetching the public key from here when VITE_VAPID_PUBLIC_KEY was
 * not baked into the build.
 */
export function registerWebPushRoutes(app: Express, deps: {
    requireAuth: (req: Request, res: Response, next: () => void) => void;
}): void {
    const { requireAuth } = deps;
    // Public: the browser needs this before it can subscribe.
    app.get('/api/push/vapid-public-key', (_req, res) => {
        const publicKey = process.env.VAPID_PUBLIC_KEY || '';
        if (!publicKey) {
            res.status(503).json({ error: 'Push notifications are not configured' });
            return;
        }
        res.json({ publicKey });
    });
    // Store the browser's PushSubscription on the logged-in user. The client
    // sends the raw subscription JSON ({ endpoint, keys: { p256dh, auth } }).
    app.post('/api/user/push-subscription', requireAuth, async (req: any, res) => {
        try {
            const sub = req.body?.subscription ?? req.body;
            if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
                res.status(400).json({ error: 'Invalid push subscription payload' });
                return;
            }
            const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
            await pgSetUserPushSubscription(String(req.user._id), subscription);
            res.json({ success: true });
        }
        catch (error: any) {
            logger.error('push-subscription save failed:', error?.message ?? error);
            res.status(500).json({ error: 'Failed to save subscription' });
        }
    });
    app.delete('/api/user/push-subscription', requireAuth, async (req: any, res) => {
        try {
            await pgSetUserPushSubscription(String(req.user._id), null);
            res.json({ success: true });
        }
        catch (error: any) {
            logger.error('push-subscription delete failed:', error?.message ?? error);
            res.status(500).json({ error: 'Failed to remove subscription' });
        }
    });
    // Authenticated self-test — powers the "Send Test" button in settings.
    app.post('/api/push/send-test', requireAuth, async (req: any, res) => {
        try {
            const ok = await PushNotificationService.sendToUser(String(req.user._id), {
                title: 'Mega Radio',
                body: 'Push notifications are working! 🎵',
                url: '/profile/settings',
            } as any);
            res.json({ success: ok });
        }
        catch (error: any) {
            logger.error('push send-test failed:', error?.message ?? error);
            res.status(500).json({ error: 'Failed to send test notification' });
        }
    });
}

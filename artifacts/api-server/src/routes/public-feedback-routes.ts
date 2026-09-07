import type { Express, Request } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { publicFeedbackInput } from '@workspace/api-zod';
import { pgSaveFeedback } from '../data/postgres-content-store';
import { logger } from '../utils/logger';

export function feedbackRateLimitKey(req: Pick<Request, 'ip'>): string {
  const ip = req.ip || 'unknown';
  return ipKeyGenerator(ip.startsWith('::ffff:') ? ip.slice(7) : ip);
}

/** Public submission only. Reading, changing status and replying stay admin-only. */
export function registerPublicFeedbackRoutes(app: Express): void {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyGenerator: feedbackRateLimitKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many submissions. Please try again later.' },
  });
  app.post('/api/feedback', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  }, limiter, async (req, res) => {
    // JSON-only also prevents ordinary cross-site HTML forms from submitting.
    // The API's existing CORS policy controls cross-origin JSON requests.
    if (!req.is('application/json')) {
      return void res.status(415).json({ success: false, error: 'JSON content is required' });
    }
    const rawBody = (req as Request & { rawBody?: string }).rawBody;
    if ((rawBody && Buffer.byteLength(rawBody, 'utf8') > 64 * 1024) ||
        Number(req.get('content-length') || 0) > 64 * 1024) {
      return void res.status(413).json({ success: false, error: 'Submission is too large' });
    }
    const parsed = publicFeedbackInput.safeParse(req.body);
    if (!parsed.success) {
      const errors = Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0] || 'form'), issue.message]));
      return void res.status(400).json({ success: false, error: 'Invalid submission', errors });
    }
    try {
      // The website's historical CONTACT/FEEDBACK types are UI categories, not
      // the PostgreSQL bug/feature/general enum. Retain their distinction in
      // the required subject, without widening native constraints or trusting
      // public input for IDs, user ownership, status or admin response fields.
      await pgSaveFeedback(null, {
        type: 'general',
        subject: parsed.data.type === 'CONTACT' ? 'Contact request' : 'Website feedback',
        email: parsed.data.email,
        message: parsed.data.message,
        status: 'open',
      });
      return void res.status(201).json({ success: true });
    } catch {
      // Do not log or echo visitor email/message, driver queries or credentials.
      logger.error('[feedback] Submission persistence failed');
      res.setHeader('Retry-After', '60');
      return void res.status(503).json({ success: false, error: 'Feedback is temporarily unavailable. Please try again.' });
    }
  });
}

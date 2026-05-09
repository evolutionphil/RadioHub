import { Router, Request, Response } from 'express';
import {
  IndexNowLog,
  IndexNowSubmissionUrls,
  INDEXNOW_SUBMISSION_URLS_RETENTION_DAYS,
} from '@workspace/db-shared/mongo-schemas';
import mongoose from 'mongoose';
import { scheduledSitemapDiff } from '../services/scheduled-sitemap-diff';

const router = Router();

// GET /api/admin/indexnow/logs - Get recent IndexNow logs with pagination
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const host = req.query.host as string;
    const status = req.query.status as string;
    
    // Build query filter
    const filter: any = {};
    if (host && host !== 'all') {
      filter.host = host;
    }
    if (status && status !== 'all') {
      filter.status = status;
    }
    
    const logs = await IndexNowLog.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    
    res.json(logs);
  } catch (error) {
    console.error('Error fetching IndexNow logs:', error);
    res.status(500).json({ error: 'Failed to fetch IndexNow logs' });
  }
});

// GET /api/admin/indexnow/stats - Get IndexNow statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get all-time stats
    const totalSubmissions = await IndexNowLog.countDocuments();
    const successfulSubmissions = await IndexNowLog.countDocuments({ status: 'success' });
    const failedSubmissions = await IndexNowLog.countDocuments({ status: 'failed' });
    
    // Get today's submissions
    const submissionsToday = await IndexNowLog.countDocuments({
      timestamp: { $gte: today }
    });
    
    // Calculate success rate
    const successRate = totalSubmissions > 0 
      ? Math.round((successfulSubmissions / totalSubmissions) * 100) 
      : 0;
    
    // Get submissions by host
    const submissionsByHost = await IndexNowLog.aggregate([
      {
        $group: {
          _id: '$host',
          count: { $sum: 1 },
          successful: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    // Get submissions by trigger
    const submissionsByTrigger = await IndexNowLog.aggregate([
      {
        $group: {
          _id: '$trigger',
          count: { $sum: 1 },
          successful: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    // Get 7-day trend (submissions per day)
    const sevenDayTrend = await IndexNowLog.aggregate([
      {
        $match: {
          timestamp: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
          },
          count: { $sum: 1 },
          successful: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Calculate average response time
    const avgResponseTime = await IndexNowLog.aggregate([
      {
        $match: {
          responseTime: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: null,
          avgResponseTime: { $avg: '$responseTime' }
        }
      }
    ]);
    
    const stats = {
      totalSubmissions,
      successfulSubmissions,
      failedSubmissions,
      successRate,
      submissionsToday,
      submissionsByHost: submissionsByHost.map(item => ({
        host: item._id,
        count: item.count,
        successful: item.successful,
        failed: item.failed,
        successRate: item.count > 0 ? Math.round((item.successful / item.count) * 100) : 0
      })),
      submissionsByTrigger: submissionsByTrigger.map(item => ({
        trigger: item._id,
        count: item.count,
        successful: item.successful,
        failed: item.failed,
        successRate: item.count > 0 ? Math.round((item.successful / item.count) * 100) : 0
      })),
      sevenDayTrend: sevenDayTrend.map(item => ({
        date: item._id,
        count: item.count,
        successful: item.successful,
        failed: item.failed
      })),
      averageResponseTime: avgResponseTime.length > 0 ? Math.round(avgResponseTime[0].avgResponseTime) : 0
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching IndexNow stats:', error);
    res.status(500).json({ error: 'Failed to fetch IndexNow stats' });
  }
});

// GET /api/admin/indexnow/sitemap-diff-runs - Recent nightly sitemap-diff
// runs (Task #190) grouped by calendar day so admins can see which new
// URLs were pinged to search engines last night without querying Mongo.
//
// Each "run" is one calendar day (UTC) of `trigger=sitemap-diff` log
// entries. We surface aggregate counts plus per-language breakdown
// (parsed from the first path segment of `sampleUrls`) and the raw
// submission rows (capped sampleUrls per row already at 5).
router.get('/sitemap-diff-runs', async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 14, 1), 60);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    since.setUTCHours(0, 0, 0, 0);

    // Include any submissions in the timestamp window OR any submissions tagged
    // with `runDate` inside the window — admin-triggered re-runs of an older
    // night still need to appear under that night's row even if the rerun
    // itself happened today.
    const sinceIso = since.toISOString().slice(0, 10);
    const submissions = await IndexNowLog.find({
      trigger: 'sitemap-diff',
      $or: [
        { timestamp: { $gte: since } },
        { runDate: { $gte: sinceIso } },
      ],
    })
      .sort({ timestamp: -1 })
      .lean();

    interface LangAgg { urls: number; successful: number; failed: number; }
    interface SubmissionView {
      _id: string;
      timestamp: Date;
      host: string;
      urlCount: number;
      status: 'success' | 'failed';
      statusCode?: number;
      errorMessage?: string;
      sampleUrls: string[];
      language: string;
      responseTime?: number;
    }
    interface RunView {
      date: string;
      totalUrls: number;
      successfulUrls: number;
      failedUrls: number;
      submissionCount: number;
      submitSuccessCount: number;
      submitFailedCount: number;
      languageBreakdown: Array<{ language: string } & LangAgg>;
      submissions: SubmissionView[];
    }

    const inferLanguage = (urls: string[] | undefined): string => {
      if (!urls || urls.length === 0) return 'unknown';
      try {
        const u = new URL(urls[0]);
        const seg = u.pathname.split('/').filter(Boolean)[0];
        if (seg && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(seg)) return seg.toLowerCase();
      } catch {
        // fall through
      }
      return 'unknown';
    };

    const runMap = new Map<string, RunView>();
    for (const s of submissions) {
      const ts = new Date(s.timestamp);
      // When `runDate` is set (admin re-run for a specific night), attribute
      // this submission to that night so it appears under the targeted row
      // instead of the day the rerun was actually executed.
      const date = (s as { runDate?: string }).runDate || ts.toISOString().slice(0, 10);
      let run = runMap.get(date);
      if (!run) {
        run = {
          date,
          totalUrls: 0,
          successfulUrls: 0,
          failedUrls: 0,
          submissionCount: 0,
          submitSuccessCount: 0,
          submitFailedCount: 0,
          languageBreakdown: [],
          submissions: [],
        };
        runMap.set(date, run);
      }
      const language = inferLanguage(s.sampleUrls);
      const isOk = s.status === 'success';
      run.submissionCount += 1;
      run.totalUrls += s.urlCount || 0;
      if (isOk) {
        run.submitSuccessCount += 1;
        run.successfulUrls += s.urlCount || 0;
      } else {
        run.submitFailedCount += 1;
        run.failedUrls += s.urlCount || 0;
      }
      run.submissions.push({
        _id: String(s._id),
        timestamp: s.timestamp,
        host: s.host,
        urlCount: s.urlCount,
        status: s.status,
        statusCode: s.statusCode,
        errorMessage: s.errorMessage,
        sampleUrls: s.sampleUrls ?? [],
        language,
        responseTime: s.responseTime,
      });
      let lb = run.languageBreakdown.find((l) => l.language === language);
      if (!lb) {
        lb = { language, urls: 0, successful: 0, failed: 0 };
        run.languageBreakdown.push(lb);
      }
      lb.urls += s.urlCount || 0;
      if (isOk) lb.successful += s.urlCount || 0;
      else lb.failed += s.urlCount || 0;
    }

    const runs = Array.from(runMap.values()).sort((a, b) => b.date.localeCompare(a.date));
    for (const r of runs) {
      r.languageBreakdown.sort((a, b) => b.urls - a.urls || a.language.localeCompare(b.language));
    }

    res.json({ runs, days });
  } catch (error) {
    console.error('Error fetching sitemap-diff runs:', error);
    res.status(500).json({ error: 'Failed to fetch sitemap-diff runs' });
  }
});

// GET /api/admin/indexnow/submissions/:id/urls — Task #336.
//
// Returns the FULL list of URLs submitted in one IndexNow request. The log
// row itself only retains 5 `sampleUrls`; the full list lives in
// `IndexNowSubmissionUrls` with a 30-day TTL so admins can audit an entire
// night's additions without unbounded growth on the log collection.
router.get('/submissions/:id/urls', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid submission id' });
      return;
    }
    const logId = new mongoose.Types.ObjectId(id);
    const doc = await IndexNowSubmissionUrls.findOne({ logId }).lean();
    if (!doc) {
      // Either the submission predates Task #336 (no full list captured),
      // its 30-day retention window already expired, or the id is unknown.
      // Surface the distinction so the UI can explain it to admins.
      const log = await IndexNowLog.findById(logId).lean();
      if (!log) {
        res.status(404).json({ error: 'Submission not found' });
        return;
      }
      res.status(404).json({
        error: 'Full URL list unavailable',
        reason: 'No full URL list was retained for this submission. Either it was submitted before full-URL retention was enabled, or the 30-day retention window has elapsed.',
        sampleUrls: log.sampleUrls ?? [],
        urlCount: log.urlCount,
        retentionDays: INDEXNOW_SUBMISSION_URLS_RETENTION_DAYS,
      });
      return;
    }
    res.json({
      logId: String(doc.logId),
      timestamp: doc.timestamp,
      host: doc.host,
      trigger: doc.trigger,
      urls: doc.urls ?? [],
      urlCount: doc.urlCount,
      expiresAt: doc.expiresAt,
      retentionDays: INDEXNOW_SUBMISSION_URLS_RETENTION_DAYS,
    });
  } catch (error) {
    console.error('Error fetching IndexNow submission URLs:', error);
    res.status(500).json({ error: 'Failed to fetch submission URLs' });
  }
});

// POST /api/admin/indexnow/sitemap-diff-runs/rerun - Re-trigger the
// sitemap-diff submission pass for a specific past night.
//
// The body must contain `date` (UTC YYYY-MM-DD) identifying the night to
// re-run. The diff itself is always computed against the current persisted
// `SitemapUrlSnapshot` (the only source of truth for "what we've already
// pinged"), which naturally retries every URL whose previous submission
// for that night failed — failed URLs are intentionally NOT added to the
// snapshot baseline by the nightly job, so they resurface as additions
// here. The resulting IndexNowLog rows are tagged with `runDate=<date>`
// so they appear under the targeted night's row in the Nightly Sitemap
// Diff Runs panel instead of today's row.
//
// Concurrency is guarded by `scheduledSitemapDiff.runOnce` so a manual
// rerun cannot race against the nightly cron or another in-flight admin
// click. The dry-run variant bypasses the guard because it has no side
// effects (no IndexNow ping, no snapshot mutation, no log rows).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
router.post('/sitemap-diff-runs/rerun', async (req: Request, res: Response) => {
  try {
    const dryRun = req.body?.dryRun === true;
    const date = typeof req.body?.date === 'string' ? req.body.date : '';

    if (!DATE_RE.test(date)) {
      return res.status(400).json({
        ok: false,
        error: 'Missing or malformed `date` — expected UTC calendar date in YYYY-MM-DD format.',
      });
    }
    // Reject obviously invalid (e.g. 2026-13-40) and future dates — re-running
    // a night that hasn't happened yet would just retag a fresh diff under a
    // future row, which is misleading.
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      return res.status(400).json({ ok: false, error: `Invalid calendar date: ${date}` });
    }
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (date > todayUtc) {
      return res.status(400).json({ ok: false, error: `Cannot re-run a future night (${date}).` });
    }

    const trigger = `manual:admin-rerun:${date}${dryRun ? ':dry-run' : ''}`;

    if (dryRun) {
      const { runSitemapDiffSubmission } = await import('../services/sitemap-diff-indexnow');
      const summary = await runSitemapDiffSubmission({ ensureManifestFresh: true, dryRun: true, runDate: date });
      return res.json({ ok: true, dryRun: true, trigger, runDate: date, summary });
    }

    const summary = await scheduledSitemapDiff.runOnce(trigger, { runDate: date });
    if (!summary) {
      return res.status(409).json({
        ok: false,
        error: 'A sitemap-diff run is already in progress. Please wait for it to finish, then try again.',
      });
    }
    return res.json({ ok: true, dryRun: false, trigger, runDate: date, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to re-run sitemap-diff submission';
    console.error('Error re-running sitemap-diff:', error);
    return res.status(500).json({ ok: false, error: message });
  }
});

export default router;

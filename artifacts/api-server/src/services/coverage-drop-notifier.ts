import { logger } from '../utils/logger';
import { User, UserNotification, CoverageSnapshot } from '../shared/mongo-schemas';

/**
 * Coverage-drop notifier (Task #145).
 *
 * After each nightly per-country coverage snapshot, we compare today's
 * logo + tag coverage to the snapshot from 7 days ago. Any country
 * whose logo or tag coverage dropped by more than
 * `COVERAGE_DROP_ALERT_THRESHOLD_PP` percentage points (default 5)
 * triggers a notification so a stuck pipeline gets caught the morning
 * it happens instead of waiting for an admin to spot a red sparkline.
 *
 * Channels (all are best-effort and never throw out of the snapshot
 * job):
 *  - Always: a prominent log line per drop and a summary line.
 *  - In-app: one `UserNotification` row per admin user (`role: 'admin'`)
 *    with `type: 'system'` and a `data.coverageDrops` payload, so
 *    admins see the alert in the same notifications surface they
 *    already use.
 *  - Optional: a JSON POST to `COVERAGE_DROP_ALERT_WEBHOOK_URL`
 *    (Slack/Discord-compatible `{ text }` body) for teams that wire
 *    a chat channel.
 *
 * Env knobs (all optional):
 *  - `ENABLE_COVERAGE_DROP_ALERTS` — set to `false` to silence entirely.
 *  - `COVERAGE_DROP_ALERT_THRESHOLD_PP` — drop threshold in pp (default 5).
 *  - `COVERAGE_DROP_ALERT_WEBHOOK_URL` — optional outbound webhook.
 *  - `COVERAGE_DROP_ALERT_MIN_STATIONS` — ignore countries with fewer
 *    than N stations to suppress noise from tiny markets (default 10).
 *  - `COVERAGE_DROP_ALERT_MAX_COUNTRIES` — cap how many drops are
 *    enumerated in the message body (default 25).
 */

export interface CoverageDrop {
  countryCode: string;
  metric: 'logo' | 'tag';
  todayPct: number;
  weekAgoPct: number;
  deltaPp: number; // negative number, e.g. -7.4
  total: number;
  weekAgoTotal: number;
}

const DEFAULT_THRESHOLD_PP = 5;
const DEFAULT_MIN_STATIONS = 10;
const DEFAULT_MAX_LISTED = 25;
const WEBHOOK_TIMEOUT_MS = 5_000;

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function getThresholdPp(): number {
  return parsePositiveNumber(
    process.env.COVERAGE_DROP_ALERT_THRESHOLD_PP,
    DEFAULT_THRESHOLD_PP,
  );
}

export function getMinStations(): number {
  return parsePositiveNumber(
    process.env.COVERAGE_DROP_ALERT_MIN_STATIONS,
    DEFAULT_MIN_STATIONS,
  );
}

function getMaxListed(): number {
  return Math.max(
    1,
    parsePositiveNumber(
      process.env.COVERAGE_DROP_ALERT_MAX_COUNTRIES,
      DEFAULT_MAX_LISTED,
    ),
  );
}

function isEnabled(): boolean {
  return process.env.ENABLE_COVERAGE_DROP_ALERTS !== 'false';
}

/**
 * Compare today's snapshot rows to the snapshot from `lookbackDays`
 * days earlier and return any country/metric that dropped by more than
 * `thresholdPp` percentage points.
 */
export async function detectCoverageDrops(opts: {
  snapshotDate: Date;
  thresholdPp?: number;
  minStations?: number;
  lookbackDays?: number;
}): Promise<CoverageDrop[]> {
  const thresholdPp = opts.thresholdPp ?? getThresholdPp();
  const minStations = opts.minStations ?? getMinStations();
  const lookbackDays = opts.lookbackDays ?? 7;

  const today = new Date(opts.snapshotDate);
  const weekAgo = new Date(today);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - lookbackDays);

  const [todayRows, weekAgoRows] = await Promise.all([
    CoverageSnapshot.find({ snapshotDate: today }).lean(),
    CoverageSnapshot.find({ snapshotDate: weekAgo }).lean(),
  ]);

  if (weekAgoRows.length === 0) {
    // No baseline yet (e.g. first week after deploy). Nothing to compare.
    return [];
  }

  const baseline = new Map<
    string,
    { logoCoveragePct: number; tagCoveragePct: number; total: number }
  >();
  for (const r of weekAgoRows) {
    baseline.set(r.countryCode, {
      logoCoveragePct: r.logoCoveragePct,
      tagCoveragePct: r.tagCoveragePct,
      total: r.total,
    });
  }

  const drops: CoverageDrop[] = [];
  for (const row of todayRows) {
    if (row.total < minStations) continue;
    const prev = baseline.get(row.countryCode);
    if (!prev) continue;
    // Also gate on the baseline size so a country that had only 2
    // stations a week ago can't fire a noisy alert just because it
    // grew to 12 today and one is missing a logo.
    if (prev.total < minStations) continue;

    const logoDelta = Math.round((row.logoCoveragePct - prev.logoCoveragePct) * 10) / 10;
    if (logoDelta < -thresholdPp) {
      drops.push({
        countryCode: row.countryCode,
        metric: 'logo',
        todayPct: row.logoCoveragePct,
        weekAgoPct: prev.logoCoveragePct,
        deltaPp: logoDelta,
        total: row.total,
        weekAgoTotal: prev.total,
      });
    }
    const tagDelta = Math.round((row.tagCoveragePct - prev.tagCoveragePct) * 10) / 10;
    if (tagDelta < -thresholdPp) {
      drops.push({
        countryCode: row.countryCode,
        metric: 'tag',
        todayPct: row.tagCoveragePct,
        weekAgoPct: prev.tagCoveragePct,
        deltaPp: tagDelta,
        total: row.total,
        weekAgoTotal: prev.total,
      });
    }
  }

  // Worst drops first.
  drops.sort((a, b) => a.deltaPp - b.deltaPp);
  return drops;
}

function formatDrop(d: CoverageDrop): string {
  return `${d.countryCode} ${d.metric}: ${d.weekAgoPct.toFixed(1)}% → ${d.todayPct.toFixed(1)}% (${d.deltaPp.toFixed(1)}pp, n=${d.total})`;
}

function summarizeDrops(drops: CoverageDrop[], thresholdPp: number, snapshotDate: Date): string {
  const max = getMaxListed();
  const date = snapshotDate.toISOString().slice(0, 10);
  const head = `Coverage drop alert (${date}): ${drops.length} country/metric pair(s) dropped >${thresholdPp}pp vs 7 days ago`;
  const lines = drops.slice(0, max).map((d) => `  • ${formatDrop(d)}`);
  if (drops.length > max) {
    lines.push(`  • …and ${drops.length - max} more`);
  }
  return [head, ...lines].join('\n');
}

async function postWebhook(url: string, message: string, drops: CoverageDrop[]): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: message, drops }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(`⚠️  Coverage drop webhook returned ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    logger.warn('⚠️  Coverage drop webhook POST failed:', err);
  } finally {
    clearTimeout(timeout);
  }
}

async function notifyAdminsInApp(
  drops: CoverageDrop[],
  snapshotDate: Date,
  thresholdPp: number,
): Promise<number> {
  const admins = await User.find({ role: 'admin' }, { _id: 1 }).lean();
  if (admins.length === 0) return 0;

  const date = snapshotDate.toISOString().slice(0, 10);
  const top = drops.slice(0, 5).map(formatDrop).join('; ');
  const message =
    drops.length === 1
      ? `Coverage drop on ${date}: ${formatDrop(drops[0])}`
      : `${drops.length} coverage drops on ${date} (>${thresholdPp}pp vs 7 days ago): ${top}${drops.length > 5 ? '…' : ''}`;

  const docs = admins.map((a) => ({
    userId: a._id,
    type: 'system' as const,
    title: '⚠️ Coverage drop detected',
    message,
    data: {
      kind: 'coverage_drop',
      snapshotDate: date,
      thresholdPp,
      drops: drops.map((d) => ({
        countryCode: d.countryCode,
        metric: d.metric,
        todayPct: d.todayPct,
        weekAgoPct: d.weekAgoPct,
        deltaPp: d.deltaPp,
        total: d.total,
      })),
    },
  }));

  await UserNotification.insertMany(docs, { ordered: false });
  return admins.length;
}

export type CoverageDropNotifier = (
  drops: CoverageDrop[],
  snapshotDate: Date,
) => Promise<void> | void;

const defaultNotifier: CoverageDropNotifier = async (drops, snapshotDate) => {
  const thresholdPp = getThresholdPp();
  const summary = summarizeDrops(drops, thresholdPp, snapshotDate);
  // Always surface in logs so the alert is visible even with no
  // webhook configured and no admin users in the DB.
  logger.error(`🚨 ${summary}`);

  try {
    const recipients = await notifyAdminsInApp(drops, snapshotDate, thresholdPp);
    logger.log(`📨 Coverage drop in-app notifications: ${recipients} admin(s)`);
  } catch (err) {
    logger.warn('⚠️  Failed to write coverage drop in-app notifications:', err);
  }

  const url = process.env.COVERAGE_DROP_ALERT_WEBHOOK_URL;
  if (url) {
    await postWebhook(url, summary, drops);
  }
};

let activeNotifier: CoverageDropNotifier = defaultNotifier;

export function setCoverageDropNotifier(fn: CoverageDropNotifier | null): void {
  activeNotifier = fn ?? defaultNotifier;
}

/**
 * Compare today's snapshot to 7 days ago and notify the team about
 * any per-country logo/tag coverage that dropped beyond the configured
 * threshold. No-op when nothing dropped or alerts are disabled.
 */
export async function checkAndNotifyCoverageDrops(
  snapshotDate: Date,
): Promise<{ checked: boolean; drops: CoverageDrop[] }> {
  if (!isEnabled()) {
    return { checked: false, drops: [] };
  }
  try {
    const drops = await detectCoverageDrops({ snapshotDate });
    if (drops.length === 0) {
      return { checked: true, drops };
    }
    await activeNotifier(drops, snapshotDate);
    return { checked: true, drops };
  } catch (err) {
    logger.error('❌ Coverage drop notifier itself threw:', err);
    return { checked: true, drops: [] };
  }
}

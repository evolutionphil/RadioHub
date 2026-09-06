/**
 * Scheduled Logo Enrichment (env-gated, daily 03:30 Europe/Berlin)
 *
 * Closes the large gap of stations that emit NO indexable image. The existing
 * 02:00 logo processor only mirrors stations that already have a usable http
 * favicon. This job targets the remainder: for each station that has a homepage
 * but no completed logo and no http favicon, it scrapes the station's OWN
 * homepage <head> for an icon (og:image / apple-touch-icon / <link rel=icon> /
 * /favicon.ico) and feeds the best candidate through the EXISTING
 * logoProcessor.processFromUrl — which SSRF-guards, downloads (2MB cap),
 * validates, resizes to webp256 and uploads to S3.
 *
 * Purely additive for Google Images: indexability (noindex / sitemap inclusion)
 * never consults logo presence.
 *
 * SAFETY:
 *  - DEFAULT OFF. Only runs where ENABLE_LOGO_ENRICHMENT_CRON === 'true'.
 *    It does external egress (fetching arbitrary station homepages) so it must
 *    only run where the prod egress allowlist permits AND S3 is configured.
 *  - Requires S3 at run start (non-S3 mode stores local filenames the SEO
 *    layer's ^https?:// check rejects → bail with 's3_not_configured').
 *  - Every outbound fetch (homepage + each icon) goes through the SSRF guard
 *    (safe-fetch / logoProcessor) — blocks private IPs / metadata / redirects.
 *  - Bounded HTML body, per-fetch timeout, single-instance lock, hard timeout,
 *    rate-limit sleep between stations, 30-day cooldown on retriable outcomes.
 *
 * Manual trigger: POST /api/admin/maintenance/logo-enrichment/run
 * Status:         GET  /api/admin/maintenance/logo-enrichment/status
 */

import cron from 'node-cron';
import { pgCatalog } from '../data/postgres-catalog-store';
import { logger } from '../utils/logger';
import { logoProcessor } from './logo-processor';
import { isS3Configured } from './s3-storage';
import { safeFetch } from '../utils/safe-fetch';

const ENABLE_ENV = 'ENABLE_LOGO_ENRICHMENT_CRON';

const RATE_LIMIT_MS = 1_500;
const HARD_TIMEOUT_MS = 3 * 60 * 60 * 1_000; // 3h
const HOMEPAGE_FETCH_TIMEOUT_MS = 6_000;
const MAX_HTML_BYTES = 512 * 1024; // 512 KB
const RETRY_COOLDOWN_DAYS = 30;
const BATCH_FETCH = 200;
const MAX_CANDIDATES = 3;

type EnrichmentResult = 'enriched' | 'icon_failed' | 'no_icon';

export interface LogoEnrichmentStatus {
  isRunning: boolean;
  trigger: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number;
  totalScanned: number;
  enriched: number;
  iconFailed: number;
  noIcon: number;
  fetchErrors: number;
  stoppedEarly: boolean;
  stopReason?: string;
}

export interface LogoEnrichmentSlice {
  countryCode?: string;
  limit?: number;
}

class ScheduledLogoEnrichment {
  private isInitialized = false;
  private isRunning = false;
  private status: LogoEnrichmentStatus = {
    isRunning: false,
    trigger: null,
    startedAt: null,
    completedAt: null,
    durationMs: 0,
    totalScanned: 0,
    enriched: 0,
    iconFailed: 0,
    noIcon: 0,
    fetchErrors: 0,
    stoppedEarly: false,
  };

  initialize(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // DEFAULT OFF — only fire where the operator has explicitly opted in.
    if (process.env[ENABLE_ENV] !== 'true') {
      logger.log(`🖼️ Logo enrichment cron DISABLED (${ENABLE_ENV} !== 'true')`);
      return;
    }

    // 03:30 Europe/Berlin — after the 03:00 sync, before 04:30 description-fill.
    cron.schedule(
      '30 3 * * *',
      () => {
        this.runOnce('cron:daily').catch((err) => {
          logger.error('❌ Logo enrichment cron crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' },
    );
    logger.log('🖼️ Logo enrichment cron initialized (daily 03:30 Europe/Berlin)');
  }

  getStatus(): LogoEnrichmentStatus {
    return { ...this.status };
  }

  async runOnce(
    trigger: string = 'manual',
    slice: LogoEnrichmentSlice = {},
  ): Promise<LogoEnrichmentStatus> {
    if (this.isRunning) {
      logger.log(`⏭️  Logo enrichment: skip (${trigger}) — previous run still in progress`);
      return this.getStatus();
    }

    this.isRunning = true;
    const startedAt = new Date();
    const deadline = startedAt.getTime() + HARD_TIMEOUT_MS;

    let totalScanned = 0;
    let enriched = 0;
    let iconFailed = 0;
    let noIcon = 0;
    let fetchErrors = 0;
    let stoppedEarly = false;
    let stopReason: string | undefined;

    this.status = {
      isRunning: true,
      trigger,
      startedAt,
      completedAt: null,
      durationMs: 0,
      totalScanned: 0,
      enriched: 0,
      iconFailed: 0,
      noIcon: 0,
      fetchErrors: 0,
      stoppedEarly: false,
    };

    logger.log(`🖼️ Logo enrichment START (${trigger})`);

    try {
      // HARD REQUIREMENT: S3 must be configured. The non-S3 fallback in the
      // logo processor stores relative local filenames, which the SEO layer's
      // ^https?:// check rejects — so enrichment would silently produce no
      // indexable image. Bail loudly instead.
      if (!isS3Configured()) {
        stoppedEarly = true;
        stopReason = 's3_not_configured';
        logger.warn('🖼️ Logo enrichment ABORT — S3 not configured (s3_not_configured)');
      } else {
        const cooldownPivot = new Date(Date.now() - RETRY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);

        // Canonical "no real logo" predicate. We deliberately do NOT use the
        // `hasLogo` flag — it was backfilled as "any non-empty favicon" and is
        // unreliable. Instead combine the authoritative signals.
        const filter: Record<string, unknown> = {
          $and: [
            // Never touch noindexed junk stations.
            { noIndex: { $ne: true } },
            // Must have an http(s) homepage to scrape.
            { homepage: { $regex: /^https?:\/\//i } },
            // No completed logo already.
            {
              $or: [
                { 'logoAssets.status': { $ne: 'completed' } },
                { 'logoAssets.webp256': { $exists: false } },
                { 'logoAssets.webp256': { $in: [null, ''] } },
              ],
            },
            // favicon is NOT already a usable http logo — those are handled by
            // the existing 02:00 logo processor, not here.
            {
              $or: [
                { favicon: { $exists: false } },
                { favicon: { $in: ['', null, 'null'] } },
                { favicon: { $not: /^https?:\/\//i } },
              ],
            },
            // Cooldown: never attempted, OR last attempt is old AND wasn't a
            // terminal 'no_icon' (those are excluded forever).
            {
              $or: [
                { logoEnrichmentAttemptedAt: { $exists: false } },
                {
                  $and: [
                    { logoEnrichmentAttemptedAt: { $lt: cooldownPivot } },
                    { logoEnrichmentResult: { $ne: 'no_icon' } },
                  ],
                },
              ],
            },
          ],
        };

        // Optional safe slice for manual testing.
        if (slice.countryCode) {
          (filter.$and as unknown[]).push({ countryCode: slice.countryCode.toUpperCase() });
        }
        const sliceLimit =
          typeof slice.limit === 'number' && slice.limit > 0
            ? Math.min(Math.floor(slice.limit), 100_000)
            : null;

        const cursor = pgCatalog().iterate(filter, {
          fields: ['_id','name','slug','homepage','favicon'], batchSize: BATCH_FETCH, limit: sliceLimit ?? undefined,
        });

        for await (const station of cursor) {
          if (Date.now() > deadline) {
            stoppedEarly = true;
            stopReason = 'hard_timeout';
            break;
          }
          if (sliceLimit && totalScanned >= sliceLimit) break;

          totalScanned++;
          const s = station as any;
          const stationId = String(s._id);
          const homepage: string = s.homepage;
          const slug: string = s.slug;

          let result: EnrichmentResult = 'no_icon';
          let iconFound = false;
          let reason: string | undefined;

          try {
            if (!slug) {
              reason = 'missing_slug';
            } else {
              const html = await this.fetchHomepageHtml(homepage);
              if (html === null) {
                // Transient homepage outage must NOT be terminal — mark it
                // retriable ('icon_failed', re-attempted after the cooldown)
                // rather than 'no_icon' (which is excluded forever). A site
                // that's briefly down would otherwise never get a logo.
                fetchErrors++;
                result = 'icon_failed';
                iconFailed++;
                reason = 'homepage_fetch_failed';
              } else {
                const candidates = this.extractIconCandidates(html, homepage);
                if (candidates.length === 0) {
                  reason = 'no_candidates';
                } else {
                  iconFound = true;
                  for (const candidate of candidates) {
                    try {
                      // The discovered icon differs from the old favicon, but
                      // may replace it only while this scan's before-image holds.
                      const r = await logoProcessor.processFromUrl(stationId, slug, candidate, s.favicon ?? null);
                      if (r.success) {
                        result = 'enriched';
                        enriched++;
                        break;
                      }
                      reason = r.error || r.failureType || 'processFromUrl_failed';
                    } catch (procErr: any) {
                      reason = procErr?.message || 'processFromUrl_threw';
                    }
                  }
                  if (result !== 'enriched') {
                    result = 'icon_failed';
                    iconFailed++;
                  }
                }
              }
            }
          } catch (err: any) {
            // Any unexpected per-station error: treat as a fetch error and
            // record a retriable outcome so we don't permanently skip it.
            fetchErrors++;
            iconFound = false;
            result = 'icon_failed';
            iconFailed++;
            reason = err?.message || 'unexpected_error';
          }

          // If we never found an icon (and didn't already count enriched), the
          // running counters above only bumped enriched/iconFailed. Make sure
          // the terminal 'no_icon' path is counted exactly once.
          if (result === 'no_icon') {
            noIcon++;
          }

          try {
            await pgCatalog().update(
              { _id: s._id },
              {
                $set: {
                  logoEnrichmentAttemptedAt: new Date(),
                  logoEnrichmentResult: result,
                  ...(reason ? { logoEnrichmentReason: String(reason).slice(0, 200) } : {}),
                },
              },
            );
          } catch (updErr: any) {
            logger.warn(
              `⚠️ [logo-enrich] failed to record outcome for ${stationId}: ${updErr?.message || updErr}`,
            );
          }

          // Live counters for the status endpoint.
          this.status.totalScanned = totalScanned;
          this.status.enriched = enriched;
          this.status.iconFailed = iconFailed;
          this.status.noIcon = noIcon;
          this.status.fetchErrors = fetchErrors;

          await sleep(RATE_LIMIT_MS);
        }
      }
    } catch (err: any) {
      logger.error('❌ Logo enrichment top-level error:', err?.message || err);
      stoppedEarly = true;
      stopReason = err?.message || 'top_level_error';
    } finally {
      this.isRunning = false;
    }

    const completedAt = new Date();
    this.status = {
      isRunning: false,
      trigger,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      totalScanned,
      enriched,
      iconFailed,
      noIcon,
      fetchErrors,
      stoppedEarly,
      stopReason,
    };

    logger.log(
      `🖼️ Logo enrichment DONE (${trigger}) — scanned=${totalScanned} enriched=${enriched} ` +
        `iconFailed=${iconFailed} noIcon=${noIcon} fetchErrors=${fetchErrors} ` +
        `duration=${(this.status.durationMs / 1000).toFixed(0)}s` +
        (stoppedEarly ? ` STOPPED_EARLY: ${stopReason}` : ''),
    );

    return this.getStatus();
  }

  /**
   * Fetch a station homepage through the SSRF-guarded safeFetch, capping the
   * body at MAX_HTML_BYTES. Returns the (possibly truncated) HTML, or null on
   * any error / non-OK / non-HTML response.
   */
  private async fetchHomepageHtml(homepage: string): Promise<string | null> {
    try {
      const res = await safeFetch(
        homepage,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        },
        { allowHttp: true, timeoutMs: HOMEPAGE_FETCH_TIMEOUT_MS, maxRedirects: 5 },
      );

      if (!res.ok) {
        try { await res.body?.cancel(); } catch {}
        return null;
      }

      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      if (ctype && !ctype.includes('html') && !ctype.includes('xml')) {
        try { await res.body?.cancel(); } catch {}
        return null;
      }

      // Read the body with a hard byte cap so a giant/streaming page can't
      // exhaust memory.
      const body = res.body;
      if (!body) return null;
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            total += value.length;
            if (total >= MAX_HTML_BYTES) {
              try { await reader.cancel(); } catch {}
              break;
            }
          }
        }
      } finally {
        try { reader.releaseLock(); } catch {}
      }

      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)), Math.min(total, MAX_HTML_BYTES));
      // Only the <head> matters for icon discovery; decode as latin1-safe utf8.
      return buf.toString('utf8');
    } catch {
      return null;
    }
  }

  /**
   * Extract up to MAX_CANDIDATES icon URLs from the homepage <head> using
   * bounded regexes (no HTML-parser dependency — the backend has none). Priority:
   *   1. og:image
   *   2. apple-touch-icon (prefer the largest sizes=)
   *   3. <link rel="icon" | "shortcut icon">
   *   4. origin /favicon.ico fallback
   * Each href is resolved against the homepage.
   */
  private extractIconCandidates(html: string, homepage: string): string[] {
    // Limit regex work to a bounded prefix — icons live in <head>.
    const head = html.slice(0, 200_000);
    const out: string[] = [];
    const seen = new Set<string>();

    const push = (raw: string | null | undefined) => {
      if (!raw) return;
      const href = raw.trim();
      if (!href) return;
      let resolved: string;
      try {
        resolved = new URL(href, homepage).toString();
      } catch {
        return;
      }
      if (!/^https?:\/\//i.test(resolved)) return;
      if (seen.has(resolved)) return;
      seen.add(resolved);
      if (out.length < MAX_CANDIDATES) out.push(resolved);
    };

    // 1. og:image (property OR name, content attr in either order).
    const ogMatch =
      head.match(
        /<meta[^>]+(?:property|name)\s*=\s*["']og:image(?::url)?["'][^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*>/i,
      ) ||
      head.match(
        /<meta[^>]+\bcontent\s*=\s*["']([^"']+)["'][^>]*(?:property|name)\s*=\s*["']og:image(?::url)?["'][^>]*>/i,
      );
    if (ogMatch) push(ogMatch[1]);

    // 2. apple-touch-icon — collect all, prefer the largest sizes=.
    const appleLinks: Array<{ href: string; size: number }> = [];
    const appleRe =
      /<link[^>]+rel\s*=\s*["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = appleRe.exec(head)) !== null) {
      const tag = m[0];
      const hrefM = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
      if (!hrefM) continue;
      const sizesM = tag.match(/\bsizes\s*=\s*["']\s*(\d+)\s*x\s*(\d+)\s*["']/i);
      const size = sizesM ? parseInt(sizesM[1], 10) : 0;
      appleLinks.push({ href: hrefM[1], size });
    }
    appleLinks.sort((a, b) => b.size - a.size);
    for (const a of appleLinks) push(a.href);

    // 3. <link rel="icon" | "shortcut icon">
    const iconRe =
      /<link[^>]+rel\s*=\s*["'][^"']*\b(?:shortcut\s+icon|icon)\b[^"']*["'][^>]*>/gi;
    const iconLinks: Array<{ href: string; size: number }> = [];
    while ((m = iconRe.exec(head)) !== null) {
      const tag = m[0];
      // Skip apple-touch-icon (already handled) and mask-icons.
      if (/apple-touch-icon|mask-icon/i.test(tag)) continue;
      const hrefM = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
      if (!hrefM) continue;
      const sizesM = tag.match(/\bsizes\s*=\s*["']\s*(\d+)\s*x\s*(\d+)\s*["']/i);
      const size = sizesM ? parseInt(sizesM[1], 10) : 0;
      iconLinks.push({ href: hrefM[1], size });
    }
    iconLinks.sort((a, b) => b.size - a.size);
    for (const i of iconLinks) push(i.href);

    // 4. origin /favicon.ico fallback.
    try {
      push(new URL('/favicon.ico', homepage).toString());
    } catch {
      // ignore
    }

    return out.slice(0, MAX_CANDIDATES);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const scheduledLogoEnrichment = new ScheduledLogoEnrichment();

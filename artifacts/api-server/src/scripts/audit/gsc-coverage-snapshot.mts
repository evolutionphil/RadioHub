/**
 * GSC Coverage Snapshot — one-shot audit script
 *
 * Pulls a comprehensive snapshot from Google Search Console for the
 * MegaRadio SEO audit (2026-05). Writes JSON + CSV artefacts to
 *   /home/user/RadioHub/docs/seo-audit-2026-05/A1-gsc/
 *
 * Usage:
 *   pnpm exec tsx artifacts/api-server/src/scripts/audit/gsc-coverage-snapshot.mts
 *
 * Pre-requisites:
 *   - Service account added to the Search Console property with at least
 *     "Restricted" (read-only) access.
 *   - SECRETS_PATH env var OR service account JSON at
 *     ../../secrets/gsc-service-account.json relative to this file.
 *
 * APIs called:
 *   1. Sitemaps API   — list submitted sitemaps + status
 *   2. Search Analytics — top pages, top queries, by-country, by-device
 *      (90-day window, 1000-row limit each)
 *   3. URL Inspection API — 50 sampled URLs
 *
 * Rate limits:
 *   URL Inspection: 2000 req/day; script does ≤50 → safe.
 *   Search Analytics: 200 req/day per property; script does ≤10 → safe.
 *   Sitemaps: generous; script does ≤4 → safe.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JWT } from 'google-auth-library';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const OUTPUT_DIR = path.resolve(
  '/home/user/RadioHub/docs/seo-audit-2026-05/A1-gsc',
);

// ---------------------------------------------------------------------------
// Service account loading
// ---------------------------------------------------------------------------

function loadServiceAccount(): { client_email: string; private_key: string } {
  // 1. Explicit env var pointing to a directory containing the JSON
  if (process.env.SECRETS_PATH) {
    const p = path.join(process.env.SECRETS_PATH, 'gsc-service-account.json');
    if (fs.existsSync(p)) {
      console.log(`[auth] Loading service account from SECRETS_PATH: ${p}`);
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  }

  // 2. Default relative path (repo root /secrets/)
  const defaultPath = path.resolve(
    __dirname,
    '../../../../../secrets/gsc-service-account.json',
  );
  if (fs.existsSync(defaultPath)) {
    console.log(`[auth] Loading service account from default path: ${defaultPath}`);
    return JSON.parse(fs.readFileSync(defaultPath, 'utf-8'));
  }

  // 3. Inline JSON in env var (for CI / containers)
  if (process.env.GSC_SERVICE_ACCOUNT_JSON) {
    console.log('[auth] Loading service account from GSC_SERVICE_ACCOUNT_JSON env var');
    return JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON);
  }

  throw new Error(
    'Cannot find GSC service account. Set SECRETS_PATH, GSC_SERVICE_ACCOUNT_JSON, ' +
    'or place the JSON at secrets/gsc-service-account.json in the repo root.',
  );
}

// ---------------------------------------------------------------------------
// JWT helper — reuse a single instance across all calls
// ---------------------------------------------------------------------------

const GSC_SCOPE_WEBMASTERS = 'https://www.googleapis.com/auth/webmasters.readonly';

function makeJwt(sa: { client_email: string; private_key: string }): JWT {
  return new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: [GSC_SCOPE_WEBMASTERS],
  });
}

async function getAccessToken(jwt: JWT): Promise<string> {
  const resp = await jwt.getAccessToken();
  if (!resp.token) throw new Error('JWT returned empty access token');
  return resp.token;
}

// ---------------------------------------------------------------------------
// Low-level HTTP helpers
// ---------------------------------------------------------------------------

type FetchResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; error: string };

async function gscGet(
  token: string,
  url: string,
): Promise<FetchResult> {
  const { default: fetch } = await import('node-fetch');
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const text = await resp.text();
  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status,
      error: interpretApiError(resp.status, text),
    };
  }
  try {
    return { ok: true, status: resp.status, body: JSON.parse(text) };
  } catch {
    return { ok: true, status: resp.status, body: text };
  }
}

async function gscPost(
  token: string,
  url: string,
  payload: unknown,
): Promise<FetchResult> {
  const { default: fetch } = await import('node-fetch');
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status,
      error: interpretApiError(resp.status, text),
    };
  }
  try {
    return { ok: true, status: resp.status, body: JSON.parse(text) };
  } catch {
    return { ok: true, status: resp.status, body: text };
  }
}

/** Turn HTTP error codes into actionable guidance for the audit operator. */
function interpretApiError(status: number, body: string): string {
  const truncated = body.slice(0, 500);
  if (status === 403) {
    return (
      'PERMISSION DENIED (403) — The service account has not been added to this ' +
      'Search Console property, or the property URL is wrong. ' +
      `Raw: ${truncated}`
    );
  }
  if (status === 429) {
    return (
      'QUOTA EXCEEDED (429) — GSC daily API quota reached. ' +
      'Wait until midnight Pacific and retry. ' +
      `Raw: ${truncated}`
    );
  }
  if (status === 404) {
    return (
      `PROPERTY NOT FOUND (404) — The siteUrl you specified is not verified in ` +
      `this service account's Search Console. Try the other site URL format. ` +
      `Raw: ${truncated}`
    );
  }
  return `HTTP ${status}: ${truncated}`;
}

// ---------------------------------------------------------------------------
// Site URL discovery — try domain property first, fall back to URL-prefix
// ---------------------------------------------------------------------------

const CANDIDATE_SITE_URLS = [
  'sc-domain:themegaradio.com',
  'https://themegaradio.com/',
];

const SITEMAPS_BASE   = 'https://www.googleapis.com/webmasters/v3/sites';
const ANALYTICS_BASE  = 'https://searchconsole.googleapis.com/webmasters/v3/sites';
const INSPECTION_BASE = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

async function detectActiveSiteUrl(token: string): Promise<string | null> {
  console.log('\n[site-detect] Probing both site URL formats...');
  for (const candidate of CANDIDATE_SITE_URLS) {
    const encoded = encodeURIComponent(candidate);
    const result = await gscGet(token, `${SITEMAPS_BASE}/${encoded}/sitemaps`);
    if (result.ok) {
      console.log(`[site-detect] SUCCESS with: ${candidate}`);
      return candidate;
    }
    console.log(`[site-detect] ${candidate} -> ${result.error.slice(0, 120)}`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function ensureOutputDir(): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`[output] Created directory: ${OUTPUT_DIR}`);
  }
}

function writeJson(filename: string, data: unknown): void {
  const dest = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(dest, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[output] Wrote ${filename}`);
}

function writeCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log(`[output] Skipped ${filename} (no rows)`);
    return;
  }
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ];
  const dest = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(dest, lines.join('\n'), 'utf-8');
  console.log(`[output] Wrote ${filename} (${rows.length} rows)`);
}

// ---------------------------------------------------------------------------
// 1. Sitemaps API
// ---------------------------------------------------------------------------

async function fetchSitemaps(
  token: string,
  siteUrl: string,
): Promise<{ raw: unknown; rows: Record<string, unknown>[] }> {
  console.log('\n[sitemaps] Fetching submitted sitemaps...');
  const encoded = encodeURIComponent(siteUrl);
  const result = await gscGet(token, `${SITEMAPS_BASE}/${encoded}/sitemaps`);

  if (!result.ok) {
    console.error(`[sitemaps] ERROR: ${result.error}`);
    return { raw: { error: result.error }, rows: [] };
  }

  const body = result.body as any;
  const sitemaps: any[] = body.sitemap ?? [];
  console.log(`[sitemaps] Found ${sitemaps.length} submitted sitemaps`);

  const rows: Record<string, unknown>[] = sitemaps.map((s) => ({
    path: s.path,
    lastSubmitted: s.lastSubmitted ?? '',
    isPending: s.isPending ?? false,
    isSitemapsIndex: s.isSitemapsIndex ?? false,
    type: s.type ?? '',
    lastDownloaded: s.lastDownloaded ?? '',
    warnings: s.warnings ?? 0,
    errors: s.errors ?? 0,
    contents_submitted: s.contents?.[0]?.submitted ?? '',
    contents_indexed:   s.contents?.[0]?.indexed ?? '',
    contents_type:      s.contents?.[0]?.type ?? '',
  }));

  return { raw: body, rows };
}

// ---------------------------------------------------------------------------
// 2. Search Analytics API
// ---------------------------------------------------------------------------

type AnalyticsDimension = 'page' | 'query' | 'country' | 'device' | 'date';

interface AnalyticsRequest {
  startDate: string;
  endDate: string;
  dimensions: AnalyticsDimension[];
  rowLimit: number;
  startRow?: number;
  dataState?: 'final' | 'all';
}

async function fetchSearchAnalytics(
  token: string,
  siteUrl: string,
  label: string,
  req: AnalyticsRequest,
): Promise<{ raw: unknown; rows: Record<string, unknown>[] }> {
  console.log(`[analytics:${label}] Fetching (dims=${req.dimensions.join('+')}, ${req.rowLimit} rows)...`);
  const encoded = encodeURIComponent(siteUrl);
  const result = await gscPost(
    token,
    `${ANALYTICS_BASE}/${encoded}/searchAnalytics/query`,
    req,
  );

  if (!result.ok) {
    console.error(`[analytics:${label}] ERROR: ${result.error}`);
    return { raw: { error: result.error }, rows: [] };
  }

  const body = result.body as any;
  const apiRows: any[] = body.rows ?? [];
  console.log(`[analytics:${label}] Received ${apiRows.length} rows`);

  const rows: Record<string, unknown>[] = apiRows.map((r) => {
    const base: Record<string, unknown> = {
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: typeof r.ctr === 'number' ? (r.ctr * 100).toFixed(2) + '%' : r.ctr,
      position: typeof r.position === 'number' ? r.position.toFixed(1) : r.position,
    };
    (req.dimensions).forEach((dim, i) => {
      base[dim] = r.keys?.[i] ?? '';
    });
    return base;
  });

  return { raw: body, rows };
}

function analyticsDateRange(): { startDate: string; endDate: string } {
  const end   = new Date();
  end.setDate(end.getDate() - 1); // yesterday (data finalized)
  const start = new Date(end);
  start.setDate(start.getDate() - 89); // 90 days total

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

// ---------------------------------------------------------------------------
// 3. URL Inspection API
// ---------------------------------------------------------------------------

interface InspectionResult {
  url: string;
  siteUrl: string;
  coverageState: string;
  indexingState: string;
  robotsTxtState: string;
  pageFetchState: string;
  lastCrawlTime: string;
  googleCanonical: string;
  userCanonical: string;
  verdict: string;
  mobileFriendliness: string;
  rawError: string;
}

async function inspectUrl(
  token: string,
  siteUrl: string,
  url: string,
): Promise<InspectionResult> {
  const result = await gscPost(token, INSPECTION_BASE, {
    inspectionUrl: url,
    siteUrl,
  });

  if (!result.ok) {
    return {
      url,
      siteUrl,
      coverageState: 'ERROR',
      indexingState: '',
      robotsTxtState: '',
      pageFetchState: '',
      lastCrawlTime: '',
      googleCanonical: '',
      userCanonical: '',
      verdict: '',
      mobileFriendliness: '',
      rawError: result.error,
    };
  }

  const body = result.body as any;
  const idx  = body?.inspectionResult?.indexStatusResult ?? {};
  const mob  = body?.inspectionResult?.mobileUsabilityResult ?? {};

  return {
    url,
    siteUrl,
    coverageState:     idx.coverageState    ?? '',
    indexingState:     idx.indexingState    ?? '',
    robotsTxtState:    idx.robotsTxtState   ?? '',
    pageFetchState:    idx.pageFetchState   ?? '',
    lastCrawlTime:     idx.lastCrawlTime    ?? '',
    googleCanonical:   idx.googleCanonical  ?? '',
    userCanonical:     idx.userCanonical    ?? '',
    verdict:           idx.verdict          ?? '',
    mobileFriendliness: mob.verdict         ?? '',
    rawError: '',
  };
}

async function fetchUrlInspections(
  token: string,
  siteUrl: string,
  urls: string[],
): Promise<{ results: InspectionResult[]; raw: unknown[] }> {
  console.log(`\n[inspect] Inspecting ${urls.length} URLs (paced at ~120ms/req)...`);
  const results: InspectionResult[] = [];
  const raw: unknown[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    process.stdout.write(`[inspect] ${i + 1}/${urls.length} ${url} ... `);

    try {
      const postResult = await gscPost(token, INSPECTION_BASE, {
        inspectionUrl: url,
        siteUrl,
      });

      if (!postResult.ok) {
        process.stdout.write(`ERROR: ${postResult.error.slice(0, 80)}\n`);
        results.push({
          url, siteUrl,
          coverageState: 'ERROR', indexingState: '', robotsTxtState: '',
          pageFetchState: '', lastCrawlTime: '', googleCanonical: '',
          userCanonical: '', verdict: '', mobileFriendliness: '',
          rawError: postResult.error,
        });
        raw.push({ url, error: postResult.error });
      } else {
        const body = postResult.body as any;
        const idx  = body?.inspectionResult?.indexStatusResult ?? {};
        const mob  = body?.inspectionResult?.mobileUsabilityResult ?? {};
        process.stdout.write(`${idx.verdict ?? 'n/a'} / ${idx.coverageState ?? 'n/a'}\n`);

        results.push({
          url, siteUrl,
          coverageState:      idx.coverageState    ?? '',
          indexingState:      idx.indexingState    ?? '',
          robotsTxtState:     idx.robotsTxtState   ?? '',
          pageFetchState:     idx.pageFetchState   ?? '',
          lastCrawlTime:      idx.lastCrawlTime    ?? '',
          googleCanonical:    idx.googleCanonical  ?? '',
          userCanonical:      idx.userCanonical    ?? '',
          verdict:            idx.verdict          ?? '',
          mobileFriendliness: mob.verdict          ?? '',
          rawError: '',
        });
        raw.push({ url, payload: body });
      }
    } catch (err: any) {
      process.stdout.write(`EXCEPTION: ${err?.message ?? err}\n`);
      results.push({
        url, siteUrl,
        coverageState: 'EXCEPTION', indexingState: '', robotsTxtState: '',
        pageFetchState: '', lastCrawlTime: '', googleCanonical: '',
        userCanonical: '', verdict: '', mobileFriendliness: '',
        rawError: err?.message ?? String(err),
      });
      raw.push({ url, error: err?.message ?? String(err) });
    }

    // Pace to ~10 req/s — well below GSC's daily cap
    await new Promise((r) => setTimeout(r, 120));
  }

  return { results, raw };
}

// ---------------------------------------------------------------------------
// URL sample list construction
// ---------------------------------------------------------------------------

// All enabled language codes from seo-config.ts (hard-coded here to avoid
// importing the full workspace package tree at script runtime).
const SEO_LANGUAGE_CODES: string[] = [
  'en', 'tr', 'es', 'fr', 'de', 'ar',
  'it', 'pt', 'nl', 'ru', 'pl', 'sv', 'da', 'no', 'fi', 'el', 'hu', 'cs',
  'sk', 'ro', 'bg', 'hr', 'sr', 'sl', 'lv', 'lt', 'et',
  'zh', 'ja', 'ko', 'hi', 'th', 'vi', 'id', 'ms', 'tl',
  'he', 'fa', 'ur', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa',
  'sw', 'am', 'zu', 'af', 'sq', 'az', 'hy', 'so', 'uk', 'bs',
];

const BASE = 'https://themegaradio.com';

function buildSampleUrls(): string[] {
  const urls: string[] = [];

  // --- Explicitly requested URLs (highest priority) ---
  const explicit: string[] = [
    `${BASE}/en`,
    `${BASE}/tr`,
    `${BASE}/de`,
    `${BASE}/en/station/bbc-radio-1`,
    `${BASE}/tr/istasyon/bbc-radio-1`,
    `${BASE}/en/genre/pop`,
    `${BASE}/en/country/germany`,
    `${BASE}/robots.txt`,
    `${BASE}/sitemap-index.xml`,
  ];
  for (const u of explicit) urls.push(u);

  // --- Homepage for every SEO language (fill up to 50 total) ---
  // The explicit list already contains /en and /tr, skip those.
  const explicitHomepages = new Set([`${BASE}/en`, `${BASE}/tr`]);
  for (const lang of SEO_LANGUAGE_CODES) {
    if (urls.length >= 50) break;
    const u = `${BASE}/${lang}`;
    if (!explicitHomepages.has(u)) urls.push(u);
  }

  // --- Additional representative pages to reach 50 ---
  const supplemental: string[] = [
    `${BASE}/en/stations`,
    `${BASE}/en/genres`,
    `${BASE}/en/regions`,
    `${BASE}/en/regions/europe`,
    `${BASE}/en/regions/asia`,
    `${BASE}/en/regions/north-america`,
    `${BASE}/en/country/united-states`,
    `${BASE}/en/country/turkey`,
    `${BASE}/en/country/united-kingdom`,
    `${BASE}/en/genre/news`,
    `${BASE}/en/genre/classical`,
    `${BASE}/en/genre/jazz`,
    `${BASE}/de/sender/bbc-radio-1`,
    `${BASE}/es/estacion/bbc-radio-1`,
    `${BASE}/fr/station/bbc-radio-1`,
    `${BASE}/en/about`,
    `${BASE}/en/faq`,
    `${BASE}/en/contact`,
    `${BASE}/en/privacy-policy`,
    `${BASE}/en/terms-and-conditions`,
    `${BASE}/en/applications`,
    `${BASE}/en/station/radio-1`,
    `${BASE}/en/station/rtl-2`,
    `${BASE}/tr/muezzin-radyosu`,
    `${BASE}/de/genre/pop`,
  ];
  for (const u of supplemental) {
    if (urls.length >= 50) break;
    if (!urls.includes(u)) urls.push(u);
  }

  return urls.slice(0, 50);
}

// ---------------------------------------------------------------------------
// Summary CSV
// ---------------------------------------------------------------------------

function buildSummaryRows(
  siteUrl: string,
  sitemapRows: Record<string, unknown>[],
  analyticsPages: Record<string, unknown>[],
  analyticsQueries: Record<string, unknown>[],
  analyticsCountry: Record<string, unknown>[],
  analyticsDevice: Record<string, unknown>[],
  inspections: InspectionResult[],
): Record<string, unknown>[] {
  const summaryRows: Record<string, unknown>[] = [];

  summaryRows.push({
    section: 'meta',
    key: 'siteUrl',
    value: siteUrl,
    ts: new Date().toISOString(),
  });
  summaryRows.push({
    section: 'sitemaps',
    key: 'total_submitted',
    value: sitemapRows.length,
    ts: '',
  });

  const sitemapWithErrors = sitemapRows.filter((r) => Number(r.errors) > 0).length;
  summaryRows.push({ section: 'sitemaps', key: 'with_errors', value: sitemapWithErrors, ts: '' });

  const totalClicks = analyticsPages.reduce((s, r) => s + Number(r.clicks ?? 0), 0);
  const totalImpressions = analyticsPages.reduce((s, r) => s + Number(r.impressions ?? 0), 0);
  summaryRows.push({ section: 'analytics_pages', key: 'total_rows', value: analyticsPages.length, ts: '' });
  summaryRows.push({ section: 'analytics_pages', key: 'total_clicks', value: totalClicks, ts: '' });
  summaryRows.push({ section: 'analytics_pages', key: 'total_impressions', value: totalImpressions, ts: '' });

  const totalQClicks = analyticsQueries.reduce((s, r) => s + Number(r.clicks ?? 0), 0);
  summaryRows.push({ section: 'analytics_queries', key: 'total_rows', value: analyticsQueries.length, ts: '' });
  summaryRows.push({ section: 'analytics_queries', key: 'total_clicks', value: totalQClicks, ts: '' });

  summaryRows.push({ section: 'analytics_country', key: 'total_rows', value: analyticsCountry.length, ts: '' });
  summaryRows.push({ section: 'analytics_device',  key: 'total_rows', value: analyticsDevice.length, ts: '' });

  const indexed = inspections.filter((r) =>
    r.verdict === 'PASS' || r.coverageState.toLowerCase().includes('submitted and indexed'),
  ).length;
  const errors  = inspections.filter((r) => r.rawError).length;
  const notIndexed = inspections.filter((r) =>
    r.coverageState.toLowerCase().includes('not indexed'),
  ).length;

  summaryRows.push({ section: 'inspections', key: 'total_sampled', value: inspections.length, ts: '' });
  summaryRows.push({ section: 'inspections', key: 'verdict_pass',  value: indexed, ts: '' });
  summaryRows.push({ section: 'inspections', key: 'not_indexed',   value: notIndexed, ts: '' });
  summaryRows.push({ section: 'inspections', key: 'api_errors',    value: errors, ts: '' });

  return summaryRows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log('=======================================================');
  console.log(' MegaRadio GSC Coverage Snapshot');
  console.log(` Started: ${startedAt}`);
  console.log('=======================================================');

  ensureOutputDir();

  // Load auth
  let sa: { client_email: string; private_key: string };
  try {
    sa = loadServiceAccount();
    console.log(`[auth] Service account: ${sa.client_email}`);
  } catch (err: any) {
    console.error(`\n[auth] FATAL: ${err.message}`);
    process.exit(1);
    throw err; // unreachable — silences TS "used before assigned" narrowing
  }

  const jwt = makeJwt(sa);

  let token0: string;
  try {
    token0 = await getAccessToken(jwt);
    console.log('[auth] Access token obtained OK');
  } catch (err: any) {
    console.error(`\n[auth] FATAL: Could not obtain access token: ${err.message}`);
    process.exit(1);
    throw err; // unreachable — silences TS narrowing
  }

  // Detect active site URL
  const activeSiteUrl = await detectActiveSiteUrl(token0);
  if (!activeSiteUrl) {
    const msg =
      'FATAL: Could not reach any Search Console property. ' +
      'Both sc-domain:themegaradio.com and https://themegaradio.com/ returned ' +
      'permission errors. Make sure the service account ' +
      `(${sa.client_email}) has been added to the property in Search Console.`;
    console.error(`\n${msg}`);
    writeJson('error-site-not-found.json', { error: msg, candidates: CANDIDATE_SITE_URLS, ts: startedAt });
    process.exit(1);
    throw new Error(msg); // unreachable — narrows activeSiteUrl to string below
  }
  const siteUrl: string = activeSiteUrl;

  // Refresh token in case the auth round-trips above consumed it
  let token: string = await getAccessToken(jwt);

  const dateRange = analyticsDateRange();
  console.log(`\n[analytics] Date range: ${dateRange.startDate} → ${dateRange.endDate} (90 days)`);

  // ----------------------------------------------------------------
  // 1. Sitemaps
  // ----------------------------------------------------------------
  const sitemapsData = await fetchSitemaps(token, siteUrl);
  writeJson('sitemaps-raw.json', sitemapsData.raw);
  writeCsv('sitemaps.csv', sitemapsData.rows);

  // Refresh token for next batch
  token = await getAccessToken(jwt);

  // ----------------------------------------------------------------
  // 2. Search Analytics — four dimensions
  // ----------------------------------------------------------------

  // 2a. Top pages
  const pagesData = await fetchSearchAnalytics(token, siteUrl, 'pages', {
    ...dateRange,
    dimensions: ['page'],
    rowLimit: 1000,
    dataState: 'final',
  });
  writeJson('analytics-pages-raw.json', pagesData.raw);
  writeCsv('analytics-pages.csv', pagesData.rows);

  token = await getAccessToken(jwt);

  // 2b. Top queries
  const queriesData = await fetchSearchAnalytics(token, siteUrl, 'queries', {
    ...dateRange,
    dimensions: ['query'],
    rowLimit: 1000,
    dataState: 'final',
  });
  writeJson('analytics-queries-raw.json', queriesData.raw);
  writeCsv('analytics-queries.csv', queriesData.rows);

  token = await getAccessToken(jwt);

  // 2c. Per-country
  const countryData = await fetchSearchAnalytics(token, siteUrl, 'country', {
    ...dateRange,
    dimensions: ['country'],
    rowLimit: 1000,
    dataState: 'final',
  });
  writeJson('analytics-country-raw.json', countryData.raw);
  writeCsv('analytics-country.csv', countryData.rows);

  token = await getAccessToken(jwt);

  // 2d. Per-device
  const deviceData = await fetchSearchAnalytics(token, siteUrl, 'device', {
    ...dateRange,
    dimensions: ['device'],
    rowLimit: 1000,
    dataState: 'final',
  });
  writeJson('analytics-device-raw.json', deviceData.raw);
  writeCsv('analytics-device.csv', deviceData.rows);

  token = await getAccessToken(jwt);

  // 2e. Date trend (daily clicks + impressions)
  const dateTrendData = await fetchSearchAnalytics(token, siteUrl, 'date-trend', {
    ...dateRange,
    dimensions: ['date'],
    rowLimit: 90,
    dataState: 'final',
  });
  writeJson('analytics-date-trend-raw.json', dateTrendData.raw);
  writeCsv('analytics-date-trend.csv', dateTrendData.rows);

  token = await getAccessToken(jwt);

  // 2f. Page × Country (top 1000 by clicks — useful for language/region coverage analysis)
  const pageCountryData = await fetchSearchAnalytics(token, siteUrl, 'page-country', {
    ...dateRange,
    dimensions: ['page', 'country'],
    rowLimit: 1000,
    dataState: 'final',
  });
  writeJson('analytics-page-country-raw.json', pageCountryData.raw);
  writeCsv('analytics-page-country.csv', pageCountryData.rows);

  token = await getAccessToken(jwt);

  // ----------------------------------------------------------------
  // 3. URL Inspection
  // ----------------------------------------------------------------
  const sampleUrls = buildSampleUrls();
  console.log(`\n[inspect] Sample URL list (${sampleUrls.length} URLs):`);
  sampleUrls.forEach((u, i) => console.log(`  ${String(i + 1).padStart(2, '0')}. ${u}`));

  const { results: inspectionResults, raw: inspectionRaw } =
    await fetchUrlInspections(token, siteUrl, sampleUrls);

  writeJson('url-inspection-raw.json', inspectionRaw);
  writeCsv('url-inspection.csv', inspectionResults as unknown as Record<string, unknown>[]);

  // ----------------------------------------------------------------
  // Summary
  // ----------------------------------------------------------------
  const summaryRows = buildSummaryRows(
    siteUrl,
    sitemapsData.rows,
    pagesData.rows,
    queriesData.rows,
    countryData.rows,
    deviceData.rows,
    inspectionResults,
  );
  writeCsv('summary.csv', summaryRows);

  const manifest = {
    runAt: startedAt,
    completedAt: new Date().toISOString(),
    siteUrl,
    serviceAccountEmail: sa.client_email,
    dateRange,
    urlsSampled: sampleUrls.length,
    files: [
      'sitemaps-raw.json', 'sitemaps.csv',
      'analytics-pages-raw.json', 'analytics-pages.csv',
      'analytics-queries-raw.json', 'analytics-queries.csv',
      'analytics-country-raw.json', 'analytics-country.csv',
      'analytics-device-raw.json', 'analytics-device.csv',
      'analytics-date-trend-raw.json', 'analytics-date-trend.csv',
      'analytics-page-country-raw.json', 'analytics-page-country.csv',
      'url-inspection-raw.json', 'url-inspection.csv',
      'summary.csv',
      'manifest.json',
    ],
    counts: {
      sitemaps: sitemapsData.rows.length,
      analytics_pages: pagesData.rows.length,
      analytics_queries: queriesData.rows.length,
      analytics_country: countryData.rows.length,
      analytics_device: deviceData.rows.length,
      analytics_date_trend: dateTrendData.rows.length,
      analytics_page_country: pageCountryData.rows.length,
      inspections: inspectionResults.length,
      inspection_errors: inspectionResults.filter((r) => !!r.rawError).length,
    },
  };
  writeJson('manifest.json', manifest);

  console.log('\n=======================================================');
  console.log(' DONE');
  console.log(`  Site URL:       ${siteUrl}`);
  console.log(`  Date range:     ${dateRange.startDate} → ${dateRange.endDate}`);
  console.log(`  Sitemaps:       ${sitemapsData.rows.length}`);
  console.log(`  Top pages:      ${pagesData.rows.length}`);
  console.log(`  Top queries:    ${queriesData.rows.length}`);
  console.log(`  Countries:      ${countryData.rows.length}`);
  console.log(`  Devices:        ${deviceData.rows.length}`);
  console.log(`  URLs inspected: ${inspectionResults.length} (${inspectionResults.filter((r) => !!r.rawError).length} errors)`);
  console.log(`  Output dir:     ${OUTPUT_DIR}`);
  console.log('=======================================================');
}

main().catch((err) => {
  console.error('\n[fatal]', err?.message ?? err);
  process.exit(1);
});

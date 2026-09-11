import { createHash } from 'node:crypto';

const DAY = 86_400_000;
const HOSTS = ['themegaradio.com', 'www.themegaradio.com'];
const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
// Verified against Cloudflare's authenticated GraphQL introspection schema.
// No dimensions: Cloudflare calculates ONE percentile distribution across the
// selected hosts/period. Averaging per-page or per-day percentiles is invalid.
export const WEB_VITALS_QUERY = `query CoreWebVitals($accountTag: string!, $start: Time!, $end: Time!) {
  viewer { accounts(filter: {accountTag: $accountTag}) {
    rumWebVitalsEventsAdaptiveGroups(
      filter: {datetime_geq: $start, datetime_leq: $end, requestHost_in: ["themegaradio.com", "www.themegaradio.com"]}
      limit: 1
    ) {
      count
      sum { lcpTotal inpTotal clsTotal }
      quantiles {
        largestContentfulPaintP50 largestContentfulPaintP75 largestContentfulPaintP95
        interactionToNextPaintP50 interactionToNextPaintP75 interactionToNextPaintP95
        cumulativeLayoutShiftP50 cumulativeLayoutShiftP75 cumulativeLayoutShiftP95
      }
    }
  } }
}`;

type VitalStatus = 'good' | 'needs_improvement' | 'poor' | 'no_data';
type Availability = 'available' | 'configuration_required' | 'no_data' | 'upstream_unavailable';
interface VitalAggregate { p50: number | null; p75: number | null; p95: number | null; status: VitalStatus }
export interface VitalsPeriod { start: string; end: string }
interface WebVitalsResult {
  success: true; status: Availability; message: string; reason?: string;
  source: 'cloudflare_rum'; hosts: string[]; period: VitalsPeriod; sampled: true;
  estimatedPageViews: number | null; lcp: VitalAggregate; inp: VitalAggregate; cls: VitalAggregate; lastUpdated: string;
}

export function parseVitalsPeriod(start: unknown, end: unknown, now = Date.now()): VitalsPeriod | null {
  // Stable minute boundary lets browser/admin instances share a cached result.
  const defaultEnd = Math.floor(now / 60_000) * 60_000;
  const parse = (value: unknown, fallback: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return NaN;
    const parsed = Date.parse(value);
    // Date.parse normalizes impossible calendar dates such as February 30.
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19) ? parsed : NaN;
  };
  const to = parse(end, defaultEnd);
  const from = parse(start, to - 7 * DAY);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 7 * DAY || to > now + 60_000) return null;
  return { start: new Date(from).toISOString(), end: new Date(to).toISOString() };
}

function emptyVital(): VitalAggregate { return { p50: null, p75: null, p95: null, status: 'no_data' }; }
function nonnegative(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function readVital(quantiles: Record<string, unknown> | undefined, prefix: string, observations: unknown, divisor: number, good: number, poor: number): VitalAggregate {
  if (!nonnegative(observations) || observations === 0) return emptyVital();
  // Cloudflare uses microseconds for LCP/INP and a negative sentinel for N/A.
  const value = (percentile: number) => {
    const raw = quantiles?.[`${prefix}P${percentile}`];
    return nonnegative(raw) ? raw / divisor : null;
  };
  const p75 = value(75);
  return { p50: value(50), p75, p95: value(95), status: p75 === null ? 'no_data' : p75 <= good ? 'good' : p75 <= poor ? 'needs_improvement' : 'poor' };
}

export function createCloudflareWebVitalsService(options: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv; now?: () => number; timeoutMs?: number } = {}) {
  const request = options.fetch ?? globalThis.fetch;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expires: number; result: Promise<WebVitalsResult> }>();
  return async (period: VitalsPeriod): Promise<WebVitalsResult> => {
    const result = (status: Availability, message: string, reason?: string): WebVitalsResult => ({
      success: true, status, message, reason, source: 'cloudflare_rum', sampled: true, hosts: HOSTS,
      period, estimatedPageViews: status === 'no_data' ? 0 : null,
      lcp: emptyVital(), inp: emptyVital(), cls: emptyVital(), lastUpdated: new Date(now()).toISOString(),
    });
    const account = env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const token = env.CLOUDFLARE_API_TOKEN?.trim();
    const key = env.CLOUDFLARE_API_KEY?.trim();
    const email = env.CLOUDFLARE_EMAIL?.trim();
    if (!account || !(token || key)) return result('configuration_required', 'Cloudflare RUM is not configured. Set the Cloudflare account ID and a read-only analytics API token for that account.', 'missing_credentials');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (key && email) { headers['X-Auth-Key'] = key; headers['X-Auth-Email'] = email; }
    else headers.Authorization = `Bearer ${key}`; // Existing deployments store an API token under this legacy variable.
    const cacheKey = createHash('sha256').update(JSON.stringify([account, headers, period])).digest('hex');
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > now()) return cached.result;
    for (const [id, entry] of cache) if (entry.expires <= now()) cache.delete(id);
    if (cache.size >= 16) return result('upstream_unavailable', 'Cloudflare analytics is busy. Retry shortly.', 'busy');
    const entry = { expires: now() + 300_000, result: Promise.resolve(null as unknown as WebVitalsResult) };
    entry.result = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
      timer.unref?.();
      try {
        const response = await request(ENDPOINT, { method: 'POST', headers, signal: controller.signal,
          body: JSON.stringify({ query: WEB_VITALS_QUERY, variables: { accountTag: account, ...period } }) });
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel();
          return result('configuration_required', 'Cloudflare rejected analytics access. Check that the API token belongs to the configured account and has Account Analytics Read permission.', 'access_denied');
        }
        if (!response.ok) { await response.body?.cancel(); return result('upstream_unavailable', 'Cloudflare analytics is temporarily unavailable. Retry shortly.', 'provider_error'); }
        const body = await response.json() as any;
        if (Array.isArray(body.errors) && body.errors.length) {
          // Never expose upstream error messages, account IDs or credentials.
          const accessDenied = body.errors.some((error: any) => typeof error?.message === 'string' && /not authorized|unauthorized|permission|authentication|access denied|invalid.*token/i.test(error.message));
          return accessDenied
            ? result('configuration_required', 'Cloudflare cannot read analytics for the configured account. Verify the account ID and grant this token Account Analytics Read access to that same account.', 'access_denied')
            : result('upstream_unavailable', 'Cloudflare did not return valid Web Vitals. Check analytics availability for this account or retry later.', 'provider_error');
        }
        const groups = body?.data?.viewer?.accounts?.[0]?.rumWebVitalsEventsAdaptiveGroups;
        if (!Array.isArray(groups) || groups.length > 1) return result('upstream_unavailable', 'Cloudflare returned an unexpected analytics response. No metrics have been estimated.', 'invalid_response');
        if (groups.length === 0 || groups[0]?.count === 0) return result('no_data', 'No Cloudflare RUM measurements are available for these hosts and dates. Verify that Web Analytics collection is enabled and allow real visits to accumulate.');
        const point = groups[0];
        if (!nonnegative(point.count)) return result('upstream_unavailable', 'Cloudflare returned an unexpected analytics response. No metrics have been estimated.', 'invalid_response');
        const lcp = readVital(point.quantiles, 'largestContentfulPaint', point.sum?.lcpTotal, 1000, 2500, 4000);
        const inp = readVital(point.quantiles, 'interactionToNextPaint', point.sum?.inpTotal, 1000, 200, 500);
        const cls = readVital(point.quantiles, 'cumulativeLayoutShift', point.sum?.clsTotal, 1, 0.1, 0.25);
        const anyMetric = [lcp, inp, cls].some(metric => metric.status !== 'no_data');
        return { ...result(anyMetric ? 'available' : 'no_data', anyMetric ? 'Cloudflare-reported percentiles for the selected hosts and period.' : 'Page views exist, but no valid Core Web Vitals are available yet.'), estimatedPageViews: point.count, lcp, inp, cls };
      } catch {
        return result('upstream_unavailable', controller.signal.aborted ? 'Cloudflare analytics timed out. Retry shortly.' : 'Cloudflare analytics could not be reached. Retry shortly.', controller.signal.aborted ? 'timeout' : 'network_error');
      } finally { clearTimeout(timer); }
    })().then(value => { entry.expires = now() + (value.status === 'available' || value.status === 'no_data' ? 300_000 : 60_000); return value; });
    cache.set(cacheKey, entry);
    return entry.result;
  };
}

export const getCloudflareWebVitals = createCloudflareWebVitalsService();

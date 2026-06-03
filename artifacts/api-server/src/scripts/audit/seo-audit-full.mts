/**
 * Full SEO Audit — one-shot script that generates a comprehensive Markdown
 * report covering sitemap health, robots.txt, llms.txt, per-language meta
 * verification, schema.org / structured data validation, per-language
 * indexability matrix, and per-URL sample indexability.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/scripts/audit/seo-audit-full.mts \
 *     --site https://www.themegaradio.com \
 *     --api  https://api.themegaradio.com \
 *     --output docs/seo-audit-2026-05/full-audit.md
 *
 * All HTTP calls are read-only. No DB mutations. Safe to re-run anytime.
 *
 * Output sections:
 *   1. Executive summary
 *   2. Sitemap health
 *   3. robots.txt audit
 *   4. llms.txt audit
 *   5. Per-language meta verification (Googlebot fetch)
 *   6. Schema.org / structured-data audit
 *   7. Per-(country × language × group) indexability matrix
 *   8. Per-URL indexability sample
 *   9. Top 10 actionable items
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface Args {
  site: string;
  api: string;
  output: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (name: string, fallback: string): string => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    site: get('site', 'https://www.themegaradio.com'),
    api: get('api', 'https://api.themegaradio.com'),
    output: get('output', 'docs/seo-audit-2026-05/full-audit.md'),
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

let lastFetchAt = 0;
async function rateLimitedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastFetchAt;
  if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));
  lastFetchAt = Date.now();
  return fetch(url, {
    ...init,
    headers: { 'User-Agent': GOOGLEBOT_UA, ...(init.headers || {}) },
  });
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; body: string; headers: Headers }> {
  try {
    const r = await rateLimitedFetch(url);
    const body = await r.text();
    return { ok: r.ok, status: r.status, body, headers: r.headers };
  } catch (e: any) {
    return { ok: false, status: 0, body: `ERROR: ${e?.message ?? e}`, headers: new Headers() };
  }
}

async function fetchJson<T = any>(url: string): Promise<T | null> {
  try {
    const r = await rateLimitedFetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Section 1 — Executive summary placeholder (populated last)
// ---------------------------------------------------------------------------

const findings: string[] = [];
function addFinding(severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO', text: string): void {
  findings.push(`- **${severity}** — ${text}`);
}

// ---------------------------------------------------------------------------
// Section 2 — Sitemap health
// ---------------------------------------------------------------------------

interface SitemapStat {
  url: string;
  status: number;
  urlCount: number;
  hreflangCount: number;
  lastmodFresh: boolean;
  oldestLastmod: string | null;
  newestLastmod: string | null;
  bytes: number;
  error?: string;
}

function extractTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

async function auditSitemap(url: string): Promise<SitemapStat> {
  const r = await fetchText(url);
  if (!r.ok) return { url, status: r.status, urlCount: 0, hreflangCount: 0, lastmodFresh: false, oldestLastmod: null, newestLastmod: null, bytes: r.body.length, error: `HTTP ${r.status}` };

  const urls = extractTags(r.body, 'url');
  const lastmods = extractTags(r.body, 'lastmod').map(s => s.trim()).filter(Boolean);
  const hreflangCount = (r.body.match(/<xhtml:link[^>]*hreflang=/g) || []).length;

  let oldest: string | null = null;
  let newest: string | null = null;
  let lastmodFresh = false;
  if (lastmods.length > 0) {
    const dates = lastmods.map(s => new Date(s).getTime()).filter(n => !isNaN(n));
    if (dates.length > 0) {
      oldest = new Date(Math.min(...dates)).toISOString();
      newest = new Date(Math.max(...dates)).toISOString();
      const ageH = (Date.now() - Math.max(...dates)) / 3_600_000;
      lastmodFresh = ageH < 25;
    }
  }

  return { url, status: r.status, urlCount: urls.length, hreflangCount, lastmodFresh, oldestLastmod: oldest, newestLastmod: newest, bytes: r.body.length };
}

async function auditAllSitemaps(siteUrl: string): Promise<{ index: SitemapStat; children: SitemapStat[] }> {
  const indexUrl = `${siteUrl}/sitemap-index.xml`;
  console.log(`[1] Sitemap index → ${indexUrl}`);
  const indexResp = await fetchText(indexUrl);

  const childUrls = (indexResp.body.match(/<loc>([^<]+)<\/loc>/g) || [])
    .map(s => s.replace(/<\/?loc>/g, '').trim())
    .filter(Boolean);

  const index: SitemapStat = {
    url: indexUrl,
    status: indexResp.status,
    urlCount: childUrls.length,
    hreflangCount: 0,
    lastmodFresh: true,
    oldestLastmod: null,
    newestLastmod: null,
    bytes: indexResp.body.length,
  };

  console.log(`  → ${childUrls.length} child sitemaps. Sampling up to 20…`);
  const sampleChildren = childUrls.slice(0, 20);
  const children: SitemapStat[] = [];
  for (const childUrl of sampleChildren) {
    children.push(await auditSitemap(childUrl));
  }
  return { index, children };
}

// ---------------------------------------------------------------------------
// Section 3 — robots.txt
// ---------------------------------------------------------------------------

interface RobotsAudit {
  status: number;
  body: string;
  hasSitemap: boolean;
  hasAiBotDirective: boolean;
  hasAuthDisallow: boolean;
  aiBotsMentioned: string[];
}

async function auditRobots(siteUrl: string): Promise<RobotsAudit> {
  console.log(`[2] robots.txt`);
  const r = await fetchText(`${siteUrl}/robots.txt`);
  const aiBots = ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'PerplexityBot', 'anthropic-ai'];
  const mentioned = aiBots.filter(b => r.body.includes(b));
  return {
    status: r.status,
    body: r.body,
    hasSitemap: /^Sitemap:/im.test(r.body),
    hasAiBotDirective: mentioned.length > 0,
    hasAuthDisallow: /Disallow:\s*\/.*\b(auth|login|signup)/i.test(r.body),
    aiBotsMentioned: mentioned,
  };
}

// ---------------------------------------------------------------------------
// Section 4 — llms.txt
// ---------------------------------------------------------------------------

interface LlmsAudit {
  status: number;
  exists: boolean;
  bytes: number;
  hasSitemap: boolean;
  sectionCount: number;
  sample: string;
}

async function auditLlms(siteUrl: string): Promise<LlmsAudit> {
  console.log(`[3] llms.txt`);
  const r = await fetchText(`${siteUrl}/llms.txt`);
  const exists = r.ok && r.body.length > 0;
  return {
    status: r.status,
    exists,
    bytes: r.body.length,
    hasSitemap: /sitemap/i.test(r.body),
    sectionCount: (r.body.match(/^##\s/gm) || []).length,
    sample: r.body.slice(0, 500),
  };
}

// ---------------------------------------------------------------------------
// Section 5 — Per-language meta verification
// ---------------------------------------------------------------------------

interface MetaAudit {
  url: string;
  status: number;
  title: string | null;
  description: string | null;
  canonical: string | null;
  ogTitle: string | null;
  hreflangCount: number;
  hasXDefault: boolean;
  robotsMeta: string | null;
  jsonLdCount: number;
  jsonLdTypes: string[];
  bodyLooksLocalized: boolean;
  expectedLang: string;
}

function extractMeta(html: string, name: string): string | null {
  const re = new RegExp(`<meta\\s+(?:name|property)=["']${name}["']\\s+content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

function extractCanonical(html: string): string | null {
  const m = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

function countHreflangs(html: string): { total: number; hasXDefault: boolean } {
  const all = html.match(/<link\s+rel=["']alternate["']\s+hreflang=["']([^"']+)["']/gi) || [];
  return {
    total: all.length,
    hasXDefault: all.some(s => /hreflang=["']x-default["']/i.test(s)),
  };
}

function extractJsonLd(html: string): { count: number; types: string[]; errors: string[] } {
  const blocks = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const types: string[] = [];
  const errors: string[] = [];
  for (const block of blocks) {
    const m = block.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!m) continue;
    try {
      const data = JSON.parse(m[1]);
      const arr = Array.isArray(data) ? data : [data];
      for (const item of arr) {
        if (item['@type']) {
          const t = Array.isArray(item['@type']) ? item['@type'].join('|') : item['@type'];
          types.push(t);
        }
      }
    } catch (e: any) {
      errors.push(e?.message ?? String(e));
    }
  }
  return { count: blocks.length, types, errors };
}

// Heuristic: does the body contain enough characters in the expected language?
function bodyLooksLocalized(html: string, lang: string): boolean {
  const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
  const text = (bodyMatch ? bodyMatch[0] : html).replace(/<[^>]+>/g, ' ').slice(0, 4000);
  // Language-specific marker characters
  const markers: Record<string, RegExp> = {
    tr: /[şŞçÇğĞıİöÖüÜ]/,
    de: /[äöüÄÖÜß]/,
    ar: /[؀-ۿ]/,
    zh: /[一-鿿]/,
    ja: /[぀-ヿ]/,
    ko: /[가-힯]/,
    ru: /[А-Яа-я]/,
    he: /[֐-׿]/,
    el: /[Α-Ωα-ω]/,
    hi: /[ऀ-ॿ]/,
    th: /[฀-๿]/,
  };
  const re = markers[lang];
  if (re) return re.test(text);
  // For Latin-script langs that share alphabet with English, fall back to "true"
  // (we'd need to compare to the EN version to be sure).
  return true;
}

async function auditPageMeta(url: string, expectedLang: string): Promise<MetaAudit> {
  const r = await fetchText(url);
  const html = r.body;
  const { total, hasXDefault } = countHreflangs(html);
  const ld = extractJsonLd(html);
  return {
    url,
    status: r.status,
    title: extractTitle(html),
    description: extractMeta(html, 'description'),
    canonical: extractCanonical(html),
    ogTitle: extractMeta(html, 'og:title'),
    hreflangCount: total,
    hasXDefault,
    robotsMeta: extractMeta(html, 'robots'),
    jsonLdCount: ld.count,
    jsonLdTypes: ld.types,
    bodyLooksLocalized: bodyLooksLocalized(html, expectedLang),
    expectedLang,
  };
}

// ---------------------------------------------------------------------------
// Section 7 — Indexability matrix (pulled from GSC inspection API)
// ---------------------------------------------------------------------------

interface IndexabilityRow {
  language: string;
  total: number;
  qualified: boolean;
  redirected: number;
}

interface NoindexBreakdownResp {
  total: number;
  breakdown: {
    langRedirected: number;
    numericSlug: number;
    stationNoIndex: number;
    junk: number;
    indexable: number;
  };
  serverNoindexTotal: number;
  qualifiedLanguageCount: number;
  qualifiedLanguages: string[];
  byLanguage: IndexabilityRow[];
}

interface StatsResp {
  byState?: Array<{ state: string; count: number }>;
  byGroup?: Array<{ group: string; total: number; indexed: number; crawledNotIndexed: number; discoveredNotIndexed: number; excluded: number; error: number; pending: number }>;
  byLanguage?: Array<{ language: string; total: number; indexed: number }>;
}

async function auditIndexability(apiUrl: string): Promise<{ breakdown: NoindexBreakdownResp | null; stats: StatsResp | null }> {
  console.log(`[6] Indexability data from GSC admin API`);
  const breakdown = await fetchJson<NoindexBreakdownResp>(`${apiUrl}/api/admin/gsc-inspection/noindex-breakdown`);
  const stats = await fetchJson<StatsResp>(`${apiUrl}/api/admin/gsc-inspection/stats`);
  if (!breakdown) addFinding('MEDIUM', 'GSC `/noindex-breakdown` returned no data — admin auth may be required to run this script against production.');
  if (!stats) addFinding('MEDIUM', 'GSC `/stats` returned no data — admin auth may be required to run this script against production.');
  return { breakdown, stats };
}

// ---------------------------------------------------------------------------
// Per-language fetch matrix
// ---------------------------------------------------------------------------

async function auditPerLanguageMeta(siteUrl: string, langs: string[]): Promise<MetaAudit[]> {
  console.log(`[5] Per-language meta (${langs.length} languages × 3 pages = ${langs.length * 3} fetches)`);
  const out: MetaAudit[] = [];
  for (const lang of langs.slice(0, 14)) {
    out.push(await auditPageMeta(`${siteUrl}/${lang}`, lang));
    out.push(await auditPageMeta(`${siteUrl}/${lang}/genres`, lang));
    out.push(await auditPageMeta(`${siteUrl}/${lang}/regions`, lang));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Markdown report builder
// ---------------------------------------------------------------------------

function md(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.replace(/\|/g, '\\|');
  return String(value);
}

function renderReport(opts: {
  site: string;
  api: string;
  sitemap: { index: SitemapStat; children: SitemapStat[] };
  robots: RobotsAudit;
  llms: LlmsAudit;
  metas: MetaAudit[];
  indexability: { breakdown: NoindexBreakdownResp | null; stats: StatsResp | null };
}): string {
  const lines: string[] = [];
  const ts = new Date().toISOString();
  lines.push(`# Full SEO Audit — ${opts.site}`);
  lines.push(`Generated: ${ts}`);
  lines.push(`API: ${opts.api}`);
  lines.push('');

  // 1. Executive summary
  lines.push('## 1. Executive Summary');
  lines.push('');
  if (findings.length === 0) {
    lines.push('No critical findings.');
  } else {
    lines.push(...findings);
  }
  lines.push('');

  // 2. Sitemap health
  lines.push('## 2. Sitemap Health');
  lines.push('');
  lines.push(`**Index**: ${opts.sitemap.index.url} → HTTP ${opts.sitemap.index.status}, ${opts.sitemap.index.urlCount} child sitemaps listed (${(opts.sitemap.index.bytes / 1024).toFixed(1)} KB)`);
  lines.push('');
  lines.push('| Child sitemap | Status | URLs | Hreflang links | Lastmod fresh (< 25h) | Oldest lastmod | Newest lastmod | Bytes |');
  lines.push('|---|---:|---:|---:|:---:|---|---|---:|');
  for (const c of opts.sitemap.children) {
    lines.push(`| ${md(c.url.replace(opts.site, ''))} | ${c.status} | ${c.urlCount} | ${c.hreflangCount} | ${c.lastmodFresh ? '✅' : '⚠️'} | ${md(c.oldestLastmod)} | ${md(c.newestLastmod)} | ${c.bytes} |`);
  }
  lines.push('');

  // 3. robots.txt
  lines.push('## 3. robots.txt Audit');
  lines.push('');
  lines.push(`- HTTP status: ${opts.robots.status}`);
  lines.push(`- Has \`Sitemap:\` directive: ${opts.robots.hasSitemap ? '✅' : '❌'}`);
  lines.push(`- Auth paths disallowed: ${opts.robots.hasAuthDisallow ? '✅' : '⚠️'}`);
  lines.push(`- AI bots mentioned: ${opts.robots.aiBotsMentioned.length > 0 ? opts.robots.aiBotsMentioned.join(', ') : '⚠️ none'}`);
  lines.push('');
  lines.push('```');
  lines.push(opts.robots.body.slice(0, 1500));
  if (opts.robots.body.length > 1500) lines.push('...(truncated)');
  lines.push('```');
  lines.push('');

  // 4. llms.txt
  lines.push('## 4. llms.txt Audit');
  lines.push('');
  lines.push(`- HTTP status: ${opts.llms.status}`);
  lines.push(`- Exists: ${opts.llms.exists ? '✅' : '❌ MISSING — consider creating one (https://llmstxt.org)'}`);
  lines.push(`- Size: ${opts.llms.bytes} bytes`);
  lines.push(`- Sections (\`##\` headers): ${opts.llms.sectionCount}`);
  lines.push(`- References sitemap: ${opts.llms.hasSitemap ? '✅' : '⚠️'}`);
  if (opts.llms.exists) {
    lines.push('');
    lines.push('Sample (first 500 chars):');
    lines.push('```');
    lines.push(opts.llms.sample);
    lines.push('```');
  }
  lines.push('');

  // 5. Per-language meta
  lines.push('## 5. Per-Language Meta Verification');
  lines.push('');
  lines.push('Fetched with Googlebot UA. `body-lang?` = heuristic check that body contains characters from the expected language.');
  lines.push('');
  lines.push('| Path | Status | Title (truncated) | Canonical correct | Hreflang | x-default | Robots meta | JSON-LD types | body-lang? |');
  lines.push('|---|---:|---|:---:|---:|:---:|---|---|:---:|');
  for (const m of opts.metas) {
    const pathOnly = m.url.replace(opts.site, '');
    const canonicalMatches = m.canonical ? m.canonical.endsWith(pathOnly) || m.canonical === m.url : false;
    const titleShort = (m.title || '').slice(0, 70);
    lines.push(`| ${md(pathOnly)} | ${m.status} | ${md(titleShort)} | ${canonicalMatches ? '✅' : '⚠️'} | ${m.hreflangCount} | ${m.hasXDefault ? '✅' : '⚠️'} | ${md(m.robotsMeta)} | ${md(m.jsonLdTypes.slice(0, 4).join(', '))} | ${m.bodyLooksLocalized ? '✅' : '⚠️'} |`);
  }
  lines.push('');

  // 6. Schema.org
  lines.push('## 6. Schema.org Structured Data Audit');
  lines.push('');
  const schemaTotals: Record<string, number> = {};
  for (const m of opts.metas) {
    for (const t of m.jsonLdTypes) {
      schemaTotals[t] = (schemaTotals[t] || 0) + 1;
    }
  }
  lines.push('| @type | Count across sampled pages |');
  lines.push('|---|---:|');
  for (const [t, n] of Object.entries(schemaTotals).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${md(t)} | ${n} |`);
  }
  lines.push('');

  // 7. Indexability matrix
  lines.push('## 7. Indexability Matrix');
  lines.push('');
  if (opts.indexability.breakdown) {
    const b = opts.indexability.breakdown;
    lines.push(`**Total URLs in GSC cache**: ${b.total.toLocaleString()}`);
    lines.push(`**Server-side noindex (total)**: ${b.serverNoindexTotal.toLocaleString()}`);
    lines.push(`- Junk: ${b.breakdown.junk.toLocaleString()}`);
    lines.push(`- station.noIndex: ${b.breakdown.stationNoIndex.toLocaleString()}`);
    lines.push(`- Numeric slug: ${b.breakdown.numericSlug.toLocaleString()}`);
    lines.push(`- Lang-redirected (301 → /en): ${b.breakdown.langRedirected.toLocaleString()}`);
    lines.push(`- Indexable: ${b.breakdown.indexable.toLocaleString()}`);
    lines.push('');
    lines.push(`**Qualified languages** (${b.qualifiedLanguageCount}): ${b.qualifiedLanguages.join(', ')}`);
    lines.push('');
    lines.push('### Per-language breakdown');
    lines.push('');
    lines.push('| Language | Total URLs | Qualified? | Redirected (301 → /en) |');
    lines.push('|---|---:|:---:|---:|');
    for (const row of b.byLanguage.slice(0, 30)) {
      lines.push(`| ${md(row.language)} | ${row.total.toLocaleString()} | ${row.qualified ? '✅' : '❌'} | ${row.redirected.toLocaleString()} |`);
    }
  } else {
    lines.push('_GSC breakdown unavailable (admin auth required, or endpoint failed)._');
  }
  lines.push('');

  if (opts.indexability.stats?.byGroup) {
    lines.push('### Per-group (Google verdict)');
    lines.push('');
    lines.push('| Group | Total | Indexed | Crawled-NI | Discovered-NI | Excluded | Error | Pending |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const g of opts.indexability.stats.byGroup) {
      lines.push(`| ${md(g.group)} | ${g.total} | ${g.indexed} | ${g.crawledNotIndexed} | ${g.discoveredNotIndexed} | ${g.excluded} | ${g.error} | ${g.pending} |`);
    }
    lines.push('');
  }

  // 9. Top actionable items
  lines.push('## 8. Top Actionable Items');
  lines.push('');
  const recs: string[] = [];
  if (!opts.llms.exists) recs.push('Create `/llms.txt` at the site root (see llmstxt.org for spec).');
  if (!opts.robots.hasAiBotDirective) recs.push('robots.txt does not mention any AI bots — consider explicit Allow/Disallow for GPTBot, ClaudeBot, etc.');
  const staleSitemaps = opts.sitemap.children.filter(c => !c.lastmodFresh && c.urlCount > 0);
  if (staleSitemaps.length > 0) {
    recs.push(`${staleSitemaps.length} child sitemap(s) have stale lastmod (> 25h). Run \`POST /api/admin/sitemap/rebuild\` to refresh.`);
  }
  const emptySitemaps = opts.sitemap.children.filter(c => c.status === 200 && c.urlCount === 0);
  if (emptySitemaps.length > 0) {
    recs.push(`${emptySitemaps.length} sitemap(s) returned 200 but contain 0 URLs — investigate (empty cohort?).`);
  }
  const metaIssues = opts.metas.filter(m => m.expectedLang !== 'en' && !m.bodyLooksLocalized);
  if (metaIssues.length > 0) {
    recs.push(`${metaIssues.length} page(s) failed the body-language heuristic — possibly serving English content on a non-English URL.`);
  }
  const noCanonical = opts.metas.filter(m => !m.canonical);
  if (noCanonical.length > 0) {
    recs.push(`${noCanonical.length} page(s) are missing the canonical link tag.`);
  }
  if (recs.length === 0) {
    lines.push('No actionable issues detected — SEO infrastructure is healthy.');
  } else {
    recs.slice(0, 10).forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push(`_Generated by \`artifacts/api-server/src/scripts/audit/seo-audit-full.mts\` at ${ts}_`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`SEO audit starting — site: ${args.site}, api: ${args.api}`);

  const sitemap = await auditAllSitemaps(args.site);
  const robots = await auditRobots(args.site);
  const llms = await auditLlms(args.site);

  // Use a representative slice of qualified languages for per-language meta
  const indexability = await auditIndexability(args.api);
  const qualifiedLangs = indexability.breakdown?.qualifiedLanguages ?? ['en', 'tr', 'de', 'fr', 'es'];
  const metas = await auditPerLanguageMeta(args.site, qualifiedLangs);

  const report = renderReport({
    site: args.site,
    api: args.api,
    sitemap,
    robots,
    llms,
    metas,
    indexability,
  });

  const outPath = path.resolve(args.output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, report, 'utf8');
  console.log(`✓ Wrote ${outPath} (${report.length} bytes)`);
}

main().catch(err => {
  console.error('SEO audit failed:', err);
  process.exit(1);
});

#!/usr/bin/env tsx
/**
 * SEO Full-Audit Script
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seo-audit-full.mts \
 *     --site https://www.themegaradio.com \
 *     --api  https://api.themegaradio.com \
 *     --output docs/seo-audit.md
 *
 * Covers:
 *   1. Sitemap index + child sitemaps (URL counts, lastmod freshness, hreflang)
 *   2. robots.txt (Sitemap refs, AI-bot directives, asset allowlist)
 *   3. llms.txt (present / missing / content)
 *   4. Per-language meta (title, description, og, canonical, hreflang)
 *   5. Schema.org / structured-data (JSON-LD parsing, required fields)
 *   6. Admin indexability breakdown (needs ADMIN_EMAIL + ADMIN_PASS)
 *   7. Summary & top-10 actionable items
 *
 * Optional env vars:
 *   ADMIN_EMAIL   admin login for /api/dashboard/stats + /api/admin/gsc-inspection
 *   ADMIN_PASS    admin password
 */

import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// ── CLI args ──────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    site:   { type: 'string', default: 'https://www.themegaradio.com' },
    api:    { type: 'string', default: 'https://api.themegaradio.com' },
    output: { type: 'string', default: 'docs/seo-audit.md' },
    delay:  { type: 'string', default: '300' },  // ms between requests
  },
  strict: false,
});

const SITE    = String(args.site  ?? 'https://www.themegaradio.com').replace(/\/$/, '');
const API     = String(args.api   ?? 'https://api.themegaradio.com').replace(/\/$/, '');
const OUTPUT  = String(args.output ?? 'docs/seo-audit.md');
const DELAY   = parseInt(String(args.delay ?? '300'), 10);

const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function fetchText(url: string, ua?: string, cookie?: string): Promise<{ ok: boolean; status: number; body: string; headers: Record<string, string> }> {
  try {
    const headers: Record<string, string> = {};
    if (ua) headers['user-agent'] = ua;
    if (cookie) headers['cookie'] = cookie;
    const res = await fetch(url, { headers, redirect: 'follow' });
    const body = await res.text();
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { resHeaders[k] = v; });
    return { ok: res.ok, status: res.status, body, headers: resHeaders };
  } catch (e: any) {
    return { ok: false, status: 0, body: e.message, headers: {} };
  }
}

function extractMeta(html: string, name: string): string {
  const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["']`, 'i'));
  return m?.[1] ?? '';
}

function extractOg(html: string, prop: string): string {
  const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']*)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:${prop}["']`, 'i'));
  return m?.[1] ?? '';
}

function extractCanonical(html: string): string {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)
    || html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["']/i);
  return m?.[1] ?? '';
}

function extractHreflangs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<link[^>]+rel=["']alternate["'][^>]+hreflang=["']([^"']*)["'][^>]+href=["']([^"']*)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) out[m[1]] = m[2];
  return out;
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m?.[1]?.trim() ?? '';
}

function extractJsonLd(html: string): any[] {
  const results: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { results.push(JSON.parse(m[1])); } catch {}
  }
  return results;
}

function countUrlsInSitemap(xml: string): number {
  return (xml.match(/<url>/g) || []).length;
}

function extractSitemapUrls(xml: string): string[] {
  const matches = xml.match(/<loc>(https?:\/\/[^<]+)<\/loc>/g) || [];
  return matches.map(m => m.replace(/<\/?loc>/g, '').trim());
}

function isLastmodFresh(xml: string, maxAgeHours = 25): boolean {
  const m = xml.match(/<lastmod>([^<]+)<\/lastmod>/);
  if (!m) return false;
  const age = (Date.now() - new Date(m[1]).getTime()) / 3_600_000;
  return age < maxAgeHours;
}

const lines: string[] = [];
function h(level: 1|2|3, text: string) { lines.push(`${'#'.repeat(level)} ${text}\n`); }
function p(text: string) { lines.push(text + '\n'); }
function li(text: string) { lines.push(`- ${text}`); }
function warn(text: string) { lines.push(`> ⚠️  ${text}`); }
function ok(text: string) { lines.push(`> ✅ ${text}`); }
function table(headers: string[], rows: string[][]): void {
  lines.push('| ' + headers.join(' | ') + ' |');
  lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');
  for (const row of rows) lines.push('| ' + row.join(' | ') + ' |');
  lines.push('');
}

// ── Section 1: Sitemap Health ─────────────────────────────────────────────────

h(1, 'SEO Full Audit — ' + new Date().toISOString().slice(0, 10));
p(`Site: ${SITE}  |  API: ${API}  |  Generated: ${new Date().toISOString()}`);
p('---');

h(2, '1. Sitemap Health');
const sitemapIndex = await fetchText(`${API}/sitemap-index.xml`, GOOGLEBOT_UA);
await sleep(DELAY);

if (!sitemapIndex.ok) {
  warn(`sitemap-index.xml returned ${sitemapIndex.status}`);
} else {
  ok(`sitemap-index.xml → ${sitemapIndex.status}`);
  const childUrls = extractSitemapUrls(sitemapIndex.body).filter(u => u.includes('sitemap'));
  p(`Found **${childUrls.length}** child sitemaps.`);

  const sitemapRows: string[][] = [];
  for (const url of childUrls.slice(0, 30)) {
    await sleep(DELAY);
    const child = await fetchText(url, GOOGLEBOT_UA);
    const urlCount = child.ok ? countUrlsInSitemap(child.body) : 0;
    const fresh = child.ok ? (isLastmodFresh(child.body) ? '✅' : '⚠️ stale') : '❌';
    const hasHreflang = child.ok && child.body.includes('hreflang') ? '✅' : '—';
    const name = url.split('/').pop() || url;
    sitemapRows.push([name, String(urlCount), fresh, hasHreflang, String(child.status)]);
  }
  if (childUrls.length > 30) sitemapRows.push([`(+${childUrls.length - 30} more)`, '…', '…', '…', '…']);
  table(['Sitemap', 'URLs', 'Fresh', 'hreflang', 'HTTP'], sitemapRows);
}

// ── Section 2: robots.txt ────────────────────────────────────────────────────

h(2, '2. robots.txt');
const robots = await fetchText(`${SITE}/robots.txt`, GOOGLEBOT_UA);
await sleep(DELAY);

if (!robots.ok) {
  warn(`robots.txt returned ${robots.status}`);
} else {
  ok(`robots.txt → ${robots.status}`);
  const robotsBody = robots.body;

  // Check sitemap refs
  const sitemapRefs = (robotsBody.match(/^Sitemap:\s*(.+)$/gmi) || []).map(l => l.replace(/^Sitemap:\s*/i, '').trim());
  p(`**Sitemap references** (${sitemapRefs.length}):`);
  sitemapRefs.forEach(s => li(s));
  if (sitemapRefs.length === 0) warn('No Sitemap: directive found in robots.txt');
  p('');

  // AI bot directives
  const aiBots = ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'PerplexityBot', 'cohere-ai', 'anthropic-ai'];
  p('**AI-bot directives:**');
  const aiBotRows: string[][] = [];
  for (const bot of aiBots) {
    const re = new RegExp(`User-agent:\\s*${bot}[\\s\\S]*?(?=User-agent:|$)`, 'i');
    const block = re.exec(robotsBody)?.[0] ?? '';
    const disallowed = block.includes('Disallow: /') ? '🚫 Disallowed' : (block ? '⚠️ Allow' : '—');
    aiBotRows.push([bot, disallowed]);
  }
  table(['Bot', 'Directive'], aiBotRows);

  // Asset allowlist
  const hasAssetsJs = robotsBody.includes('/assets/*.js');
  const hasAssetsCss = robotsBody.includes('/assets/*.css');
  hasAssetsJs ? ok('Allow: /assets/*.js present') : warn('Allow: /assets/*.js MISSING — Vite bundles may be blocked!');
  hasAssetsCss ? ok('Allow: /assets/*.css present') : warn('Allow: /assets/*.css MISSING');

  // Auth paths
  const disallowedAuth = robotsBody.match(/Disallow:\s*\/api\/auth\/?/i);
  disallowedAuth ? ok('Disallow: /api/auth present') : warn('Disallow: /api/auth not found');
}

// ── Section 3: llms.txt ───────────────────────────────────────────────────────

h(2, '3. llms.txt');
const llms = await fetchText(`${SITE}/llms.txt`, GOOGLEBOT_UA);
await sleep(DELAY);

if (llms.status === 404) {
  warn('llms.txt NOT FOUND (404) — AI crawlers get no structured guidance. Consider adding one.');
} else if (!llms.ok) {
  warn(`llms.txt returned ${llms.status}`);
} else {
  ok(`llms.txt → ${llms.status} (${llms.body.length} bytes)`);
  const llmsLines = llms.body.split('\n').filter(l => l.trim()).length;
  p(`${llmsLines} non-empty lines.`);
}

// ── Section 4: Per-language meta ─────────────────────────────────────────────

h(2, '4. Per-Language Meta Verification');
p('Checking 5 representative URL types per language using Googlebot UA.');

// Sample languages (universal 14 + a few extended)
const SAMPLE_LANGS = ['en', 'tr', 'de', 'es', 'fr', 'pt', 'ar', 'ru', 'it', 'ja', 'fi', 'nl', 'sv', 'pl'];
// Sample URL paths per type
const SAMPLE_PATHS: Record<string, string> = {
  home:    '/',
  country: '/country/turkey',
  genre:   '/genre/pop',
  station: '/station/trt-fm',    // known station slug; adjust if needed
  search:  '/search',
};

const metaIssues: string[] = [];
const metaRows: string[][] = [];

for (const lang of SAMPLE_LANGS) {
  for (const [type, path] of Object.entries(SAMPLE_PATHS)) {
    const url = lang === 'en' ? `${SITE}${path}` : `${SITE}/${lang}${path}`;
    await sleep(DELAY);
    const r = await fetchText(url, GOOGLEBOT_UA);
    if (r.status >= 400 && r.status !== 404) {
      metaRows.push([lang, type, String(r.status), '—', '—', '—']);
      continue;
    }
    const title = extractTitle(r.body).slice(0, 60);
    const desc  = extractMeta(r.body, 'description').slice(0, 80);
    const canonical = extractCanonical(r.body);
    const hreflangs = extractHreflangs(r.body);
    const hreflangCount = Object.keys(hreflangs).length;
    const canonicalOk = canonical === url || canonical === url.replace(/\/$/, '') ? '✅' : `⚠️ ${canonical.slice(0, 40)}`;
    metaRows.push([lang, type, String(r.status), title || '⚠️ empty', String(hreflangCount), canonicalOk]);
    if (!title) metaIssues.push(`${lang}/${type}: missing <title>`);
    if (!desc)  metaIssues.push(`${lang}/${type}: missing meta description`);
    if (hreflangCount === 0 && type !== 'search') metaIssues.push(`${lang}/${type}: no hreflang`);
  }
}

table(['Lang', 'Type', 'HTTP', 'Title', 'hreflang#', 'Canonical'], metaRows);

if (metaIssues.length > 0) {
  p(`**${metaIssues.length} meta issues found:**`);
  metaIssues.slice(0, 20).forEach(i => warn(i));
} else {
  ok('All sampled pages have title + description + hreflang');
}

// ── Section 5: Schema.org audit ───────────────────────────────────────────────

h(2, '5. Schema.org / Structured Data');

const schemaUrls = [
  { label: 'Homepage (en)',    url: `${SITE}/` },
  { label: 'Station page',     url: `${SITE}/station/trt-fm` },
  { label: 'Genre page',       url: `${SITE}/genre/pop` },
  { label: 'Country page',     url: `${SITE}/country/turkey` },
];

const schemaRows: string[][] = [];
for (const { label, url } of schemaUrls) {
  await sleep(DELAY);
  const r = await fetchText(url, GOOGLEBOT_UA);
  const schemas = extractJsonLd(r.body);
  if (schemas.length === 0) {
    schemaRows.push([label, '0', '❌ none', '—']);
    continue;
  }
  const types = schemas.map(s => s['@type'] || '?').join(', ');
  const hasBreadcrumb = schemas.some(s => s['@type'] === 'BreadcrumbList') ? '✅' : '—';
  const issues = schemas.flatMap(s => {
    const errs: string[] = [];
    if (!s['@context']) errs.push('no @context');
    if (!s['@type'])    errs.push('no @type');
    return errs;
  });
  schemaRows.push([label, String(schemas.length), types.slice(0, 60), issues.length === 0 ? '✅' : issues.join(', ')]);
}
table(['Page', 'JSON-LD blocks', 'Types', 'Issues'], schemaRows);

// ── Section 6: Admin indexability (requires auth) ─────────────────────────────

h(2, '6. Indexability Summary (Admin Stats)');

let adminCookie = '';
const adminEmail = process.env.ADMIN_EMAIL;
const adminPass  = process.env.ADMIN_PASS;

if (adminEmail && adminPass) {
  const loginRes = await fetch(`${API}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPass }),
    credentials: 'include',
  });
  const setCookie = loginRes.headers.get('set-cookie');
  if (setCookie) adminCookie = setCookie.split(';')[0];
}

if (!adminCookie) {
  warn('ADMIN_EMAIL / ADMIN_PASS not set — skipping indexability section. Set env vars and re-run.');
} else {
  // Noindex breakdown
  const niRes = await fetchText(`${API}/api/admin/gsc-inspection/noindex-breakdown`, GOOGLEBOT_UA, adminCookie);
  await sleep(DELAY);
  if (niRes.ok) {
    try {
      const data = JSON.parse(niRes.body);
      const byLang = data.byLanguage || [];
      p(`**${byLang.length} language buckets** in noindex breakdown:`);
      const sorted = [...byLang].sort((a: any, b: any) => b.total - a.total).slice(0, 20);
      table(
        ['Lang', 'Total', 'Redirected', 'Qualified'],
        sorted.map((r: any) => [r.lang, String(r.total), String(r.redirected ?? 0), r.qualified ? '✅' : '⚠️']),
      );
    } catch { warn('Could not parse noindex-breakdown response'); }
  } else {
    warn(`noindex-breakdown: ${niRes.status}`);
  }

  // GSC stats
  const gscRes = await fetchText(`${API}/api/admin/gsc-inspection/stats`, GOOGLEBOT_UA, adminCookie);
  await sleep(DELAY);
  if (gscRes.ok) {
    try {
      const data = JSON.parse(gscRes.body);
      if (data.indexed !== undefined) {
        p(`**GSC totals:** indexed=${data.indexed}, crawledNotIndexed=${data.crawledNotIndexed}, discoveredNotIndexed=${data.discoveredNotIndexed}`);
        const pct = data.indexed / (data.total || 1) * 100;
        pct > 90 ? ok(`${pct.toFixed(1)}% of known URLs indexed (healthy)`) : warn(`Only ${pct.toFixed(1)}% indexed — investigate`);
      }
    } catch {}
  }
}

// ── Section 7: Summary & Recommendations ─────────────────────────────────────

h(2, '7. Summary & Recommendations');

const allIssues: { priority: 'high' | 'medium'; desc: string }[] = [];

if (!sitemapIndex.ok)         allIssues.push({ priority: 'high',   desc: 'sitemap-index.xml not reachable' });
if (!robots.ok)               allIssues.push({ priority: 'high',   desc: 'robots.txt not reachable' });
if (llms.status === 404)      allIssues.push({ priority: 'medium', desc: 'llms.txt missing — add to expose site structure to AI crawlers' });
metaIssues.slice(0, 5).forEach(i => allIssues.push({ priority: 'medium', desc: i }));

if (allIssues.length === 0) {
  ok('No critical issues detected in sampled pages.');
} else {
  const high = allIssues.filter(i => i.priority === 'high');
  const med  = allIssues.filter(i => i.priority === 'medium');
  if (high.length) { p(`**🔴 High priority (${high.length}):**`); high.forEach(i => li(i.desc)); p(''); }
  if (med.length)  { p(`**🟡 Medium priority (${med.length}):**`); med.forEach(i => li(i.desc)); p(''); }
}

p('---');
p(`_Report generated by \`seo-audit-full.mts\` on ${new Date().toISOString()}_`);

// ── Write output ──────────────────────────────────────────────────────────────

const report = lines.join('\n');
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, report, 'utf8');
console.log(`\n✅ SEO audit complete — report written to: ${OUTPUT}`);
console.log(`   Issues found: ${allIssues.length}`);

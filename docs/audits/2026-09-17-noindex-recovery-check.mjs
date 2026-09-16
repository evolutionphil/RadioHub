// Public, bounded verification. This script never changes application data.
const origin = 'https://themegaradio.com';
const slug = process.argv[2] || '92-citi-fm';
const stationResponse = await fetch(`${origin}/api/station/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(20000) });
const stationText = await stationResponse.text();
const stationData = JSON.parse(stationText);
const station = stationData.station || stationData;
console.log(JSON.stringify({ type: 'station', slug, status: stationResponse.status,
  noIndex: station.noIndex, languages: Object.keys(station.descriptions || {}),
  privateJournalExposed: /noIndexRecoveryJournal|no_index_recovery_journal|explicit-selected-legacy-noindex-recovery/.test(stationText) }));
const first = await fetch(`${origin}/en/station/${slug}`, { signal: AbortSignal.timeout(20000) });
const html = await first.text();
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(m => [m[1], m[2].replace(/&amp;/g, '&')]));
const alternatives = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0])).filter(a => a.rel === 'alternate' && a.hreflang && a.hreflang !== 'x-default');
if (alternatives.length !== 14) throw new Error(`Expected 14 localized alternatives, got ${alternatives.length}; HTTP ${first.status}`);
for (const alternate of alternatives) {
  if (new URL(alternate.href).origin !== origin) throw new Error('Unexpected alternate origin');
  const response = await fetch(alternate.href, { signal: AbortSignal.timeout(20000) });
  const body = await response.text();
  const links = [...body.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0]));
  const metas = [...body.matchAll(/<meta\b[^>]*>/gi)].map(m => attrs(m[0]));
  const robots = metas.filter(m => /^(robots|googlebot)$/.test(m.name || '')).map(m => m.content).join(';');
  const canonical = links.find(l => l.rel === 'canonical')?.href;
  const noindex = /\b(noindex|none)\b/i.test(robots + ';' + response.headers.get('x-robots-tag'));
  const result = { language: alternate.hreflang, url: response.url, status: response.status, noindex,
    selfCanonical: canonical === response.url, localizedTitle: body.match(/<title>([^<]*)<\/title>/i)?.[1],
    alternates: links.filter(l => l.rel === 'alternate' && l.hreflang && l.hreflang !== 'x-default').length };
  console.log(JSON.stringify(result));
  if (result.status !== 200 || noindex || !result.selfCanonical || result.alternates !== 14) process.exitCode = 1;
}

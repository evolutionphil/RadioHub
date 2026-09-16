import { writeFile } from 'node:fs/promises';

// Read an existing GSC CSV export converted to JSON on stdin. Public GET only.
let input = '';
for await (const chunk of process.stdin) input += chunk.toString();
const urls = JSON.parse(input).map(row => row.URL);
let hash = 2166136261;
const source = urls.slice().sort().join('\n');
for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619) >>> 0;
if (process.env.GSC_EXPECTED_URL_HASH && hash !== Number(process.env.GSC_EXPECTED_URL_HASH)) throw new Error(`GSC export differs from current UI: ${hash}`);
console.log(JSON.stringify({ phase: 'source-verified', count: urls.length, hash }));
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]?.replace(/&amp;/g, '&');
const rows = Array(urls.length);
let next = 0;
async function worker() {
  while (next < urls.length) {
    const index = next++;
    const url = urls[index];
    let target = url;
    const chain = [];
    try {
      if (new URL(target).origin !== 'https://themegaradio.com') throw new Error('Out-of-scope origin');
      for (let hop = 0; hop < 10; hop++) {
        const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'RadioHub-Public-GSC-Verification/1.0' } });
        const location = response.headers.get('location');
        chain.push({ url: target, status: response.status, location });
        if (response.status >= 300 && response.status < 400 && location) {
          await response.body?.cancel();
          target = new URL(location, target).href;
          if (new URL(target).origin !== 'https://themegaradio.com') throw new Error('Out-of-scope redirect');
          continue;
        }
        const html = await response.text();
        const robots = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0])
          .filter(tag => /^(robots|googlebot)$/i.test(attribute(tag, 'name') || '')).map(tag => attribute(tag, 'content') || '');
        const xRobotsTag = response.headers.get('x-robots-tag');
        const canonicalTag = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]).find(tag => attribute(tag, 'rel') === 'canonical');
        rows[index] = { url, final: target, status: response.status, chain, robots, xRobotsTag,
          noindex: /\b(noindex|none)\b/i.test([...robots, xRobotsTag || ''].join(';')),
          canonical: canonicalTag ? attribute(canonicalTag, 'href') : null };
        break;
      }
      if (!rows[index]) throw new Error('Redirect limit');
    } catch (error) { rows[index] = { url, final: target, chain, error: error.message }; }
    if ((index + 1) % 50 === 0) console.log(JSON.stringify({ phase: 'checking', completed: rows.filter(Boolean).length, total: urls.length }));
  }
}
await Promise.all([worker(), worker()]);
const summary = { count: rows.length, status: {}, noindex: rows.filter(row => row.noindex).length, errors: rows.filter(row => row.error).length };
for (const row of rows) summary.status[row.status ?? 'error'] = (summary.status[row.status ?? 'error'] || 0) + 1;
const output = { checkedAt: new Date().toISOString(), sourceHash: hash, concurrency: 2, summary, rows };
await writeFile(new URL('./2026-09-17-all-gsc-noindex.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ phase: 'complete', summary, unresolved: rows.filter(row => row.noindex || row.status !== 200).map(({ url, final, status, noindex, error }) => ({ url, final, status, noindex, error })) }));

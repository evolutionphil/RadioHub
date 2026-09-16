import { writeFile } from 'node:fs/promises';

// Bounded, unauthenticated public HTTP check of examples observed in GSC.
const origin = 'https://themegaradio.com';
const groups = {
  noindex: [
    '/ar/mahta/radio-blacklight', '/ar/station/radio-blacklight',
    '/ar/mahta/radio-kosava-info', '/ar/station/radio-kosava-info',
    '/pl/stacja/967-1', '/pl/station/967-1', '/en/station/967-1',
    '/en/station/panepistimio-kritis-96-7', '/ar/mahta/radio-10-chernivtsi-ukraine',
  ],
  notFound: [
    '/bd/station/kpissfm-2', '/rs/station/kpissfm-1', '/am/station/flashbassfm-1',
    '/ar/station/rdi-gaga', '/ar/station/trk-radyo', '/ar/station/rdio_fm-1',
    '/et/station/radio-yar-5', '/ar/station/dr-p8-jazz-aac',
    '/ar/station/smooth-3', '/am/station/-2173',
  ],
  crawledNotIndexed: [
    '/in/station/0-n-2010s-on-radio-1', '/it/stazione/0-n-2010s-on-radio',
    '/it/station/0-n-2010s-on-radio-1', '/ar/mahta/0-n-2010s-on-radio',
    '/ar/station/0-n-2010s-on-radio-1', '/om/station/0-n-2010s-on-radio-1',
    '/ar/mahta/folk-alley-aac-64k', '/ar/station/folk-alley-aac-64k',
    '/tn/station/folk-alley-aac-64k', '/de/sender/hr3-mittgelhessen',
  ],
};
const decode = (value = '') => value
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
  .replace(/&#x([\da-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)));
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
  .map((match) => [match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4])]));

async function inspect(group, path) {
  const startedAt = new Date().toISOString();
  const chain = [];
  let current = new URL(path, origin).href;
  try {
    for (let hop = 0; hop < 10; hop++) {
      const response = await fetch(current, {
        redirect: 'manual', signal: AbortSignal.timeout(20000),
        headers: { 'user-agent': 'RadioHub-Public-SEO-Audit/1.0', accept: 'text/html' },
      });
      const location = response.headers.get('location');
      const xRobotsTag = response.headers.get('x-robots-tag');
      chain.push({ url: current, status: response.status, location, xRobotsTag });
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        current = new URL(location, current).href;
        if (new URL(current).origin !== origin) throw new Error('Redirect leaves audited public origin');
        continue;
      }
      const html = await response.text();
      const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => attrs(tag));
      const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => attrs(tag));
      const robots = meta.filter((tag) => /^(robots|googlebot)$/i.test(tag.name ?? ''))
        .map((tag) => ({ name: tag.name, content: tag.content ?? '' }));
      const noindex = robots.some((tag) => /\b(noindex|none)\b/i.test(tag.content))
        || /\b(noindex|none)\b/i.test(xRobotsTag ?? '');
      const description = meta.find((tag) => /^description$/i.test(tag.name ?? ''))?.content ?? null;
      const canonical = links.find((tag) => /(?:^|\s)canonical(?:\s|$)/i.test(tag.rel ?? ''))?.href ?? null;
      return {
        group, inputUrl: new URL(path, origin).href, checkedAt: startedAt, chain,
        finalUrl: current, finalStatus: response.status, contentType: response.headers.get('content-type'),
        robots, xRobotsTag, noindex, canonical, description,
        descriptionLength: description?.length ?? 0,
        title: decode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim(),
        httpAndRobotsIndexable: response.status === 200 && !noindex,
      };
    }
    throw new Error('Redirect limit reached');
  } catch (error) {
    return { group, inputUrl: new URL(path, origin).href, checkedAt: startedAt, chain,
      finalUrl: current, error: `${error.name}: ${error.message}` };
  }
}

const jobs = Object.entries(groups).flatMap(([group, paths]) => paths.map((path) => ({ group, path })));
const results = Array(jobs.length);
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const index = next++;
    const { group, path } = jobs[index];
    results[index] = await inspect(group, path);
    console.log(JSON.stringify({ group, path, status: results[index].finalStatus,
      noindex: results[index].noindex, canonical: results[index].canonical, error: results[index].error }));
  }
}
await Promise.all([worker(), worker()]);
const audit = {
  generatedAt: new Date().toISOString(), origin,
  methodology: 'Unauthenticated public GET, manual redirects (up to 10), max 2 concurrent requests, 20-second request timeout. HTML robots/googlebot and final X-Robots-Tag checked. httpAndRobotsIndexable does not assert Google indexing, canonical acceptance, robots.txt access, or content quality.',
  gscReportUpdated: '2026-09-14', gscValidationsFailed: '2026-09-15',
  summary: Object.fromEntries(Object.keys(groups).map((group) => {
    const rows = results.filter((row) => row.group === group);
    return [group, { checked: rows.length,
      httpAndRobotsIndexable: rows.filter((row) => row.httpAndRobotsIndexable).length,
      noindex: rows.filter((row) => row.noindex).length,
      errors: rows.filter((row) => row.error).length,
      statusCounts: rows.reduce((counts, row) => {
        const status = row.finalStatus ?? 'error'; counts[status] = (counts[status] ?? 0) + 1; return counts;
      }, {}),
    }];
  })),
  results,
};
await writeFile(new URL('./2026-09-17-gsc-failed-live-check.json', import.meta.url), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit.summary));

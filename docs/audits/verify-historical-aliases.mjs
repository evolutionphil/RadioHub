import { writeFile } from 'node:fs/promises';

const origin = 'https://themegaradio.com';
const mappings = [
  ['radio-onda-rossa-1', 'onda-rossa'],
  ['kiis-1065-sydney-1065-fm-mp3-1', 'kiis-106-5'],
];
const attribute = (tag, key) => tag.match(new RegExp(`\\b${key}=["']([^"']*)["']`, 'i'))?.[1]?.replaceAll('&amp;', '&');
const links = html => [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]);
async function check(url, expectedSlug) {
  const chain = [];
  let response;
  for (let hop = 0; hop < 8; hop++) {
    if (new URL(url).origin !== origin) throw new Error('Unexpected origin');
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'RadioHub-Historical-Alias-Verification/1.0' } });
    const location = response.headers.get('location');
    chain.push({ url, status: response.status, location });
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      url = new URL(location, url).href;
      continue;
    }
    break;
  }
  const html = await response.text();
  const tags = links(html);
  const canonical = attribute(tags.find(tag => attribute(tag, 'rel') === 'canonical') || '', 'href');
  const robots = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0])
    .filter(tag => /^(robots|googlebot)$/i.test(attribute(tag, 'name') || ''))
    .map(tag => attribute(tag, 'content') || '').join(';') + ';' + (response.headers.get('x-robots-tag') || '');
  const alternates = tags.filter(tag => attribute(tag, 'rel') === 'alternate' && attribute(tag, 'hreflang') !== 'x-default')
    .map(tag => ({ lang: attribute(tag, 'hreflang'), href: attribute(tag, 'href') })).filter(x => x.lang && x.href);
  const record = { input: chain[0].url, final: url, status: response.status, chain, canonical,
    noindex: /\b(noindex|none)\b/i.test(robots), languages: [...new Set(alternates.map(x => x.lang))] };
  record.pass = response.status === 200 && !record.noindex && canonical === url &&
    new URL(url).pathname.endsWith('/' + expectedSlug) && record.languages.length === 14;
  return { record, alternates };
}
const results = [];
for (const [legacy, canonical] of mappings) {
  const seed = await check(`${origin}/en/station/${canonical}`, canonical);
  if (!seed.record.pass) throw new Error(`Canonical seed failed: ${canonical}`);
  for (const alternate of seed.alternates) {
    const source = new URL(alternate.href);
    source.pathname = source.pathname.slice(0, source.pathname.lastIndexOf('/') + 1) + legacy;
    const { record } = await check(source.href, canonical);
    record.language = alternate.lang;
    record.pass &&= record.chain.length > 1 && record.chain[0].status === 301 && record.final === new URL(alternate.href).href;
    results.push(record);
  }
}
for (const [path, canonical] of [
  ['/af/station/radio-onda-rossa-1', 'onda-rossa'],
  ['/ch/station/kiis-1065-sydney-1065-fm-mp3-1', 'kiis-106-5'],
  ['/ly/station/kiss-981', 'kiss-98-1'],
]) results.push((await check(origin + path, canonical)).record);
const failures = results.filter(row => !row.pass);
await writeFile(new URL(`./${new Date().toISOString().slice(0, 10)}-historical-alias-live.json`, import.meta.url),
  JSON.stringify({ checkedAt: new Date().toISOString(), count: results.length, passed: results.length - failures.length, results }, null, 2) + '\n');
console.log(JSON.stringify({ checked: results.length, passed: results.length - failures.length, failures }));
if (failures.length) process.exitCode = 1;

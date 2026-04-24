/**
 * Unit tests for `generateLanguageUrls()`'s new `allowedLanguages` param
 * (architect P0 — stop advertising ~57 hreflang alternates per station).
 */
import assert from 'node:assert/strict';
import { generateLanguageUrls } from '../shared/seo-config';

const DOMAIN = 'https://themegaradio.com';
const PATH = '/station/baba-radyo';

// Legacy behaviour: no allow-list, all enabled languages emitted + x-default.
{
  const out = generateLanguageUrls(PATH, DOMAIN, 'en', undefined, undefined);
  const hreflangs = new Set(out.map((h) => h.hreflang));
  assert.ok(hreflangs.has('en'), 'en must be present');
  assert.ok(hreflangs.has('x-default'), 'x-default must be present');
  assert.ok(
    hreflangs.size > 30,
    `legacy mode must emit many languages (got ${hreflangs.size})`,
  );
}

// Empty allow-list → zero alternates (junk/noindex page).
{
  const out = generateLanguageUrls(PATH, DOMAIN, 'en', undefined, undefined, []);
  assert.deepEqual(
    out,
    [],
    'empty allow-list must suppress ALL hreflang entries (including x-default)',
  );
}

// Restricted allow-list (en, tr, de) — only those three appear, plus x-default.
{
  const out = generateLanguageUrls(
    PATH,
    DOMAIN,
    'en',
    undefined,
    undefined,
    ['en', 'tr', 'de'],
  );
  const hreflangs = new Set(out.map((h) => h.hreflang));
  assert.equal(hreflangs.has('en'), true, 'en present');
  assert.equal(hreflangs.has('tr'), true, 'tr present');
  assert.equal(hreflangs.has('de'), true, 'de present');
  assert.equal(hreflangs.has('x-default'), true, 'x-default present (en allowed)');
  assert.equal(hreflangs.has('ko'), false, 'ko must NOT be present');
  assert.equal(hreflangs.has('th'), false, 'th must NOT be present');
  assert.equal(hreflangs.has('fr'), false, 'fr must NOT be present');
  // 3 languages + x-default = 4 total entries.
  assert.equal(out.length, 4, `expected 4 entries, got ${out.length}`);
}

// Allow-list without English → x-default points at the first allowed language,
// NOT at /en/ (which would be noindex for that station).
{
  const out = generateLanguageUrls(
    PATH,
    DOMAIN,
    'de',
    undefined,
    undefined,
    ['de', 'tr'],
  );
  const xDefault = out.find((h) => h.hreflang === 'x-default');
  assert.ok(xDefault, 'x-default must still be emitted');
  assert.equal(
    xDefault!.url.includes('/en/'),
    false,
    'x-default must NOT point at /en/ when en is not in the allow-list',
  );
  const firstAllowed = out.find((h) => h.hreflang !== 'x-default');
  assert.equal(
    xDefault!.url,
    firstAllowed!.url,
    'x-default should match the first allowed language URL',
  );
}

// Case-insensitivity: allow-list entries may be upper/mixed case.
{
  const out = generateLanguageUrls(
    PATH,
    DOMAIN,
    'en',
    undefined,
    undefined,
    ['EN', 'Tr'],
  );
  const hreflangs = new Set(out.map((h) => h.hreflang));
  assert.equal(hreflangs.has('en'), true, 'uppercase EN in allow-list accepted');
  assert.equal(hreflangs.has('tr'), true, 'mixed-case Tr in allow-list accepted');
}

// null allow-list must behave like undefined (no filter).
{
  const out = generateLanguageUrls(
    PATH,
    DOMAIN,
    'en',
    undefined,
    undefined,
    null as any,
  );
  const hreflangs = new Set(out.map((h) => h.hreflang));
  assert.ok(
    hreflangs.size > 30,
    `null allow-list must behave like legacy (got ${hreflangs.size})`,
  );
}

console.log('✅ hreflang-allowlist tests passed');

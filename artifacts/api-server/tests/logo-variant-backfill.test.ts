import assert from 'node:assert/strict';
import { it } from 'node:test';
import sharp from 'sharp';
import { createLogoVariantBackfill, logoVariantCandidate, parseLogoVariantRequest, renderSmallLogoVariants } from '../src/services/logo-variant-backfill';
import type { LogoVariantStation } from '../src/data/postgres-logo-variant-store';

const id = '1234567890abcdef12345678', config = { bucket: 'offline-logos', region: 'eu-north-1' };
const base = `https://${config.bucket}.s3.${config.region}.amazonaws.com/`;
const fixture = (): LogoVariantStation => ({ id, slug: 'radio', favicon: 'https://third-party.invalid/do-not-fetch.png', logoAssets: {
  status: 'completed', folder: 'radio_12345678', webp256: `${base}station-logos/radio_12345678/logo-256.webp`,
  original: `${base}station-logos/radio_12345678/original.png`, processedAt: '2026-05-19T00:00:00Z', extra: { preserve: true },
} });
function harness(station = fixture(), invalidate?: (station: LogoVariantStation) => Promise<void>) {
  const calls = { reads: [] as string[], uploads: [] as string[], commits: 0 };
  let failUpload = false, conflict = false;
  const run = createLogoVariantBackfill({ storageConfig: () => config, invalidate,
    store: { findByIds: async () => [structuredClone(station)], appendVariants: async (_before, additions) => {
      calls.commits++; if (conflict) return false;
      station.logoAssets = { ...station.logoAssets, ...additions }; return true;
    } },
    read: async key => { calls.reads.push(key); return Buffer.from('mock-stored-webp'); },
    render: async (_buffer, sizes) => Object.fromEntries(sizes.map(size => [`webp${size}`, Buffer.from(`mock-${size}`)])),
    upload: async key => { calls.uploads.push(key); if (failUpload && key.endsWith('96.webp')) throw new Error('offline S3 failure'); return base + key; },
  });
  return { run, station, calls, fail: () => { failUpload = true; }, conflict: () => { conflict = true; } };
}

it('defaults to read-only preview without any S3, rendering or write side effects', async () => {
  const h = harness(), before = structuredClone(h.station);
  const result = await h.run(parseLogoVariantRequest({ stationIds: [id] }));
  assert.equal(result.dryRun, true); assert.equal(result.results[0].status, 'eligible');
  assert.deepEqual(result.results[0].sizes, [48, 96]); assert.deepEqual(h.station, before);
  assert.deepEqual(h.calls, { reads: [], uploads: [], commits: 0 });
});
for (const value of [null, [], {}, { stationIds: [] }, { stationIds: [id, id] }, { stationIds: ['bad'] },
  { stationIds: [id.toUpperCase()] }, { stationIds: Array(11).fill(id) }, { stationIds: [id], dryRun: 'false' },
  { stationIds: [id], force: true }, { stationIds: [id], sourceUrl: 'https://evil.invalid/' }]) {
  it(`strictly rejects malformed or broad input ${JSON.stringify(value)}`, () => assert.throws(() => parseLogoVariantRequest(value)));
}
it('appends only48/96 in unique paths while preserving existing assets and favicon', async () => {
  const h = harness(), before = structuredClone(h.station);
  const result = await h.run({ stationIds: [id], dryRun: false });
  assert.equal(result.updated, 1); assert.equal(h.calls.reads[0], 'station-logos/radio_12345678/logo-256.webp');
  for (const key of h.calls.uploads) assert.match(key, /^station-logos\/radio_12345678\/variants\/[a-f0-9-]{36}\/logo-(48|96)\.webp$/);
  assert.deepEqual({ ...h.station.logoAssets, webp48: undefined, webp96: undefined }, { ...before.logoAssets, webp48: undefined, webp96: undefined });
  assert.equal(h.station.favicon, before.favicon);
  const again = await h.run({ stationIds: [id], dryRun: false });
  assert.equal(again.updated, 0); assert.equal(again.results[0].status, 'skipped'); assert.equal(h.calls.reads.length, 1);
  const other = harness(); await other.run({ stationIds: [id], dryRun: false });
  assert.ok(other.calls.uploads.every(key => !h.calls.uploads.includes(key)));
});
it('fills only the missing size and retains an already-published small sibling', async () => {
  const station = fixture(); station.logoAssets!.webp48 = 'https://preserve.invalid/existing.webp';
  const h = harness(station); await h.run({ stationIds: [id], dryRun: false });
  assert.equal(h.calls.uploads.length, 1); assert.match(h.calls.uploads[0], /logo-96.webp$/);
  assert.equal(station.logoAssets!.webp48, 'https://preserve.invalid/existing.webp');
});
it('cache invalidation runs only after a commit and a cache failure never misreports the committed update', async () => {
  let calls = 0;
  const h = harness(fixture(), async () => { calls++; throw new Error('offline cache'); });
  await h.run({ stationIds: [id], dryRun: true }); assert.equal(calls, 0);
  const result = await h.run({ stationIds: [id], dryRun: false });
  assert.equal(calls, 1); assert.equal(result.updated, 1); assert.equal(result.results[0].status, 'updated');
  assert.equal(result.results[0].cacheRefresh, 'warning'); assert.ok(h.station.logoAssets!.webp96);
  const conflict = harness(fixture(), async () => { calls++; }); conflict.conflict();
  await conflict.run({ stationIds: [id], dryRun: false }); assert.equal(calls, 1);
});
for (const kind of ['upload failure', 'concurrent change']) it(`${kind} leaves every working metadata field untouched`, async () => {
  const h = harness(), before = structuredClone(h.station);
  kind === 'upload failure' ? h.fail() : h.conflict();
  const result = await h.run({ stationIds: [id], dryRun: false });
  assert.equal(result.updated, 0); assert.equal(result.results[0].status, kind === 'upload failure' ? 'failed' : 'conflict');
  assert.deepEqual(h.station, before); assert.equal(h.calls.commits, kind === 'upload failure' ? 0 : 1);
});
for (const replacement of [
  'http://offline-logos.s3.eu-north-1.amazonaws.com/station-logos/radio_12345678/logo-256.webp',
  `${base}station-logos/radio_12345678/logo-256.webp?x=1`, `${base}station-logos/radio_12345678/logo-256.webp#x`,
  `${base}station-logos/radio_12345678/../other/logo-256.webp`, `${base}station-logos/radio_12345678%2Flogo-256.webp`,
  'https://offline-logos.s3.eu-north-1.amazonaws.com.evil.invalid/station-logos/radio_12345678/logo-256.webp',
  'https://user@offline-logos.s3.eu-north-1.amazonaws.com/station-logos/radio_12345678/logo-256.webp',
  'https://offline-logos.s3.eu-north-1.amazonaws.com:443/station-logos/radio_12345678/logo-256.webp',
]) it(`rejects non-exact stored S3 source ${replacement}`, () => {
  const station = fixture(); station.logoAssets!.webp256 = replacement; assert.equal(logoVariantCandidate(station, config), null);
});
it('does not touch failed/pending logos or a missing station', async () => {
  for (const status of ['failed', 'pending', 'processing']) {
    const station = fixture(); station.logoAssets!.status = status;
    const h = harness(station); const result = await h.run({ stationIds: [id], dryRun: false });
    assert.equal(result.results[0].status, 'skipped'); assert.deepEqual(h.calls.reads, []);
  }
  assert.equal((await harness().run({ stationIds: ['aaaaaaaaaaaaaaaaaaaaaaaa'], dryRun: false })).results[0].status, 'skipped');
});
it('real Sharp output retains transparency and exact48/96 geometry without changing its source', async () => {
  const source = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 30, g: 60, b: 90, alpha: 0.5 } } }).webp({ lossless: true }).toBuffer();
  const original = Buffer.from(source), result = await renderSmallLogoVariants(source, [48, 96]);
  for (const size of [48, 96]) {
    const meta = await sharp(result[`webp${size}`]).metadata();
    assert.equal(meta.width, size); assert.equal(meta.height, size); assert.equal(meta.hasAlpha, true); assert.equal(meta.format, 'webp');
    const raw = await sharp(result[`webp${size}`]).raw().toBuffer(); assert.equal(raw[3], 128);
  }
  assert.deepEqual(source, original);
});
it('rejects malformed, nonsquare, excessive pixel and non-WebP source data', async () => {
  await assert.rejects(renderSmallLogoVariants(Buffer.from('<svg>bad</svg>'), [48]));
  for (const [width, height, format] of [[256, 255, 'webp'], [512, 512, 'webp'], [256, 256, 'png']] as const) {
    const source = await sharp({ create: { width, height, channels: 4, background: 'red' } }).toFormat(format).toBuffer();
    await assert.rejects(renderSmallLogoVariants(source, [48]));
  }
});

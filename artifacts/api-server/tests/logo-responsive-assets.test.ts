import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { after, beforeEach, it, mock } from 'node:test';

// Entire storage/database boundary is fake. No S3, external image request,
// local output directory, or PostgreSQL write is permitted in this suite.
mock.method(fs, 'access', async () => undefined);
const writes: { key: string; type: string; buffer: Buffer }[] = [];
const commits: any[] = [];
let failSize = '', format = 'png', claimAllowed = true;
const image = Buffer.from('offline-original-image');
const catalog = {
  claimLogo: async () => claimAllowed ? { favicon: 'https://source.example.invalid/logo.png' } : null,
  update: async (filter: any, update: any) => { commits.push({ filter, update }); return { matchedCount: 1 }; },
};
mock.module('../src/data/postgres-catalog-store', { namedExports: { pgCatalog: () => catalog } });
mock.module('../src/services/s3-storage', { namedExports: {
  isS3Configured: () => true,
  deleteFolderFromS3: async () => { throw new Error('Deletion is forbidden'); },
  uploadToS3: async (key: string, buffer: Buffer, type: string) => {
    if (failSize && key.endsWith(failSize)) throw new Error('simulated upload failure');
    writes.push({ key, buffer, type });
    return `https://storage.example.invalid/${key}`;
  },
} });
const { logoProcessor } = await import('../src/services/logo-processor');
mock.method(logoProcessor as any, 'isValidImageBuffer', async () => ({ valid: true, format }));
mock.method(logoProcessor as any, 'downloadImageWithRetry', async () => ({ buffer: image }));
mock.method(logoProcessor as any, 'safeProcessImage', async (_buffer: Buffer, size: number) => Buffer.from(`webp-${size}`));
beforeEach(() => { writes.length = 0; commits.length = 0; failSize = ''; format = 'png'; claimAllowed = true; });
after(() => mock.restoreAll());

for (const fromUrl of [false, true]) it(`publishes all actual resolutions with correct original MIME (${fromUrl ? 'download' : 'upload'})`, async () => {
  const result = fromUrl
    ? await logoProcessor.processFromUrl('radio', 'radio', 'https://source.example.invalid/misleading.jpg')
    : await logoProcessor.processFromBuffer('radio', 'radio', image, 'misleading.jpg');
  assert.equal(result.success, true);
  assert.deepEqual(writes.map(w => w.key.split('/').at(-1)), ['original.png', 'logo-48.webp', 'logo-96.webp', 'logo-256.webp']);
  assert.equal(writes[0].type, 'image/png'); assert.equal(writes[0].buffer, image);
  assert.deepEqual(writes.slice(1).map(w => w.type), Array(3).fill('image/webp'));
  const saved = commits.at(-1).update.$set;
  for (const size of [48, 96, 256]) assert.ok(saved.logoAssets[`webp${size}`].endsWith(`/logo-${size}.webp`));
  assert.equal(saved.logoAssets.status, 'completed'); assert.equal(saved.favicon, saved.logoAssets.webp256);
  assert.equal(commits.at(-1).filter['logoAssets.operationId'], saved.logoAssets.operationId);
});

for (const [detected, extension, type] of [['jpeg', 'jpg', 'image/jpeg'], ['webp', 'webp', 'image/webp'], ['gif', 'gif', 'image/gif'], ['tiff', 'tiff', 'image/tiff'], ['avif', 'avif', 'image/avif'], ['heif', 'heif', 'image/heif'], ['ico', 'ico', 'image/x-icon']]) {
  it(`matches validated ${detected} bytes to original extension and MIME`, async () => {
    format = detected;
    assert.equal((await logoProcessor.processFromBuffer('radio', 'radio', image, 'untrusted.png')).success, true);
    assert.ok(writes[0].key.endsWith(`/original.${extension}`)); assert.equal(writes[0].type, type);
  });
}

it('uses new operation-specific keys on every job and does not claim missing resolutions complete', async () => {
  await logoProcessor.processFromBuffer('radio', 'radio', image, 'logo.png');
  const firstKeys = writes.map(w => w.key);
  writes.length = 0; commits.length = 0;
  failSize = 'logo-96.webp';
  assert.equal((await logoProcessor.processFromBuffer('radio', 'radio', image, 'logo.png')).success, false);
  assert.ok(writes.every(w => !firstKeys.includes(w.key)));
  assert.ok(commits.every(c => c.update.$set?.logoAssets?.status !== 'completed'));
  assert.equal(commits.at(-1).update.$set['logoAssets.status'], 'failed');
});

it('a lost operation claim never uploads any image', async () => {
  claimAllowed = false;
  assert.equal((await logoProcessor.processFromBuffer('radio', 'radio', image, 'logo.png')).success, false);
  assert.equal(writes.length, 0); assert.equal(commits.length, 0);
});

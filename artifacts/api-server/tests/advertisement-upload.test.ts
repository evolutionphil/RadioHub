import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import sharp from 'sharp';

let configured = true;
let storageFails = false;
const uploads: Array<{ key: string; buffer: Buffer; contentType: string }> = [];
mock.module('../src/services/s3-storage', { namedExports: {
  isS3Configured: () => configured,
  uploadToS3: async (key: string, buffer: Buffer, contentType: string) => {
    if (storageFails) throw new Error('Injected S3 failure');
    uploads.push({ key, buffer: Buffer.from(buffer), contentType });
    return `https://bucket.s3.invalid/${key}`;
  },
} });
const { registerAdvertisementUploadRoute } = await import('../src/routes/advertisement-upload');

describe('Persistent advertisement image upload', () => {
  let directory: string;
  let productionUrl: string, developmentUrl: string;
  let png: Buffer;
  const servers: Server[] = [];
  const requireAdmin: express.RequestHandler = (req, res, next) => {
    if (req.headers['x-test-admin'] === 'yes') next();
    else res.status(401).json({ error: 'Admin authentication required' });
  };
  before(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'radiohub-ad-upload-test-'));
    for (const production of [true, false]) {
      const app = express();
      registerAdvertisementUploadRoute(app, requireAdmin, { production, uploadsDirectory: directory });
      const server = await new Promise<Server>(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      });
      servers.push(server);
      const url = `http://127.0.0.1:${(server.address() as any).port}`;
      if (production) productionUrl = url; else developmentUrl = url;
    }
    png = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#ff00aa' } }).png().toBuffer();
  });
  beforeEach(() => { configured = true; storageFails = false; uploads.length = 0; });
  after(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    mock.restoreAll();
    assert.equal(path.dirname(directory), tmpdir());
    assert.match(path.basename(directory), /^radiohub-ad-upload-test-/);
    await rm(directory, { recursive: true, force: true });
  });
  async function upload(buffer: Buffer | null, mime = 'image/png', filename = 'image.png', url = productionUrl, authenticated = true) {
    const form = new FormData();
    if (buffer) form.append('image', new Blob([new Uint8Array(buffer)], { type: mime }), filename);
    return fetch(url + '/api/admin/advertisements/upload', { method: 'POST', body: form,
      headers: authenticated ? { 'x-test-admin': 'yes' } : {} });
  }
  it('registers immediately and stores actual supported image bytes with canonical keys and MIME types', async () => {
    for (const [format, mime, extension] of [['png', 'image/png', 'png'], ['jpeg', 'image/jpeg', 'jpg'], ['webp', 'image/webp', 'webp']] as const) {
      const input = await sharp(png).toFormat(format).toBuffer();
      const response = await upload(input, mime, '../../untrusted-name.html');
      assert.equal(response.status, 200);
      const result = await response.json() as any;
      assert.deepEqual(Object.keys(result), ['imageUrl']);
      assert.match(result.imageUrl, new RegExp(`^https://bucket\\.s3\\.invalid/advertisements/ad-[a-f0-9-]+\\.${extension}$`));
      const saved = uploads.at(-1)!;
      assert.equal(saved.contentType, mime); assert.deepEqual(saved.buffer, input);
    }
    assert.deepEqual(await readdir(directory), [], 'Configured storage must not write ephemeral files');
  });
  it('preserves every frame and original bytes of an animated GIF', async () => {
    const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]);
    const gif = await sharp(pixels, { raw: { width: 1, height: 2, channels: 4, pageHeight: 1 } }).gif({ delay: [100, 150], loop: 0 }).toBuffer();
    assert.equal((await sharp(gif, { animated: true }).metadata()).pages, 2);
    const response = await upload(gif, 'image/gif', 'animation.gif');
    assert.equal(response.status, 200); assert.deepEqual(uploads[0].buffer, gif);
    assert.equal(uploads[0].contentType, 'image/gif');
  });
  it('rejects empty, spoofed, unsupported and truncated images without storage writes', async () => {
    for (const [input, mime] of [
      [null, 'image/png'], [Buffer.from('<html>Not an image</html>'), 'image/png'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'), 'image/svg+xml'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'), 'image/png'],
      [png.subarray(0, 40), 'image/png'],
    ] as const) assert.equal((await upload(input, mime)).status, 400);
    assert.equal(uploads.length, 0);
  });
  it('enforces both compressed bytes and decoded pixel limits', async () => {
    assert.equal((await upload(Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
    const excessive = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: 'white' } }).png().toBuffer();
    assert.ok(excessive.length < 5 * 1024 * 1024);
    assert.equal((await upload(excessive)).status, 400); assert.equal(uploads.length, 0);
  });
  it('requires normal admin authentication before parsing or storing uploads', async () => {
    assert.equal((await upload(png, 'image/png', 'image.png', productionUrl, false)).status, 401);
    assert.equal(uploads.length, 0);
  });
  it('fails closed in production without S3 and never reports a transient storage failure as success', async () => {
    configured = false;
    assert.equal((await upload(png)).status, 503);
    configured = true; storageFails = true;
    const failure = await upload(png); assert.equal(failure.status, 503);
    assert.equal((await failure.json() as any).imageUrl, undefined);
    assert.equal(uploads.length, 0); assert.deepEqual(await readdir(directory), []);
  });
  it('retains a functional local-only fallback for development', async () => {
    configured = false;
    const response = await upload(png, 'image/png', 'image.png', developmentUrl);
    assert.equal(response.status, 200); const result = await response.json() as any;
    assert.match(result.imageUrl, /^\/uploads\/ad-[a-f0-9-]+\.png$/);
    assert.deepEqual(await readFile(path.join(directory, path.basename(result.imageUrl))), png);
    const served = await fetch(developmentUrl + result.imageUrl);
    assert.equal(served.status, 200); assert.match(served.headers.get('content-type') || '', /^image\/png/);
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), png); assert.equal(uploads.length, 0);
  });
});

import assert from 'node:assert/strict';
import { beforeEach, it, mock } from 'node:test';
import { Readable } from 'node:stream';
process.env.AWS_BUCKET_NAME = 'offline-logos'; process.env.AWS_REGION = 'eu-north-1';
process.env.AWS_ACCESS_KEY_ID = 'offline-key'; process.env.AWS_SECRET_ACCESS_KEY = 'offline-secret';
const calls: any[] = []; let response: any;
class Command { constructor(public input: any) {} }
mock.module('@aws-sdk/client-s3', { namedExports: {
  S3Client: class { async send(command: any, options: any) { calls.push({ command, options }); return response; } },
  GetObjectCommand: Command, PutObjectCommand: Command, DeleteObjectCommand: Command, DeleteObjectsCommand: Command,
} });
const { readLogoVariantSource, uploadLogoVariant } = await import('../src/services/s3-storage');
beforeEach(() => { calls.length = 0; response = { Body: Readable.from([Buffer.from('webp')]), ContentType: 'image/webp', ContentLength: 4 }; });
const sourceKey = 'station-logos/radio_12345678/logo-256.webp';
const variantKey = 'station-logos/radio_12345678/variants/12345678-1234-1234-1234-123456789abc/logo-96.webp';
const signal = () => AbortSignal.timeout(1000);
it('reads by configured S3 Bucket/Key only with an abort signal, never fetches arbitrary URLs', async () => {
  assert.equal((await readLogoVariantSource(sourceKey, signal())).toString(), 'webp');
  assert.deepEqual(calls[0].command.input, { Bucket: 'offline-logos', Key: sourceKey }); assert.ok(calls[0].options.abortSignal);
});
for (const key of ['https://evil.invalid/image', '../original.png', 'station-logos/radio/../../logo-256.webp', 'station-logos/radio/original.png']) {
  it(`refuses source key ${key} before SDK access`, async () => { await assert.rejects(readLogoVariantSource(key, signal())); assert.equal(calls.length, 0); });
}
it('rejects oversized declared content and oversized streamed content', async () => {
  response.ContentLength = 2 * 1024 * 1024 + 1; await assert.rejects(readLogoVariantSource(sourceKey, signal()));
  response = { Body: Readable.from([Buffer.alloc(2 * 1024 * 1024), Buffer.from('x')]), ContentType: 'image/webp' };
  await assert.rejects(readLogoVariantSource(sourceKey, signal())); assert.equal(response.Body.destroyed, true);
});
it('rejects wrong MIME and empty bodies', async () => {
  response.ContentType = 'text/html'; await assert.rejects(readLogoVariantSource(sourceKey, signal()));
  response = { Body: Readable.from([]), ContentType: 'image/webp' }; await assert.rejects(readLogoVariantSource(sourceKey, signal()));
});
it('publishes only small variants with conditional create and immutable cache headers', async () => {
  const url = await uploadLogoVariant(variantKey, Buffer.from('webp'), signal());
  assert.equal(url, `https://offline-logos.s3.eu-north-1.amazonaws.com/${variantKey}`);
  assert.equal(calls[0].command.input.IfNoneMatch, '*'); assert.equal(calls[0].command.input.ContentType, 'image/webp');
  assert.equal(calls[0].command.input.CacheControl, 'public, max-age=31536000, immutable');
});
for (const key of [sourceKey, variantKey.replace('96.webp', '256.webp'), variantKey.replace('logo-96.webp', 'original.webp')]) {
  it(`forbids overwriting original or256 key ${key}`, async () => { await assert.rejects(uploadLogoVariant(key, Buffer.from('x'), signal())); assert.equal(calls.length, 0); });
}

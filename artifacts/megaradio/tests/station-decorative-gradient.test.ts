import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { test } from 'vitest';

// Decode non-interlaced RGBA PNG scanlines so this byte-preservation check
// does not add an image library to the frontend. PNG filters are lossless.
function decodeRgbaPng(file: Buffer) {
  assert.equal(file.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let width = 0, height = 0;
  const compressed: Buffer[] = [];
  const colorMetadata: Record<string, Buffer> = {};
  for (let offset = 8; offset < file.length;) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.deepEqual([...data.subarray(8)], [8, 6, 0, 0, 0], '8-bit non-interlaced RGBA required');
    }
    if (type === 'IDAT') compressed.push(data);
    if (['sRGB', 'gAMA', 'iCCP', 'cHRM'].includes(type)) colorMetadata[type] = data;
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed)), stride = width * 4;
  assert.equal(raw.length, height * (stride + 1));
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const offset = y * stride + x;
      const left = x >= 4 ? pixels[offset - 4] : 0;
      const up = y ? pixels[offset - stride] : 0;
      const upperLeft = y && x >= 4 ? pixels[offset - stride - 4] : 0;
      const p = left + up - upperLeft;
      const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : a <= b && a <= c ? left : b <= c ? up : upperLeft;
      pixels[offset] = (raw[y * (stride + 1) + x + 1] + prediction) & 255;
    }
  }
  return { width, height, pixels, colorMetadata };
}

test('compressed station glow retains every original RGBA pixel and saves at least25percent', async () => {
  // Derivative: sharp(original).png({compressionLevel:9, adaptiveFiltering:false, palette:false}).
  // Copy original non-IDAT chunks unchanged, including sRGB/gAMA color metadata.
  // No palette, resize, quantization, color conversion, or art regeneration.
  const original = await readFile(path.resolve(import.meta.dirname, '../../../attached_assets/bg-gradient.png'));
  const optimized = await readFile(path.resolve(import.meta.dirname, '../../../attached_assets/bg-gradient.lossless.png'));
  const a = decodeRgbaPng(original), b = decodeRgbaPng(optimized);
  assert.equal(a.width, 704); assert.equal(a.height, 351);
  assert.deepEqual(b, a);
  assert.ok(optimized.length < original.length * 0.75);
});

test('station glow stays decorative with the same desktop-only square stretch and coordinates', async () => {
  const source = await readFile(path.resolve(import.meta.dirname, '../src/pages/stations/[id].tsx'), 'utf8');
  assert.match(source, /import bgGradient from "@assets\/bg-gradient\.lossless\.png"/);
  const decoration = source.match(/<div\s+aria-hidden="true"\s+className="hidden md:block absolute pointer-events-none w-\[521px\] h-\[521px\]"\s+style=\{\{([\s\S]*?)\}\}\s*\/>/);
  assert.ok(decoration);
  assert.match(decoration[1], /top: '-41px'/);
  assert.match(decoration[1], /left: '-64px'/);
  assert.match(decoration[1], /opacity: 1/);
  assert.match(decoration[1], /backgroundImage: `url\(\$\{bgGradient\}\)`/);
  assert.match(decoration[1], /backgroundSize: '100% 100%'/);
  assert.match(decoration[1], /backgroundRepeat: 'no-repeat'/);
  assert.doesNotMatch(source, /src=\{bgGradient\}/);
});

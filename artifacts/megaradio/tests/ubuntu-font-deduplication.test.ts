import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'vitest';
import { brotliDecompressSync } from 'node:zlib';

// Read the WOFF2 directory and its Brotli stream; glyph reconstruction is not
// needed to prove that the two transformed outline/layout tables are identical.
// Directory tags/transform rules: https://www.w3.org/TR/WOFF2/#table_dir_format
const tableTags = ['cmap','head','hhea','hmtx','maxp','name','OS/2','post','cvt ','fpgm','glyf','loca','prep','CFF ','VORG','EBDT','EBLC','gasp','hdmx','kern','LTSH','PCLT','VDMX','vhea','vmtx','BASE','GDEF','GPOS','GSUB','EBSC','JSTF','MATH','CBDT','CBLC','COLR','CPAL','SVG ','sbix','acnt','avar','bdat','bloc','bsln','cvar','fdsc','feat','fmtx','fvar','gvar','hsty','just','lcar','mort','morx','opbd','prop','trak','Zapf','Silf','Glat','Gloc','Feat','Sill'];
function fontTables(file: Buffer): Map<string, Buffer> {
  assert.equal(file.toString('ascii',0,4),'wOF2');
  assert.notEqual(file.toString('ascii',4,8),'ttcf');
  let offset = 48;
  const base128 = () => {
    let value = 0;
    for (let i=0;i<5;i++) {
      const byte=file[offset++];
      assert.ok(byte !== undefined && !(i===0 && byte===0x80));
      value=value*128+(byte&127);
      assert.ok(value<=0xffffffff);
      if (!(byte&128)) return value;
    }
    throw new Error('Invalid UIntBase128');
  };
  const entries: Array<{tag:string;length:number}> = [];
  for (let i=0;i<file.readUInt16BE(12);i++) {
    const flags=file[offset++];
    const tag=(flags&63)===63?file.toString('ascii',offset,offset+=4):tableTags[flags&63];
    const originalLength=base128(), version=flags>>6;
    const transformed=['glyf','loca'].includes(tag)?version===0:version!==0;
    entries.push({tag,length:transformed?base128():originalLength});
  }
  const raw=brotliDecompressSync(file.subarray(offset,offset+file.readUInt32BE(20)));
  offset=0;
  const tables=new Map<string,Buffer>();
  for (const entry of entries) {
    tables.set(entry.tag,raw.subarray(offset,offset+entry.length));
    offset+=entry.length;
  }
  assert.equal(offset,raw.length);
  return tables;
}

function unicodePoints(cmap: Buffer): Set<number> {
  const points = new Set<number>();
  for (let record=0;record<cmap.readUInt16BE(2);record++) {
    const start=cmap.readUInt32BE(8+record*8), format=cmap.readUInt16BE(start);
    if (format===4) {
      const count=cmap.readUInt16BE(start+6)/2, ends=start+14, starts=ends+count*2+2,
        deltas=starts+count*2, offsets=deltas+count*2;
      for (let segment=0;segment<count;segment++) {
        const first=cmap.readUInt16BE(starts+segment*2), last=cmap.readUInt16BE(ends+segment*2);
        for (let point=first;point<=last && point!==0xffff;point++) {
          const offset=cmap.readUInt16BE(offsets+segment*2), delta=cmap.readInt16BE(deltas+segment*2);
          let glyph=offset ? cmap.readUInt16BE(offsets+segment*2+offset+(point-first)*2) : point;
          if (!offset || glyph) glyph=(glyph+delta)&0xffff;
          if (glyph) points.add(point);
        }
      }
    } else if (format===12) {
      for (let group=0;group<cmap.readUInt32BE(start+12);group++) {
        const offset=start+16+group*12;
        for (let point=cmap.readUInt32BE(offset);point<=cmap.readUInt32BE(offset+4);point++) points.add(point);
      }
    }
  }
  return points;
}

function cssPoints(face: string): Set<number> {
  const range=/unicode-range:\s*([^;]+);/.exec(face)?.[1];
  assert.ok(range,'Each subset must declare its exact Unicode coverage');
  const points=new Set<number>();
  for (const part of range.split(',')) {
    const match=/^\s*U\+([0-9a-f]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    assert.ok(match,`Invalid Unicode range ${part}`);
    for (let point=parseInt(match[1],16);point<=parseInt(match[2]||match[1],16);point++) points.add(point);
  }
  return points;
}

test('original Ubuntu 600 and 700 have byte-identical glyphs, Unicode coverage, layout and metrics', async () => {
  const files=await Promise.all([600,700].map(weight=>readFile(path.resolve(import.meta.dirname,`../public/fonts/ubuntu-${weight}.woff2`))));
  const [a,b]=files.map(fontTables);
  assert.deepEqual([...a.keys()],[...b.keys()]);
  for (const required of ['cmap','glyf','hmtx','hhea','OS/2','GPOS','GSUB']) assert.ok(a.has(required));
  for (const [tag,value] of a) {
    const left=Buffer.from(value),right=Buffer.from(b.get(tag)!);
    if (tag==='head') {
      // Only non-rendering checksumAdjustment and modified timestamp differ.
      for (const data of [left,right]) { data.fill(0,8,12); data.fill(0,28,36); }
    }
    assert.deepEqual(left,right,`Font table ${tag} must remain equivalent before sharing the URL`);
  }
});

test('main and critical CSS preserve all original Unicode coverage, weights and local names with disjoint subsets', async () => {
  for (const filename of ['../src/index.css','../src/styles/critical.css']) {
    const css=await readFile(path.resolve(import.meta.dirname,filename),'utf8');
    const faces=[...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(match=>match[1]);
    for (const weight of [400,500,600,700]) {
      const matching=faces.filter(value=>value.includes("font-family: 'Ubuntu'") && new RegExp(`font-weight:\\s*${weight};`).test(value));
      assert.equal(matching.length,5,`Missing Ubuntu subsets for ${weight} in ${filename}`);
      const assetWeight=weight===600?700:weight;
      const original=fontTables(await readFile(path.resolve(import.meta.dirname,`../public/fonts/ubuntu-${assetWeight}.woff2`)));
      const coverage=unicodePoints(original.get('cmap')!);
      const union=new Set<number>();
      for (const suffix of ['-latin','-latin-ext','-greek','-cyrillic','']) {
        const url=`/fonts/ubuntu-${assetWeight}${suffix}.woff2`;
        const face=matching.find(value=>value.includes(url));
        assert.ok(face,`Missing ${url}`);
        assert.match(face,/font-display:\s*swap;/);
        if (filename.endsWith('index.css') && weight===600) assert.match(face,/local\('Ubuntu SemiBold'\)/);
        const points=cssPoints(face);
        const font=fontTables(await readFile(path.resolve(import.meta.dirname,`../public${url}`)));
        const actual=unicodePoints(font.get('cmap')!);
        if (suffix) assert.deepEqual(points,actual,`${url} must match its CSS range exactly`);
        for (const point of points) {
          assert.ok(actual.has(point),`Missing U+${point.toString(16)} in ${url}`);
          assert.ok(!union.has(point),`Overlapping U+${point.toString(16)} in ${filename}`);
          union.add(point);
        }
        assert.deepEqual(font.get('hhea')!.subarray(0,10),original.get('hhea')!.subarray(0,10),'Vertical metrics must match');
        assert.equal(font.get('head')!.readUInt16BE(18),original.get('head')!.readUInt16BE(18),'Units per em must match');
        for (const tag of ['cvt ','fpgm','prep']) assert.deepEqual(font.get(tag),original.get(tag),`${tag} hinting must match`);
        for (const tag of ['GSUB','GPOS']) assert.ok(font.has(tag),`Shaping table ${tag} must be retained`);
      }
      assert.deepEqual(union,coverage,`Original language and symbol coverage must be unchanged for ${weight}`);
    }
    assert.doesNotMatch(css,/ubuntu-600\.woff2/);
  }
});

test('Latin startup fonts use less than 40 percent of the original transfer without replacing originals', async () => {
  let fullBytes=0,subsetBytes=0;
  for (const weight of [400,500,700]) {
    fullBytes+=(await readFile(path.resolve(import.meta.dirname,`../public/fonts/ubuntu-${weight}.woff2`))).length;
    const latin=await readFile(path.resolve(import.meta.dirname,`../public/fonts/ubuntu-${weight}-latin.woff2`));
    subsetBytes+=latin.length;
    const points=unicodePoints(fontTables(latin).get('cmap')!);
    for (const char of 'Mega Radio 0123456789 äöüßéàñç €…') assert.ok(points.has(char.codePointAt(0)!));
  }
  assert.ok(subsetBytes<fullBytes*0.4,`${subsetBytes} must stay below 40% of ${fullBytes}`);
});

test('both SPA and SSR preload each small Latin font once, never full fonts or the unused duplicate', async () => {
  for (const filename of ['../index.html','../../api-server/src/index-web.ts']) {
    const source=await readFile(path.resolve(import.meta.dirname,filename),'utf8');
    assert.doesNotMatch(source,/ubuntu-600\.woff2/);
    for (const weight of [400,500,700]) {
      assert.equal((source.match(new RegExp(`<link[^>]+href="/fonts/ubuntu-${weight}-latin\\.woff2"[^>]*>`,'g'))||[]).length,1);
      assert.doesNotMatch(source,new RegExp(`<link[^>]+href="/fonts/ubuntu-${weight}\\.woff2"[^>]*>`));
    }
  }
});

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

test('main and critical CSS keep all weights/local names, sharing only the duplicate bold URL', async () => {
  for (const filename of ['../src/index.css','../src/styles/critical.css']) {
    const css=await readFile(path.resolve(import.meta.dirname,filename),'utf8');
    const faces=[...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(match=>match[1]);
    for (const weight of [400,500,600,700]) {
      const face=faces.find(value=>value.includes("font-family: 'Ubuntu'") && new RegExp(`font-weight:\\s*${weight};`).test(value));
      assert.ok(face,`Missing Ubuntu ${weight} in ${filename}`);
      assert.ok(face.includes(`/fonts/ubuntu-${weight===600?700:weight}.woff2`));
      assert.match(face,/font-display:\s*swap;/);
      if (filename.endsWith('index.css') && weight===600) assert.match(face,/local\('Ubuntu SemiBold'\)/);
    }
    assert.doesNotMatch(css,/ubuntu-600\.woff2/);
  }
});

test('both SPA and SSR preload the shared bold font once, never the unused duplicate', async () => {
  for (const filename of ['../index.html','../../api-server/src/index-web.ts']) {
    const source=await readFile(path.resolve(import.meta.dirname,filename),'utf8');
    assert.doesNotMatch(source,/ubuntu-600\.woff2/);
    assert.equal((source.match(/<link[^>]+href="\/fonts\/ubuntu-700\.woff2"[^>]*>/g)||[]).length,1);
  }
});

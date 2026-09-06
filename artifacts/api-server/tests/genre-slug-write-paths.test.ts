import { test,mock,before,after,beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { createNativePostgresFixture } from './helpers/native-postgres-fixture';
import { normalizeGenreSlug,SAFE_GENRE_SLUG_RE } from '../src/seo/genre-slug';

let fixture:Awaited<ReturnType<typeof createNativePostgresFixture>>,server:Server,base:string,cacheClears=0;
mock.module('../src/cache',{defaultExport:{
  clearByPattern:async()=>{cacheClears++;},get:async()=>null,set:async()=>{},delete:async()=>{},
},namedExports:{CacheKeys:{},invalidateSocialCacheForUser:async()=>{}}});
before(async()=>{
  fixture=await createNativePostgresFixture('genre_slug_write_paths');
  const {registerSlugRoutes}=await import('../src/routes/slug-routes');
  const {registerTranslationAdminRoutes}=await import('../src/routes/translation-admin-routes');
  const app=express();app.use(express.json());
  const pass=(_req:any,_res:any,next:any)=>next();
  registerSlugRoutes(app,{requireAdmin:pass});registerTranslationAdminRoutes(app,{requireAdmin:pass,requireAuth:pass});
  server=await new Promise<Server>(resolve=>{const running=app.listen(0,'127.0.0.1',()=>resolve(running));});
  base='http://127.0.0.1:'+(server.address() as any).port;
});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));if(fixture)await fixture.close();});
beforeEach(async()=>{await fixture.clear('stations','genres','users','admin_maintenance_jobs');cacheClears=0;});

test('normalizeGenreSlug: dirty inputs always yield SAFE_GENRE_SLUG_RE-compatible output (or empty)', () => {
  const cases: Array<{ input: string | null | undefined; expected?: string }> = [
    { input: 'bassline"', expected: 'bassline' },
    { input: 'R&B', expected: 'r-b' },
    { input: 'hip   hop', expected: 'hip-hop' },
    { input: '  Drum & Bass  ', expected: 'drum-bass' },
    // Accented / non-ASCII collapse to dashes (the helper does NOT
    // transliterate — that is the slugifier's job; the helper just
    // gates the result with [a-z0-9]+).
    { input: 'Café', expected: 'caf' },
    { input: 'Naïve Pop', expected: 'na-ve-pop' },
    // Leading/trailing punctuation is trimmed.
    { input: '---synthwave---', expected: 'synthwave' },
    // Pure-junk inputs normalize to '' so callers can skip them.
    { input: '', expected: '' },
    { input: '   ', expected: '' },
    { input: '!!!', expected: '' },
    { input: null, expected: '' },
    { input: undefined, expected: '' },
  ];

  for (const { input, expected } of cases) {
    const out = normalizeGenreSlug(input);
    assert.equal(out, expected, `normalizeGenreSlug(${JSON.stringify(input)}) → ${JSON.stringify(out)}`);
    if (out !== '') {
      assert.match(
        out,
        SAFE_GENRE_SLUG_RE,
        `normalizeGenreSlug(${JSON.stringify(input)}) produced "${out}" which fails SAFE_GENRE_SLUG_RE`,
      );
    }
  }
});

test('normalizeGenreSlug: every output passes the GenreSchema validator regex (fuzz)', () => {
  // Spray a wider net of dirty inputs to catch a future regex tweak
  // that would silently let an unsafe character through. Anything
  // non-empty MUST match SAFE_GENRE_SLUG_RE — that is the contract
  // the GenreSchema validator depends on.
  const fuzzInputs = [
    'AC/DC',
    'foo_bar',
    'foo.bar',
    'foo+bar',
    'foo bar baz',
    '12-inch',
    '----',
    'Über-Pop',
    '한국어 락',
    '<script>alert(1)</script>',
    '🎸 metal 🤘',
  ];
  for (const input of fuzzInputs) {
    const out = normalizeGenreSlug(input);
    if (out === '') continue;
    assert.match(out, SAFE_GENRE_SLUG_RE, `"${input}" → "${out}" violates SAFE_GENRE_SLUG_RE`);
  }
});

test('POST /api/generate-all-slugs commits only non-empty safe genre slugs to PostgreSQL',async()=>{
  const names=['Rock','R&B','bassline"','hip   hop','!!!','   ','<script>'];
  for(const [i,name] of names.entries())await fixture.insert('genres',{_id:'g'+i,name,slug:null,isDiscoverable:false});
  const response=await fetch(base+'/api/generate-all-slugs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({regenerateAll:true})});
  assert.equal(response.status,200);
  const deadline=Date.now()+5000;
  while(cacheClears<4){
    if(Date.now()>deadline)throw new Error('SQL slug job did not complete its cache invalidation');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  const rows=(await fixture.pool.query('SELECT id,slug FROM genres ORDER BY id')).rows;
  assert.equal(rows.length,names.length);
  for(const row of rows){assert.equal(typeof row.slug,'string');assert.notEqual(row.slug,'');assert.match(row.slug,SAFE_GENRE_SLUG_RE);}
  assert.equal(new Set(rows.map(row=>row.slug)).size,rows.length,'fallback names also receive unique safe slugs');
  const jobs=(await fixture.pool.query('SELECT status FROM admin_maintenance_jobs')).rows;
  assert.equal(jobs.length,1);assert.equal(jobs[0].status,'completed');
});

test('POST /api/admin/populate-genres persists safe normalized slugs and refuses junk tags',async()=>{
  const stations=[{tags:'rock, R&B, bassline"'},{tags:'hip   hop, !!!, <script>, electronic'},{tags:'   , drum & bass'},{genre:'Café'}];
  for(const [i,station] of stations.entries())await fixture.insert('stations',{_id:'s'+i,stationuuid:'uuid-'+i,name:'Station '+i,url:'https://example.invalid/'+i,...station});
  const response=await fetch(base+'/api/admin/populate-genres',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(response.status,200);const body=await response.json() as any;
  assert.equal(body.success,true);assert.ok(body.genresCreated>0);
  const rows=(await fixture.pool.query('SELECT slug,source FROM genres')).rows;
  assert.ok(rows.length>0);
  for(const row of rows){
    assert.equal(typeof row.slug,'string');assert.notEqual(row.slug,'');assert.match(row.slug,SAFE_GENRE_SLUG_RE);
    assert.equal(row.source.slug,row.slug,'canonical column and populated metadata use the same safe slug');
  }
  const slugs=new Set(rows.map(row=>row.slug));
  for(const dirty of ['','!!!','<script>','   '])assert.ok(!slugs.has(dirty));
  for(const expected of ['rock','r-b','bassline','hip-hop','electronic','drum-bass','caf'])assert.ok(slugs.has(expected),expected+' is preserved');
});

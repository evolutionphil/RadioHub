import assert from 'node:assert/strict';
import { after,before,describe,it,mock } from 'node:test';
import { createNativePostgresFixture,type NativePostgresFixture } from './helpers/native-postgres-fixture';

let submit:()=>Promise<void>=async()=>{};
mock.module(new URL('../src/services/indexnow.ts',import.meta.url).href,{namedExports:{IndexNowService:{submitToIndexNow:async()=>{await submit();return {success:true};}}}});
mock.module(new URL('../src/seo/sitemap-manifest-builder.ts',import.meta.url).href,{namedExports:{buildAllSitemapManifests:async()=>{},extractTopCountriesFromChunk:()=>[]}});
mock.module(new URL('../src/performance-cache.ts',import.meta.url).href,{namedExports:{performanceCache:{getUrlTranslations:async()=>new Map()}}});
mock.module(new URL('../src/seo/qualified-languages.ts',import.meta.url).href,{namedExports:{getQualifiedLanguagesState:async()=>({languages:['en']}),QualifiedLanguagesUnavailableError:class extends Error{}}});

describe('Sitemap job ownership survives small pools and fails closed on session loss',{skip:!process.env.PG_TEST_DATABASE_URL},()=>{
  let fixture:NativePostgresFixture;
  let seo:typeof import('../src/data/postgres-seo-indexing-store');
  let runtime:typeof import('../src/postgres-runtime');
  before(async()=>{
    process.env.POSTGRES_POOL_MAX='1';process.env.POSTGRES_COORDINATION_POOL_MAX='1';
    fixture=await createNativePostgresFixture('seo_lock');
    seo=await import('../src/data/postgres-seo-indexing-store');runtime=await import('../src/postgres-runtime');
  });
  after(async()=>{await fixture?.close();});
  it('allows data queries while holding a separate coordination session and writes on that session',async()=>{
    await seo.withSeoJobLock('one-connection',async lock=>{
      assert.equal((await runtime.getPostgresPool().query('SELECT 1 value')).rows[0].value,1);
      await seo.pgSaveUrlSnapshot('main','one',0,['https://example.invalid/owned'],lock);
    });
    assert.deepEqual((await seo.pgGetUrlSnapshot('main','one')).urls,['https://example.invalid/owned']);
  });
  it('rejects an old lock holder after its backend is terminated and preserves the successor snapshot',async()=>{
    await assert.rejects(seo.withSeoJobLock('terminated',async lock=>{
      const pid=(await lock.client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      const lost=new Promise<void>(resolve=>lock.client.once('error',()=>resolve()));
      await fixture.pool.query('SELECT pg_terminate_backend($1)',[pid]);await lost;
      // A second connection can own the same lock after PostgreSQL releases it.
      const successor=await fixture.pool.connect();
      try{
        assert.equal((await successor.query("SELECT pg_try_advisory_lock(hashtextextended('seo-job:terminated',0)) locked")).rows[0].locked,true);
        await seo.pgSaveUrlSnapshot('main','terminated',0,['https://example.invalid/new'],{client:successor,assertOwned:()=>{}});
        await assert.rejects(seo.pgSaveUrlSnapshot('main','terminated',0,['https://example.invalid/stale'],lock),/no longer owned/);
      }finally{await successor.query("SELECT pg_advisory_unlock(hashtextextended('seo-job:terminated',0))");successor.release();}
    }),/no longer owned/);
    assert.deepEqual((await seo.pgGetUrlSnapshot('main','terminated')).urls,['https://example.invalid/new']);
    assert.equal(await seo.withSeoJobLock('terminated',async()=>true),true);
  });
  it('does not publish a sitemap baseline if its lock is lost during the external submission',async()=>{
    const build=await seo.pgWriteBuildingManifest({type:'main',language:'en',version:'lock-test',qualifiedLanguagesHash:'hash',qualifiedLanguages:['en'],chunks:[],totalUrls:0});
    await seo.pgActivateManifest(build.id,'main','en');
    const coordination=runtime.getPostgresCoordinationPool();
    const originalConnect=coordination.connect.bind(coordination);let ownedClient:any;
    coordination.connect=(async()=>{ownedClient=await originalConnect();return ownedClient;}) as typeof coordination.connect;
    submit=async()=>{
      const pid=(await ownedClient.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      const lost=new Promise<void>(resolve=>ownedClient.once('error',()=>resolve()));
      await fixture.pool.query('SELECT pg_terminate_backend($1)',[pid]);await lost;
      await seo.pgSaveUrlSnapshot('main','en',0,['https://example.invalid/successor']);
    };
    try{
      const {runSitemapDiffSubmission}=await import('../src/services/sitemap-diff-indexnow');
      await assert.rejects(runSitemapDiffSubmission({ensureManifestFresh:false}),/no longer owned/);
      assert.deepEqual((await seo.pgGetUrlSnapshot('main','en')).urls,['https://example.invalid/successor']);
      submit=async()=>{throw new Error('dry-run must not submit');};
      const dry=await runSitemapDiffSubmission({ensureManifestFresh:false,dryRun:true});assert.ok(dry.totalAdditions>0);
      assert.deepEqual((await seo.pgGetUrlSnapshot('main','en')).urls,['https://example.invalid/successor']);
    }finally{coordination.connect=originalConnect;submit=async()=>{};}
  });
});

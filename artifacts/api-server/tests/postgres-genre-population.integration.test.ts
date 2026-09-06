import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import { after,before,beforeEach,describe,it } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import { createNativePostgresFixture,type NativePostgresFixture } from './helpers/native-postgres-fixture';

describe('Set-based native genre population',{skip:!process.env.PG_TEST_DATABASE_URL},()=>{
  let fixture:NativePostgresFixture;
  let countGenres:typeof import('../src/data/postgres-translation-admin-store').pgGenrePopulationCounts;
  let pool:ReturnType<typeof import('../src/postgres-runtime').getPostgresPool>;
  let server:Server|undefined,base='';
  before(async()=>{
    fixture=await createNativePostgresFixture('genre_population');
    ({pgGenrePopulationCounts:countGenres}=await import('../src/data/postgres-translation-admin-store'));
    pool=(await import('../src/postgres-runtime')).getPostgresPool();
    const app=express();app.use(express.json());
    const auth=(req:any,res:any,next:any)=>req.headers['x-test-admin']==='allowed'?next():res.status(401).end();
    (await import('../src/routes/translation-admin-routes')).registerTranslationAdminRoutes(app,{requireAdmin:auth,requireAuth:auth});
    server=await new Promise<Server>(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    base=`http://127.0.0.1:${(server.address() as any).port}`;
  });
  beforeEach(async()=>{await fixture.clear('stations','genres');});
  after(async()=>{if(server)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));await fixture?.close();});
  const station=(name:string,tags:string|null,genre?:unknown)=>fixture.insert('stations',{name,stationuuid:randomUUID(),url:`https://example.invalid/${name}`,tags,source:{genre}});
  it('counts each station once after case/whitespace normalization across repeated tags and legacy genre',async()=>{
    await station('one',' Pop ,pop, POP, Rock, rock ',' POP ');
    await station('two','pop, Jazz','jazz');
    await station('three',null,'\t Deep House \n');
    await station('four','deep house, DEEP HOUSE','deep house');
    await station('five',' ',{unexpected:'not a genre'});
    assert.deepEqual(await countGenres(),[
      {tag:'deep house',count:2},{tag:'jazz',count:1},{tag:'pop',count:2},{tag:'rock',count:1},
    ]);
  });
  it('returns only grouped tags and counts in one query, regardless of full document size',async()=>{
    await fixture.pool.query(`INSERT INTO stations(id,station_uuid,name,url,tags_raw,source,descriptions)
      SELECT 'large-'||n,gen_random_uuid(),'Large '||n,'https://example.invalid/'||n,'pop,Pop,pop',
      jsonb_build_object('genre','POP','description',repeat('payload ',1000)),jsonb_build_object('en',repeat('details ',1000))
      FROM generate_series(1,1000) n`);
    const originalQuery=pool.query.bind(pool);let calls=0;const returnedFields:string[][]=[];
    pool.query=(async(...args:any[])=>{calls++;const result=await (originalQuery as any)(...args);returnedFields.push(result.fields.map((field:any)=>field.name));return result;}) as typeof pool.query;
    try{assert.deepEqual(await countGenres(),[{tag:'pop',count:1000}]);assert.equal(calls,1);assert.deepEqual(returnedFields,[['tag','count']]);}
    finally{pool.query=originalQuery;}
  });
  it('preserves admin endpoint authorization and slug filtering without inflating stationCount/discoverability',async()=>{
    await station('solo','Solo,Solo, ,'+ 'x'.repeat(50),'solo');
    await station('paired-a','Paired,???',null);await station('paired-b',null,'Paired');
    assert.equal((await fetch(`${base}/api/admin/populate-genres`,{method:'POST'})).status,401);
    const response=await fetch(`${base}/api/admin/populate-genres`,{method:'POST',headers:{'x-test-admin':'allowed'}});
    assert.equal(response.status,200);const result=await response.json() as any;
    assert.equal(result.genresCreated,2);assert.equal(result.tagsProcessed,3);
    assert.deepEqual((await fixture.pool.query('SELECT slug,station_count,is_discoverable FROM genres ORDER BY slug')).rows,[
      {slug:'paired',station_count:2,is_discoverable:true},{slug:'solo',station_count:1,is_discoverable:false},
    ]);
  });
  it('refreshes counts while preserving an existing curator-hidden name, visibility and metadata',async()=>{
    await fixture.insert('genres',{
      _id:'curated',name:'Hand-picked display name',slug:'hidden',isDiscoverable:false,stationCount:99,
      createdAt:new Date('2001-01-01'),updatedAt:new Date('2001-01-01'),
      source:{name:'Hand-picked display name',isDiscoverable:false,stationCount:99,updatedAt:'2001-01-01',
        description:'Curated description',manualEditFields:{name:true},custom:{retained:true}},
    });
    await station('hidden-a','Hidden');await station('hidden-b',null,'Hidden');
    await station('new','New genre');
    const before=(await fixture.pool.query("SELECT * FROM genres WHERE id='curated'")).rows[0];
    const response=await fetch(`${base}/api/admin/populate-genres`,{method:'POST',headers:{'x-test-admin':'allowed'}});
    assert.equal(response.status,200);
    const after=(await fixture.pool.query("SELECT * FROM genres WHERE id='curated'")).rows[0];
    assert.equal(after.name,before.name);assert.equal(after.is_discoverable,false);assert.equal(after.station_count,2);
    assert.equal(after.source.stationCount,2);assert.ok(after.updated_at>before.updated_at);
    assert.deepEqual(after.created_at,before.created_at);
    const metadata=({stationCount:_count,updatedAt:_updated,...rest}:any)=>rest;
    assert.deepEqual(metadata(after.source),metadata(before.source));
    assert.equal(new Date(after.source.updatedAt).getTime(),after.updated_at.getTime());
    const inserted=(await fixture.pool.query("SELECT * FROM genres WHERE slug='new-genre'")).rows[0];
    assert.equal(inserted.name,'New genre');assert.equal(inserted.station_count,1);
  });
});

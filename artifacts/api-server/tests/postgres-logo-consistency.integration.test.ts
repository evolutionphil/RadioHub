import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import pg from 'pg';

const connectionString=process.env.PG_TEST_DATABASE_URL;
describe('PostgreSQL logo source and upload fencing',{skip:!connectionString},()=>{
  const schema=`logo_fence_${process.pid}_${randomBytes(6).toString('hex')}`;
  const admin=new pg.Pool({connectionString,ssl:false,max:1});
  let pool:pg.Pool,server:Server|undefined,base='',created=false;
  let runtime:typeof import('../src/postgres-runtime');
  let catalog:import('../src/data/postgres-catalog-store').PostgresCatalogStore;
  let processor:import('../src/services/logo-processor').LogoProcessor;
  let downloadCount=0,uploadCount=0;
  let downloadHook:(()=>Promise<void>)|undefined,uploadHook:(()=>Promise<void>)|undefined;
  const image=Buffer.from('offline-image-fixture');
  before(async()=>{
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    const url=new URL(connectionString!);url.searchParams.set('options',`-c search_path=${schema},public`);
    process.env.DATABASE_URL=url.toString();process.env.POSTGRES_SSL='disable';process.env.REDIS_URL='';
    runtime=await import('../src/postgres-runtime');pool=runtime.getPostgresPool();
    const dir=path.resolve(import.meta.dirname,'../../../lib/db/migrations');
    for(const file of(await readdir(dir)).filter(file=>/^\d+.*\.sql$/.test(file)).sort())await pool.query(await readFile(path.join(dir,file),'utf8'));
    mock.module('../src/services/s3-storage',{namedExports:{
      isS3Configured:()=>true,isS3Url:(value:string)=>value.includes('.s3.'),
      uploadToS3:async(key:string)=>{uploadCount++;await uploadHook?.();return `https://offline.s3.example.invalid/${key}`;},
      deleteFolderFromS3:async()=>undefined,deleteFromS3:async()=>undefined,getS3PublicUrl:(key:string)=>`https://offline.s3.example.invalid/${key}`,
    }});
    processor=(await import('../src/services/logo-processor')).logoProcessor;
    catalog=(await import('../src/data/postgres-catalog-store')).pgCatalog();
    mock.method(processor as any,'downloadImageWithRetry',async()=>{downloadCount++;await downloadHook?.();return{buffer:image};});
    mock.method(processor as any,'isValidImageBuffer',async()=>({valid:true,format:'png'}));
    mock.method(processor as any,'safeProcessImage',async()=>image);
    const {registerAdminStationRoutes}=await import('../src/routes/admin-station-routes');
    const app=express();app.use(express.json());
    const requireAdmin=(req:any,res:any,next:any)=>req.headers['x-offline-admin']==='allowed'?next():res.status(401).json({error:'unauthorized'});
    registerAdminStationRoutes(app,{requireAdmin});
    server=await new Promise<Server>(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    base=`http://127.0.0.1:${(server.address() as any).port}`;
  });
  beforeEach(()=>{downloadCount=0;uploadCount=0;downloadHook=undefined;uploadHook=undefined;});
  after(async()=>{
    if(server)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));
    if(runtime)await runtime.closePostgres();
    try{if(created){assert.match(schema,/^logo_fence_\d+_[a-f0-9]{12}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}}
    finally{await admin.end();mock.restoreAll();}
  });
  const station=async(favicon:string|null)=>(await catalog.insertMany([{
    _id:randomBytes(12).toString('hex'),stationuuid:randomUUID(),name:'Offline Logo',slug:`logo-${randomUUID()}`,
    url:`https://stream.example.invalid/${randomUUID()}`,favicon,
  }]))[0];
  it('rejects queued URL A when URL B was saved before the claim, without downloading or uploading A',async()=>{
    const row=await station('https://example.invalid/A.png');
    await catalog.update({_id:row._id},{$set:{favicon:'https://example.invalid/B.png'}});
    const before=await catalog.findById(row._id);
    const result=await processor.processFromUrl(row._id,row.slug,'https://example.invalid/A.png');
    assert.equal(result.success,false);assert.equal(downloadCount,0);assert.equal(uploadCount,0);
    assert.deepEqual(await catalog.findById(row._id),before);
  });
  it('allows a discovered candidate different from the original favicon only with an explicit matching before-image',async()=>{
    const row=await station(null);
    const result=await processor.processFromUrl(row._id,row.slug,'https://example.invalid/discovered.png',null);
    assert.equal(result.success,true);assert.equal(downloadCount,1);
    const saved=await catalog.findById(row._id);assert.equal(saved!.logoAssets.status,'completed');assert.equal(saved!.favicon,saved!.logoAssets.webp256);
    const stale=await processor.processFromUrl(row._id,row.slug,'https://example.invalid/second-candidate.png',null);
    assert.equal(stale.success,false);assert.equal(downloadCount,1);
  });
  it('preserves a newer favicon edit made during URL download',async()=>{
    const row=await station('https://example.invalid/A.png');
    downloadHook=async()=>{await catalog.update({_id:row._id},{$set:{favicon:'https://example.invalid/midflight.png'}});};
    const result=await processor.processFromUrl(row._id,row.slug,row.favicon);
    assert.equal(result.success,false);assert.match(result.error||'',/source changed/);
    assert.equal((await catalog.findById(row._id))!.favicon,'https://example.invalid/midflight.png');
    assert.notEqual((await catalog.findById(row._id))!.logoAssets.status,'completed');
  });
  it('commits buffered upload metadata and the public S3 favicon in one fenced update',async()=>{
    const row=await station('https://example.invalid/original.png');
    const result=await processor.processFromBuffer(row._id,row.slug,image,'upload.png');
    assert.equal(result.success,true);assert.equal(downloadCount,0);
    const saved=await catalog.findById(row._id);assert.equal(saved!.favicon,saved!.logoAssets.webp256);assert.match(saved!.favicon,/^https:\/\/offline\.s3\./);
    assert.equal(saved!.logoAssets.status,'completed');assert.equal(saved!.hasCustomFavicon,true);
  });
  it('does not commit buffered upload metadata or favicon over an edit made during S3 upload',async()=>{
    const row=await station('https://example.invalid/original.png');
    uploadHook=async()=>{await catalog.update({_id:row._id},{$set:{favicon:'https://example.invalid/new-admin.png'}});};
    const result=await processor.processFromBuffer(row._id,row.slug,image,'upload.png');
    assert.equal(result.success,false);
    const saved=await catalog.findById(row._id);assert.equal(saved!.favicon,'https://example.invalid/new-admin.png');assert.notEqual(saved!.logoAssets.status,'completed');
  });
  it('does not overwrite a later edit when the upload HTTP route reads back its completed assets',async()=>{
    const row=await station('https://example.invalid/original.png');
    const original=catalog.findOne.bind(catalog);let intercepted=false;
    const readBack=mock.method(catalog,'findOne',async(filter:any,options:any)=>{
      const result=await original(filter,options);
      if(filter._id===row._id&&options?.fields?.includes('logoAssets')){
        intercepted=true;await catalog.update({_id:row._id},{$set:{favicon:'https://example.invalid/after-upload.png'}});
      }
      return result;
    });
    try{
      const form=new FormData();form.append('favicon',new Blob([image],{type:'image/png'}),'upload.png');
      const response=await fetch(`${base}/api/admin/stations/${row._id}/upload-favicon`,{method:'POST',headers:{'x-offline-admin':'allowed'},body:form});
      assert.equal(response.status,200);assert.equal((await response.json() as any).success,true);assert.equal(intercepted,true);
    }finally{readBack.mock.restore();}
    assert.equal((await catalog.findById(row._id))!.favicon,'https://example.invalid/after-upload.png');
  });
});

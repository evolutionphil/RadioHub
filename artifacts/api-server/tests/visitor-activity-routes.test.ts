import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createVisitorActivityHandlers,createVisitorPageViewHandler,registerVisitorActivityRoutes} from '../src/routes/visitor-activity-routes';
import {decodeActivityCursor,encodeActivityCursor} from '../src/data/postgres-visitor-activity';
import {PAGE_VIEW_LOCAL} from '../src/middleware/visitor-activity';
import {requireAdmin} from '../src/middleware/auth';
const id='01234567-1234-4234-8234-0123456789ab';
function response(){return {statusCode:200,body:undefined as any,headers:{} as any,locals:{} as any,
  setHeader(key:string,value:unknown){this.headers[key]=value;},status(value:number){this.statusCode=value;return this;},
  json(value:unknown){this.body=value;return this;},end(){return this;}};}
async function invoke(handler:any,query:any={},activityId=id){const res=response();await handler({query,params:{activityId}},res);return res;}
test('admin routes are behind actual requireAdmin, ingestion is public and bounded',async()=>{
  const routes:any[]=[];registerVisitorActivityRoutes({get:(...args:any[])=>routes.push(args),post:(...args:any[])=>routes.push(args)} as any,requireAdmin);
  assert.equal(routes.length,3);
  for(const route of routes.filter(r=>r[0].startsWith('/api/admin/'))){
    assert.equal(route[1],requireAdmin);let reached=false;
    for(const session of [undefined,{}]){const res=response();requireAdmin({session,method:'GET',originalUrl:route[0],headers:{}} as any,res as any,()=>{reached=true;});assert.equal(res.statusCode,401);}
    assert.equal(reached,false);
  }
  for(const file of ['index-api.ts','index-web.ts']){
    const source=await readFile(new URL(`../src/${file}`,import.meta.url),'utf8');
    assert.match(source,/app\.use\('\/api\/visitor-activity\/page-view',[\s\S]{0,300}express\.json\(\{ limit: '2kb' \}\)\)/);
    assert.match(source,/Expected JSON page view/);
  }
});
test('page-view validation accepts only sanitized route and category, unknown skips; DNT/admin are silent',async()=>{
  const handler=createVisitorPageViewHandler();
  const request=async(body:any,headers:any={},session?:any)=>{
    const res=response();await handler({body,headers,session,get:(key:string)=>headers[key.toLowerCase()]} as any,res as any,()=>{});return res;
  };
  const good=await request({path:'/de/profil/messages/secret?q=password#token',referralCategory:'google'});
  assert.equal(good.statusCode,204);assert.deepEqual(good.locals[PAGE_VIEW_LOCAL],{path:'/de/profile/messages/:redacted',referralCategory:'google'});
  assert.ok(!JSON.stringify(good).includes('secret'));assert.equal(good.headers['Cache-Control'],'private, no-store');
  for(const body of [null,[],{path:12},{path:'/en',action:'favorite-add'},{path:'/en',referralCategory:'https://secret.test'},
    {path:'x'.repeat(513)},{path:'/en',userId:'secret'},{path:'/en',referrer:'https://private.test'}])assert.equal((await request(body)).statusCode,400);
  for(const path of ['/admin','/unknown/secret','/en/login','https://secret.test/']){
    const res=await request({path});assert.equal(res.statusCode,204);assert.equal(res.locals[PAGE_VIEW_LOCAL],undefined);
  }
  for(const headers of [{dnt:'1'},{'sec-gpc':'1'},{referer:'https://themegaradio.com/admin'}]){
    const res=await request({path:'/en'},headers);assert.equal(res.statusCode,204);assert.equal(res.locals[PAGE_VIEW_LOCAL],undefined);
  }
  assert.equal((await request({path:'/en'},{},{adminAuth:true})).locals[PAGE_VIEW_LOCAL],undefined);
});
test('cursor/UUID/limit validation prevents raw addresses and malformed pagination reaching SQL',async()=>{
  let reads=0;const read:any=async()=>{reads++;return {events:[]};};const h=createVisitorActivityHandlers(read,read);
  for(const q of [{limit:'0'},{limit:'101'},{limit:['1']},{limit:'01'},{before:'bad'},{before:12},{ip:'198.51.100.1'},{window:'week'}])
    assert.equal((await invoke(h.activity,q)).statusCode,400);
  for(const invalid of ['198.51.100.1','198.51.100.0/24','arbitrary',id.toUpperCase()])assert.equal((await invoke(h.activity,{},invalid)).statusCode,400);
  assert.equal(reads,0);
  const cursor=encodeActivityCursor('2026-09-24T12:00:00.123456Z',id);assert.deepEqual(decodeActivityCursor(cursor),{time:'2026-09-24T12:00:00.123456Z',id});
  assert.equal(decodeActivityCursor(Buffer.from(JSON.stringify({time:'yesterday',id})).toString('base64url')),null);
  assert.equal((await invoke(h.activity,{limit:'100',before:cursor})).statusCode,200);assert.equal(reads,1);
});
test('read cache is single-flight, private, four concurrent reads shared across both lists; errors do not fabricate history',async()=>{
  let time=0,calls=0,resolve!:(value:any)=>void;const blocked=new Promise<any>(r=>{resolve=r;});
  const read:any=async()=>{calls++;return blocked;};const h=createVisitorActivityHandlers(read,read,()=>time);
  const pending=[invoke(h.activity),invoke(h.activity,{limit:'49'}),invoke(h.activity,{limit:'48'}),invoke(h.automated)];
  const same=invoke(h.activity,{limit:'50'});await Promise.resolve();assert.equal(calls,4);
  assert.equal((await invoke(h.automated,{limit:'24'})).statusCode,503);
  resolve({events:[],visitors:[]});const results=await Promise.all([...pending,same]);
  for(const result of results){assert.equal(result.statusCode,200);assert.equal(result.headers['Cache-Control'],'private, no-store');}
  await invoke(h.activity);assert.equal(calls,4);time=10000;await invoke(h.activity);assert.equal(calls,5);
  const missing=createVisitorActivityHandlers((async()=>null) as any,read);assert.equal((await invoke(missing.activity)).statusCode,404);
  const failed=createVisitorActivityHandlers((async()=>{throw new Error('driver ip secret');}) as any,read);
  const error=await invoke(failed.activity);assert.equal(error.statusCode,503);assert.deepEqual(error.body,{error:'Visitor activity temporarily unavailable'});
});

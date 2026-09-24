import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {createVisitorActivityMiddleware,PAGE_VIEW_LOCAL} from '../src/middleware/visitor-activity';
import {createUniqueVisitorTrackingMiddleware} from '../src/middleware/unique-visitor-tracking';
import {logger} from '../src/utils/logger';
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
function request(middleware:any,options:any={}){
  const headers={'user-agent':'Mozilla/5.0 Chrome/128.0 Safari/537.36',...options.headers};
  const req:any={method:options.method??'GET',path:options.path??'/en/station/radio',ip:options.ip??'203.0.113.8',
    headers,body:options.body,session:options.session,user:options.user,socket:{remoteAddress:'203.0.113.8'},app:{get:()=>()=>false},
    get:(key:string)=>headers[key.toLowerCase()]};
  const res:any=Object.assign(new EventEmitter(),{statusCode:options.status??200,locals:options.locals??{},
    getHeader:()=>options.contentType??'text/html; charset=utf-8'});
  let next=0;middleware(req,res,()=>next++);assert.equal(next,1);
  return {req,res,finish:()=>res.emit('finish')};
}
test('successful finish only, API polling/static/prefetch/admin/optouts never collected',async()=>{
  const events:any[]=[];const handler=createVisitorActivityMiddleware(async e=>{events.push(e);});
  for(const status of [101,301,304,399,400,401,403,404,500])request(handler,{status}).finish();
  for(const path of ['/api/stations','/api/station/radio','/api/admin/visitor-metrics','/admin','/api/health','/en/login','/assets/a.js'])request(handler,{path}).finish();
  for(const headers of [{dnt:'1'},{'sec-gpc':'1'},{purpose:'prefetch'},{'sec-purpose':'prerender'},{referer:'https://themegaradio.com/admin'},{'sec-fetch-dest':'image'}])request(handler,{headers}).finish();
  request(handler,{session:{adminAuth:true}}).finish();
  const late=request(handler);late.req.user={role:'admin'};late.finish();
  const aborted=request(handler);aborted.res.emit('close');await settle();assert.equal(events.length,0);
  request(handler).finish();await settle();assert.equal(events.length,1);assert.equal(events[0].automationStatus,'browser-like');
  assert.equal(events[0].path,'/en/station/radio');assert.equal(events[0].source,'http');
});
test('bots use separate capacity and never touch qualified counts; web bot-only ignores API and browsers',async()=>{
  const events:any[]=[];let time=0;
  const handler=createVisitorActivityMiddleware(async e=>{events.push(e);},{now:()=>time});
  for(let i=0;i<8;i++)request(handler,{ip:`203.0.113.${i+1}`,headers:{'user-agent':'Googlebot/2.1'}}).finish();
  request(handler,{ip:'198.51.100.1'}).finish();await settle();
  assert.deepEqual(events.map(e=>e.trafficKind),['automated','qualified']);
  assert.equal(events[0].automationStatus,'automated');
  const botOnly:any[]=[];const web=createVisitorActivityMiddleware(async e=>{botOnly.push(e);},{botsOnly:true});
  request(web).finish();request(web,{path:'/api/stations/123/click',method:'POST',headers:{'user-agent':'Googlebot'}}).finish();
  request(web,{headers:{'user-agent':'Googlebot'}}).finish();await settle();assert.equal(botOnly.length,1);
  let counts=0;const unique=createUniqueVisitorTrackingMiddleware(async()=>{counts++;});
  request(unique,{headers:{'user-agent':'Googlebot'}}).finish();
  request(unique,{path:'/api/visitor-activity/page-view',method:'POST'}).finish();await settle();assert.equal(counts,0);
});
test('explicit page views use server validated locals and client category, not arbitrary body/referrer; native is unknown',async()=>{
  const events:any[]=[];const handler=createVisitorActivityMiddleware(async e=>{events.push(e);});
  request(handler,{path:'/api/visitor-activity/page-view',method:'POST',status:204,
    body:{path:'/profile/secret',action:'favorite-add'},headers:{'user-agent':'okhttp/4.0',referer:'https://themegaradio.com/'},
    locals:{[PAGE_VIEW_LOCAL]:{path:'/profile/:redacted',referralCategory:'google'}}}).finish();
  await settle();assert.equal(events.length,1);assert.equal(events[0].source,'client-pageview');
  assert.equal(events[0].action,'page-view');assert.equal(events[0].referralCategory,'google');assert.equal(events[0].automationStatus,'unknown');
  assert.ok(!JSON.stringify(events).includes('secret'));
});
test('per-IP cooldown and pending caps drop rather than queue; warnings never expose raw IP/errors',async()=>{
  let time=0;let finish!:()=>void;const events:any[]=[];
  const blocked=new Promise<void>(resolve=>{finish=resolve;});
  const handler=createVisitorActivityMiddleware(async e=>{events.push(e);await blocked;},{now:()=>time});
  for(let i=0;i<10;i++){time=i*1000;request(handler,{ip:`203.0.113.${i+1}`}).finish();await settle();}
  assert.equal(events.length,3);finish();await settle();
  time=20000;request(handler,{ip:'198.51.100.1'}).finish();request(handler,{ip:'198.51.100.1'}).finish();await settle();assert.equal(events.length,4);
  const warnings:any[]=[];const original=logger.warn;logger.warn=(...args:any[])=>{warnings.push(args);};
  try{
    const fails=createVisitorActivityMiddleware(async()=>{throw new Error('private driver 198.51.100.9');},{now:()=>time});
    request(fails).finish();await settle();time+=3000;request(fails).finish();await settle();
    assert.equal(warnings.length,1);assert.ok(!JSON.stringify(warnings).includes('198.51.100'));assert.ok(!JSON.stringify(warnings).includes('driver'));
  }finally{logger.warn=original;}
});
test('real player report records2xx including anonymous204 without inventing audio success or storing station body',async()=>{
  const events:any[]=[];let time=0;const handler=createVisitorActivityMiddleware(async e=>{events.push(e);},{now:()=>time});
  for(const status of [200,204,301,400,500]){
    time+=3000;request(handler,{method:'POST',path:'/api/recently-played',status,contentType:status===204?'':'application/json',
      body:{stationId:'68a8c458bd66579311aac72f',token:'secret'}}).finish();await settle();
  }
  assert.equal(events.length,2);assert.deepEqual(events.map(e=>e.status),[200,204]);
  assert.equal(events[1].action,'play-request');assert.equal(events[1].path,'/api/recently-played');
  assert.ok(!JSON.stringify(events).includes('68a8c458'));assert.ok(!JSON.stringify(events).includes('secret'));
});

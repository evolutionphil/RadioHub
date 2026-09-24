import type { Express, RequestHandler } from 'express';
import { REFERRAL_CATEGORIES, sanitizeVisitorPagePath, type VisitorReferralCategory } from '@workspace/seo-shared/visitor-activity';
import { ACTIVITY_UUID, decodeActivityCursor, pgAutomatedVisitors, pgVisitorActivity } from '../data/postgres-visitor-activity';
import { activityPrivacyOptOut, PAGE_VIEW_LOCAL } from '../middleware/visitor-activity';
import { adminRequest } from '../middleware/unique-visitor-tracking';

export function createVisitorPageViewHandler(): RequestHandler {
  return (req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if (activityPrivacyOptOut(req) || adminRequest(req)) return void res.status(204).end();
    const body = req.body;
    if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(key=>!['path','referralCategory'].includes(key))
        || typeof body.path!=='string' || body.path.length>512
        || (body.referralCategory!==undefined && !REFERRAL_CATEGORIES.includes(body.referralCategory)))
      return void res.status(400).json({error:'Invalid visitor page view'});
    const path = sanitizeVisitorPagePath(body.path);
    if(path) res.locals[PAGE_VIEW_LOCAL]={path,referralCategory:(body.referralCategory??'direct-or-unknown') as VisitorReferralCategory};
    res.status(204).end();
  };
}

/** Shared four-read budget and capped single-flight cache for both admin reads. */
export function createVisitorActivityHandlers(readActivity=pgVisitorActivity,readAutomated=pgAutomatedVisitors,now=Date.now) {
  type Entry={pending?:Promise<any>;value?:any;expiresAt:number};
  const cache=new Map<string,Entry>(); let active=0;
  const handler=(automated:boolean):RequestHandler=>async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const q=req.query,keys=Object.keys(q),id=String(req.params.activityId??'');
    const limit=q.limit??(automated?'25':'50'),before=q.before===undefined?null:decodeActivityCursor(q.before);
    if(keys.some(key=>!['limit','before'].includes(key)) || Object.values(q).some(value=>typeof value!=='string')
      || typeof limit!=='string' || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit)>100
      || (q.before!==undefined && !before) || (!automated&&!ACTIVITY_UUID.test(id)))
      return void res.status(400).json({error:'Invalid visitor activity query'});
    const key=JSON.stringify([automated,id,Number(limit),before]);
    try{
      let entry=cache.get(key);
      if(!entry){
        if(cache.size>=128){const evict=[...cache].find(([,v])=>!v.pending);if(!evict)throw new Error('Capacity');cache.delete(evict[0]);}
        entry={expiresAt:0};cache.set(key,entry);
      }
      if(entry.value===undefined||now()>=entry.expiresAt){
        if(!entry.pending){
          if(active>=4)throw new Error('Capacity');active++;const current=entry;
          current.pending=Promise.resolve().then(async()=>{
            if(automated)return await readAutomated(Number(limit),before);
            return await readActivity(id,Number(limit),before);
          })
            .then(value=>{current.value=value;current.expiresAt=now()+10000;return value;})
            .finally(()=>{active--;current.pending=undefined;});
        }
        await entry.pending;
      }
      if(entry.value===null)return void res.status(404).json({error:'Visitor activity not found'});
      res.json(entry.value);
    }catch{res.status(503).json({error:'Visitor activity temporarily unavailable'});}
  };
  return {activity:handler(false),automated:handler(true)};
}
export function registerVisitorActivityRoutes(app:Express,requireAdmin:RequestHandler){
  const handlers=createVisitorActivityHandlers();
  app.post('/api/visitor-activity/page-view',createVisitorPageViewHandler());
  app.get('/api/admin/visitor-metrics/activity/:activityId',requireAdmin,handlers.activity);
  app.get('/api/admin/visitor-metrics/automated',requireAdmin,handlers.automated);
}

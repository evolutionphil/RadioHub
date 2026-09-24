import type { Request, RequestHandler } from 'express';
import { classifyVisitorReferral, sanitizeVisitorPagePath, type VisitorActivityAction, type VisitorReferralCategory } from '@workspace/seo-shared/visitor-activity';
import { pgTrackVisitorActivity, type VisitorActivityWrite } from '../data/postgres-visitor-activity';
import { adminRequest, eligibleRequest, isAutomatedVisitorAgent, visitorAddress } from './unique-visitor-tracking';
import { classifyVisitorContext } from './visitor-client-context';
import { logger } from '../utils/logger';

export function activityPrivacyOptOut(req: Request): boolean { return req.get('DNT') === '1' || req.get('Sec-GPC') === '1'; }
export const PAGE_VIEW_LOCAL = 'sanitizedVisitorPageView';
export interface ClientPageView { path: string; referralCategory: VisitorReferralCategory }

/** Only explicitly successful application routes, never API polling = a view.
 * Dynamic route identifiers and request bodies are not copied into the event. */
export function observedVisitorAction(path: string, method: string, body: unknown): { path: string; action: VisitorActivityAction } | null {
  if (method === 'GET' && !path.startsWith('/api/')) {
    const safe = sanitizeVisitorPagePath(path);
    return safe ? { path: safe, action: /\/(?:station|stations)\/[^/]+$/.test(safe) ? 'station-view' : 'page-view' } : null;
  }
  if (method === 'POST' && /^\/api\/stations\/[^/]+\/click$/.test(path)) return {path:'/api/stations/:station/click',action:'play-request'};
  if (method === 'POST' && path === '/api/recently-played'
      && typeof (body as {stationId?:unknown}|null)?.stationId === 'string'
      && /^[a-zA-Z0-9_-]{1,128}$/.test((body as {stationId:string}).stationId)) return {path:'/api/recently-played',action:'play-request'};
  if (method === 'POST' && /^\/api\/(?:user-engagement\/)?stations\/[^/]+\/rate$/.test(path))
    return {path:'/api/stations/:station/rate',action:'rating-submit'};
  if (method === 'POST' && path === '/api/user/favorites') return {path:'/api/user/favorites',action:'favorite-add'};
  if (method === 'DELETE' && /^\/api\/user\/favorites\/[^/]+$/.test(path)) return {path:'/api/user/favorites/:station',action:'favorite-remove'};
  if (method === 'POST' && /^\/api\/user-engagement\/stations\/[^/]+\/favorite$/.test(path)) {
    const action = (body as {action?:unknown}|null)?.action;
    return action === 'add' || action === 'remove'
      ? {path:'/api/user-engagement/stations/:station/favorite',action:action === 'add'?'favorite-add':'favorite-remove'} : null;
  }
  return null;
}

/** Separate bot/qualified budgets ensure crawler bursts cannot starve visitor
 * activity or presence. Saturation drops observations; there is no queue/retry.
 * Per-process day caps bound storage growth, SQL additionally caps IP/hour. */
export function createVisitorActivityMiddleware(write = pgTrackVisitorActivity, options: { botsOnly?: boolean; now?:()=>number } = {}): RequestHandler {
  const now = options.now ?? Date.now;
  const makeBudget = () => ({ recent:new Map<string,number>(), pending:0, day:-1, admitted:0, minute:-1, minuteCount:0, shortWindow:-1, shortCount:0 });
  const budgets = { qualified:makeBudget(), automated:makeBudget() };
  let warningAt = Number.NEGATIVE_INFINITY;
  return (req,res,next) => {
    if (activityPrivacyOptOut(req) || !eligibleRequest(req,true)) return next();
    const automated = isAutomatedVisitorAgent(req.headers['user-agent']);
    if (options.botsOnly && (!automated || req.path.startsWith('/api/'))) return next();
    const address = visitorAddress(req);
    if (!address) return next();
    const initialPath = req.path, method = req.method;
    const context = classifyVisitorContext({userAgent:req.headers['user-agent'],platformHeader:req.headers['x-megaradio-platform'],countryCode:address.countryCode});
    res.once('finish',()=>{
      if (res.statusCode<200 || res.statusCode>=300 || adminRequest(req) || activityPrivacyOptOut(req)) return;
      const reported: ClientPageView|undefined = initialPath === '/api/visitor-activity/page-view' ? res.locals[PAGE_VIEW_LOCAL] : undefined;
      const event = reported ? {path:reported.path,action:'page-view' as const} : observedVisitorAction(initialPath,method,req.body);
      if (!event) return;
      const contentType=String(res.getHeader('Content-Type')||'');
      const emptyPlayReport = initialPath === '/api/recently-played' && event.action === 'play-request' && res.statusCode === 204 && !contentType;
      if (!reported && !emptyPlayReport && !/^(?:text\/html|application\/json)(?:;|$)/i.test(contentType)) return;
      const trafficKind = automated ? 'automated' : 'qualified';
      const budget = budgets[trafficKind], time=now(), day=Math.floor(time/86400000), minute=Math.floor(time/60000);
      if (budget.day!==day) {budget.day=day;budget.admitted=0;}
      if (budget.minute!==minute) {budget.minute=minute;budget.minuteCount=0;}
      const shortWindow=Math.floor(time/(automated?10000:1000));
      if(budget.shortWindow!==shortWindow){budget.shortWindow=shortWindow;budget.shortCount=0;}
      if (budget.pending>=(automated?1:3) || budget.admitted>=(automated?10000:50000)
          || budget.minuteCount>=(automated?6:120) || budget.shortCount>=(automated?1:2)) return;
      const previous=budget.recent.get(address.ip);
      if (previous!==undefined && previous>time) return;
      if (previous!==undefined) budget.recent.delete(address.ip);
      if (budget.recent.size>=50000) {
        const first=budget.recent.entries().next().value;
        if (first && first[1]<=time) budget.recent.delete(first[0]);
        else return;
      }
      budget.recent.set(address.ip,time+(automated?60000:2000));
      budget.pending++;budget.admitted++;budget.minuteCount++;budget.shortCount++;
      const value: VisitorActivityWrite = {ip:address.ip,context,trafficKind,...event,method,status:res.statusCode,
        source:reported?'client-pageview':'http',referralCategory:reported?.referralCategory??classifyVisitorReferral(req.get('referer')),
        automationStatus:automated?'automated':context.browser && context.contextSource==='user-agent'?'browser-like':'unknown'};
      void Promise.resolve().then(()=>write(value)).catch(()=>{
        if(now()-warningAt>=60000){warningAt=now();logger.warn('Visitor activity sampling write failed; activity may be incomplete.');}
      }).finally(()=>{budget.pending--;});
    });
    next();
  };
}

import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { pollAdminOperation, OPERATIONAL_TABLES, isTerminalLogoJob } from '../src/lib/admin-operations';
const mocks = vi.hoisted(() => ({ request:vi.fn(), query:vi.fn(), toast:vi.fn() }));
vi.mock('@/lib/queryClient', async () => { const { QueryClient } = await import('@tanstack/react-query'); return { apiRequest:mocks.request,queryClient:new QueryClient() }; });
vi.mock('@/hooks/use-toast', () => ({ useToast:() => ({toast:mocks.toast}) }));
vi.mock('@/hooks/useAdminAuth', () => ({useAdminAuth:() => ({isAuthenticated:true})}));
import AdminCities from '../src/pages/admin/cities';
import AdminPerformance from '../src/pages/admin/performance';
import StatusMonitoring from '../src/pages/status-monitoring';
import DbManagement from '../src/pages/admin/db-management';
import LogoManagement from '../src/pages/admin/logo-management';
import AdminAppLogs from '../src/pages/admin/app-logs';
function mount(element: React.ReactNode) {
  const client=new QueryClient({defaultOptions:{queries:{retry:false,queryFn:({queryKey})=>mocks.query(queryKey[0])},mutations:{retry:false}}});
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); mocks.request.mockResolvedValue({json:async()=>({})});mocks.query.mockResolvedValue({}); });
afterEach(() => { vi.useRealTimers();vi.restoreAllMocks(); });

describe('cancellable operational job polling', () => {
  it('does not overlap slow requests and stops at a terminal result', async () => {
    vi.useFakeTimers();let finish!: (v:any)=>void;
    mocks.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const onData=vi.fn(),onError=vi.fn();const stop=pollAdminOperation<{status:string}>({url:'/api/admin/job/one',onData,onError,isTerminal:j=>j.status==='completed',intervalMs:10});
    await vi.advanceTimersByTimeAsync(1000);expect(mocks.request).toHaveBeenCalledTimes(1);
    finish({json:async()=>({status:'completed'})});await vi.advanceTimersByTimeAsync(100);
    expect(onData).toHaveBeenCalledWith({status:'completed'});expect(mocks.request).toHaveBeenCalledTimes(1);expect(onError).not.toHaveBeenCalled();stop();
  });
  it('aborts in-flight reads on unmount and ignores late responses', async () => {
    vi.useFakeTimers();let finish!:(v:any)=>void;mocks.request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const onData=vi.fn(),onError=vi.fn();const stop=pollAdminOperation({url:'/api/admin/job/one',onData,onError,isTerminal:()=>false,intervalMs:10});
    await vi.advanceTimersByTimeAsync(10);const signal=mocks.request.mock.calls[0][2].signal;stop();expect(signal.aborted).toBe(true);
    finish({json:async()=>({status:'running'})});await vi.advanceTimersByTimeAsync(1000);expect(onData).not.toHaveBeenCalled();expect(onError).not.toHaveBeenCalled();expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('stops on404/auth/network failures instead of polling forever', async () => {
    vi.useFakeTimers();mocks.request.mockRejectedValue(new Error('404: job not found'));const onError=vi.fn();
    pollAdminOperation({url:'/api/admin/job/missing',onData:vi.fn(),onError,isTerminal:()=>false,intervalMs:10});
    await vi.advanceTimersByTimeAsync(1000);expect(onError).toHaveBeenCalledOnce();expect(mocks.request).toHaveBeenCalledOnce();
  });
  it('knows terminal logo states but does not discard a paused worker', () => {
    for(const state of ['completed','failed','cancelled','lost'])expect(isTerminalLogoJob(state)).toBe(true);
    for(const state of ['running','paused',undefined])expect(isTerminalLogoJob(state)).toBe(false);
  });
});
it('city analysis errors do not render a success or an actionable stale merge', async () => {
  mocks.request.mockRejectedValue(new Error('503: unavailable'));mount(<AdminCities/>);
  fireEvent.click(screen.getByRole('button',{name:'Analyze Duplicates'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');expect(screen.queryByText('Merge Completed Successfully!')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Merge All Duplicates'})).not.toBeInTheDocument();
});
it('city merge preserves the result and requires explicit confirmation', async () => {
  mocks.request.mockResolvedValueOnce({json:async()=>({totalCityGroups:1,totalStationsAffected:2,duplicates:[]})}).mockResolvedValueOnce({json:async()=>({success:true,stationsUpdated:2,cityGroupsProcessed:1,mergeOperations:[]})});
  vi.spyOn(window,'confirm').mockReturnValue(true);mount(<AdminCities/>);fireEvent.click(screen.getByRole('button',{name:'Analyze Duplicates'}));
  fireEvent.click(await screen.findByRole('button',{name:'Merge All Duplicates'}));expect(await screen.findByText('Merge Completed Successfully!')).toBeInTheDocument();expect(mocks.request).toHaveBeenCalledTimes(2);expect(screen.queryByRole('button',{name:'Merge All Duplicates'})).not.toBeInTheDocument();
});
it('performance parses the real nested job payload and finishes polling', async () => {
  const metrics={databaseStats:{totalStations:3,totalCountries:1,totalGenres:1,indexesCount:3,dbSize:'1 MB'},systemHealth:{memoryUsage:30,cpuUsage:null,connectionPool:1},optimizationSuggestions:[]};
  mocks.request.mockImplementation(async(method:string,url:string)=>({ok:true,json:async()=>url.endsWith('/metrics')?metrics:url.endsWith('/web-vitals')?null:method==='POST'?{success:true,jobId:'job1'}:{success:true,job:{id:'job1',status:'completed',progress:100,message:'Finished safely'}}}));
  const view=mount(<AdminPerformance/>);await screen.findByText('Performance Optimization');
  const button=screen.getByRole('button',{name:'Analyze DB'});fireEvent.click(button);
  expect(await screen.findByText('Finished safely',{}, {timeout:4000})).toBeInTheDocument();view.unmount();
});
it('status shows catalogue totals and does not classify source false as offline', async () => {
  mocks.query.mockImplementation(async(url:string)=>url.endsWith('operations-status')?{totals:{total:40000,working:7,unavailable:2,unverified:39991,sslErrors:0,recentChecks:0,uptrend:1,downtrend:0},recentChecks:[],problemStations:[],stations:[]}:
    url.endsWith('/metrics')?{databaseStats:{dbSize:'1 MB'},systemHealth:{memoryUsage:32,cpuUsage:null,connectionPool:2}}:url.endsWith('/stats')?{totalStations:40000,workingStations:20000}: {isRunning:false,lastSyncLog:null});
  mount(<StatusMonitoring/>);await waitFor(()=>expect(screen.getAllByText('Hidden from Lists').length).toBeGreaterThan(0));expect(screen.queryByText('Offline Stations')).not.toBeInTheDocument();expect(screen.getByText('39991')).toBeInTheDocument();expect(screen.getByText('32%')).toBeInTheDocument();
});
it('a failed station-health read does not blank healthy performance and sync sections', async () => {
  mocks.query.mockImplementation(async(url:string)=>{
    if(url.endsWith('operations-status'))throw new Error('503');
    return url.endsWith('/metrics')?{databaseStats:{dbSize:'1 MB'},systemHealth:{memoryUsage:32,cpuUsage:null,connectionPool:2}}:url.endsWith('/stats')?{totalStations:40000,workingStations:20000}:{isRunning:false,lastSyncLog:null};
  });
  mount(<StatusMonitoring/>);expect(await screen.findByRole('alert')).toHaveTextContent('Station health');
  expect(screen.getByRole('heading',{name:'System Status Monitoring'})).toBeInTheDocument();expect(screen.getByText('32%')).toBeInTheDocument();
  expect(screen.queryByText('No problem stations detected')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Retry failed sections'})).toBeInTheDocument();
});
it('PostgreSQL table controls use retained operation aliases without a fictional512MB quota', async () => {
  mocks.query.mockResolvedValue({engine:'postgresql',countsAreEstimates:true,totalSizeMB:1000,storageSizeMB:1200,indexSizeMB:200,collections:[{name:'app_logs',count:5,sizeMB:1,storageSizeMB:1,indexSizeMB:0}],quotaStatus:{quotaExceeded:false}});
  vi.spyOn(window,'confirm').mockReturnValue(true);mount(<DbManagement/>);fireEvent.click(await screen.findByRole('button',{name:'Clear'}));
  await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith('POST','/api/admin/db-drop-collection',{body:{collection:'applogs'}}));expect(screen.queryByText(/Quota Usage/)).not.toBeInTheDocument();expect(OPERATIONAL_TABLES.stations).toBeUndefined();expect(OPERATIONAL_TABLES.catalog_sync_runs.clearable).toBe(false);
});
it('a completed logo job is not reattached from a cached active-job response', async () => {
  const job={jobId:'finished-logo-job',status:'completed',total:1,processed:1,successful:1,failed:0,startedAt:new Date().toISOString()};
  mocks.query.mockImplementation(async(url:string)=>url.endsWith('/active-job')?{hasActiveJob:true,job:{...job,status:'running'}}:url.endsWith('/job-status')?job:url.endsWith('/stats')?{totalStations:1,stationsWithFavicon:1,stationsWithSlug:1,stationsWithLogoAssets:1,stationsFailed:0,stationsNeedingProcessing:0,stationsWithoutLogo:0,stationsNoFavicon:0,processingComplete:true,s3Configured:false}:null);
  mocks.request.mockResolvedValue({ok:true,json:async()=>({totalFailed:0,countsByType:{},rows:[]})});
  mount(<LogoManagement/>);expect(await screen.findByTestId('badge-status-completed')).toBeInTheDocument();
  await waitFor(()=>expect(screen.queryByText('Job: finished-logo-job')).not.toBeInTheDocument(),{timeout:4000});
  expect(mocks.query.mock.calls.filter(([url])=>url.endsWith('/job-status'))).toHaveLength(1);
});
it('application-log pagination reaches older results and resets when filters change', async () => {
  mocks.request.mockImplementation(async(_method:string,url:string)=>({ok:true,json:async()=>url.includes('/crashes')?{count:0,logs:[]}:{success:true,count:0,total:75,logs:[]}}));
  mount(<AdminAppLogs/>);fireEvent.click(await screen.findByRole('button',{name:'Next'}));
  await waitFor(()=>expect(mocks.request.mock.calls.some(([,url])=>url.includes('page=2'))).toBe(true));
  fireEvent.change(screen.getByPlaceholderText('Search device...'),{target:{value:'device-1'}});
  await waitFor(()=>expect(mocks.request.mock.calls.some(([,url])=>url.includes('page=1')&&url.includes('deviceId=device-1'))).toBe(true));
});

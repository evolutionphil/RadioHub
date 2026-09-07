import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {renderHook,waitFor,act} from '@testing-library/react';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import {readStationBootstrap} from '../src/lib/station-bootstrap';
const seed={language:'tr',station:{_id:'one',slug:'kral-fm',name:'Kral',url:'https://radio.example/live',descriptions:{tr:'Türkçe'}}};
function insert(value=seed){const script=document.createElement('script');script.id='station-bootstrap';script.type='application/json';script.textContent=JSON.stringify(value);document.body.appendChild(script);return script;}
afterEach(()=>{document.getElementById('station-bootstrap')?.remove();vi.unstubAllEnvs();vi.resetModules();});
it('uses only the matching station and language; ignores corrupt payloads',()=>{
 const script=insert();expect(readStationBootstrap('kral-fm','tr')).toEqual(seed.station);
 expect(readStationBootstrap('one','tr')).toEqual(seed.station);
 expect(readStationBootstrap('other','tr')).toBeUndefined();expect(readStationBootstrap('kral-fm','de')).toBeUndefined();
 script.textContent='{bad';expect(readStationBootstrap('kral-fm','tr')).toBeUndefined();
});
it('shows the description immediately without polluting the complete API cache; full response still loads',async()=>{
 insert(); const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 let resolve!: (data:any)=>void;const queryFn=vi.fn(()=>new Promise<any>(r=>{resolve=r;}));
 const queryKey=['/api/station/kral-fm'];
 const hook=renderHook(()=>useQuery({queryKey,queryFn,placeholderData:()=>readStationBootstrap('kral-fm','tr')}),
  {wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 expect(hook.result.current.data.descriptions.tr).toBe('Türkçe');expect(hook.result.current.isPlaceholderData).toBe(true);
 expect(client.getQueryData(queryKey)).toBeUndefined();expect(queryFn).toHaveBeenCalledTimes(1);
 const full={...seed.station,descriptions:{tr:'Türkçe',de:'Deutsch'},homepage:'https://example.com'};
 await act(async()=>resolve(full));await waitFor(()=>expect(hook.result.current.isPlaceholderData).toBe(false));
 expect(client.getQueryData(queryKey)).toEqual(full);hook.unmount();client.clear();
});
it('favicon images use the API image service while audio keeps its independent proxy',async()=>{
 vi.stubEnv('VITE_API_BASE_URL','https://api.example');vi.stubEnv('VITE_STREAM_PROXY_URL','https://stream.example');
 const {normalizeFaviconUrl,getStreamProxyUrl}=await import('../src/lib/utils');
 expect(normalizeFaviconUrl('https://logos.example/a.png')).toMatch(/^https:\/\/api.example\/api\/image\//);
 expect(normalizeFaviconUrl('//logos.example/a.png')).toEqual(normalizeFaviconUrl('https://logos.example/a.png'));
 expect(normalizeFaviconUrl('/station-logos/a.webp')).toBe('/station-logos/a.webp');
 expect(getStreamProxyUrl('/api/stream/encoded')).toBe('https://stream.example/api/stream/encoded');
});

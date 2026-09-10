import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import AdminAppLogs from '@/pages/admin/app-logs';
import {AdminErrorLogs} from '@/pages/admin-error-logs';
import {AdminPageErrorBoundary} from '@/components/admin/AdminPageErrorBoundary';

afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
function mount(page:React.ReactNode){
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  return render(<QueryClientProvider client={client}>{page}</QueryClientProvider>);
}
it('renders app-log all-filter options without a Radix empty-value crash',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({success:true,logs:[],count:0,total:0})})));
  expect(()=>mount(<AdminAppLogs/>)).not.toThrow();
  expect(screen.getByRole('heading',{name:'iOS / CarPlay Logs'})).toBeInTheDocument();
  await screen.findByText('No logs found');
  expect(screen.getAllByRole('combobox')).toHaveLength(3);
});
it('shows a real failed request instead of pretending there are no application logs',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:503,json:async()=>({error:'Unavailable'})})));
  mount(<AdminAppLogs/>);
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded'));
  expect(screen.queryByText('No logs found')).not.toBeInTheDocument();
});
it('renders error-log default filters without a Radix empty-value crash',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({errors:[],pagination:{page:1,limit:20,total:0,pages:0}})})));
  expect(()=>mount(<AdminErrorLogs/>)).not.toThrow();
  await waitFor(()=>expect(screen.getAllByRole('combobox')).toHaveLength(2));
});
it('contains a failed page and allows route navigation to reset the boundary',()=>{
  vi.spyOn(console,'error').mockImplementation(()=>{});
  function Broken():React.ReactNode{throw new Error('Fixture render failure');}
  const view=render(<div><nav>Admin navigation</nav><AdminPageErrorBoundary key="logs"><Broken/></AdminPageErrorBoundary></div>);
  expect(screen.getByRole('alert')).toHaveTextContent('could not be displayed');
  expect(screen.getByText('Admin navigation')).toBeInTheDocument();
  view.rerender(<div><nav>Admin navigation</nav><AdminPageErrorBoundary key="dashboard"><h1>Recovered page</h1></AdminPageErrorBoundary></div>);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(screen.getByRole('heading',{name:'Recovered page'})).toBeInTheDocument();
});

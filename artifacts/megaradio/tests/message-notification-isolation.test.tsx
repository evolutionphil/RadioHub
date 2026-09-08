import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MessagesPage from '../src/pages/messages';
import NotificationsView from '../src/pages/notifications-view';
import NotificationSettings from '../src/pages/notifications';

const state = vi.hoisted(() => ({ user: { _id:'aaaaaaaaaaaaaaaaaaaaaaaa', notificationSettings: undefined as any }, navigate:vi.fn(), toast:vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({useAuth:() => ({user:state.user,isAuthenticated:!!state.user})}));
vi.mock('@/hooks/useTranslation', () => ({useTranslation:() => ({language:'de',t:(_key:string,fallback:string) => fallback})}));
vi.mock('@/hooks/use-toast', () => ({useToast:() => ({toast:state.toast})}));
vi.mock('wouter', () => ({useLocation:() => ['/de/profile/notifications',state.navigate]}));
vi.mock('@/hooks/usePushNotifications', () => ({usePushNotifications:() => ({isSupported:true,isSubscribed:true,permission:'granted',isLoading:false,
  subscribe:vi.fn(),unsubscribe:vi.fn(),requestPermission:vi.fn(),sendTestNotification:vi.fn()})}));
const A='aaaaaaaaaaaaaaaaaaaaaaaa', B='bbbbbbbbbbbbbbbbbbbbbbbb', C='cccccccccccccccccccccccc';
const msgId='111111111111111111111111';
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;
const json = (value: unknown,status=200) => new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const chatMessage = (partner=B) => ({_id:msgId,fromUserId:partner,toUserId:A,content:'Existing message',read:true,createdAt:'2026-01-02T00:00:00Z'});
function defaults(url: string) {
  if(url.includes('ws-ticket')) return json({},401);
  if(url.includes('/messages/conversations')) return json({conversations:[B,C].map((id,i) => ({partnerId:id,partner:{_id:id,username:i?'Carol':'Bob'},lastMessage:'Preview',unreadCount:0}))});
  if(url.includes('/messages/contacts')) return json({contacts:[]});
  if(url.includes('/messages/conversation/')) {const partner=url.split('/').at(-1)!.split('?')[0];return json({messages:[chatMessage(partner)],partner:{_id:partner,username:partner===B?'Bob':'Carol'},hasMore:false});}
  if(url.includes('/user/notifications')) return json({notifications:[],pagination:{page:1,pages:1,total:0},unreadCount:0});
  return json({});
}
function mount(child: React.ReactNode) {
  return render(<QueryClientProvider client={client}>{child}</QueryClientProvider>);
}
beforeEach(() => {
  state.user={_id:A,notificationSettings:undefined}; state.navigate.mockReset();state.toast.mockReset();
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:1}}});
  fetchMock=vi.fn(async (url: string) => defaults(String(url))); vi.stubGlobal('fetch',fetchMock);
  Element.prototype.scrollIntoView=vi.fn();
  window.history.replaceState({},'', '/de/profile/messages');
});
afterEach(() => {cleanup();client.clear();vi.unstubAllGlobals();});

it('captures recipient and prevents late send success from clearing the next conversation draft',async () => {
  let finish!: (response:Response) => void;
  fetchMock.mockImplementation(async (url:string,options?:RequestInit) => url==='/api/messages/send' ? new Promise<Response>(resolve=>{finish=resolve;}) : defaults(url));
  mount(<MessagesPage/>);
  fireEvent.click(await screen.findByText('Bob'));
  const input=await screen.findByPlaceholderText('Message Bob');
  fireEvent.change(input,{target:{value:'For Bob'}});
  fireEvent.click(screen.getByRole('button',{name:'Send message'}));
  await waitFor(()=>expect(finish).toBeTypeOf('function'));
  fireEvent.click(screen.getByText('Carol'));
  fireEvent.change(await screen.findByPlaceholderText('Message Carol'),{target:{value:'Carol draft'}});
  await act(async()=>finish(json({success:true})));
  expect(screen.getByPlaceholderText('Message Carol')).toHaveValue('Carol draft');
  const calls=fetchMock.mock.calls.filter(([url])=>url==='/api/messages/send');
  expect(calls).toHaveLength(1);expect(JSON.parse(calls[0][1].body)).toMatchObject({toUserId:B,content:'For Bob'});
});

it('failed sends are not automatically retried and keep the draft with a visible error',async () => {
  fetchMock.mockImplementation(async (url:string)=>url==='/api/messages/send'?json({},500):defaults(url));
  mount(<MessagesPage/>);fireEvent.click(await screen.findByText('Bob'));
  fireEvent.change(await screen.findByPlaceholderText('Message Bob'),{target:{value:'Keep this draft'}});
  act(()=>{fireEvent.click(screen.getByRole('button',{name:'Send message'}));fireEvent.click(screen.getByRole('button',{name:'Send message'}));});
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
  expect(fetchMock.mock.calls.filter(([url])=>url==='/api/messages/send')).toHaveLength(1);
  expect(screen.getByPlaceholderText('Message Bob')).toHaveValue('Keep this draft');
});

it('account changes reset conversation state and cannot display previous account cache',async () => {
  const view=mount(<MessagesPage/>);fireEvent.click(await screen.findByText('Bob'));
  await screen.findByText('Existing message');
  state.user={_id:'dddddddddddddddddddddddd',notificationSettings:undefined};
  fetchMock.mockImplementation(async (url:string)=>url.includes('/messages/conversations')?new Promise<Response>(()=>{}):defaults(url));
  view.rerender(<QueryClientProvider client={client}><MessagesPage/></QueryClientProvider>);
  expect(screen.queryByText('Existing message')).not.toBeInTheDocument();
  expect(screen.queryByText('Bob')).not.toBeInTheDocument();
});

it('older messages are reachable and remain in the correct conversation',async () => {
  fetchMock.mockImplementation(async (url:string)=>{
    if(url.includes('/messages/conversation/')) return url.includes('before=')
      ? json({messages:[{...chatMessage(),_id:'000000000000000000000001',content:'Older message',createdAt:'2026-01-01'}],hasMore:false})
      : json({messages:[chatMessage()],partner:{_id:B,username:'Bob'},hasMore:true});
    return defaults(url);
  });
  mount(<MessagesPage/>);fireEvent.click(await screen.findByText('Bob'));
  fireEvent.click(await screen.findByRole('button',{name:'Load earlier messages'}));
  expect(await screen.findByText('Older message')).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes(`before=${msgId}`))).toBe(true);
  expect(screen.queryByRole('button',{name:'Load earlier messages'})).not.toBeInTheDocument();
});

it('native read=true stays read and native sender ID opens the localized message conversation',async () => {
  fetchMock.mockImplementation(async (url:string)=> url.startsWith('/api/user/notifications?') ? json({notifications:[
    {_id:msgId,type:'new_message',read:true,fromUserId:B,title:'Read message',message:'Body',createdAt:'2026-01-01'}
  ],pagination:{page:1,pages:1,total:1},unreadCount:0}) : defaults(url));
  mount(<NotificationsView/>);fireEvent.click(await screen.findByText('Read message'));
  expect(state.navigate).toHaveBeenCalledWith(`/de/profile/messages?partner=${B}`);
  expect(fetchMock.mock.calls.some(([url])=>String(url).endsWith('/read'))).toBe(false);
});

it('notification query failure is not mislabeled as an empty inbox',async () => {
  fetchMock.mockImplementation(async()=>json({},500));
  mount(<NotificationsView/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(screen.queryByText('No notifications yet')).not.toBeInTheDocument();
});

it('notification tabs request server-filtered pages rather than filtering the current page',async () => {
  fetchMock.mockImplementation(async(url:string)=>json({notifications:[{_id:msgId,type:url.includes('category=social')?'follow':'system',read:true,title:url.includes('category=social')?'Older social item':'Latest system item',message:'Body',createdAt:'2026-01-01'}],pagination:{page:1,pages:1,total:1},unreadCount:0,categoryCounts:{all:40,social:1,stations:0,system:39}}));
  mount(<NotificationsView/>);await screen.findByText('Latest system item');
  fireEvent.click(screen.getByRole('button',{name:'Social 1'}));
  expect(await screen.findByText('Older social item')).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes('page=1&limit=20&category=social'))).toBe(true);
});

it('notification account switch cannot reuse a previous account inbox',async () => {
  fetchMock.mockImplementation(async () => json({notifications:[{_id:msgId,type:'system',read:true,title:'Private old inbox',message:'Secret',createdAt:'2026-01-01'}],pagination:{page:1,pages:1},unreadCount:0}));
  const view=mount(<NotificationsView/>);await screen.findByText('Private old inbox');
  state.user={_id:C,notificationSettings:undefined};fetchMock.mockImplementation(async()=>new Promise<Response>(()=>{}));
  view.rerender(<QueryClientProvider client={client}><NotificationsView/></QueryClientProvider>);
  expect(screen.queryByText('Private old inbox')).not.toBeInTheDocument();
});

it('an image upload finishing after a conversation switch never sends to the new recipient',async () => {
  let finishUpload!: (response:Response)=>void;
  fetchMock.mockImplementation(async (url:string)=>url==='/api/messages/upload-image'?new Promise<Response>(resolve=>{finishUpload=resolve;}):defaults(url));
  const view=mount(<MessagesPage/>);fireEvent.click(await screen.findByText('Bob'));
  await screen.findByPlaceholderText('Message Bob');
  fireEvent.change(view.container.querySelector('input[type=file]')!,{target:{files:[new File(['image'],'photo.png',{type:'image/png'})]}});
  await screen.findByAltText('Preview');fireEvent.click(screen.getByRole('button',{name:'Send message'}));
  await waitFor(()=>expect(finishUpload).toBeTypeOf('function'));
  fireEvent.click(screen.getByText('Carol'));await screen.findByPlaceholderText('Message Carol');
  await act(async()=>finishUpload(json({imageUrl:'/uploads/chat/test.png'})));
  expect(fetchMock.mock.calls.some(([url])=>url==='/api/messages/send')).toBe(false);
  expect(screen.queryByAltText('Preview')).not.toBeInTheDocument();
});

it('notification setting HTTP failure rolls back and preferences reset on account change',async () => {
  state.user.notificationSettings={favorites:false,nowPlaying:true,newStations:false,recommendations:false};
  fetchMock.mockImplementation(async()=>json({},500));
  const view=mount(<NotificationSettings/>);
  const control=screen.getByTestId('switch-favorites');expect(control).not.toBeChecked();
  fireEvent.click(control);
  await waitFor(()=>expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Save Failed'})));
  expect(control).not.toBeChecked();
  state.user={_id:C,notificationSettings:undefined};
  view.rerender(<QueryClientProvider client={client}><NotificationSettings/></QueryClientProvider>);
  expect(screen.getByTestId('switch-favorites')).toBeChecked();
});

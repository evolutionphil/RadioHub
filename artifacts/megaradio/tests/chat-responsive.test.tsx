import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { availableChatHeight, useChatViewport } from '../src/hooks/use-chat-viewport';
import { getChatCopy, getProfileNavCopy } from '../src/lib/chat-copy';
import MessagesPage from '../src/pages/messages';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
vi.mock('@/hooks/useAuth', () => ({useAuth:() => ({user:{_id:'aaaaaaaaaaaaaaaaaaaaaaaa'}})}));
vi.mock('@/hooks/useTranslation', () => ({useTranslation:() => ({language:'de',localeTranslations:{messages_title:'Messages',messages_send:'Send message'},t:(_key:string,fallback:string) => fallback})}));
const json = (value: unknown, status=200) => new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
let client: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  fetchMock = vi.fn(async (url:string) => {
    if (String(url).includes('ws-ticket')) return json({},401);
    if (String(url).includes('/messages/conversations')) return json({conversations:[{partnerId:B,partner:{_id:B,username:'bob',fullName:'Bob'},lastMessage:'Hello',unreadCount:0}]});
    if (String(url).includes('/messages/contacts')) return json({contacts:[]});
    if (String(url).includes('/messages/conversation/')) return json({messages:[{_id:'111111111111111111111111',fromUserId:B,toUserId:A,content:'A very long message '+ 'x'.repeat(500),read:true,createdAt:'2026-09-14T10:00:00Z'}],partner:{_id:B,username:'bob',fullName:'Bob'},hasMore:false});
    return json({});
  });
  vi.stubGlobal('fetch',fetchMock);
  window.history.replaceState({},'', '/de/profile/messages');
});
afterEach(() => {cleanup(); client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks();});

describe('chat viewport boundaries', () => {
  it.each([
    [70, 844, undefined, 774], // iPhone, no player
    [70, 844, 740, 670], // expanded player
    [70, 420, 740, 350], // keyboard covers player: no double reservation
    [105, 900, 744, 639], // desktop player
    [70, 600, 496, 426], // short landscape display
    [70, 60, undefined, 0],
  ])('fits below top %s, viewport %s and player %s', (top,bottom,player,expected) => {
    expect(availableChatHeight(top,bottom,player)).toBe(expected);
  });

  it('reacts to visual viewport keyboard resize and player mount, removing listeners on unmount', async () => {
    const viewport = new EventTarget() as EventTarget & {height:number;offsetTop:number};
    viewport.height = 800; viewport.offsetTop=0;
    vi.stubGlobal('visualViewport',viewport);
    const rect = vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(this:Element) {
      const top = this.getAttribute('data-testid')==='global-player-wrapper' ? 650 : 70;
      return {top,bottom:top+100,height:100,left:0,right:390,width:390,x:0,y:top,toJSON:()=>({})};
    });
    function Example() {const ref=useChatViewport();return <div ref={ref} data-testid="viewport-chat"/>;}
    const view=render(<Example/>);
    await waitFor(()=>expect(screen.getByTestId('viewport-chat')).toHaveStyle({maxHeight:'730px'}));
    const player=document.createElement('div');player.setAttribute('data-testid','global-player-wrapper');
    act(()=>document.body.append(player));
    await waitFor(()=>expect(screen.getByTestId('viewport-chat')).toHaveStyle({maxHeight:'580px'}));
    act(()=>{viewport.height=400;viewport.dispatchEvent(new Event('resize'));});
    await waitFor(()=>expect(screen.getByTestId('viewport-chat')).toHaveStyle({maxHeight:'330px'}));
    const remove=vi.spyOn(viewport,'removeEventListener');view.unmount();
    expect(remove).toHaveBeenCalledWith('resize',expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll',expect.any(Function));
    player.remove();rect.mockRestore();
  });
});

it('uses one mobile pane, local scroll, a shrinking composer and keyboard-accessible conversations',async()=>{
  const scroll = vi.spyOn(Element.prototype,'scrollIntoView');
  render(<QueryClientProvider client={client}><MessagesPage/></QueryClientProvider>);
  const conversation = await screen.findByRole('button',{name:/Bob/});
  fireEvent.click(conversation);
  const field = await screen.findByRole('textbox',{name:'Nachricht an Bob'});
  expect(field.tagName).toBe('TEXTAREA');
  expect(field).toHaveClass('min-w-0','text-base');
  expect(field).toHaveStyle({height:'24px',border:'0px',padding:'0px 12px',overflowY:'hidden'});
  expect(screen.getByTestId('chat-shell')).toHaveClass('h-full','min-h-0','overflow-hidden');
  expect(screen.getByTestId('chat-conversations')).toHaveClass('hidden','md:flex');
  expect(screen.getByTestId('chat-message-scroll')).toHaveClass('min-h-0','overflow-y-auto','overscroll-contain');
  expect(screen.getByTestId('chat-composer')).toHaveClass('flex-shrink-0');
  expect(scroll).not.toHaveBeenCalled();
  expect(await screen.findByText(/^A very long message/)).toHaveClass('[overflow-wrap:anywhere]');
  expect(screen.getByRole('button',{name:'Nachricht senden'})).toBeDisabled();
  expect(screen.getByRole('heading',{name:'Nachrichten'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Zurück zu den Chats'}));
  expect(screen.getByTestId('chat-conversation')).toHaveClass('hidden','md:flex');
  expect(screen.getByTestId('chat-conversations')).not.toHaveClass('hidden');
});

it('keeps the bottom anchored on resize without disturbing someone reading older messages',async()=>{
  const callbacks = new Map<Element,ResizeObserverCallback>();
  vi.stubGlobal('ResizeObserver',class {
    constructor(private callback: ResizeObserverCallback){}
    observe(element:Element){callbacks.set(element,this.callback);}
    unobserve(element:Element){callbacks.delete(element);}
    disconnect(){}
  });
  render(<QueryClientProvider client={client}><MessagesPage/></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button',{name:/Bob/}));
  await screen.findByText(/^A very long message/);
  const scroller=screen.getByTestId('chat-message-scroll');
  Object.defineProperty(scroller,'scrollHeight',{value:1000,configurable:true});
  Object.defineProperty(scroller,'clientHeight',{value:200,configurable:true});
  act(()=>callbacks.get(scroller)!([],{} as ResizeObserver));
  scroller.scrollTop=800;fireEvent.scroll(scroller);
  // Real browser ordering: a resize-induced scroll can precede ResizeObserver.
  // Its new gap must not be mistaken for someone scrolling up to older history.
  Object.defineProperty(scroller,'clientHeight',{value:100,configurable:true});
  fireEvent.scroll(scroller);
  act(()=>callbacks.get(scroller)!([],{} as ResizeObserver));
  expect(scroller.scrollTop).toBe(1000);
  scroller.scrollTop=100;fireEvent.scroll(scroller);
  act(()=>callbacks.get(scroller)!([],{} as ResizeObserver));
  expect(scroller.scrollTop).toBe(100);
});

it('preserves composition input without prematurely sending IME text',async()=>{
  render(<QueryClientProvider client={client}><MessagesPage/></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button',{name:/Bob/}));
  const field=await screen.findByRole('textbox',{name:'Nachricht an Bob'});
  fireEvent.change(field,{target:{value:'こんにちは'}});
  fireEvent.keyDown(field,{key:'Enter',isComposing:true});
  fireEvent.keyDown(field,{key:'Enter',shiftKey:true});
  expect(fetchMock.mock.calls.some(([url])=>url==='/api/messages/send')).toBe(false);
  fireEvent.keyDown(field,{key:'Enter'});
  await waitFor(()=>expect(fetchMock.mock.calls.some(([url])=>url==='/api/messages/send')).toBe(true));
});

it('ships nonempty chat shell copy for every primary language',()=>{
  const languages=['en','es','fr','de','pt','it','ru','ar','zh','tr','ja','ko','hi','he'];
  for(const language of languages){
    const copy=getChatCopy(language);
    expect(Object.values(copy).every(value=>typeof value==='string' && value.trim().length>0)).toBe(true);
    expect(copy.message).toContain('{name}');
    if(language!=='en') expect(copy.message).not.toBe(getChatCopy('en').message);
    expect(Object.values(getProfileNavCopy(language)).every(value=>typeof value==='string' && value.trim().length>0)).toBe(true);
  }
  expect(getChatCopy('de-AT').send).toBe('Nachricht senden');
});

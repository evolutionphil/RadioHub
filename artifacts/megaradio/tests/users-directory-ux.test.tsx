import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { usersDirectoryCopy } from '../src/lib/users-directory-copy';
import { PublicProfileAvatar } from '../src/components/ui/public-profile-avatar';
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language:'de', localeTranslations:{} }) }));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({ getLocalizedUrl:(path:string)=>`/de${path}` }) }));
import UsersIndex from '../src/pages/users/index';
const clients: QueryClient[]=[];
afterEach(()=>{cleanup();clients.forEach(c=>c.clear());clients.length=0;vi.restoreAllMocks();});
function mount(){vi.spyOn(window,'scrollTo').mockImplementation(()=>{});const c=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(c);return render(<QueryClientProvider client={c}><UsersIndex/></QueryClientProvider>);}
const response=(users:any[]=[])=>new Response(JSON.stringify({users,pagination:{page:1,pages:1}}),{status:200});

it.each(ACTIVE_SITEMAP_LANGUAGES)('supplies complete directory copy for %s',language=>{
  const copy=usersDirectoryCopy(language);expect(Object.values(copy)).toHaveLength(17);
  for(const value of Object.values(copy))expect(value?.length).toBeGreaterThan(0);
  if(language!=='en')expect(copy.search).not.toBe(usersDirectoryCopy('en').search);
});
it('uses a separate non-overlapping icon, debounces search, and clears it with focus restored',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>response([{_id:'1',displayName:'Radio Friend'}]));
  mount();await screen.findByText('Radio Friend');
  const input=screen.getByRole('searchbox',{name:'Benutzer suchen'});
  expect(input).toHaveClass('min-w-0','flex-1','p-0','text-base');
  expect(screen.getByTestId('directory-search-shell')).toHaveClass('flex','gap-3');
  expect(input.previousElementSibling?.tagName.toLowerCase()).toBe('svg');
  fireEvent.change(input,{target:{value:'Ti'}});fireEvent.change(input,{target:{value:'Tina'}});
  expect(fetch).toHaveBeenCalledTimes(1);
  await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
  expect(String(fetch.mock.calls[1][0])).toContain('q=Tina');
  fireEvent.click(screen.getByRole('button',{name:'Suche löschen'}));
  expect(input).toHaveValue('');expect(input).toHaveFocus();
});
it('shows retry instead of a misleading empty result after failure and recovers',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('{}',{status:503})).mockImplementation(async()=>response([{_id:'1',fullName:'Recovered Listener'}]));
  mount();expect(await screen.findByRole('alert')).toHaveTextContent('Benutzer konnten nicht geladen werden');
  expect(screen.queryByText('Keine passenden Benutzer gefunden.')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Erneut versuchen'}));
  expect(await screen.findByText('Recovered Listener')).toBeInTheDocument();expect(fetch).toHaveBeenCalledTimes(2);
});
it('never renders private profiles and uses one whole-card accessible link',async()=>{
  vi.spyOn(globalThis,'fetch').mockImplementation(async()=>response([{_id:'1',slug:'radio-friend',fullName:'Radio Friend',favoritesCount:7},{_id:'2',fullName:'Private Person',isPublicProfile:false}]));
  mount();const link=await screen.findByRole('link',{name:'Radio Friend'});
  expect(link).toHaveAttribute('href','/de/users/radio-friend');expect(link.querySelector('button')).toBeNull();
  expect(screen.queryByText('Private Person')).toBeNull();
});
it('tries the second stored avatar once then uses request-free initials within the fixed crop',()=>{
  const view=render(<PublicProfileAvatar profile={{avatar:'/broken.jpg',profileImageUrl:'/other.jpg'}} name="Radio Friend" className="size-16"/>);
  fireEvent.error(screen.getByRole('img',{name:'Radio Friend'}));
  expect(screen.getByRole('img',{name:'Radio Friend'})).toHaveAttribute('src','/other.jpg');
  fireEvent.error(screen.getByRole('img',{name:'Radio Friend'}));
  expect(screen.getByRole('img',{name:'Radio Friend'})).toHaveTextContent('RF');expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.firstElementChild).toHaveClass('size-16','overflow-hidden','rounded-full','shrink-0');
});

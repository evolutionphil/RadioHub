import React, { Suspense, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountWithInitialHomeHandover } from '../src/lib/initial-home-handover';
import { createPreloadableComponent } from '../src/lib/preloadable-component';

const roots: Root[] = [];
afterEach(() => {
  act(() => { roots.splice(0).forEach(root => root.unmount()); });
  cleanup();
  document.body.replaceChildren();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function ssrRoot() {
  const root = document.createElement('div');
  root.id = 'root';
  root.innerHTML = '<div id="ssr-content"><main><div class="hero-container"><picture><img src="/images/hero-bg-430w.webp" alt=""></picture><h1>Radio hören</h1></div><a href="/de/radios">Sender</a></main></div>';
  document.body.append(root);
  return root;
}

it('keeps the original SSR hero until both modules are ready, then mounts once without a Loading commit', async () => {
  const root = ssrRoot();
  const originalHero = root.querySelector('img');
  const pageMount = vi.fn();
  const headerMount = vi.fn();
  function Home() {
    useEffect(() => { pageMount(); }, []);
    return <main><img src="/images/hero-bg-430w.webp" alt="" /><h1>Radio hören</h1></main>;
  }
  function Header() {
    useEffect(() => { headerMount(); }, []);
    return <nav>Header</nav>;
  }
  const homeLoad = deferred<{ default: typeof Home }>();
  const headerLoad = deferred<{ default: typeof Header }>();
  const loadHome = vi.fn(() => homeLoad.promise);
  const loadHeader = vi.fn(() => headerLoad.promise);
  const home = createPreloadableComponent(loadHome);
  const header = createPreloadableComponent(loadHeader);
  const Fallback = vi.fn(() => <div>Loading...</div>);
  const mount = vi.fn(() => {
    const app = createRoot(root);
    roots.push(app);
    app.render(<Suspense fallback={<Fallback />}><header.Component /><home.Component /></Suspense>);
  });
  let handover!: Promise<void>;
  await act(async () => {
    handover = mountWithInitialHomeHandover({ root, pathname: '/de', production: true,
      preload: () => Promise.all([home.preload(), header.preload()]), mount, onError: error => { throw error; } });
  });
  expect(home.preload()).toBe(home.preload());
  expect(header.preload()).toBe(header.preload());
  expect(loadHome).toHaveBeenCalledTimes(1);
  expect(loadHeader).toHaveBeenCalledTimes(1);
  expect(originalHero?.isConnected).toBe(true);
  expect(root.textContent).toContain('Radio hören');
  expect(mount).not.toHaveBeenCalled();
  await act(async () => { homeLoad.resolve({ default: Home }); });
  expect(originalHero?.isConnected).toBe(true);
  expect(mount).not.toHaveBeenCalled();
  await act(async () => { headerLoad.resolve({ default: Header }); await handover; });
  expect(Fallback).not.toHaveBeenCalled();
  expect(mount).toHaveBeenCalledTimes(1);
  expect(pageMount).toHaveBeenCalledTimes(1);
  expect(headerMount).toHaveBeenCalledTimes(1);
  expect(root.querySelectorAll('img')).toHaveLength(1);
  expect(root.querySelector('#ssr-content')).toBeNull();
  expect(root.textContent).not.toContain('Loading');
});

it('preserves readable SSR and reports a failed preload without mounting an incomplete app', async () => {
  const root = ssrRoot();
  const hero = root.querySelector('img');
  const error = new Error('Initial route unavailable');
  const mount = vi.fn(), onError = vi.fn();
  await mountWithInitialHomeHandover({ root, pathname: '/de', production: true,
    preload: () => Promise.reject(error), mount, onError });
  expect(mount).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith(error);
  expect(hero?.isConnected).toBe(true);
  expect(root.querySelector('a')?.getAttribute('href')).toBe('/de/radios');
});

it.each(['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'])(
  'limits the handover to a supported exact /%s home with SSR', async language => {
    const root = ssrRoot();
    const pending = deferred<void>();
    const mount = vi.fn(), preload = vi.fn(() => pending.promise);
    const task = mountWithInitialHomeHandover({ root, pathname: `/${language}`, production: true,
      preload, mount, onError: vi.fn() });
    await Promise.resolve();
    expect(preload).toHaveBeenCalledTimes(1);
    expect(mount).not.toHaveBeenCalled();
    pending.resolve();
    await task;
    expect(mount).toHaveBeenCalledTimes(1);
  },
);

it.each(['/', '/de/', '/DE', '/at', '/af', '/de/radios', '/tr/istasyon/orf-radio-wien', '/admin']) (
  'leaves the existing immediate mount unchanged for %s', async pathname => {
    const root = ssrRoot();
    const mount = vi.fn(), preload = vi.fn();
    const task = mountWithInitialHomeHandover({ root, pathname, production: true, preload, mount, onError: vi.fn() });
    expect(mount).toHaveBeenCalledTimes(1);
    expect(preload).not.toHaveBeenCalled();
    await task;
  },
);

it.each(['development', 'empty-root', 'nested-ssr', 'not-home-ssr'])(
  'does not delay %s', async kind => {
    const root = ssrRoot();
    if (kind === 'empty-root') root.replaceChildren();
    if (kind === 'nested-ssr') root.innerHTML = `<section>${root.innerHTML}</section>`;
    if (kind === 'not-home-ssr') root.innerHTML = '<div id="ssr-content"><h1>Other content</h1></div>';
    const mount = vi.fn(), preload = vi.fn();
    const task = mountWithInitialHomeHandover({ root, pathname: '/de', production: kind !== 'development', preload, mount, onError: vi.fn() });
    expect(mount).toHaveBeenCalledTimes(1);
    expect(preload).not.toHaveBeenCalled();
    await task;
  },
);

it('keeps ordinary lazy navigation state and DOM when the parent updates after loading', async () => {
  const mounted = vi.fn();
  function Page({ label }: { label: string }) {
    const [value, setValue] = useState('');
    useEffect(() => { mounted(); }, []);
    return <><p>{label}</p><input aria-label="Search" value={value} onChange={event => setValue(event.target.value)} /></>;
  }
  const pending = deferred<{ default: typeof Page }>();
  const load = vi.fn(() => pending.promise);
  const route = createPreloadableComponent(load);
  const view = render(<Suspense fallback={<p>Loading route</p>}><route.Component label="First" /></Suspense>);
  expect(screen.getByText('Loading route')).toBeInTheDocument();
  await act(async () => { pending.resolve({ default: Page }); });
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Preserve search' } });
  view.rerender(<Suspense fallback={<p>Loading route</p>}><route.Component label="Updated" /></Suspense>);
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input).toHaveValue('Preserve search');
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(1);
});

it('wires the same cached modules into App and leaves OAuth initialization before mounting', () => {
  const main = readFileSync('src/main.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const routes = readFileSync('src/components/lazy-routes.tsx', 'utf8');
  expect(main.indexOf('initOAuthTokenExchange();')).toBeLessThan(main.indexOf('void mountWithInitialHomeHandover('));
  expect(main).toContain('preload: preloadInitialHomeComponents');
  expect(main).toContain('production: import.meta.env.PROD');
  expect(app).toContain("import { RadioHeader } from '@/lib/initial-home-components'");
  expect(routes).toContain("export { InitialHome as RadioFrontend } from '@/lib/initial-home-components'");
});

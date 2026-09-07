import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GlobalPlayerContext, shellDefaults, useGlobalPlayer } from '../src/hooks/useGlobalPlayer.shell';

const runtimeEvents = vi.hoisted(() => ({ mounts: vi.fn(), unmounts: vi.fn(), play: vi.fn() }));
vi.mock('../src/hooks/useGlobalPlayer', () => ({ GlobalPlayerProvider: ({ children }: { children: React.ReactNode }) => {
  const [station, setStation] = useState<any>(null);
  useEffect(() => { runtimeEvents.mounts(); return () => { runtimeEvents.unmounts(); }; }, []);
  return <GlobalPlayerContext.Provider value={{ ...shellDefaults, currentStation: station, isHydrated: true,
    playStation: async value => { runtimeEvents.play(value); setStation(value); },
  }}>{children}</GlobalPlayerContext.Provider>;
} }));
import { LazyGlobalPlayerProvider } from '../src/hooks/LazyGlobalPlayerProvider';

let runIdle: IdleRequestCallback;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('requestIdleCallback', vi.fn(callback => { runIdle = callback; return 17; }));
  vi.stubGlobal('cancelIdleCallback', vi.fn());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('preserves the page DOM, typed state and single mount when the deferred player runtime loads', async () => {
  const pageMount = vi.fn(), pageUnmount = vi.fn();
  function Page() {
    const [query, setQuery] = useState('');
    const player = useGlobalPlayer();
    useEffect(() => { pageMount(); return () => { pageUnmount(); }; }, []);
    return <><img src="/images/hero-bg-430w.webp" alt="Hero" /><input aria-label="Station search" value={query} onChange={event => setQuery(event.target.value)} />
      <span>{player.isHydrated ? 'Player ready' : 'Player waiting'}</span>
      <button onClick={() => void player.playStation({ _id: 'one', name: 'Radio One' } as any)}>Play</button>
      <span>{player.currentStation?.name}</span></>;
  }
  const view = render(<LazyGlobalPlayerProvider><Page /></LazyGlobalPlayerProvider>);
  const originalInput = screen.getByRole('textbox');
  const originalHero = screen.getByRole('img', { name: 'Hero' });
  fireEvent.change(originalInput, { target: { value: 'typed before player loads' } });
  expect(runtimeEvents.mounts).not.toHaveBeenCalled();
  await act(async () => { runIdle({ didTimeout: false, timeRemaining: () => 50 }); });
  await waitFor(() => expect(screen.getByText('Player ready')).toBeInTheDocument());
  expect(screen.getByRole('textbox')).toBe(originalInput);
  expect(screen.getByRole('img', { name: 'Hero' })).toBe(originalHero);
  expect(originalInput).toHaveValue('typed before player loads');
  expect(pageMount).toHaveBeenCalledTimes(1);
  expect(pageUnmount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  await waitFor(() => expect(screen.getByText('Radio One')).toBeInTheDocument());
  expect(runtimeEvents.play).toHaveBeenCalledTimes(1);
  expect(runtimeEvents.mounts).toHaveBeenCalledTimes(1);
  expect(pageMount).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(runtimeEvents.unmounts).toHaveBeenCalledTimes(1);
  expect(pageUnmount).toHaveBeenCalledTimes(1);
});

it('cancels pending player initialization when its page is unmounted', () => {
  const view = render(<LazyGlobalPlayerProvider><span>Page</span></LazyGlobalPlayerProvider>);
  view.unmount();
  expect(cancelIdleCallback).toHaveBeenCalledWith(17);
  expect(runtimeEvents.mounts).not.toHaveBeenCalled();
});

it('keeps the Safari timer fallback and page identity when idle callbacks are unavailable', async () => {
  vi.unstubAllGlobals();
  vi.useFakeTimers();
  const view = render(<LazyGlobalPlayerProvider><input aria-label="Safari search" defaultValue="Preserved" /></LazyGlobalPlayerProvider>);
  const input = screen.getByRole('textbox');
  await act(async () => { await vi.advanceTimersByTimeAsync(199); });
  expect(runtimeEvents.mounts).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(runtimeEvents.mounts).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input).toHaveValue('Preserved');
  view.unmount();
  expect(runtimeEvents.unmounts).toHaveBeenCalledTimes(1);
});

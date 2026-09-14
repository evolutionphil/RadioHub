import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: { isAuthenticated: false, isLoading: false, error: null as unknown },
  player: {
    currentStation: { _id: 'one', slug: 'radio-one', name: 'Radio One', country: 'Germany' } as any,
    isPlaying: true,
    stationMeta: null,
    pauseStation: vi.fn(), stopStation: vi.fn(), resumeStation: vi.fn(),
    playStation: vi.fn(), previousStation: vi.fn(), nextStation: vi.fn(),
  },
  path: '/', mobile: false,
}));
vi.mock('../src/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => state.player }));
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => state.auth }));
vi.mock('../src/hooks/use-mobile', () => ({ useIsMobile: () => state.mobile }));
vi.mock('../src/hooks/useTranslation', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string) => fallback, language: 'en', localeTranslations: {},
}) }));
vi.mock('../src/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({
  englishPath: state.path, getLocalizedUrl: (path: string) => `/en${path}`,
}) }));
vi.mock('../src/components/ui/station-control-button-group', () => ({ default: () => null }));
vi.mock('../src/components/ui/meta-actions-button-group', () => ({ default: () => null }));
vi.mock('../src/components/ui/favorite-button', () => ({ default: () => null }));
vi.mock('../src/components/ui/animated-equalizer', () => ({ default: () => null }));
vi.mock('../src/components/ui/station-logo', () => ({ StationLogo: () => null }));

let policy: typeof import('../src/hooks/useSignupPrompt');
let GlobalPlayer: typeof import('../src/components/global-player').default;
let hidden = false;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-14T12:00:00Z'));
  localStorage.clear();
  sessionStorage.clear();
  hidden = false;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
  Object.assign(state.auth, { isAuthenticated: false, isLoading: false, error: null });
  Object.assign(state.player, {
    currentStation: { _id: 'one', slug: 'radio-one', name: 'Radio One', country: 'Germany' },
    isPlaying: true,
  });
  state.path = '/';
  state.mobile = false;
  window.history.replaceState({}, '', '/en');
  policy = await import('../src/hooks/useSignupPrompt');
  GlobalPlayer = (await import('../src/components/global-player')).default;
});

afterEach(() => {
  cleanup();
  for (const action of [state.player.pauseStation, state.player.stopStation, state.player.resumeStation,
    state.player.playStation, state.player.previousStation, state.player.nextStation]) {
    expect(action).not.toHaveBeenCalled();
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const advance = (milliseconds: number) => act(() => { vi.advanceTimersByTime(milliseconds); });
const setVisible = (visible: boolean) => act(() => {
  hidden = !visible;
  document.dispatchEvent(new Event('visibilitychange'));
});
const expectNoPrompt = () => {
  expect(screen.queryByTestId('player-signup-banner')).not.toBeInTheDocument();
  expect(screen.queryByTestId('ask-to-signup-modal')).not.toBeInTheDocument();
};
const eligibleAt = () => Number(localStorage.getItem(policy.SIGNUP_PROMPT_STORAGE_KEY));

it('honors desktop Later across station changes, playback toggles, mobile/detail navigation and remounts', () => {
  const view = render(<GlobalPlayer />);
  advance(policy.SIGNUP_BANNER_DELAY_MS - 1);
  expectNoPrompt();
  advance(1);
  expect(screen.getByTestId('player-signup-banner')).toBeInTheDocument();
  expect(screen.queryByTestId('ask-to-signup-modal')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Later' }));
  expect(eligibleAt()).toBe(Date.now() + policy.SIGNUP_PROMPT_SNOOZE_MS);
  state.player.currentStation = { _id: 'two', name: 'Radio Two' };
  view.rerender(<GlobalPlayer />);
  advance(policy.SIGNUP_MODAL_DELAY_MS * 2);
  expectNoPrompt();
  state.player.isPlaying = false;
  view.rerender(<GlobalPlayer />);
  state.player.isPlaying = true;
  state.path = '/station/radio-two';
  state.mobile = true;
  view.rerender(<GlobalPlayer />);
  advance(policy.SIGNUP_MODAL_DELAY_MS * 2);
  expectNoPrompt();
  view.unmount();
  render(<GlobalPlayer />);
  advance(policy.SIGNUP_MODAL_DELAY_MS * 2);
  expectNoPrompt();
});

it('keeps a visible desktop banner as the only invitation without escalating to a modal', () => {
  render(<GlobalPlayer />);
  advance(policy.SIGNUP_MODAL_DELAY_MS * 3);
  expect(screen.getByTestId('player-signup-banner')).toBeInTheDocument();
  expect(screen.queryByTestId('ask-to-signup-modal')).not.toBeInTheDocument();
});

it.each(['later', 'signup', 'escape'] as const)('shares the mobile modal %s dismissal with desktop and station-detail prompts', (action) => {
  state.mobile = true;
  const view = render(<GlobalPlayer />);
  advance(policy.SIGNUP_MODAL_DELAY_MS - 1);
  expectNoPrompt();
  advance(1);
  expect(screen.getByTestId('ask-to-signup-modal')).toBeInTheDocument();
  expect(screen.queryByTestId('player-signup-banner')).not.toBeInTheDocument();
  if (action === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
  else fireEvent.click(screen.getByTestId(action === 'later' ? 'signup-modal-later-button' : 'signup-modal-signup-button'));
  expect(eligibleAt()).toBe(Date.now() + policy.SIGNUP_PROMPT_SNOOZE_MS);
  expectNoPrompt();
  state.mobile = false;
  view.rerender(<GlobalPlayer />);
  advance(policy.SIGNUP_MODAL_DELAY_MS * 2);
  expectNoPrompt();
  state.path = '/station/radio-one';
  view.rerender(<GlobalPlayer />);
  advance(policy.SIGNUP_MODAL_DELAY_MS * 2);
  expectNoPrompt();
  for (let attempt = 0; attempt < 3; attempt++) {
    state.player.isPlaying = false;
    view.rerender(<GlobalPlayer />);
    state.player.currentStation = { _id: `another-${attempt}`, name: `Another Radio ${attempt}` };
    state.player.isPlaying = true;
    view.rerender(<GlobalPlayer />);
    advance(policy.SIGNUP_MODAL_DELAY_MS * 2);
    expectNoPrompt();
  }
  view.unmount();
  render(<GlobalPlayer />);
  advance(policy.SIGNUP_MODAL_DELAY_MS * 2);
  expectNoPrompt();
});

it('snoozes the desktop signup action before navigating to signup', () => {
  render(<GlobalPlayer />);
  advance(policy.SIGNUP_BANNER_DELAY_MS);
  fireEvent.click(screen.getByTestId('player-signup-button'));
  expect(eligibleAt()).toBe(Date.now() + policy.SIGNUP_PROMPT_SNOOZE_MS);
  expectNoPrompt();
});

it('uses the modal on desktop station detail without rendering the mini-player or banner', () => {
  state.path = '/station/radio-one';
  render(<GlobalPlayer />);
  advance(policy.SIGNUP_MODAL_DELAY_MS);
  expect(screen.getByTestId('ask-to-signup-modal')).toBeInTheDocument();
  expect(screen.queryByTestId('player-signup-banner')).not.toBeInTheDocument();
  expect(screen.queryByTestId('global-player-wrapper')).not.toBeInTheDocument();
});

it('persists impressions for a day and Later for a week across reloads, then allows a new invitation', async () => {
  const first = renderHook(() => policy.useSignupPrompt({ eligible: true, delayMs: 1000 }));
  advance(1000);
  expect(first.result.current.isOpen).toBe(true);
  const impressionExpiry = eligibleAt();
  expect(impressionExpiry).toBe(Date.now() + policy.SIGNUP_PROMPT_INTERVAL_MS);
  first.unmount();
  vi.resetModules();
  const reloaded = await import('../src/hooks/useSignupPrompt');
  const second = renderHook(() => reloaded.useSignupPrompt({ eligible: true, delayMs: 1000 }));
  advance(2000);
  expect(second.result.current.isOpen).toBe(false);
  second.unmount();
  vi.setSystemTime(impressionExpiry);
  const third = renderHook(() => reloaded.useSignupPrompt({ eligible: true, delayMs: 1000 }));
  advance(1000);
  expect(third.result.current.isOpen).toBe(true);
  act(() => third.result.current.dismiss());
  const snoozeExpiry = eligibleAt();
  third.unmount();
  vi.resetModules();
  const afterSnooze = await import('../src/hooks/useSignupPrompt');
  vi.setSystemTime(snoozeExpiry - 1);
  const fourth = renderHook(() => afterSnooze.useSignupPrompt({ eligible: true, delayMs: 1000 }));
  expect(fourth.result.current.isOpen).toBe(false);
  fourth.unmount();
  vi.setSystemTime(snoozeExpiry);
  const fifth = renderHook(() => afterSnooze.useSignupPrompt({ eligible: true, delayMs: 1000 }));
  advance(1000);
  expect(fifth.result.current.isOpen).toBe(true);
});

it.each(['paused', 'loading', 'authenticated', 'auth-error', 'no-station', 'signup', 'auth-route'] as const)(
  'cancels pending invitations while %s, with a fresh delay when eligible again', condition => {
    const view = render(<GlobalPlayer />);
    advance(policy.SIGNUP_BANNER_DELAY_MS - 1000);
    if (condition === 'paused') state.player.isPlaying = false;
    if (condition === 'loading') state.auth.isLoading = true;
    if (condition === 'authenticated') state.auth.isAuthenticated = true;
    if (condition === 'auth-error') state.auth.error = new Error('Unavailable');
    if (condition === 'no-station') state.player.currentStation = null;
    if (condition === 'signup') state.path = '/signup';
    if (condition === 'auth-route') state.path = '/auth/forgot-password';
    view.rerender(<GlobalPlayer />);
    advance(policy.SIGNUP_MODAL_DELAY_MS * 2);
    expectNoPrompt();
    Object.assign(state.auth, { isAuthenticated: false, isLoading: false, error: null });
    state.player.isPlaying = true;
    state.player.currentStation = { _id: 'one', name: 'Radio One' };
    state.path = '/';
    view.rerender(<GlobalPlayer />);
    advance(policy.SIGNUP_BANNER_DELAY_MS - 1);
    expectNoPrompt();
    advance(1);
    expect(screen.getByTestId('player-signup-banner')).toBeInTheDocument();
  },
);

it('does not accumulate background time or reshow an invitation after hiding and returning', () => {
  const view = render(<GlobalPlayer />);
  advance(policy.SIGNUP_BANNER_DELAY_MS - 1000);
  setVisible(false);
  advance(policy.SIGNUP_MODAL_DELAY_MS * 2);
  expectNoPrompt();
  setVisible(true);
  advance(policy.SIGNUP_BANNER_DELAY_MS - 1);
  expectNoPrompt();
  advance(1);
  expect(screen.getByTestId('player-signup-banner')).toBeInTheDocument();
  setVisible(false);
  expectNoPrompt();
  setVisible(true);
  view.rerender(<GlobalPlayer />);
  advance(policy.SIGNUP_MODAL_DELAY_MS * 2);
  expectNoPrompt();
});

it('closes an open invitation after another tab dismisses and rechecks storage before a pending delivery', async () => {
  const first = renderHook(() => policy.useSignupPrompt({ eligible: true, delayMs: 1000 }));
  advance(1000);
  expect(first.result.current.isOpen).toBe(true);
  const later = Date.now() + policy.SIGNUP_PROMPT_SNOOZE_MS;
  act(() => {
    localStorage.setItem(policy.SIGNUP_PROMPT_STORAGE_KEY, String(later));
    window.dispatchEvent(new StorageEvent('storage', { key: policy.SIGNUP_PROMPT_STORAGE_KEY, newValue: String(later) }));
  });
  expect(first.result.current.isOpen).toBe(false);
  first.unmount();
  localStorage.clear();
  vi.resetModules();
  const newTab = await import('../src/hooks/useSignupPrompt');
  const second = renderHook(() => newTab.useSignupPrompt({ eligible: true, delayMs: 1000 }));
  advance(500);
  localStorage.setItem(policy.SIGNUP_PROMPT_STORAGE_KEY, String(later));
  advance(500);
  expect(second.result.current.isOpen).toBe(false);
});

it('shows at most one invitation when multiple players mount together in StrictMode', () => {
  const pair = renderHook(() => ({
    first: policy.useSignupPrompt({ eligible: true, delayMs: 1000 }),
    second: policy.useSignupPrompt({ eligible: true, delayMs: 1000 }),
  }), { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });
  advance(1000);
  expect([pair.result.current.first.isOpen, pair.result.current.second.isOpen].filter(Boolean)).toHaveLength(1);
  act(() => (pair.result.current.first.isOpen ? pair.result.current.first : pair.result.current.second).dismiss());
  expect(pair.result.current.first.isOpen).toBe(false);
  expect(pair.result.current.second.isOpen).toBe(false);
});

it('retains Later across remounts when both browser storage reads and writes throw', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'QuotaExceededError'); });
  const first = renderHook(() => policy.useSignupPrompt({ eligible: true, delayMs: 1000 }));
  advance(1000);
  expect(first.result.current.isOpen).toBe(true);
  act(() => first.result.current.dismiss());
  first.unmount();
  const second = renderHook(() => policy.useSignupPrompt({ eligible: true, delayMs: 1000 }));
  advance(policy.SIGNUP_MODAL_DELAY_MS * 2);
  expect(second.result.current.isOpen).toBe(false);
});

it('retains Later when storage writes succeed but subsequent reads fail', () => {
  const first = renderHook(() => policy.useSignupPrompt({ eligible: true, delayMs: 1000 }));
  advance(1000);
  act(() => first.result.current.dismiss());
  expect(eligibleAt()).toBe(Date.now() + policy.SIGNUP_PROMPT_SNOOZE_MS);
  first.unmount();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  const second = renderHook(() => policy.useSignupPrompt({ eligible: true, delayMs: 1000 }));
  advance(policy.SIGNUP_MODAL_DELAY_MS * 2);
  expect(second.result.current.isOpen).toBe(false);
});

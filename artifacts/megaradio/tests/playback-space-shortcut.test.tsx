import React, { StrictMode, useState } from 'react';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { usePlaybackSpaceShortcut } from '../src/hooks/usePlaybackSpaceShortcut';

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

const space = (target: EventTarget = document.body, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true, composed: true, ...init });
  fireEvent(target, event);
  return event;
};
const options = () => ({ enabled: true, isPlaying: true, pause: vi.fn(), resume: vi.fn() });

it('pauses and resumes the same station on successive Space presses without scrolling', () => {
  const pause = vi.fn(), resume = vi.fn();
  function Player() {
    const [playing, setPlaying] = useState(true);
    usePlaybackSpaceShortcut({ enabled: true, isPlaying: playing,
      pause: () => { pause(); setPlaying(false); }, resume: () => { resume(); setPlaying(true); } });
    return <span>{playing ? 'Playing Radio One' : 'Paused Radio One'}</span>;
  }
  render(<StrictMode><Player /></StrictMode>);
  expect(space().defaultPrevented).toBe(true);
  expect(screen.getByText('Paused Radio One')).toBeInTheDocument();
  expect(space().defaultPrevented).toBe(true);
  expect(screen.getByText('Playing Radio One')).toBeInTheDocument();
  expect(pause).toHaveBeenCalledTimes(1);
  expect(resume).toHaveBeenCalledTimes(1);
});

it('does not change playback or normal scrolling without a current station', () => {
  const state = { ...options(), enabled: false };
  renderHook(() => usePlaybackSpaceShortcut(state));
  expect(space().defaultPrevented).toBe(false);
  expect(state.pause).not.toHaveBeenCalled();
  expect(state.resume).not.toHaveBeenCalled();
});

it('uses the latest callbacks and playback state, and cleans up after stopping/unmounting', () => {
  const state = options();
  const view = renderHook(props => usePlaybackSpaceShortcut(props), { initialProps: state });
  const next = { ...options(), isPlaying: false };
  view.rerender(next);
  space();
  expect(next.resume).toHaveBeenCalledTimes(1);
  expect(state.pause).not.toHaveBeenCalled();
  view.rerender({ ...next, enabled: false });
  expect(space().defaultPrevented).toBe(false);
  view.rerender(next);
  view.unmount();
  expect(space().defaultPrevented).toBe(false);
  expect(next.resume).toHaveBeenCalledTimes(1);
});

it('ignores held-key repeats but still prevents page scrolling', () => {
  const state = options();
  renderHook(() => usePlaybackSpaceShortcut(state));
  space();
  expect(space(document.body, { repeat: true }).defaultPrevented).toBe(true);
  expect(state.pause).toHaveBeenCalledTimes(1);
});

it.each(['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing'] as const)('preserves %s shortcuts and composition', modifier => {
  const state = options();
  renderHook(() => usePlaybackSpaceShortcut(state));
  expect(space(document.body, { [modifier]: true }).defaultPrevented).toBe(false);
  expect(state.pause).not.toHaveBeenCalled();
});

it.each(['Enter', 'k', '/'])('does not intercept %s', key => {
  const state = options();
  renderHook(() => usePlaybackSpaceShortcut(state));
  expect(space(document.body, { key, code: '' }).defaultPrevented).toBe(false);
  expect(state.pause).not.toHaveBeenCalled();
});

it.each([' ', 'Spacebar'])('supports key-only Space events (%s)', key => {
  const state = options();
  renderHook(() => usePlaybackSpaceShortcut(state));
  expect(space(document.body, { key, code: '' }).defaultPrevented).toBe(true);
  expect(state.pause).toHaveBeenCalledTimes(1);
});

it.each([
  '<input />', '<textarea></textarea>', '<select><option>One</option></select>',
  '<button><span>Like</span></button>', '<a href="/search"><span>Search</span></a>',
  '<div contenteditable="true"><span>Editor</span></div>',
  '<div contenteditable="plaintext-only"><span>Editor</span></div>',
  '<div role="slider" tabindex="0"></div>', '<div role="checkbox" tabindex="0"></div>',
  '<div role="combobox"><span>Country</span></div>', '<div role="menuitem"><span>Menu</span></div>',
  '<div role="dialog"><p>Dialog content</p></div>', '<dialog open><p>Dialog content</p></dialog>',
  '<video controls></video>', '<audio controls></audio>', '<details><summary>More</summary></details>',
])('does not hijack text, controls or modal content: %s', html => {
  const state = options();
  renderHook(() => usePlaybackSpaceShortcut(state));
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  const target = wrapper.querySelector('span,p,summary') ?? wrapper.firstElementChild!;
  expect(space(target).defaultPrevented).toBe(false);
  expect(state.pause).not.toHaveBeenCalled();
});

it('lets users type spaces and activate focused buttons normally', async () => {
  const user = userEvent.setup();
  const state = options(), click = vi.fn();
  function Page() {
    usePlaybackSpaceShortcut(state);
    return <><input aria-label="Search" /><button onClick={click}>Favorite</button></>;
  }
  render(<Page />);
  await user.type(screen.getByRole('textbox'), 'Radio One');
  expect(screen.getByRole('textbox')).toHaveValue('Radio One');
  await user.tab();
  await user.keyboard(' ');
  expect(click).toHaveBeenCalledTimes(1);
  expect(state.pause).not.toHaveBeenCalled();
});

it('respects prevented events, focused editors and controls inside shadow roots', () => {
  const state = options();
  renderHook(() => usePlaybackSpaceShortcut(state));
  const cancelled = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  cancelled.preventDefault();
  fireEvent(document.body, cancelled);
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  expect(space(window).defaultPrevented).toBe(false);
  input.blur();
  const host = document.createElement('div');
  document.body.append(host);
  const shadowInput = document.createElement('input');
  host.attachShadow({ mode: 'open' }).append(shadowInput);
  expect(space(shadowInput).defaultPrevented).toBe(false);
  expect(state.pause).not.toHaveBeenCalled();
});

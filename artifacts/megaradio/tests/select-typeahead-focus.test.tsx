import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../src/components/ui/select';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function openSelect(onValueChange = vi.fn()) {
  return render(<Select defaultOpen onValueChange={onValueChange}>
    <SelectTrigger aria-label="Choose a station"><SelectValue placeholder="Choose" /></SelectTrigger>
    <SelectContent><SelectItem value="alpha">Alpha</SelectItem><SelectItem value="bravo">Bravo</SelectItem></SelectContent>
  </Select>);
}

it('ignores delayed typeahead focus after the select has unmounted', () => {
  const view = openSelect();
  const alpha = screen.getByRole('option', { name: 'Alpha' });
  alpha.focus();
  vi.useFakeTimers();
  fireEvent.keyDown(alpha, { key: 'b' });
  view.unmount();
  expect(() => act(() => { vi.advanceTimersByTime(0); })).not.toThrow();
});

it('still focuses a mounted typeahead match and selects it with Enter', () => {
  const onValueChange = vi.fn();
  openSelect(onValueChange);
  const alpha = screen.getByRole('option', { name: 'Alpha' });
  const bravo = screen.getByRole('option', { name: 'Bravo' });
  alpha.focus();
  vi.useFakeTimers();
  fireEvent.keyDown(alpha, { key: 'b' });
  act(() => { vi.advanceTimersByTime(0); });
  expect(bravo).toHaveFocus();
  fireEvent.keyDown(bravo, { key: 'Enter' });
  expect(onValueChange).toHaveBeenCalledWith('bravo');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

import React from 'react';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '../src/lib/theme-provider';
afterEach(() => { cleanup(); document.body.classList.remove('admin-theme'); document.documentElement.classList.remove('dark', 'light'); localStorage.removeItem('admin-theme-test'); });
it('admin light theme wins over saved dark mode without overwriting the public preference', () => {
  localStorage.setItem('admin-theme-test', 'dark'); document.body.classList.add('admin-theme');
  render(<ThemeProvider storageKey="admin-theme-test"><span>Admin</span></ThemeProvider>);
  expect(document.documentElement).toHaveClass('light'); expect(document.documentElement).not.toHaveClass('dark');
  expect(localStorage.getItem('admin-theme-test')).toBe('dark');
});
it('public dark mode is unchanged when admin is not mounted', () => {
  render(<ThemeProvider defaultTheme="dark" storageKey="admin-theme-test"><span>Public</span></ThemeProvider>);
  expect(document.documentElement).toHaveClass('dark');
});
it('admin body and portal tokens are HSL channels, not nested CSS colors', () => {
  const css = readFileSync(new NodeURL('../src/styles/admin-theme.css', import.meta.url), 'utf8');
  expect(css).toContain('body.admin-theme');
  for (const name of ['background', 'foreground', 'card', 'popover', 'border', 'destructive', 'muted', 'ring']) {
    expect(css).toMatch(new RegExp(`--${name}: [\\d.]+ [\\d.]+% [\\d.]+%;`));
  }
});

import React, { StrictMode } from 'react';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PrivacySettingsButton, { PRIVACY_SETTINGS_LABELS } from '../src/components/ads/PrivacySettingsButton';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';

const host = window as any;
afterEach(() => { cleanup(); delete host.googlefc; });

it('waits without loading scripts, timers, or changing visitor consent', () => {
  delete host.googlefc;
  const scripts = document.scripts.length;
  render(<PrivacySettingsButton language="de" />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(document.scripts.length).toBe(scripts);
  expect(host.googlefc.callbackQueue).toHaveLength(1);
});

it('uses the documented queue only after a visitor clicks, keeping the Google instance', () => {
  const show = vi.fn();
  const queue = { push: vi.fn((entry: any) => typeof entry === 'function' ? entry() : entry.CONSENT_API_READY()) };
  const api = host.googlefc = { callbackQueue: queue, showRevocationMessage: show };
  render(<PrivacySettingsButton language="de" />);
  expect(show).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: PRIVACY_SETTINGS_LABELS.de }));
  expect(host.googlefc).toBe(api);
  expect(show).toHaveBeenCalledTimes(1);
  expect(queue.push).toHaveBeenCalledTimes(2);
});

it('covers every supported site locale without English fallback', () => {
  expect(Object.keys(PRIVACY_SETTINGS_LABELS).sort()).toEqual([...ACTIVE_SITEMAP_LANGUAGES].sort());
  for (const language of ACTIVE_SITEMAP_LANGUAGES.filter(code => code !== 'en')) {
    expect(PRIVACY_SETTINGS_LABELS[language]).not.toBe(PRIVACY_SETTINGS_LABELS.en);
  }
});

it('handles a delayed API and StrictMode cleanup without automatically reopening consent', () => {
  host.googlefc = { callbackQueue: [] };
  const view = render(<StrictMode><PrivacySettingsButton language="tr" /></StrictMode>);
  const show = host.googlefc.showRevocationMessage = vi.fn();
  act(() => host.googlefc.callbackQueue.forEach((entry: any) => entry.CONSENT_API_READY()));
  expect(screen.getByRole('button', { name: PRIVACY_SETTINGS_LABELS.tr })).toBeVisible();
  expect(show).not.toHaveBeenCalled();
  view.unmount();
  act(() => host.googlefc.callbackQueue.forEach((entry: any) => entry.CONSENT_API_READY()));
  expect(show).not.toHaveBeenCalled();
});

it('does not expose a broken action when the consent API is unavailable', () => {
  host.googlefc = { callbackQueue: { push: (entry: any) => entry.CONSENT_API_READY() } };
  render(<PrivacySettingsButton language="de" />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('can reopen at API readiness without waiting for consent data or a previous decision', () => {
  const show = vi.fn();
  const pendingData: unknown[] = [];
  host.googlefc = { showRevocationMessage: show, callbackQueue: {
    push(entry: any) { if (typeof entry === 'function') pendingData.push(entry); else entry.CONSENT_API_READY(); },
  } };
  render(<PrivacySettingsButton language="tr" />);
  fireEvent.click(screen.getByTestId('privacy-settings'));
  expect(show).toHaveBeenCalledTimes(1);
  expect(pendingData).toHaveLength(0);
});

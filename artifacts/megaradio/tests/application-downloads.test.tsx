import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { applicationDownloadCopy, applicationStoreUrl } from '../src/lib/application-downloads';
import { AppDownloadLink } from '../src/components/links/AppDownloadLink';
import { Applications } from '../src/pages/applications';

const state = vi.hoisted(() => ({ language: 'de', manifest: undefined as unknown }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: state.language, t: (key: string, fallback?: string) => fallback || key }) }));
vi.mock('@/components/SeoHead', () => ({ SeoHead: () => null }));
vi.mock('@/lib/queryClient', () => ({ resolveApiUrl: (path: string) => path }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: state.manifest }) }));

describe('configured app downloads', () => {
  it('keeps TV and mobile destinations distinct and never substitutes an absent Apple listing', () => {
    const config = { storeUrl: { android: 'https://play.google.com/store/apps/details?id=mobile',
      androidtv: 'https://play.google.com/store/apps/details?id=tv', ios: '', tvos: '',
      desktop: 'https://github.com/owner/desktop/releases/latest' } };
    expect(applicationStoreUrl(config, 'android')).toContain('id=mobile');
    expect(applicationStoreUrl(config, 'androidtv')).toContain('id=tv');
    expect(applicationStoreUrl(config, 'ios')).toBeUndefined();
    expect(applicationStoreUrl(config, 'tvos')).toBeUndefined();
    expect(applicationStoreUrl(config, 'macos')).toBeUndefined();
    state.manifest = config;
    const { container } = render(<Applications />);
    const anchors = [...container.querySelectorAll('a')];
    expect(anchors.map(a => a.href)).toEqual([config.storeUrl.androidtv, config.storeUrl.android]);
    expect(container.querySelectorAll('[aria-disabled="true"]')).toHaveLength(4);
    expect(container.querySelector('[href="#"]')).toBeNull();
    expect(screen.getAllByText('Download-Link nicht verfügbar', { exact: false })).toHaveLength(4);
  });
  it('renders missing destinations without a focusable or clickable placeholder', () => {
    const { container } = render(<AppDownloadLink unavailableLabel="Nicht verfügbar">App Store</AppDownloadLink>);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).toHaveAttribute('title', 'Nicht verfügbar');
    expect(link).not.toHaveAttribute('href');
    expect(link).not.toHaveAttribute('tabindex');
    expect(container.querySelector('a')).toBeNull();
  });
  it('uses a valid Apple app listing only for its specified platform', () => {
    const listing = 'https://apps.apple.com/de/app/mega-radio/id123456789';
    expect(applicationStoreUrl({ storeUrl: { ios: listing } }, 'ios')).toBe(listing);
    expect(applicationStoreUrl({ storeUrl: { ios: listing } }, 'macos')).toBeUndefined();
  });
  it.each(['#', 'javascript:alert(1)', 'http://play.google.com/store/apps/details?id=a',
    'https://play.google.com.evil.test/store/apps/details?id=a',
    'https://user:secret@play.google.com/store/apps/details?id=a',
    'https://play.google.com/store', 'https://play.google.com/store/apps/details',
    'https://github.com/owner/releases/latest'])('rejects non-listing or unsafe Android target %s', target => {
    expect(applicationStoreUrl({ storeUrl: { android: target } }, 'android')).toBeUndefined();
  });
  it.each(['en','de','tr','es','fr','pt','it','ru','ar','zh','ja','ko','hi','he'])('%s has localized availability text', language => {
    const copy = applicationDownloadCopy(language);
    expect(copy.unavailable.length).toBeGreaterThan(5);
    if (language !== 'en') expect(copy.unavailable).not.toBe(applicationDownloadCopy('en').unavailable);
  });
});

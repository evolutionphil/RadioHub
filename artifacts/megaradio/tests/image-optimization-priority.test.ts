import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/utils', () => ({ getStreamProxyUrl: (url: string) => url }));

import { enhanceImage, preloadCriticalImages } from '../src/utils/image-optimization';

const requested: string[] = [];

beforeEach(() => {
  requested.length = 0;
  document.head.innerHTML = '';
  window.history.replaceState({}, '', '/');
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,');
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('min-width'),
  })));
  vi.stubGlobal('Image', class {
    onload?: () => void;
    set src(value: string) {
      requested.push(value);
      queueMicrotask(() => this.onload?.());
    }
  });
});

afterEach(() => {
  document.head.innerHTML = '';
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('image loading priority', () => {
  it.each(['fetchpriority', 'data-priority'])('keeps %s=high images eager', attribute => {
    const img = document.createElement('img');
    img.setAttribute(attribute, 'high');
    enhanceImage(img);
    expect(img.loading).toBe('eager');
  });

  it('repairs an explicit lazy/high priority conflict', () => {
    const img = document.createElement('img');
    img.setAttribute('fetchpriority', 'high');
    img.setAttribute('loading', 'lazy');
    enhanceImage(img);
    expect(img.loading).toBe('eager');
  });

  it('preserves explicit eager loading and lazily enhances unmarked images', () => {
    const eager = document.createElement('img');
    eager.setAttribute('loading', 'eager');
    enhanceImage(eager);
    expect(eager.getAttribute('loading')).toBe('eager');
    const ordinary = document.createElement('img');
    enhanceImage(ordinary);
    expect(ordinary.loading).toBe('lazy');
  });
});

describe('critical image fallback preloads', () => {
  it('loads only the desktop hero on desktop home without HTML hints', async () => {
    await preloadCriticalImages();
    expect(requested).toEqual(['/header-logo-80w.webp', '/images/hero-bg.webp']);
  });

  it('loads only the mobile hero on a localized mobile home', async () => {
    window.history.replaceState({}, '', '/tr');
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    await preloadCriticalImages();
    expect(requested).toEqual(['/header-logo-80w.webp', '/images/hero-bg-430w.webp']);
  });

  it.each(['/station/example', '/tr/istasyon/example', '/admin/dashboard', '/genres'])('does not preload a hero on %s', async pathname => {
    window.history.replaceState({}, '', pathname);
    await preloadCriticalImages();
    expect(requested).toEqual(['/header-logo-80w.webp']);
  });

  it('does not duplicate matching HTML preloads', async () => {
    document.head.innerHTML = `
      <link rel="preload" as="image" href="/header-logo-80w.webp">
      <link rel="preload" as="image" href="/images/hero-bg.webp" media="(min-width: 768px)">
      <link rel="preload" as="image" href="/images/hero-bg-430w.webp" media="(max-width: 767px)">
    `;
    await preloadCriticalImages();
    expect(requested).toEqual([]);
  });

  it('ignores a hint whose media query does not match', async () => {
    document.head.innerHTML = '<link rel="preload" as="image" href="/images/hero-bg.webp" media="(max-width: 767px)">';
    await preloadCriticalImages();
    expect(requested).toContain('/images/hero-bg.webp');
  });
});

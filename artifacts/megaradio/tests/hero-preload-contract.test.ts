import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SSR and SPA hero preload contract', () => {
  it('both heads use the same media-specific sources as the rendered picture', () => {
    const server = readFileSync(path.resolve(import.meta.dirname, '../../api-server/src/index-web.ts'), 'utf8');
    const shell = readFileSync(path.resolve(import.meta.dirname, '../index.html'), 'utf8');
    const home = readFileSync(path.resolve(import.meta.dirname, '../src/pages/radio-frontend.tsx'), 'utf8');
    const heroConditional = server.match(/\$\{pageType === 'home' \? '([^']+)' : ''\}/)?.[1];
    expect(heroConditional).toBeTruthy();
    const parser = new DOMParser();
    const ssr = parser.parseFromString(heroConditional!, 'text/html');
    const spa = parser.parseFromString(shell, 'text/html');
    for (const [href, media] of [
      ['/images/hero-bg-430w.webp', '(max-width: 767px)'],
      ['/images/hero-bg.webp', '(min-width: 768px)'],
    ]) {
      for (const document of [ssr, spa]) {
        const preload = document.querySelector(`link[rel="preload"][href="${href}"]`);
        expect(preload?.getAttribute('media')).toBe(media);
        expect(preload?.getAttribute('fetchpriority')).toBe('high');
        expect(preload?.hasAttribute('imagesrcset')).toBe(false);
      }
    }
    expect(home).toContain('<source media="(min-width: 768px)" srcSet="/images/hero-bg.webp"');
    expect(home).toContain('src="/images/hero-bg-430w.webp"');
  });
});

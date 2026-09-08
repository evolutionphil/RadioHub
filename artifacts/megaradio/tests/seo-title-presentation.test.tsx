import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { normalizeSeoTitle, normalizeSeoTitleTags, type SeoMetaTags } from '@workspace/seo-shared/seo-config';
import { SeoHead } from '../src/components/seo/SeoHead';

describe('shared SEO title presentation', () => {
  const full = 'Radyo Akışı SSS — Çevrimiçi Radyo Hakkında Sık Sorulan Sorular | Mega Radio';
  it('caps presentation while retaining the full brand and original input', () => {
    const input = { title: full, ogTitle: full, twitterTitle: full, canonical: 'https://themegaradio.com/tr/faq' };
    const result = normalizeSeoTitleTags(input);
    expect(input.title).toBe(full);
    expect(result.title.length).toBeLessThanOrEqual(70);
    expect(result.title).toMatch(/ \| Mega Radio$/);
    expect(result.ogTitle).toBe(result.title);
    expect(result.twitterTitle).toBe(result.title);
    expect(result.canonical).toBe(input.canonical);
    expect(normalizeSeoTitle(result.title)).toBe(result.title);
  });
  it('uses the same title for live document and social cards', () => {
    render(<SeoHead seoData={{ title: full, ogTitle: full, twitterTitle: full,
      description: 'Türkçe açıklama', canonical: 'https://themegaradio.com/tr/faq' } as SeoMetaTags} />);
    const expected = normalizeSeoTitle(full);
    expect(document.title).toBe(expected);
    expect(document.querySelector('meta[property="og:title"]')).toHaveAttribute('content', expected);
    expect(document.querySelector('meta[name="twitter:title"]')).toHaveAttribute('content', expected);
  });
  it('retains short custom names, quotes and unknown-language strings without inventing content', () => {
    for (const title of ['Radio "A&B"', '世界のラジオ', 'Meine eigene Überschrift']) expect(normalizeSeoTitle(title)).toBe(title);
    expect(normalizeSeoTitle('')).toBeTruthy();
    expect(normalizeSeoTitle('A'.repeat(90)).length).toBe(70);
  });
});

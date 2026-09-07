import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SeoHead } from '../src/components/seo/SeoHead';
import { buildDirectoryIndexSeo } from '@workspace/seo-shared/directory-index-seo';
import { generateSeoTags, SITEMAP_PRIORITY_LANGUAGES, truncateAtWordBoundary } from '@workspace/seo-shared/seo-config';
import { translateUrl } from '@workspace/seo-shared/url-translations';

afterEach(() => { cleanup(); document.head.innerHTML = ''; });
for (const kind of ['genres','regions'] as const) for (const language of SITEMAP_PRIORITY_LANGUAGES.universal14) {
  it(`${language}/${kind}: React preserves the shared localized head and URL signals`, () => {
    const originalPath = `/${language}${translateUrl(`/${kind}`,language)}`;
    const data = generateSeoTags(kind,language,{},`/${kind}`,'https://themegaradio.com',undefined,originalPath,originalPath);
    const expected = buildDirectoryIndexSeo(kind,language);
    const before = JSON.stringify(data);
    render(<SeoHead seoData={data} />);
    expect(document.title).toBe(expected.title);
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(truncateAtWordBoundary(expected.description,160));
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(expected.title);
    expect(document.querySelector('meta[name="twitter:title"]')?.getAttribute('content')).toBe(expected.title);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(data.canonical);
    expect(document.querySelectorAll('link[rel="alternate"][hreflang]')).toHaveLength(data.hreflangs!.length);
    for (const alternate of data.hreflangs!) {
      expect(document.querySelector(`link[hreflang="${alternate.hreflang}"]`)?.getAttribute('href')).toBe(alternate.url);
    }
    expect(JSON.stringify(data)).toBe(before);
  });
}

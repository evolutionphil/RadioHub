import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { LEGAL_CONTENT, getLegalContent, resolveLegalLocale, LEGAL_LOCALES, LEGAL_REVIEWED_AT, LEGAL_CONTACT_EMAIL } from '@workspace/seo-shared/legal-content';
import { renderLegalPageHtml } from '@workspace/seo-shared/legal-content-html';
import { PrivacyPolicy } from '../src/pages/privacy-policy';
import { TermsAndConditions } from '../src/pages/terms-and-conditions';

const state = vi.hoisted(() => ({ language: 'en' }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: state.language, t: (key: string) => key }) }));
vi.mock('@/components/SeoHead', () => ({ SeoHead: () => null }));
afterEach(cleanup);

describe('published legal text localization', () => {
  it('covers the exact fourteen active sitemap languages', () => {
    expect([...LEGAL_LOCALES].sort()).toEqual([...ACTIVE_SITEMAP_LANGUAGES].sort());
    expect(Object.keys(LEGAL_CONTENT).sort()).toEqual([...LEGAL_LOCALES].sort());
  });
  for (const locale of LEGAL_LOCALES) {
    for (const kind of ['privacy', 'terms'] as const) {
      it(`${locale}/${kind} retains every original section, paragraph and list item`, () => {
        const page = LEGAL_CONTENT[locale][kind];
        const original = LEGAL_CONTENT.en[kind];
        expect(page.sections).toHaveLength(kind === 'privacy' ? 10 : 13);
        expect(page.title.trim()).not.toBe('');
        expect(page.subtitle.trim()).not.toBe('');
        page.sections.forEach((section, index) => {
          const source = original.sections[index];
          expect(section.title.trim()).not.toBe('');
          expect(Boolean(section.text)).toBe(Boolean(source.text));
          expect(section.items?.length).toBe(source.items?.length);
          expect(section.groups?.length).toBe(source.groups?.length);
          expect(section.contact).toBe(source.contact);
          if (section.text && locale !== 'en') expect(section.text).not.toBe(source.text);
          section.items?.forEach((text) => expect(text.trim()).not.toBe(''));
          section.groups?.forEach((group, groupIndex) => {
            expect(group.title.trim()).not.toBe('');
            expect(group.text.trim()).not.toBe('');
            expect(group.items).toHaveLength(source.groups![groupIndex].items.length);
            if (locale !== 'en') expect(group.text).not.toBe(source.groups![groupIndex].text);
          });
        });
        const body = JSON.stringify(page);
        expect(body).toContain(kind === 'terms' ? '30' : '100');
        expect(body).not.toMatch(/123 Radio Street|Music City|\$\{|<script/i);
      });
      it(`${locale}/${kind} renders all body content in the selected locale`, () => {
        state.language = locale;
        const { container } = render(kind === 'privacy' ? <PrivacyPolicy /> : <TermsAndConditions />);
        const page = LEGAL_CONTENT[locale][kind];
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(page.title);
        expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(page.sections.length);
        expect(container.querySelector('[lang]')?.getAttribute('lang')).toBe(locale);
        expect(container.querySelector('[dir]')?.getAttribute('dir')).toBe(['ar', 'he'].includes(locale) ? 'rtl' : 'ltr');
        for (const section of page.sections) {
          if (section.text) expect(screen.getByText(section.text)).toBeTruthy();
          section.items?.forEach(item => expect(screen.getByText(item)).toBeTruthy());
        }
        expect(screen.getByText(LEGAL_CONTACT_EMAIL[kind])).toBeTruthy();
        expect(container.textContent).not.toContain('123 Radio Street');
        expect(container.textContent).not.toContain('Last updated:');
        expect(container.textContent).not.toContain('page_privacy_policy');
        const ssr = document.createElement('div');
        ssr.innerHTML = renderLegalPageHtml(kind, locale);
        const blocks = (root: Element) => Array.from(root.querySelectorAll('h1,h2,h3,p,li'))
          .map(node => node.textContent?.replace(/\s+/g, ' ').trim());
        expect(blocks(ssr)).toEqual(blocks(container));
        expect(ssr.querySelectorAll('h1')).toHaveLength(1);
        expect(ssr.querySelector('main')?.getAttribute('lang')).toBe(locale);
      });
    }
  }
  it('normalizes device variants and explicitly labels unsupported copy as English', () => {
    expect(resolveLegalLocale('de-AT')).toBe('de');
    expect(resolveLegalLocale('pt_BR')).toBe('pt');
    expect(getLegalContent('zz')).toBe(LEGAL_CONTENT.en);
    expect(LEGAL_REVIEWED_AT).toBeNull();
  });
});

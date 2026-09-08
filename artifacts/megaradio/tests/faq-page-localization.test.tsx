import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FAQ_PAGE_ITEMS, resolveFaqPageItems } from '@workspace/seo-shared/faq-schema';
import FaqPage from '../src/pages/faq';
const state = vi.hoisted(() => ({ language: 'de', translations: {} as Record<string, string> }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string, fallback: string) => state.translations[key] ?? fallback }) }));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({ currentLanguage: state.language, getLocalizedUrl: (path: string) => `/${state.language}/localized${path}` }) }));
vi.mock('@/components/SeoHead', () => ({ SeoHead: () => null }));
describe('missing appended FAQ locale keys', () => {
  it.each(['en','de','tr','es','fr','pt','it','ru','ar','zh','ja','ko','hi','he'])('%s resolves matching visible Q&A without English seed fallback', language => {
    state.language = language; state.translations = {};
    const items = resolveFaqPageItems(language, (_key, fallback) => fallback);
    expect(items).toHaveLength(15);
    expect(items[13].answer.length).toBeGreaterThan(20);
    expect(items[13].answer).not.toContain('57');
    if (language !== 'en') for (const [index, item] of items.slice(10).entries()) {
      expect(item.question).not.toBe(FAQ_PAGE_ITEMS[index + 10].qFallback);
      expect(item.answer).not.toBe(FAQ_PAGE_ITEMS[index + 10].aFallback);
    }
    render(<FaqPage />);
    fireEvent.click(screen.getByTestId('faq-toggle-13'));
    expect(screen.getByText(items[13].question)).toBeInTheDocument();
    expect(screen.getByText(items[13].answer)).toBeInTheDocument();
    expect(screen.getByTestId('link-contact')).toHaveAttribute('href', `/${language}/localized/contact`);
  });
  it('keeps existing localized and custom first-ten copy, replacing only exact known seed values', () => {
    const custom = { faq_what_is_radio: 'Custom first question', faq_how_search: 'Meine eigene Suchfrage',
      faq_how_search_answer: 'Meine eigene Antwort', faq_languages_supported_answer: 'Our interface is available in 57 languages and stations broadcast in dozens more — local language broadcasting from every region.' };
    const items = resolveFaqPageItems('de', (key, fallback) => custom[key as keyof typeof custom] ?? fallback);
    expect(items[0].question).toBe(custom.faq_what_is_radio);
    expect(items[10].question).toBe(custom.faq_how_search);
    expect(items[10].answer).toBe(custom.faq_how_search_answer);
    expect(items[13].answer).not.toContain('57');
    const seeded = resolveFaqPageItems('de', (key, fallback) => key === 'faq_how_search' ? FAQ_PAGE_ITEMS[10].qFallback : fallback);
    expect(seeded[10].question).not.toBe(FAQ_PAGE_ITEMS[10].qFallback);
  });
});

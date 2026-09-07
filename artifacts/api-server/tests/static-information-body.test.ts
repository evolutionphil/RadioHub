import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, mock, test } from 'node:test';
import { renderStaticInformationBody } from '../src/seo/static-information-body';
import { buildStaticPageSeo } from '@workspace/seo-shared/static-page-seo-templates';

mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, { namedExports: {
  performanceCache: { getTranslations: () => null, setTranslations: () => {}, getPageData: () => null, setPageData: () => {}, getUrlTranslations: async () => new Map(), getStats: () => ({ hits: 0, misses: 0 }) },
  PerformanceCache: class {}, deepFreeze: <T,>(value: T) => value,
} });
let renderer: { generateHtmlBody(input: any): string };
before(async () => { const { SeoRenderer } = await import('../src/seo-renderer'); renderer = new SeoRenderer(); });
const locales = ['en','de','tr','es','fr','pt','it','ru','ar','zh','ja','ko','hi','he'];
const source = (page: string) => readFileSync(new URL(`../../megaradio/src/pages/${page}.tsx`, import.meta.url), 'utf8');
const keys = (page: string) => [...new Set([...source(page).matchAll(/\bt\(['"]([^'"]+)/g)].map(m => m[1]))];

for (const language of locales) {
  test(`${language} About SSR retains every visible translated paragraph and title`, () => {
    const translations = Object.fromEntries(keys('about').map(key => [key, `${language}:${key}`]));
    const body = renderer.generateHtmlBody({ pageType: 'about', language, translations });
    for (const key of keys('about')) assert.ok(body.includes(`${language}:${key}`), key);
    assert.equal((body.match(/<h1\b/g) || []).length, 1);
    assert.equal((body.match(/<section\b/g) || []).length, 4);
    assert.ok(body.indexOf('<h1') < body.indexOf('<h2'));
    assert.equal((body.match(/<li>/g) || []).length, 7);
    const frame = readFileSync(new URL('../../megaradio/public/images/about-frame.png', import.meta.url));
    assert.ok(body.includes(`width="${frame.readUInt32BE(16)}" height="${frame.readUInt32BE(20)}"`));
  });
  test(`${language} Contact SSR exposes localized labels, without pre-boot submissions`, () => {
    const translations = Object.fromEntries(keys('contact').map(key => [key, `${language}:${key}`]));
    const body = renderer.generateHtmlBody({ pageType: 'contact', language, translations });
    for (const key of ['contact_page_title','contact_happy_to_hear','contact_email_placeholder','contact_message_placeholder','contact_send_button']) assert.ok(body.includes(`${language}:${key}`), key);
    assert.equal((body.match(/<h1\b/g) || []).length, 1);
    assert.match(body, /<form aria-busy="true"/);
    assert.match(body, /<input disabled type="email" aria-label=/);
    assert.match(body, /<textarea disabled rows="6" aria-label=/);
    assert.match(body, /<button disabled type="button"/);
    assert.doesNotMatch(body, /contact_mail_sent|contact_error_message|action=/);
  });
}
test('database values are escaped and missing dictionaries use localized safe copy', () => {
  const malicious = '<script>alert("x")</script>';
  const body = renderStaticInformationBody('about','de',{ about_intro_paragraph_1: malicious, about_mega_radio: malicious });
  assert.ok(body.includes('&lt;script&gt;'));
  assert.doesNotMatch(body, /<script>/);
  const empty = renderStaticInformationBody('contact','tr',{});
  assert.ok(empty.includes(buildStaticPageSeo('contact','tr').description));
  assert.doesNotMatch(empty, /<form|<h2|contact_/);
});

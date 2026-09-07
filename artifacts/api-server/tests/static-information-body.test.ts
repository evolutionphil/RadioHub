import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { before, mock, test } from 'node:test';
import { renderStaticInformationBody } from '../src/seo/static-information-body';
import { buildStaticPageSeo } from '@workspace/seo-shared/static-page-seo-templates';
import { buildHomeSeo } from '@workspace/seo-shared/home-seo-templates';

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
  test(`${language} home missing intro key uses localized copy and canonical navigation segments`, () => {
    const translations = { nav_for_you: 'LOCAL_FOR_YOU', nav_users: 'LOCAL_USERS' };
    const body = renderer.generateHtmlBody({ pageType: 'home', language, translations,
      urlTranslations: new Map([[`${language}:recommendations`, 'localized-recommendations'], [`${language}:users`, 'localized-users']]) });
    const intro = body.match(/<section class="intro-section">([\s\S]*?)<\/section>/)?.[1];
    assert.ok(intro?.includes(buildHomeSeo(language, translations).description));
    assert.doesNotMatch(intro || '', /your gateway to unlimited/);
    assert.ok(body.includes(`href="/${language}/localized-recommendations"`));
    assert.ok(body.includes(`href="/${language}/localized-users"`));
  });
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
    assert.ok(body.includes('src="/images/about-frame.png"'));
    assert.match(body, /<img loading="eager"[^>]+src="\/images\/about-frame.png"/);
    assert.ok(body.includes("url('/images/about-bg.webp')"));
    assert.doesNotMatch(body, /srcset=|\/assets\/images\//);
    for (const asset of body.matchAll(/(?:src="|url\(')(\/images\/[^"')]+)/g)) {
      assert.ok(existsSync(new URL(`../../megaradio/public${asset[1]}`, import.meta.url)), asset[1]);
    }
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

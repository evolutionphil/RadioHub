import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';

const previousKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = 'unit-test-key-no-external-requests';
let responses: Array<string | Error> = [];
let requests = 0;
const messages: string[] = [];
mock.module('openai', {
  defaultExport: class {
    chat = { completions: { create: async () => {
      requests++;
      const response = responses.shift();
      assert.notEqual(response, undefined, 'all model responses must be supplied by the test; no network fallback');
      if (response instanceof Error) throw response;
      return { choices: [{ message: { content: response } }] };
    } } };
  },
});
mock.module(new URL('../src/utils/logger.ts', import.meta.url).href, {
  namedExports: { logger: {
    log: (...args: unknown[]) => messages.push(args.join(' ')),
    warn: (...args: unknown[]) => messages.push(args.join(' ')),
    error: (...args: unknown[]) => messages.push(args.join(' ')),
  } },
});
const { translateDescription } = await import('../src/services/ai-station-description');
after(() => {
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;
  mock.restoreAll();
});

const sourceFull = 'Fixture Radio broadcasts music and local news throughout the day, with programmes for listeners in the region.';
const sourceMeta = 'Fixture Radio: live music and local news throughout the day.';
const translatedFull = 'Fixture Radio sendet den ganzen Tag Musik und lokale Nachrichten mit einem abwechslungsreichen Programm für die Region.';
const translatedMeta = 'Fixture Radio: Musik und lokale Nachrichten aus der Region live hören.';

test('source full copies are rejected for all 13 other universal languages, despite valid lengths', async () => {
  const targets = SITEMAP_PRIORITY_LANGUAGES.universal14.filter(language => language !== 'en');
  responses = targets.map(() => `${sourceFull}===${translatedMeta}`);
  const result = await translateDescription(sourceFull, sourceMeta, 'en', targets, 'Fixture Radio');
  assert.equal(result.size, 0);
  assert.ok(messages.some(message => message.includes('repeats the source language')));
});

test('case, whitespace, existing source/output markers and missing separators cannot disguise a full copy', async () => {
  for (const copy of [sourceFull.toUpperCase(), sourceFull.replaceAll(' ', ' \n '), `[TRANSLATED FULL DESCRIPTION] ${sourceFull}`, `[FULL DESCRIPTION - 200-300 words] ${sourceFull}`]) {
    responses = [`${copy}===${translatedMeta}`];
    assert.equal((await translateDescription(`[FULL DESCRIPTION - 200-300 words] ${sourceFull}`, sourceMeta, 'en', ['de'], 'Fixture Radio')).size, 0);
  }
  responses = [sourceFull];
  assert.equal((await translateDescription(sourceFull, sourceMeta, 'en', ['de'], 'Fixture Radio')).size, 0);
});

test('valid translated full and meta remain unchanged, including station and brand names', async () => {
  const full = `${translatedFull} Mega Radio.`;
  const meta = `${translatedMeta} Mega Radio.`;
  responses = [`${full}===${meta}`];
  const result = await translateDescription(`${sourceFull} Mega Radio.`, `${sourceMeta} Mega Radio.`, 'en', ['de'], 'Fixture Radio');
  assert.deepEqual(result.get('de'), { full, meta });
});

test('distinct full translations remain accepted in every non-English universal locale without script heuristics', async () => {
  const texts: Record<string, string> = {
    es: 'Fixture Radio ofrece música y noticias locales durante todo el día.',
    fr: 'Fixture Radio diffuse de la musique et des informations locales toute la journée.',
    de: translatedFull,
    pt: 'Fixture Radio transmite música e notícias locais durante todo o dia.',
    it: 'Fixture Radio trasmette musica e notizie locali per tutta la giornata.',
    ru: 'Fixture Radio передаёт музыку и местные новости в течение всего дня.',
    ar: 'تقدم Fixture Radio الموسيقى والأخبار المحلية على مدار اليوم.',
    zh: 'Fixture Radio 全天播放音乐和本地新闻。',
    tr: 'Fixture Radio gün boyunca müzik ve yerel haberler yayınlar.',
    ja: 'Fixture Radio は一日を通して音楽と地域のニュースを放送します。',
    ko: 'Fixture Radio는 하루 종일 음악과 지역 뉴스를 방송합니다.',
    hi: 'Fixture Radio दिन भर संगीत और स्थानीय समाचार प्रसारित करता है।',
    he: 'Fixture Radio משדרת מוזיקה וחדשות מקומיות לאורך כל היום.',
  };
  const targets = SITEMAP_PRIORITY_LANGUAGES.universal14.filter(language => language !== 'en');
  responses = targets.map(language => `${texts[language].repeat(3)}===${texts[language]}`);
  const result = await translateDescription(sourceFull, sourceMeta, 'en', targets, 'Fixture Radio');
  assert.equal(result.size, 13);
  for (const language of targets) assert.deepEqual(result.get(language), { full: texts[language].repeat(3), meta: texts[language] });
});

test('a distinct full with an exact cleaned source meta reuses the existing full-excerpt fallback', async () => {
  responses = [`[TRANSLATED FULL DESCRIPTION] ${translatedFull}===[TRANSLATED META DESCRIPTION] ${sourceMeta}`];
  const result = await translateDescription(sourceFull, `[SEO META - 155-160 characters] ${sourceMeta}`, 'en', ['de'], 'Fixture Radio');
  assert.deepEqual(result.get('de'), { full: translatedFull, meta: translatedFull });
  responses = [`${translatedFull}===`];
  assert.deepEqual((await translateDescription(sourceFull, sourceMeta, 'en', ['de'], 'Fixture Radio')).get('de'), result.get('de'), 'use the established missing-meta behavior, not fabricated summary text');
});

test('full-copy rejection is language-independent and does not apply to a same-language request', async () => {
  responses = [`${translatedFull}===${sourceMeta}`];
  assert.equal((await translateDescription(translatedFull, translatedMeta, 'de', ['en'], 'Fixture Radio')).size, 0);
  const before = requests;
  responses = [];
  assert.equal((await translateDescription(sourceFull, sourceMeta, 'en', ['en', 'EN'], 'Fixture Radio')).size, 0);
  assert.equal(requests, before);
});

test('identity-only meta is not misclassified as a source-language sentence', async () => {
  const stationName = 'Fixture Radio International';
  const full = translatedFull.replaceAll('Fixture Radio', stationName);
  for (const meta of [stationName, `${stationName} | Mega Radio`, `MegaRadio — ${stationName}`]) {
    responses = [`${full}===${meta}`];
    const result = await translateDescription(sourceFull.replaceAll('Fixture Radio', stationName), meta, 'en', ['de'], stationName);
    assert.equal(result.get('de')?.meta, meta);
    assert.equal(result.get('de')?.full, full);
  }
});

test('one rejected target or model error does not discard valid partial translations', async () => {
  responses = [`${sourceFull}===${sourceMeta}`, `${translatedFull}===${translatedMeta}`, new Error('mock translation failure')];
  const targetLanguages = ['fr', 'de', 'it'];
  const before = [...targetLanguages];
  const result = await translateDescription(sourceFull, sourceMeta, 'en', targetLanguages, 'Fixture Radio');
  assert.deepEqual([...result], [['de', { full: translatedFull, meta: translatedMeta }]]);
  assert.deepEqual(targetLanguages, before);
});

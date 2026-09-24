import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';

const previousKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = 'unit-test-key-no-external-requests';
let responses: Array<string | Error> = [];
let requests = 0;
let requestDelay = 0;
let activeRequests = 0;
let peakRequests = 0;
const messages: string[] = [];
const modelRequests: any[] = [];
mock.module('openai', {
  defaultExport: class {
    chat = { completions: { create: async (options: any) => {
      assert.equal(options.model, 'gpt-4o-mini');
      modelRequests.push(structuredClone(options));
      requests++;
      const response = responses.shift();
      assert.notEqual(response, undefined, 'all model responses must be supplied by the test; no network fallback');
      activeRequests++;
      peakRequests = Math.max(peakRequests, activeRequests);
      if (requestDelay) await new Promise(resolve => setTimeout(resolve, requestDelay));
      activeRequests--;
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
const { generateStationDescription, translateDescription } = await import('../src/services/ai-station-description');
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

test('all-locale translation caps simultaneous gpt-4o-mini requests at two', async () => {
  const targets = SITEMAP_PRIORITY_LANGUAGES.universal14.filter(language => language !== 'en');
  responses = targets.map(() => `${translatedFull}===${translatedMeta}`);
  requestDelay = 5;
  peakRequests = 0;
  try {
    const result = await translateDescription(sourceFull, sourceMeta, 'en', targets, 'Fixture Radio');
    assert.equal(result.size, targets.length);
    assert.equal(peakRequests, 2);
    assert.equal(activeRequests, 0);
  } finally { requestDelay = 0; }
});

test('cancelling a translation run stops before the next pair of paid requests', async () => {
  responses = Array.from({ length: 4 }, () => `${translatedFull}===${translatedMeta}`);
  const before = requests;
  await assert.rejects(translateDescription(sourceFull, sourceMeta, 'en', ['de', 'fr', 'it', 'es'], 'Fixture Radio', () => {
    if (requests > before) throw new Error('Job cancelled');
  }), /Job cancelled/);
  assert.equal(requests - before, 2);
  assert.equal(responses.length, 2);
});

test('English generation and fallback prompts are consistent, metadata-bound and proportional', async () => {
  const station = { _id: 'pilot', name: 'Froggy100.3 ', country: 'United States', countryCode: 'US', tags: 'country' };
  const original = structuredClone(station);
  const full = 'Froggy100.3 is a radio station in the United States with country music listed among its supplied genre tags. Its station profile identifies the broadcaster by this name.';
  const meta = 'Froggy100.3 is a United States radio station with country music in its listed genres.';
  for (const fallback of [false, true]) {
    const offset = modelRequests.length;
    responses = fallback ? ['NO_INFO_AVAILABLE', `${full}===${meta}`] : [`${full}===${meta}`];
    const result = await generateStationDescription(station, 'en');
    assert.equal(result.success, true);
    assert.equal(result.usedFallback, fallback);
    assert.equal(result.fullDescription, full);
    assert.deepEqual(modelRequests.slice(offset).map(request => request.max_tokens), fallback ? [1000, 600] : [1000]);
    for (const request of modelRequests.slice(offset)) {
      const prompt = request.messages[0].content;
      assert.match(prompt, /entirely in English/);
      assert.match(prompt, /ONLY (?:the supplied station metadata|this supplied metadata)/);
      assert.match(prompt, /no required word count/);
      assert.match(prompt, /Do not (?:add facts from memory or )?invent schedules, presenters, request shows, local news/);
      assert.doesNotMatch(prompt, /NEVER in English|not English|Do NOT use English|200-300|Froggy100\.3 "/);
    }
  }
  assert.deepEqual(station, original, 'local normalization never renames the catalog station');
});

test('concise CJK generation succeeds unchanged in primary and fallback without extra model calls', async () => {
  const station = { name: '来宾综合广播 ', country: 'China', countryCode: 'CN', state: '广西', tags: 'full service', bitrate: 128, codec: 'MP3' };
  const original = structuredClone(station);
  const content: Record<string, { full: string; meta: string }> = {
    zh: {
      full: '来宾综合广播是一家位于中国广西的广播电台。资料列出的类型为综合广播，并提供 MP3 格式的在线音频流，码率为 128 kbps。',
      meta: '来宾综合广播位于中国广西，提供综合广播及 128 kbps MP3 在线音频流。',
    },
    ja: {
      full: '来宾综合广播は中国の広西にあるラジオ局です。登録情報では総合放送とされ、128 kbps の MP3 音声ストリームが案内されています。',
      meta: '来宾综合广播：中国・広西の総合放送。音声は MP3、128 kbps。',
    },
    ko: {
      full: '来宾综合广播는 중국 광시의 라디오 방송국입니다. 제공된 정보에는 종합 방송과 128 kbps MP3 오디오 스트림이 기재되어 있습니다.',
      meta: '来宾综合广播는 중국 광시의 종합 방송으로 MP3 스트림을 제공합니다.',
    },
  };
  for (const [language, { full, meta }] of Object.entries(content)) {
    assert.ok(full.length >= 50 && full.length < 100, `${language} full exercises the compact range`);
    assert.ok(meta.length >= 20 && meta.length < 50, `${language} meta exercises the compact range`);
    for (const fallback of [false, true]) {
      const offset = requests;
      responses = fallback ? ['NO_INFO_AVAILABLE', `${full}===${meta}`] : [`${full}===${meta}`];
      const result = await generateStationDescription(station, language);
      assert.deepEqual(result, { success: true, fullDescription: full, metaDescription: meta, language, usedFallback: fallback });
      assert.equal(requests - offset, fallback ? 2 : 1);
      assert.equal(responses.length, 0);
    }
    responses = [`${full.slice(0, 50)}===${meta.slice(0, 20)}`];
    assert.equal((await generateStationDescription(station, language)).success, true, `${language} accepts the exact compact boundary`);
    responses = ['NO_INFO_AVAILABLE', `${full.slice(0, 50)}===${meta.slice(0, 20)}`];
    assert.equal((await generateStationDescription(station, language)).success, true, `${language} fallback shares the exact compact boundary`);
  }
  assert.deepEqual(station, original);
});

test('CJK bounds still reject short, missing or NO_INFO content after both attempts', async () => {
  const station = { name: '来宾综合广播', country: 'China', countryCode: 'CN' };
  const full = '来宾综合广播是一家位于中国广西的广播电台。资料列出的类型为综合广播，并提供 MP3 格式的在线音频流，码率为 128 kbps。';
  const meta = '来宾综合广播位于中国广西，提供综合广播及 128 kbps MP3 在线音频流。';
  for (const language of ['zh', 'ja', 'ko']) {
    for (const response of [`${full.slice(0, 49)}===${meta}`, `${full}===${meta.slice(0, 19)}`, `${full}===`, full, `NO_INFO_AVAILABLE ${full}===${meta}`]) {
      const offset = requests;
      responses = [response, response];
      const result = await generateStationDescription(station, language);
      assert.equal(result.success, false);
      assert.equal(result.error, 'Both primary and fallback AI generation failed');
      assert.equal(requests - offset, 2);
    }
  }
});

test('non-CJK generation retains the existing primary and fallback length floors', async () => {
  const station = { name: 'Fixture Radio', country: 'Germany', countryCode: 'DE' };
  const full = 'Fixture Radio is a radio station whose supplied profile lists music and a location in Germany. Its listed stream uses the MP3 audio format.';
  const meta = 'Fixture Radio is a German radio station with an MP3 audio stream.';
  for (const language of ['en', 'de', 'tr', 'zh-CN', 'ZH']) {
    responses = [`${full.slice(0, 99)}===${meta}`, `${full}===${meta}`];
    assert.equal((await generateStationDescription(station, language)).usedFallback, true);
    responses = [`${full.slice(0, 100)}===${meta}`];
    assert.equal((await generateStationDescription(station, language)).usedFallback, false);
    for (const fallback of [`${full.slice(0, 100)}===${meta}`, `${full}===${meta.slice(0, 49)}`]) {
      responses = ['NO_INFO_AVAILABLE', fallback];
      assert.equal((await generateStationDescription(station, language)).success, false);
    }
  }
});

test('compact generation rejects long or repeated identity-only content and template markers', async () => {
  const name = '城市国际文化音乐综合广播电台'.repeat(4);
  const station = { name, country: 'China', countryCode: 'CN' };
  const template = '[FULL DESCRIPTION - write one concise paragraph using the supplied metadata]';
  const templateWithoutDash = '[FULL DESCRIPTION write one concise paragraph using the supplied radio metadata]';
  const templateMeta = '[SEO META - summarize the supplied metadata here]';
  for (const language of ['zh', 'ja', 'ko']) {
    for (const response of [`${name}===${name}`, `${name} ${name} Mega Radio===${name} Mega Radio`, `${template}===${templateMeta}`, `${templateWithoutDash}===${templateMeta}`]) {
      responses = [response, response];
      assert.equal((await generateStationDescription(station, language)).success, false);
    }
    for (const name of ['Radio', 'Mega']) {
      const brandOnly = 'Mega Radio '.repeat(6);
      responses = [`${brandOnly}===${brandOnly}`, `${brandOnly}===${brandOnly}`];
      assert.equal((await generateStationDescription({ ...station, name }, language)).success, false);
    }
  }
});

test('trailing catalog whitespace does not duplicate a station name before Turkish possessives', async () => {
  const name = 'Froggy100.3 ';
  const full = 'Froggy100.3’ün Amerika Birleşik Devletleri kaynaklı yayınında country müzik etiketleri yer alır.';
  const meta = 'Froggy100.3’ün Amerika Birleşik Devletleri kaynaklı country müzik yayını.';
  responses = [`${full}===${meta}`];
  const result = await translateDescription("Froggy100.3's United States station profile lists country music among its genres.", 'Froggy100.3: country music from the United States.', 'en', ['tr'], name);
  assert.deepEqual(result.get('tr'), { full, meta });
  assert.equal(result.get('tr')?.full.split('Froggy100.3').length, 2);
  const request = modelRequests.at(-1);
  assert.equal(request.max_tokens, 1000);
  assert.equal(request.temperature, 0.2);
  assert.match(request.messages[0].content, /BOTH the full description and the meta description entirely in Turkish/);
  assert.doesNotMatch(request.messages.map((message: any) => message.content).join('\n'), /Froggy100\.3 "/);
});

test('CJK station names keep their exact original script in translation and prompts', async () => {
  const name = '城市之声';
  const full = `${name}是电台资料中列出的名称，所属国家为中国，音乐标签包括流行音乐。这里的文字仅介绍已提供的电台信息，并保留原来的中文名称。`;
  const meta = `${name}：来自中国的电台，资料中列出的音乐类型是流行音乐。`;
  responses = [`${full}===${meta}`];
  const result = await translateDescription(`${name} is a radio station from China whose supplied genre tags include pop music.`, `${name}: a Chinese radio station with pop music tags.`, 'en', ['zh'], `${name} `);
  assert.deepEqual(result.get('zh'), { full, meta });
  const [system, user] = modelRequests.at(-1).messages.map((message: any) => message.content);
  assert.ok(system.includes(`"${name}"`));
  assert.match(system, /original Unicode characters and original script/);
  assert.match(user, /Both output parts must be entirely in Chinese except unchanged proper names/);
  assert.doesNotMatch(system + user, /Latin alphabet|NOT .*Chinese characters|is\.\.\.|\[rest of translated/);
});

test('untranslated English meta opener uses the existing translated full excerpt', async () => {
  responses = [`${translatedFull}===Tune in to Fixture Radio für Musik und lokale Nachrichten.`];
  const result = await translateDescription(sourceFull, sourceMeta, 'en', ['de'], 'Fixture Radio');
  assert.deepEqual(result.get('de'), { full: translatedFull, meta: translatedFull });
});

test('an English opener in both parts cannot survive through meta excerpt fallback', async () => {
  responses = ['Tune in to Fixture Radio für ein abwechslungsreiches Musikprogramm aus der Region.===Tune in to Fixture Radio und höre Musik aus der Region.'];
  const result = await translateDescription(sourceFull, sourceMeta, 'en', ['de'], 'Fixture Radio');
  assert.equal(result.size, 0);
});

test('English targets and proper names containing the English opener are exempt', async () => {
  const englishFull = 'Tune in to Fixture Radio for a varied selection of regional music and radio programming.';
  const englishMeta = 'Tune in to Fixture Radio for music and regional programming.';
  responses = [`${englishFull}===${englishMeta}`];
  assert.deepEqual((await translateDescription(translatedFull, translatedMeta, 'de', ['en'], 'Fixture Radio')).get('en'), { full: englishFull, meta: englishMeta });
  const name = 'Tune in to Radio';
  const full = `${name} sendet ein abwechslungsreiches Musikprogramm für Hörerinnen und Hörer aus der Region.`;
  const meta = `${name}: Musik und Radioprogramme aus der Region.`;
  responses = [`${full}===${meta}`];
  assert.deepEqual((await translateDescription(`${name} offers music programmes for regional listeners.`, `${name}: regional music programmes.`, 'en', ['de'], name)).get('de'), { full, meta });
});

test('mixed English full openers cannot be stored even when metadata is translated', async () => {
  const invalid: Record<string, string> = {
    tr: 'Fixture Radio is vibrant bir radyo istasyonu olarak Rusya müzik kataloğunda listeleniyor.',
    ko: 'Fixture Radio is 러시아의 라디오 방송국으로 음악 카탈로그에 등록되어 있습니다.',
    hi: 'Fixture Radio is रूस के एक रेडियो स्टेशन के रूप में इस संगीत कैटलॉग में दर्ज है।',
    he: 'Fixture Radio is תחנת רדיו הרשומה בקטלוג המוזיקה כתחנה מרוסיה.',
  };
  const before = requests;
  for (const [language, full] of Object.entries(invalid)) {
    responses = [`${full}===${translatedMeta}`];
    assert.equal((await translateDescription(sourceFull, sourceMeta, 'en', [language], 'Fixture Radio')).size, 0, language);
  }
  assert.equal(requests - before, 4, 'a rejected locale does not trigger unbounded retries');
});

test('mixed English meta opener reuses valid full prose without modifying it', async () => {
  const full = "Fixture Radio, Rusya'daki bir radyo istasyonu olarak müzik kataloğunda listeleniyor.";
  responses = [`${full}===Fixture Radio is vibrant bir Rus radyo istasyonu olarak listeleniyor.`];
  assert.deepEqual((await translateDescription(sourceFull, sourceMeta, 'en', ['tr'], 'Fixture Radio')).get('tr'), { full, meta: full });
});

test('primary and fallback generation reject mixed openers without extra paid retries', async () => {
  const station = { name: 'Fixture Radio', country: 'Russia', countryCode: 'RU' };
  const full = "Fixture Radio, Rusya'da yer alan bir radyo istasyonudur. İstasyonun sağlanan katalog bilgilerinde müzik kategorisi belirtiliyor.";
  const meta = "Fixture Radio, Rusya'da yer alan ve müzik kataloğunda listelenen bir radyo istasyonudur.";
  for (const [badFull, badMeta] of [[full.replace('Fixture Radio,', 'Fixture Radio is vibrant'), meta], [full, meta.replace('Fixture Radio,', 'Fixture Radio is vibrant')]]) {
    const before = requests;
    responses = [`${badFull}===${badMeta}`];
    const primary = await generateStationDescription(station, 'tr');
    assert.equal(primary.success, false);
    assert.equal(primary.usedFallback, false);
    assert.match(primary.error || '', /English opener/);
    assert.equal(requests - before, 1);
    responses = ['NO_INFO_AVAILABLE', `${badFull}===${badMeta}`];
    const fallback = await generateStationDescription(station, 'tr');
    assert.equal(fallback.success, false);
    assert.equal(fallback.usedFallback, true);
    assert.equal(requests - before, 3, 'fallback uses only the existing bounded second attempt');
  }
});

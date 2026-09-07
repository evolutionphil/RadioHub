import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSeoTags, getStationMetaDescription, SITEMAP_PRIORITY_LANGUAGES, truncateAtWordBoundary } from '@workspace/seo-shared/seo-config';

const englishMeta = 'Listen to Fixture Radio live online for music and local news.';
const fullByLanguage: Record<string, string> = {
  en: 'Fixture Radio broadcasts music and local news throughout the day.',
  es: 'Fixture Radio ofrece música y noticias locales durante todo el día.',
  fr: 'Fixture Radio diffuse de la musique et des informations locales toute la journée.',
  de: 'Fixture Radio sendet den ganzen Tag Musik und lokale Nachrichten.',
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
const stationWith = (entry: unknown) => ({
  name: 'Fixture Radio', slug: 'fixture-radio', country: 'Germany',
  descriptions: { en: { full: fullByLanguage.en, meta: englishMeta }, de: entry },
});

for (const language of SITEMAP_PRIORITY_LANGUAGES.universal14) {
  test(`${language}: metadata selects localized full copy only when its stored meta repeats English`, () => {
    const station = {
      name: 'Fixture Radio', slug: 'fixture-radio', country: 'Germany',
      descriptions: Object.fromEntries(Object.entries(fullByLanguage).map(([locale, full]) => [locale, { full, meta: englishMeta }])),
    };
    const before = JSON.stringify(station);
    const expected = language === 'en' ? englishMeta : fullByLanguage[language];
    assert.equal(getStationMetaDescription(station, language, {}), expected);
    const tags = generateSeoTags('station', language, {}, '/station/fixture-radio', 'https://themegaradio.com', station);
    assert.equal(tags.description, expected);
    assert.equal(tags.twitterDescription, expected);
    assert.equal(tags.ogDescription, fullByLanguage[language], 'existing full-copy Open Graph content must stay intact');
    assert.equal(JSON.stringify(station), before, 'selection must not mutate source or persist a translation');
  });
}

test('genuine stored locale meta and non-exact English matches keep their priority', () => {
  for (const meta of ['Fixture Radio: Musik und lokale Nachrichten.', englishMeta.toUpperCase(), 'Custom editorial summary.']) {
    assert.equal(getStationMetaDescription(stationWith({ full: fullByLanguage.de, meta }), 'de', {}), meta);
  }
});

test('marker-cleaned English copies use a word-boundary excerpt of the existing locale full', () => {
  const full = fullByLanguage.de.repeat(5);
  const station = stationWith({ full: `[TRANSLATED FULL DESCRIPTION] ${full}`, meta: `[TRANSLATED META DESCRIPTION] ${englishMeta}` });
  station.descriptions.en.meta = `[SEO META - 155-160 characters] ${englishMeta}`;
  const result = getStationMetaDescription(station, 'de', {});
  assert.equal(result, truncateAtWordBoundary(full, 145));
  assert.ok(result.length <= 145);
});

test('missing, invalid, identity-only or still-English full descriptions do not mask the stored meta', () => {
  for (const full of [undefined, '', '   ', 123, {}, fullByLanguage.en, fullByLanguage.en.toUpperCase(), fullByLanguage.en.replaceAll(' ', '  '), 'Fixture Radio', 'Mega Radio']) {
    assert.equal(getStationMetaDescription(stationWith({ full, meta: englishMeta }), 'de', {}), englishMeta);
  }
  const station = stationWith({ full: fullByLanguage.de, meta: englishMeta });
  delete (station.descriptions as Record<string, unknown>).en;
  assert.equal(getStationMetaDescription(station, 'de', {}), englishMeta, 'without matching English metadata, leave a stored locale meta untouched');
});

test('intentional station and product identity-only meta remains valid across languages', () => {
  for (const meta of ['Fixture Radio', 'Fixture Radio — Mega Radio', 'MegaRadio | Fixture Radio', 'Mega Radio']) {
    const station = stationWith({ full: fullByLanguage.de, meta });
    station.descriptions.en.meta = meta;
    assert.equal(getStationMetaDescription(station, 'de', {}), meta);
  }
});

test('empty and malformed meta cannot suppress existing localized full or translation fallbacks', () => {
  for (const meta of ['', '   ', '[SEO META - 155-160 characters]', 123, {}, null]) {
    assert.equal(getStationMetaDescription(stationWith({ full: fullByLanguage.de, meta }), 'de', {}), fullByLanguage.de);
  }
  const fallback = 'Fixture Radio jetzt hören.';
  for (const entry of [{ full: '   ', meta: '   ' }, { full: 123, meta: {} }, '[TRANSLATED FULL DESCRIPTION]', null]) {
    assert.equal(getStationMetaDescription(stationWith(entry), 'de', { default_station_about: '{station_name} jetzt hören.' }), fallback);
  }
});

test('legacy full strings retain compatibility without writing new metadata', () => {
  assert.equal(getStationMetaDescription(stationWith(`[TRANSLATED FULL DESCRIPTION] ${fullByLanguage.de}`), 'de', {}), fullByLanguage.de);
  const station: any = stationWith({ full: fullByLanguage.en, meta: englishMeta });
  station.descriptions.en = `[FULL DESCRIPTION - 200-300 words] ${fullByLanguage.en}`;
  assert.equal(getStationMetaDescription(station, 'de', {}), englishMeta);
});

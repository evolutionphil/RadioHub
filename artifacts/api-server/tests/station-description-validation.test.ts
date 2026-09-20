import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findDescriptionLanguageIssues, getInvalidDescriptionLocales } from '../src/services/station-description-validation';

const name = 'Fixture Radio';
const english = {
  full: `${name} is a radio station whose supplied profile lists country music and a location in the United States.`,
  meta: `${name} is a United States radio station with country music among its listed genres.`,
};
const german = {
  full: `${name} ist ein Radiosender aus den Vereinigten Staaten. Im Senderprofil wird Countrymusik als Musikrichtung genannt.`,
  meta: `${name} ist ein Radiosender aus den Vereinigten Staaten mit Countrymusik im Senderprofil.`,
};

test('explicit cross-locale source copies identify individual fields without changing input', () => {
  const descriptions = { en: english, de: { ...german, meta: english.meta }, fr: { ...english, full: `  [FULL DESCRIPTION] ${english.full.toUpperCase().replaceAll(' ', ' \n ')}  ` } };
  const before = structuredClone(descriptions);
  assert.deepEqual(findDescriptionLanguageIssues(descriptions, ['en', 'de', 'fr'], { stationName: name, sourceLanguage: 'en' }), [
    { language: 'de', field: 'meta', reason: 'source-copy' },
    { language: 'fr', field: 'full', reason: 'source-copy' },
    { language: 'fr', field: 'meta', reason: 'source-copy' },
  ]);
  assert.deepEqual(getInvalidDescriptionLocales(descriptions, ['fr', 'de', 'fr', 'en'], { stationName: name, sourceLanguage: 'en' }), ['fr', 'de']);
  assert.deepEqual(descriptions, before);
});

test('does not infer source language or distinguish arbitrary Latin prose', () => {
  assert.deepEqual(findDescriptionLanguageIssues({ en: english, de: english, fr: german }, ['en', 'de', 'fr']), []);
  assert.deepEqual(findDescriptionLanguageIssues({ en: english, 'en-GB': english }, ['en', 'en-GB'], { sourceLanguage: 'en' }), []);
  assert.deepEqual(findDescriptionLanguageIssues({ en: english, de: german }, ['en', 'de'], { sourceLanguage: 'en' }), []);
});

test('unchanged identity-only or short technical metadata is inconclusive', () => {
  for (const meta of [name, `${name} | Mega Radio`, `MegaRadio — ${name}`, '128 kbps MP3', 'Pop & Jazz']) {
    const descriptions = { en: { ...english, meta }, de: { ...german, meta } };
    assert.deepEqual(findDescriptionLanguageIssues(descriptions, ['de'], { stationName: name, sourceLanguage: 'en' }), []);
  }
  assert.deepEqual(findDescriptionLanguageIssues({ ja: { full: 'Mega Radio', meta: '128 kbps MP3' } }, ['ja']), []);
});

test('substantial prose without an expected script is flagged in each non-Latin target', () => {
  for (const language of ['ru', 'ar', 'zh', 'ja', 'ko', 'hi', 'he', 'zh-CN']) {
    assert.deepEqual(findDescriptionLanguageIssues({ [language]: english }, [language], { stationName: name }), [
      { language, field: 'full', reason: 'wrong-script' },
      { language, field: 'meta', reason: 'wrong-script' },
    ]);
  }
});

test('native-script names cannot disguise otherwise untranslated prose', () => {
  const stationName = '城市之声';
  const content = {
    full: `${stationName} is a station whose profile lists pop music and a location in China.`,
    meta: `${stationName}: the station profile lists pop music and a location in China.`,
  };
  assert.deepEqual(getInvalidDescriptionLocales({ zh: content }, ['zh'], { stationName }), ['zh']);
  assert.deepEqual(findDescriptionLanguageIssues({ zh: { full: stationName, meta: stationName } }, ['zh'], { stationName }), []);
});

test('valid native prose and ambiguous mixed scripts remain unchanged', () => {
  const text: Record<string, string> = {
    ru: 'Fixture Radio передаёт музыку для слушателей и сохраняет название радиостанции в описании.',
    ar: 'تقدم Fixture Radio الموسيقى للمستمعين وتحافظ على اسم المحطة الأصلي في وصفها.',
    zh: 'Fixture Radio 是电台资料中列出的名称，所属国家为中国，音乐标签包括流行音乐。',
    ja: 'Fixture Radio は電台の紹介に記載されている名称で、音楽の情報を掲載しています。',
    ko: 'Fixture Radio는 방송국의 이름이며 소개에 음악과 방송국의 기본 정보가 포함되어 있습니다.',
    hi: 'Fixture Radio रेडियो स्टेशन का नाम है और इस विवरण में संगीत से जुड़ी जानकारी शामिल है।',
    he: 'Fixture Radio הוא שם תחנת הרדיו והתיאור כולל מידע על המוזיקה ועל התחנה.',
  };
  for (const [language, full] of Object.entries(text)) {
    assert.deepEqual(findDescriptionLanguageIssues({ [language]: { full, meta: full } }, [language], { stationName: name }), []);
  }
  assert.deepEqual(findDescriptionLanguageIssues({ ja: { full: text.zh, meta: text.zh } }, ['ja']), [], 'Han alone does not distinguish Japanese from Chinese');
  assert.deepEqual(findDescriptionLanguageIssues({ ru: { full: `Radio Музыка ${english.full}`, meta: english.meta } }, ['ru']), [{ language: 'ru', field: 'meta', reason: 'wrong-script' }], 'mixed-script prose is not classified by an arbitrary ratio');
});

test('names, links, markup and entities do not supply evidence of connecting prose', () => {
  const stationName = 'The Very Long International Radio Station Name';
  const identity = `<p>${stationName}</p> &nbsp; https://example.invalid/a-long-station-website-path`;
  assert.deepEqual(findDescriptionLanguageIssues({ ar: { full: identity, meta: identity } }, ['ar'], { stationName }), []);
  const literalName = 'Radio [FM]+ (Live)';
  assert.deepEqual(findDescriptionLanguageIssues({ he: { full: literalName.repeat(4) } }, ['he'], { stationName: literalName }), []);
});

test('missing, malformed and unsupported locales remain outside language repair', () => {
  for (const descriptions of [undefined, null, false, [], 'malformed']) {
    assert.deepEqual(findDescriptionLanguageIssues(descriptions, ['en', 'ar']), []);
  }
  assert.deepEqual(findDescriptionLanguageIssues({ ar: { full: '', meta: null }, he: [], unknown: english }, ['ar', 'he', 'unknown']), []);
});

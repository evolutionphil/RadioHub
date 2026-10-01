import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { HOME_HERO_COPY, getHomeHeroCopy } from '@workspace/seo-shared/home-hero-copy';
import { buildHomeSeo } from '@workspace/seo-shared/home-seo-templates';

// Exercise the actual renderer without starting the background cache or DB.
mock.module('../src/performance-cache', { namedExports: {
  performanceCache: {
    getTranslations: () => ({}),
    getPageData: () => null,
    setPageData: () => {},
    getUrlTranslations: async () => new Map(),
  },
} });
mock.module('../src/seo/qualified-languages', { namedExports: {
  getCachedQualifiedLanguages: async () => [...ACTIVE_SITEMAP_LANGUAGES],
} });

let renderer: InstanceType<typeof import('../src/seo-renderer').SeoRenderer>;
before(async () => {
  const { SeoRenderer } = await import('../src/seo-renderer');
  renderer = new SeoRenderer();
});
after(() => mock.restoreAll());

const RADIO_WORDS: Record<string, RegExp> = {
  en: /radio/i, de: /radio/i, tr: /radyo/i, es: /radio/i,
  fr: /radio/i, pt: /rádio/i, it: /radio/i, ru: /радио/i,
  ar: /راديو/, zh: /电台/, ja: /ラジオ/, ko: /라디오/,
  hi: /रेडियो/, he: /רדיו/,
};

test('every public locale has complete brand copy and a localized radio headline', () => {
  assert.deepEqual(Object.keys(HOME_HERO_COPY).sort(), [...ACTIVE_SITEMAP_LANGUAGES].sort());
  for (const language of ACTIVE_SITEMAP_LANGUAGES) {
    const copy = HOME_HERO_COPY[language];
    for (const field of ['eyebrow', 'headline', 'tagline'] as const) {
      assert.ok(copy[field].trim(), `${language}: ${field} must not be empty`);
      assert.doesNotMatch(copy[field], /[\r\n]|<br\b|hero_/, `${language}: plain single-line ${field}`);
      if (language !== 'en') assert.notEqual(copy[field], HOME_HERO_COPY.en[field]);
    }
    assert.match(copy.headline, RADIO_WORDS[language], language);
    assert.equal(copy.direction, ['ar', 'he'].includes(language) ? 'rtl' : 'ltr', language);
  }
});

test('approved German and Turkish hero wording stays exact', () => {
  assert.deepEqual(getHomeHeroCopy('de'), {
    eyebrow: 'Sender aus aller Welt',
    headline: 'Radio live hören',
    tagline: 'Kostenlos. Jederzeit. Überall.',
    direction: 'ltr',
  });
  assert.deepEqual(getHomeHeroCopy('tr'), {
    eyebrow: 'Dünyanın sesi burada',
    headline: 'Canlı radyo dinle',
    tagline: 'Ücretsiz. Her an. Her yerde.',
    direction: 'ltr',
  });
});

test('locale variants normalize and unknown locales use the English fallback', () => {
  assert.equal(getHomeHeroCopy(' DE_at '), HOME_HERO_COPY.de);
  assert.equal(getHomeHeroCopy('tr-TR'), HOME_HERO_COPY.tr);
  assert.equal(getHomeHeroCopy('ar-SA'), HOME_HERO_COPY.ar);
  for (const language of ['', 'unknown', 'constructor', '__proto__']) {
    assert.equal(getHomeHeroCopy(language), HOME_HERO_COPY.en);
  }
});

for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  test(`${language}: server hero matches shared app copy even with stale database translations`, () => {
    const copy = getHomeHeroCopy(language);
    for (const translations of [{}, {
      hero_worlds_best_radio: 'Stale database headline',
      hero_over_100_countries: 'Stale database eyebrow',
      hero_listen_everywhere: 'Stale database tagline',
    }]) {
      const html = renderer.generateHtmlBody({ pageType: 'home', language, translations });
      const hero = html.match(/<div class="home-hero-copy" dir="(ltr|rtl)">([\s\S]*?)<\/div>/);
      assert.ok(hero, 'A single wrapper controls only the hero text direction');
      assert.equal(hero[1], copy.direction);
      assert.equal(hero[2].trim().replace(/>\s+</g, '><'),
        `<p class="home-hero-eyebrow">${copy.eyebrow}</p>` +
        `<h1 class="home-hero-title">${copy.headline}</h1>` +
        `<p class="home-hero-tagline">${copy.tagline}</p>`);
      assert.equal((html.match(/<h1\b/g) || []).length, 1);
      assert.doesNotMatch(hero[0], /Stale database|<h2\b/);
    }
  });

  test(`${language}: homepage metadata still uses the existing SEO templates and database overrides`, async () => {
    for (const translations of [{}, {
      meta_title: 'Custom homepage search title',
      meta_description: 'Custom homepage search description.',
      hero_worlds_best_radio: 'Previous hero wording',
    }]) {
      const seo = buildHomeSeo(language, translations);
      const actual = await renderer.generateEnhancedSeoTags('home', language, translations, '/', 'https://themegaradio.com');
      assert.equal(actual.title, `${seo.title} | Mega Radio`);
      assert.equal(actual.description, seo.description);
      assert.equal(actual.ogTitle, actual.title);
      assert.equal(actual.twitterTitle, actual.title);
      assert.equal(actual.ogDescription, seo.description);
      assert.equal(actual.twitterDescription, seo.description);
      assert.notEqual(actual.title, getHomeHeroCopy(language).headline);
    }
  });
}

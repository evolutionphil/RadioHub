# A.6 — Canonical & Hreflang: Code Audit

## Canonical URL Logic (`seo-renderer.ts` lines 960–1008)

### noindex pages (junk / numericOnlySlug / langIneligible)
```ts
seoTags.robots = 'noindex, follow';
seoTags.canonical = `${domain}/${canonicalLang}/${translatedSegment}/${stationData.slug}`;
// canonicalLang: indexable.includes('en') ? 'en' : indexable[0] ?? 'en'
```
- **Canonical → primary indexable variant, never self** ✅ (H3 FALSE)
- Translated segment always looked up — never raw language code

### indexable pages
- Canonical = own URL (built earlier in `renderStationPage`)
- Hreflang = all languages returned by `getIndexableLanguagesForStation(station, qualifiedLangs)`

### junk pages
- `seoTags.hreflangs = []` — no hreflangs emitted on junk/410 pages ✅

## Hreflang Tag Format (`seo-sitemap-routes.ts` lines 12–39)

```ts
// bare code + BCP47 if different (e.g., zh → ['zh', 'zh-Hans'])
function hreflangTagsForCode(code: string): string[] { ... }
// builds <xhtml:link rel="alternate"> XML attributes
function buildHreflangLinks(lang: string, href: string): string { ... }
```

### x-default
- **Always present** on every `<url>` entry in all sitemaps → English variant
- SSR: emitted via `generateLanguageUrls()` which returns array including `x-default`
- Client (`SeoHead.tsx` lines 285–294): `updateHrefLangTags()` receives x-default

## Sitemap Hreflang Strategy

| Sitemap type | Languages in hreflang |
|---|---|
| main + genres | ALL `qualifiedLanguages` |
| stations | `getIndexableLanguagesForStation(station, qualifiedLanguages)` only |

Station sitemaps correctly filter to per-station eligible languages — avoids advertising 57-language clusters for stations with limited geographic audience.

## Station Indexability Gate (`junk-station-rules.ts` lines 406–443)

```ts
function getIndexableLanguagesForStation(station, qualifiedLangs) {
  if (station.noIndex === true) return [];
  if (isJunkStation(station)) return [];
  const eligible = getEligibleLanguages(station);   // country + diaspora + descriptions
  if (!qualifiedLangs) return eligible;
  return eligible.filter(lang => qualifiedLangs.includes(lang));
}
```

### Eligible language sources (per station)
1. UNIVERSAL_LANGUAGES (en, es, fr, de, pt, it, ru, ar, zh, tr, ja, ko, hi, he) — always
2. Country primary language (COUNTRY_TO_LANGUAGE)
3. Country diaspora extras (COUNTRY_EXTRA_LANGUAGES)
4. station.languageCodes field
5. station.descriptions[lang] if both full + meta non-empty

## H3 Assessment (self-canonical on noindex)
**FALSE** — noindex pages canonical to indexable variant. No conflicting signal.

## H4 Assessment (broken hreflang clusters)
**PARTIALLY TRUE** — When only ~10 languages qualify, hreflang clusters for stations are reduced to 10-language sets. Google may see inconsistent cluster sizes over time as the qualified set grows/shrinks. Once all 57 languages are qualified (after Phase C is applied), clusters will stabilise.

## H7 Assessment (duplicate content)
**PARTIALLY TRUE** — `/af/stasie/x` and `/af/station/x` dual-path: the 301 redirect is in place but Google indexes both before honouring the redirect. After 368 noindex URLs are reversed, this becomes less critical.

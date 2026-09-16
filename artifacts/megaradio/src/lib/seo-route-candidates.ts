import { COUNTRY_TO_LANGUAGE, SEO_LANGUAGES, type SeoLanguage } from '@workspace/seo-shared/seo-config';

interface SeoRouteCandidates {
  languages: SeoLanguage[];
  countries: Array<[string, string]>;
}

const candidatesByPrefix = new Map<string, SeoRouteCandidates>();
const emptyCandidates: SeoRouteCandidates = { languages: [], countries: [] };
const enabledLanguages = new Set(SEO_LANGUAGES.filter(language => language.enabled).map(language => language.code));

function candidatesFor(prefix: string): SeoRouteCandidates {
  let candidates = candidatesByPrefix.get(prefix);
  if (!candidates) {
    candidates = { languages: [], countries: [] };
    candidatesByPrefix.set(prefix, candidates);
  }
  return candidates;
}

for (const language of SEO_LANGUAGES) {
  if (language.enabled && language.code !== 'en') candidatesFor(language.code).languages.push(language);
}
for (const [country, language] of Object.entries(COUNTRY_TO_LANGUAGE)) {
  if (country !== language && enabledLanguages.has(language)) candidatesFor(country).countries.push([country, language]);
}

/** Only this literal first segment can match a generated route. Preserve both
 * groups for overlapping language/country codes (e.g. ar), in their old order.
 * Wouter's default matcher is case-insensitive; its generic fallback routes
 * remain in App and still decide what unsupported paths should display. */
export function getSeoRouteCandidates(pathname: string): SeoRouteCandidates {
  const prefix = /^\/([^/?#]+)/.exec(pathname)?.[1].toLowerCase();
  return (prefix && candidatesByPrefix.get(prefix)) || emptyCandidates;
}

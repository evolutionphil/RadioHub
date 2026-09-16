import { SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { evaluateJunkStation, getEligibleLanguages, isNumericOnlySlug } from './junk-station-rules';

export const AUDIT_LANGUAGES = [...SITEMAP_PRIORITY_LANGUAGES.universal14];
export interface AuditStation {
  _id: string; name: string; slug: string | null; url: string; countryCode?: string;
  languageCodes?: string; noIndex?: boolean; redirectToSlug?: string;
  lastCheckOk?: boolean; manualEditFields?: { noIndex?: unknown };
  automaticNoIndex?: { owner?: string; version?: number; active?: boolean; reason?: string };
  descriptions?: Record<string, { full?: string; meta?: string }>;
}
export interface StationAuditDecision {
  reason: string | null; reviewReason: string | null; currentQualityReason: string | null; eligibleLanguages: string[];
  completeLanguages: string[]; missingFull: string[]; missingMeta: string[];
}

/** First-match exclusions are disjoint. Health is evidence for review only;
 * neither a failed stream nor an old unowned flag proves content is junk. */
export function classifyStationIndexability(station: AuditStation): StationAuditDecision {
  const junk = evaluateJunkStation({ ...station, slug: station.slug ?? undefined });
  const numeric = isNumericOnlySlug(station.slug);
  const provenance = station.automaticNoIndex;
  const owned = provenance?.owner === 'radiohub-junk-policy' && provenance.version === 1 && provenance.active === true;
  const ownedHealth = owned && provenance.reason === 'stream-dead-30d';
  let reason: string | null = null;
  if (!station.slug?.trim()) reason = 'missing-slug';
  else if (station.redirectToSlug) reason = 'duplicate-redirect';
  else if (station.noIndex === true && station.manualEditFields?.noIndex) reason = 'manual-noindex';
  else if (station.noIndex === true) reason = ownedHealth ? 'automatic-health-noindex' : owned ? 'automatic-other-noindex' : 'legacy-unknown-noindex';
  else if (numeric) reason = 'numeric-slug';
  else if (junk.isJunk) reason = `junk:${junk.reason}`;

  let reviewReason: string | null = null;
  if (station.noIndex === true && station.slug?.trim() && !station.redirectToSlug &&
      !station.manualEditFields?.noIndex && !numeric && !junk.isJunk) {
    reviewReason = ownedHealth ? 'owned-health-policy-retirement' :
      owned && provenance.reason?.startsWith('duplicate-of:') ? 'automatic-duplicate-needs-identity-review' :
      !owned ? 'unknown-flag-without-current-quality-rule' : 'automatic-rule-no-longer-matches';
  }
  const missingFull = AUDIT_LANGUAGES.filter(lang => !station.descriptions?.[lang]?.full?.trim());
  const missingMeta = AUDIT_LANGUAGES.filter(lang => !station.descriptions?.[lang]?.meta?.trim());
  return { reason, reviewReason, currentQualityReason: numeric ? 'numeric-slug' : junk.isJunk ? junk.reason || 'unspecified-junk' : null,
    eligibleLanguages: getEligibleLanguages(station), missingFull, missingMeta,
    completeLanguages: AUDIT_LANGUAGES.filter(lang => !missingFull.includes(lang) && !missingMeta.includes(lang)) };
}

export function createStationAudit(qualifiedLanguages: readonly string[], snapshotAt: string) {
  const report = {
    snapshotAt, total: 0, qualifiedLanguages: [...qualifiedLanguages],
    reasons: {} as Record<string, number>, reviewCandidates: {} as Record<string, number>,
    storedNoIndexQualityReasons: {} as Record<string, number>,
    samples: [] as Array<{ id: string; slug: string | null; name: string; reason: string; noIndex: boolean; lastCheckOk: boolean | null; completeLanguageCount: number }>,
    languages: AUDIT_LANGUAGES.map(language => ({ language, qualified: qualifiedLanguages.includes(language),
      indexable: 0, excluded: 0, localeIneligible: 0, unqualified: 0,
      missingFull: 0, missingMeta: 0, incomplete: 0, indexableIncomplete: 0,
      exclusions: {} as Record<string, number>, publishedUrls: null as number | null, manifestGeneratedAt: null as string | null })),
  };
  const add = (counts: Record<string, number>, key: string) => { counts[key] = (counts[key] || 0) + 1; };
  return { report, consume(station: AuditStation): StationAuditDecision {
    const decision = classifyStationIndexability(station);
    report.total++;
    add(report.reasons, decision.reason || 'passes-station-rules');
    if (station.noIndex === true) add(report.storedNoIndexQualityReasons, decision.currentQualityReason || 'no-current-quality-rule');
    if (decision.reviewReason) {
      add(report.reviewCandidates, decision.reviewReason);
      if (report.samples.filter(sample => sample.reason === decision.reviewReason).length < 5) {
        report.samples.push({ id: station._id, slug: station.slug, name: station.name, reason: decision.reviewReason,
          noIndex: station.noIndex === true, lastCheckOk: station.lastCheckOk ?? null, completeLanguageCount: decision.completeLanguages.length });
      }
    }
    for (const language of report.languages) {
      if (decision.missingFull.includes(language.language)) language.missingFull++;
      if (decision.missingMeta.includes(language.language)) language.missingMeta++;
      if (!decision.completeLanguages.includes(language.language)) language.incomplete++;
      const reason = decision.reason || (!language.qualified ? 'unqualified-language' :
        !decision.eligibleLanguages.includes(language.language) ? 'locale-ineligible' : null);
      if (reason) {
        language.excluded++; add(language.exclusions, reason);
        if (reason === 'locale-ineligible') language.localeIneligible++;
        if (reason === 'unqualified-language') language.unqualified++;
      } else {
        language.indexable++;
        if (!decision.completeLanguages.includes(language.language)) language.indexableIncomplete++;
      }
    }
    return decision;
  } };
}

/** Prevent spreadsheet formula execution, quote newlines and commas. */
export function auditCsvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export const AUDIT_CSV_HEADER = 'station_id,slug,name,country,station_exclusion,review_reason,current_quality_reason,noindex,manual_noindex,automatic_owner,automatic_reason,provider_last_check_ok,eligible_languages,complete_languages,missing_full_languages,missing_meta_languages\r\n';
export function stationAuditCsv(station: AuditStation, decision: StationAuditDecision): string {
  return [station._id, station.slug, station.name, station.countryCode, decision.reason || '', decision.reviewReason || '', decision.currentQualityReason || '',
    station.noIndex === true, Boolean(station.manualEditFields?.noIndex), station.automaticNoIndex?.owner,
    station.automaticNoIndex?.reason, station.lastCheckOk, decision.eligibleLanguages.join('|'),
    decision.completeLanguages.join('|'), decision.missingFull.join('|'), decision.missingMeta.join('|')].map(auditCsvCell).join(',') + '\r\n';
}

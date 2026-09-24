import { pgCatalog } from '../data/postgres-catalog-store';
import { performanceCache } from '../performance-cache';
import { generateStationDescription, detectStationLanguage, translateDescription } from './ai-station-description';
import { fillMissingDescription, hasCompleteDescription, hasDescriptionText, metadataFromFull } from './station-description-content';
import { findDescriptionLanguageIssues } from './station-description-validation';

export async function fillMissingStationDescriptions(
  station: any,
  targetLanguages: string[],
  onAction: (action: 'generating' | 'translating' | 'saving', languages: string[]) => void,
  assertActive: () => void,
  options: { repairInvalid?: boolean; onSaved?: (language: string) => void } = {},
): Promise<{ skipped: boolean; languages: string[] }> {
  if (station.manualEditFields?.descriptions === true) return { skipped: true, languages: [] };
  if (options.repairInvalid && (station.noIndex !== false || station.redirectToSlug)) return { skipped: true, languages: [] };
  if (station.descriptions != null && (typeof station.descriptions !== 'object' || Array.isArray(station.descriptions))) {
    throw new Error('Malformed description collection; repair its structure before missing-only generation');
  }
  const descriptions = station.descriptions && typeof station.descriptions === 'object' && !Array.isArray(station.descriptions)
    ? structuredClone(station.descriptions) : {};
  const expectedDescriptions = structuredClone(descriptions);
  if (options.repairInvalid) {
    // Country/native-language metadata is not proof of a stored source's
    // language. Only conclusive script/opening evidence authorizes replacement.
    for (const issue of findDescriptionLanguageIssues(descriptions, targetLanguages, { stationName: station.name })) {
      descriptions[issue.language][issue.field] = '';
    }
  }
  const written: string[] = [];
  const save = async (language: string, generated: { full: string; meta: string }) => {
    assertActive();
    onAction('saving', [language]);
    const existing = descriptions[language];
    const next = fillMissingDescription(existing, generated);
    if (!hasCompleteDescription(next)) throw new Error(`Incomplete generated description for ${language}`);
    if (options.repairInvalid && findDescriptionLanguageIssues({ [language]: next }, [language], { stationName: station.name }).length) {
      throw new Error(`Generated description has invalid language evidence: ${language}`);
    }
    const result = await pgCatalog().update(
      { _id: station._id, [`descriptions.${language}`]: expectedDescriptions[language] ?? null, 'manualEditFields.descriptions': { $ne: true },
        ...(options.repairInvalid ? { noIndex: false, redirectToSlug: { $in: [null, ''] } } : {}) },
      { $set: { [`descriptions.${language}`]: next } },
    );
    if (!result.modifiedCount) throw new Error(`Description changed concurrently or is protected: ${language}; rerun missing-only to recheck`);
    descriptions[language] = next;
    expectedDescriptions[language] = next;
    written.push(language);
    options.onSaved?.(language);
    if (station.slug) performanceCache.invalidateStationCache(station.slug);
    performanceCache.setQuick('admin:description-coverage', null, 1);
  };

  // Repair metadata first so a later provider failure cannot discard that work.
  for (const language of targetLanguages) {
    const existing = descriptions[language];
    if (hasDescriptionText(existing?.full) && !hasDescriptionText(existing?.meta)) {
      const meta = metadataFromFull(existing.full);
      if (!meta) throw new Error(`No usable localized prose for metadata repair: ${language}`);
      await save(language, { full: existing.full, meta });
    }
  }
  let missing = targetLanguages.filter(language => !hasCompleteDescription(descriptions[language]));
  if (!missing.length) return { skipped: written.length === 0, languages: written };

  const nativeLanguage = detectStationLanguage(station);
  let sourceLanguage = [nativeLanguage, ...Object.keys(descriptions)].find(language =>
    hasDescriptionText(descriptions[language]?.full) &&
    (hasDescriptionText(descriptions[language]?.meta) || metadataFromFull(descriptions[language].full)),
  );
  if (!sourceLanguage) {
    if (station.aiDescriptionSkipped) return { skipped: true, languages: written };
    assertActive();
    onAction('generating', [nativeLanguage]);
    const result = await generateStationDescription(station, nativeLanguage);
    if (!result.success || !result.fullDescription || !result.metaDescription) {
      throw new Error(result.error || 'Failed to generate a source description');
    }
    sourceLanguage = result.language;
    await save(sourceLanguage, { full: result.fullDescription, meta: result.metaDescription });
    missing = targetLanguages.filter(language => !hasCompleteDescription(descriptions[language]));
  }
  if (missing.length) {
    const source = descriptions[sourceLanguage];
    // Capture an already-complete pivot before the first translation request.
    // A target returned in that request must not create a chain of paid retries.
    const englishPivot = hasCompleteDescription(descriptions.en) ? descriptions.en : undefined;
    assertActive();
    onAction('translating', missing);
    const translations = await translateDescription(source.full,
      hasDescriptionText(source.meta) ? source.meta : metadataFromFull(source.full),
      sourceLanguage, missing, station.name, assertActive);
    for (const language of missing) {
      const translated = translations.get(language);
      if (translated) await save(language, translated);
    }
    let failed = missing.filter(language => !hasCompleteDescription(descriptions[language]));
    const pivotTargets = failed.filter(language => language !== 'en');
    const comparable = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();
    if (sourceLanguage !== 'en' && englishPivot && pivotTargets.length &&
        comparable(englishPivot.full) !== comparable(source.full)) {
      // One alternate-source attempt only. The same translator keeps its output
      // validation/concurrency limit; saves retain original compare-and-set guards.
      assertActive();
      onAction('translating', pivotTargets);
      const retried = await translateDescription(englishPivot.full, englishPivot.meta,
        'en', pivotTargets, station.name, assertActive);
      for (const language of pivotTargets) {
        const translated = retried.get(language);
        if (translated) await save(language, translated);
      }
      failed = failed.filter(language => !hasCompleteDescription(descriptions[language]));
    }
    if (failed.length) throw new Error(`Translation failed for languages: ${failed.join(', ')}`);
  }
  return { skipped: false, languages: written };
}

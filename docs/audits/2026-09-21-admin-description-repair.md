# Admin description filters and catalogue repair — 21 September 2026

## Delivered

- **Stations → Maintenance & translation tools → Bulk AI repair · 14 languages** checks the entire eligible catalogue, not only the visible page or selected country. Existing selection-based bulk generation remains separate.
- Confirmation describes API charges and scope. The server always uses the 14 supported languages and GPT-4o mini, rejects language/scope overrides, limits translation concurrency to two, and permits only one description job at a time.
- Missing full descriptions and meta descriptions are filled. Conclusive wrong-script cases are repaired conservatively. Valid existing fields, manually protected descriptions, stored noindex and redirect exclusions are preserved. Writes use compare-and-set checks to avoid overwriting concurrent edits.
- Progress, failures, cancellation and sitemap-publish outcome are visible. Failed locales can be retried without regenerating successful ones. A copied native-language result may receive **one** alternate attempt using an already-complete, distinct English source; copied results are still rejected. There is no unbounded retry chain.
- Description filtering now uses a PostgreSQL-native summary maintained transactionally by a trigger, avoiding repeated decompression of large 14-language JSON values. Superseded browser requests are cancelled. No MongoDB service or background database synchronization was introduced.

## Measured verification

| Check | Result |
| --- | --- |
| Missing-language filter, before | 13,761 ms |
| Missing-language filter, final sample | 2,595 ms |
| No-description / has-description filters | 186 ms / 308 ms |
| API regression tests | 89 passed |
| Frontend regression tests | 43 passed |
| Typechecks and production builds | API and web passed |
| Railway | API and web Active / Deployment successful; stream and database Online |
| New eligible stations | 84/84 with slug and all 14 full/meta fields |
| Final exact-selection retry | 2 successful, zero failed |
| Remaining Missing languages rows | 1,087, all stored noindex; no indexable rows |
| New-station public locale samples | 42/42 passed across three stations |
| Sitemap manifests | 42 active, all 14 languages, zero zombie languages |
| Station sitemap membership | 55,664 URLs per language (+84) |

Measurements are individual live requests, not a guaranteed maximum. Field completeness does not certify every historical sentence's language or accuracy. Arbitrary wrong Latin-language text, mixed-language fragments and unsupported factual claims still require editorial review; two known source-text cases were reviewed and corrected in all languages during this work.

The manual synchronous sitemap-rebuild request returned a Railway 502 timeout after the underlying rebuild completed. The operation was not duplicated. Fresh database manifests and served EN/DE/TR chunk-6 XML confirmed the new membership, correct XML MIME and image tags. This timeout is not presented as fixed by the new bulk feature; its publication runs within the background job instead.

## Release and safety boundary

Feature release: `338ab6da981f044ae4acec23c2bc59fd380e11ee`; CJK validation correction: `9b26777a38f48689011e4c76234fbbd9ad9c7ae6`; bounded English-source retry: `a75b91523354603a07c266d1a45899b6bfa485cb`.

Final retry: `bulk-desc-51a809bc-93c5-449d-bd4f-b2abb39fdac2`, completed `2026-09-20T22:56:15.514Z`. No global paid repair was started merely to test the new button. The previously authorized new-import backlog was completed with explicit station IDs. No records were deleted or merged, and no payment, account-access or service-resource settings changed.

Search Console validation requests already show Started. This is not Passed and does not guarantee Google indexing. See the linked chronological audit for provider-sync and historical-URL repairs.

## Guidance applied

The SEO-audit skill informed canonical/hreflang checks and preservation of intentional exclusions; frontend-design kept the new action consistent with the existing admin interface. OpenAI documentation informed bounded GPT-4o mini prompts and validation. The computer-use skill was used to publish through the existing GitHub Desktop session without extracting credentials or changing accounts.

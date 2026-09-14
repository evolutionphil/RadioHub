# Sitemap and Search Console audit — 14 September 2026

## Scope and evidence

Authenticated Search Console UI for `sc-domain:themegaradio.com`, public production XML/HTML/image responses, authorized read-only admin endpoints, and source/tests were compared. The initial audit made no production data/configuration/deployment changes. At the user's subsequent explicit request to restore the integration, the configuration-only production repair below was applied. No GitHub push or local code deployment was performed; publishing the code changes remains with the user.

The SEO audit workflow distinguishes discovery, crawling, indexability, and Google's index selection. The optional squirrelscan CLI was initially unavailable, so the complete sitemap audit used direct live XML/HTML checks and source regression tests. The user subsequently authorized installing the CLI; its separately scoped setup/check is recorded below.

## Confirmed findings

### 1. The app's Google integration has been using an unauthorized account

- Production `/api/admin/gsc-inspection/status`: configured=true, property=`sc-domain:themegaradio.com`, latest inspection batch `2026-09-14T21:07:49.565Z`: **83 attempted, 0 successful, 83 failed**.
- Cached dashboard inventory: **685,211 URLs**, of which **461,650 pending** and **223,561 API errors**. This is NOT a measurement that Google has indexed zero pages.
- Cached error examples report HTTP 403 `PERMISSION_DENIED`: the account does not own the site or the URL is outside its property.
- An independent current, read-only Google `sites.get` using the configured service account returned **404: the domain property is not a verified Search Console site in this account**. Credentials were kept in process memory and not printed or saved.
- The app also has an existing connected OAuth account with `webmasters.readonly`. Source previously always selected the service account before this connected account. A connected token alone does not prove that its refresh token is still valid or that it has property access; the corrected code must verify access before running a batch.

#### Production repair verified at 23:52 Berlin

- Blanked only `GSC_SERVICE_ACCOUNT_JSON` on Railway's production **RadioHub API** service. OAuth client configuration, stored OAuth connection, and `GSC_SITE_URL` were preserved. No new Google permission, account, or credential was created; the old Google service-account key was not revoked.
- Railway deployment `f0315d37-2507-45f1-980f-a31223ae9caa` completed **SUCCESS**, retaining the existing code commit `2d60e9a7b4d87572a45846230dc8069443856f0f`. This was a settings-triggered redeployment, not a publication of the pending source fixes.
- `POST /api/admin/gsc-inspection/refresh` with `{"batchSize":1}` completed at **2026-09-14T21:52:18.723Z**: **1 attempted, 1 succeeded, 0 failed**. The authenticated admin UI independently displayed **1/1 succeeded**. With the service-account setting empty, this successful Google inspection used the existing OAuth connection.
- `cronEnabled=true`; scheduled inspection remains active. Historical 403 rows were not deleted or falsely marked successful and will be replaced as those URLs are re-inspected within the configured quota. A successful API inspection is not the same as Google indexing that URL.
- Post-change API health, English homepage, and the identified station's public API all returned **HTTP 200**.

### 2. GSC's main index has not recorded child processing; standalone English leaves work

Observed submitted sitemap rows:

| Submitted URL | Last read | GSC status | Discovered pages |
| --- | --- | --- | ---: |
| `/sitemap-index.xml` | 7 September 2026 | Success | 0 |
| `/sitemap-stations-en-1.xml` | 14 September 2026 | Success | 10,000 |
| `/sitemap-main-en.xml` | 14 September 2026 | Success | 73 |

The master detail said it was successfully processed, with no child rows. This is evidence of no recorded child processing, **not proof of invalid current XML**, and not proof that individual pages cannot be indexed. Google's documentation supports submitting one index containing the child sitemaps; manually submitting every leaf is not a requirement.

After validating the live master and all 98 children, the master was resubmitted once. Google displayed **“Sitemap submitted successfully”** and the row's submitted/read dates changed to **14 September 2026**, status Success. Discovered count remained zero immediately afterward; child processing/indexing is not claimed complete. The user's existing two child submissions were retained.

### 3. Most reported exclusions are already-crawled URLs, not sitemap-discovery failures

The Page Indexing report was last updated **4 September 2026** (historical, not today's inventory): 5 indexed pages, approximately 63,900 not indexed. Largest group: **61,301 crawled — currently not indexed**. Other visible groups included 625 not found, 407 noindex, 367 soft 404, 32 redirects, 237 Google-selected alternate canonicals, and historical server/duplicate/redirect-error groups. Several validations were already in progress from 7 September; these were not restarted blindly.

Example `/en/station/wtos`:

- Google's stored inspection: crawled 5 September, fetch successful, crawling allowed, indexing allowed, self-declared canonical; no referring sitemap detected. Not selected for indexing.
- A fresh Google live test on 14 September at 23:18 Berlin: **URL available to Google; page can be indexed; one valid breadcrumb item**.
- Its production HTML returned HTTP 200, self canonical, `index, follow`.
- Request Indexing was attempted once after the successful live test, but Google rejected it because the **daily manual request quota was exhausted**. No accepted request is claimed.

Ten example URLs from the largest exclusion group were checked publicly. Current canonical station pages returned 200/indexable; obsolete language/route forms redirected toward their supported canonical pages. Some obsolete forms take two redirects. These historical samples do not establish that every excluded URL is healthy.

Authenticated Manual Actions and Security Issues reports both said **no issues detected**.

### 4. Fourteen languages are supported, with content-based station eligibility

The current code supports `ar, de, en, es, fr, he, hi, it, ja, ko, pt, ru, tr, zh`. A station locale is included when it passes the common indexability gate and has native/broadcast-language relevance or a non-empty localized full and meta description. Sitemap, SSR canonical/redirect decisions and hreflang must agree.

Blank/untranslated station versions must not be advertised as complete translated pages. Broadly disabling this gate would hide data-quality gaps and create alternate URLs that do not deliver the promised language content. Google determines page language from actual content, not just `lang` or `hreflang`.

### 5. Complete live XML audit and one genuine translation gap

The master and **98/98 child files** returned HTTP 200 without redirects; all parsed as well-formed XML. No empty or oversized files were found. The index directly references URL-set leaves, not nested language indexes.

- **684,483 localized URL entries**: 1,022 main, 3,346 genres, 680,115 station entries. These are not unique station counts or indexed counts.
- Each locale has 73 main URLs and 239 genre URLs. Nine locales have 48,580 station URLs; `es, fr, pt, hi, he` have 48,579.
- Largest child: `/sitemap-stations-ja-3.xml`, **32,378,484 uncompressed bytes (30.88 MiB)** and 10,000 URLs, below the protocol's 50 MiB/50,000-URL limits.
- The exception is `/en/station/cheng-wu-zong-he-guang-bo` (成武综合广播). Public station data confirms nine full+meta descriptions; the five omitted locales have no description record. Spanish and French variants currently 301 to English. No false claim that every station already has all 14 translations.
- The production description-fill job began 14 September 02:30 UTC, generated 61 descriptions/796 translated language records, then **stopped early on a PostgreSQL statement timeout** at 02:39:38, before processing partial records. This explains why automatic completion cannot currently be assumed.
- Independently, the source candidate selector and scheduler previously treated a full description as complete even when its meta description was absent; that disagrees with the sitemap eligibility gate.

MANGORADIO was checked on all 14 localized page URLs: HTTP 200, correct HTML language, self canonical, index/follow, localized descriptions and body text. HTML exposes 15 hreflang entries (14 locale tags plus x-default); XML exposes 23 including generic/regional aliases. After normalizing encoded versus Unicode URLs and region aliases, the sample had **zero reciprocal-link failures and zero conflicting shared hreflang targets**. This is representative testing, not a semantic review of all 48,580 stations.

### 6. Images are already present, but external-only logos were omitted

Live station sitemaps contain **309,815 image occurrences** (repeated across language URLs); **370,300 station entries have no image tag**. Most included images point to the station-logo S3 bucket. Three sampled S3 logos returned 200 `image/webp`, with no redirect or X-Robots-Tag. Station pages and `/api/image/` are allowed for Googlebot in robots.txt.

The old picker ignored external-only favicons even though SSR could display those same logos through the first-party image proxy. The fix uses that existing proxy as a fallback, preserving processed S3 URLs first. It does not invent images for stations with no usable logo, advertise a shared placeholder, or claim that Google Images has indexed the images.

Search Console's sitemap table does not expose an indexed-image count. Its discovered-page/video columns must not be interpreted as an image-indexing result.

## Code corrections

- Sitemap validators hash the actual XML, including image/date changes. The body hash is computed at generation time; a small same-lifetime validator cache permits cheap conditional hits even for leaves too large for the local body cache. A date-only request cannot incorrectly suppress a changed body with 304.
- A rolling manifest update no longer drops the other languages merely because the first new version was activated. Incomplete manifests or advertised leaves that unexpectedly render empty return uncached, retryable 503 rather than a successful empty sitemap.
- Existing external-only station logos can appear via the same owned image proxy used in SSR. Known placeholders and invalid/credential-bearing URLs are excluded.
- GSC discovery includes A–Z hubs and applies the same content-language eligibility rules as the public sitemap. Translated-language completeness is projected without shipping all full translated texts to the admin report.
- GSC aggregate counts use localized URL multiplicities rather than counting one station as one URL. Redirected and unknown catalog results are separated from indexable results; thin/non-whitelisted genres are recognized.
- An API/auth/network error preserves the previous Google indexing verdict instead of converting it into a new indexing failure. The UI distinguishes uninspected URLs, API failures, Google inspection, and IndexNow notifications.
- Batches prefer the already-connected OAuth account and verify configured property access before claiming inspection work/quota. A preconfigured service account is only a fallback if it independently passes the same check. No broader scopes or property permissions are granted.
- Description completion scans bounded catalog pages, including pages with zero incomplete stations, so a rare partial record does not require an unbounded single SQL scan. Missing meta descriptions are detected as incomplete; metadata-only repairs preserve existing localized prose and avoid paid translation. Existing manual-edit/concurrency guards remain.

## Release checklist and remaining limits

1. Publish the local changes through the user's normal GitHub/Railway workflow. They are not deployed; the successful configuration-only redeployment above retained the existing production commit.
2. Current OAuth access is now proven by a successful live inspection. After publishing the pending API build, verify its additional property-access preflight and error-state protections as well. Keep the unauthorized service-account setting empty; no reconnect or broader permission was needed for this repair.
3. Confirm the next description-fill run completes the partial phase without a timeout. The five actual missing translations remain a production-data gap until this succeeds. Do not force their URLs into the sitemap while they redirect to English.
4. Confirm a subsequent manifest rebuild includes those newly completed locales, and spot-check their 200/self-canonical responses.
5. Allow Google to process the accepted master resubmission and existing validations. Retry the individual WTOS manual request only after Google's quota resets if needed. No repeating submission loop or guaranteed indexing deadline.

Repairing sitemap transport and the reporting integration cannot force Google to index the 61,301 already-crawled historical URLs. Current example indexability is verified; corpus-wide originality, content quality, incoming links and Google's canonical/index selection remain separate factors, not established diagnoses from this audit.

## Sources

- [Google: build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google: sitemap index requirements](https://developers.google.com/search/docs/crawling-indexing/sitemaps/large-sitemaps)
- [Search Console: sitemap report semantics](https://support.google.com/webmasters/answer/7451001?hl=en)
- [Google: localized versions and reciprocal hreflang](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [Google: image sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps)
- [Search Console API: property access lookup](https://developers.google.com/webmaster-tools/v1/sites/get)
- [Search Console API: usage limits](https://developers.google.com/webmaster-tools/limits)

## Verification and release status

Verification:

- 45 sitemap/canonical/hreflang tests passed.
- 20 native PostgreSQL GSC/snapshot tests passed, including OAuth selection, property-denied fail-fast without quota claims, error recovery, A–Z discovery, translated foreign-locale eligibility, and counting beyond 50,000 URLs.
- 75 description/catalog/worker tests passed: 28 description-outcome cases, 29 native catalog cases, and 18 native admin/worker contracts. The paging regression crosses 200 already-complete stations before reaching a rare partial candidate.
- Full frontend suite: **91 files, 1,319 tests passed**.
- API and frontend TypeScript checks passed; the production frontend build passed (203 outputs validated in memory, no build files written).
- `git diff --check` passed.

The local PostgreSQL servers started for validation were stopped after testing. A valid sitemap and passing live indexability test do not guarantee indexing or a processing deadline.

## Optional audit CLI installed

At the user's follow-up request, **Squirrel 0.0.95** was installed from the official installer/release after reviewing the installer and verifying the downloaded binary checksum. Executable: `C:\Users\mumiix\AppData\Local\squirrel\bin\squirrel.exe`. Only this directory was added to the user's PATH, preserving existing entries; system PATH and shell profiles were not modified. New terminals can run `squirrel --version`.

`squirrel self doctor`: **7 checks passed, 0 failed**. One non-blocking warning: this binary-copy installation is not managed for self-updates. No cloud account, paid credits, MCP connection, or extra property permissions were enabled. Telemetry and automatic update requests were disabled for the install/audit session.

No additional production CLI audit was launched: installed 0.0.95 has no exposed no-sitemap option, and its sitemap discovery uses separate fixed concurrency rather than honoring the page-crawl concurrency limit. A ten-page limit therefore does not bound sitemap downloads. Repeating large sitemap fetches was unnecessary after the complete direct audit. No Squirrel score is fabricated, and no score improvement or full CLI coverage is claimed. The installed tool remains available for appropriately bounded future audits. See [official CLI options](https://docs.squirrelscan.com/cli/audit) and [crawler behavior](https://docs.squirrelscan.com/crawl).

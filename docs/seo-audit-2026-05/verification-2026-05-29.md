# SEO Audit — Re-Verification & Fixes (2026-05-29)

This pass re-checked every change shipped in the recent PRs, re-validated the
existing A1–A24 SEO audit findings against the **current** codebase (143
commits have landed on `main` since the 2026-05-18 audit), and fixed the one
remaining robots.txt blocking issue that affects Google rendering of public
pages.

Live-fetch SEO checks (`seo-audit-full.mts`) cannot run from this sandbox —
outbound HTTP is blocked by the environment network policy (`google.com`
itself returns 403). All verification below is **code-level** (reliable and
reproducible) plus the live audit script remains available to run from a
network-allowed environment.

---

## 1. Build / type / test health

| Check | Result |
|---|---|
| `pnpm --filter @workspace/megaradio run typecheck` | ✅ clean |
| `pnpm --filter @workspace/api-server run typecheck` | ✅ clean (4 pre-existing errors fixed this pass) |
| `pnpm run typecheck:libs` | ✅ clean |
| `pnpm --filter @workspace/megaradio run test` (vitest) | ✅ 40/40 pass |
| `pnpm --filter @workspace/api-server run test` (node) | ✅ 306 pass; 172 fail = **environment only** |

**The 172 api-server test failures are NOT code failures.** Every one traces to
`mongodb-memory-server` trying to download a MongoDB binary from
`fastdl.mongodb.org`, which the sandbox network policy blocks (HTTP 403). Tests
that do not need an in-memory DB all pass. This is identical behaviour on a
clean checkout of `main` and is unrelated to any change in these PRs.

### Type errors fixed this pass (previously blocked a clean `pnpm run build`)

- `admin-station-routes.ts` ×2 — dropped explicit `import('mongodb').UpdateResult`
  annotations (`mongodb` is not a direct dependency); Mongoose infers the
  return type of `updateMany()`.
- `cleanup-duplicate-genre-slugs.ts`, `cleanup-malformed-genre-slugs.ts` —
  aliased `Collection`/`ObjectId` from the `mongoose.mongo` namespace instead of
  importing the non-dependency `mongodb` module.
- `seo-audit-full.mts` — cast `r.json()` (`unknown`) to the generic `T`.

---

## 2. robots.txt — full re-review (the user's primary concern)

Source: `artifacts/api-server/src/routes/seo-sitemap-routes.ts:954`.

**Strategy is correct:** `Allow: /api/` opens all SSR/data endpoints to
Googlebot's Web Rendering Service, with narrow `Disallow:` rules for genuinely
sensitive subtrees (admin, auth, user, billing, audio stream, internal). Google's
"longest-match-wins" rule makes those narrow Disallows override the broad Allow.

### Fixed this pass — `/api/image/` was blocking station artwork ⚠️→✅

`/api/image/<base64>` (`stream-proxy-routes.ts:198`) is the **resize proxy that
serves every station logo and favicon** on the homepage station cards and
station-detail pages. It was `Disallow`'d, so Googlebot's WRS could not fetch
station artwork while rendering — making pages look thinner to Google and
blocking Google Images from indexing the logos.

Changed to `Allow: /api/image/` in all three crawler stanzas (`*`, Baiduspider,
Sogou) and added an explicit `Allow: /api/og-image/`. The proxy is a safe GET
with SSRF guards and emits `Cache-Control: public, max-age=86400,
s-maxage=604800` (CDN-cached 7 days), so crawler fetches are cheap.

### Confirmed NOT blocking anything else important

| Concern | Verdict |
|---|---|
| `/api/og-image/:slug` (og:image source) | ✅ Was always crawlable (no Disallow); now explicit Allow |
| `/assets/*.js`, `/assets/*.css` (Vite bundles) | ✅ Explicitly allowed; `Allow: /assets/*.js` (12 chars) beats `Disallow: /*/profile` (10) |
| Public data endpoints used by SSR/WRS (`/api/genres/*`, `/api/stations/*`, `/api/location`, `/api/public-profiles`, `/api/advertisements`, ratings) | ✅ All under `Allow: /api/`, none Disallow'd |
| `/api/user/follow` referenced client-side | ✅ POST/DELETE only — robots.txt does not gate non-GET; button degrades gracefully |
| `/search`, `/*/search` Disallow'd | ✅ Intentional — search pages are also `noindex, follow` in SSR (`seo-renderer.ts`) |
| Geo-block / rate-limit / CF-only blocking Googlebot | ✅ Googlebot is in the bot-bypass regex; not throttled (A11) |
| `X-Robots-Tag` vs in-body meta conflict | ✅ Header `index, follow` + selective in-body `noindex` resolves to most-restrictive (correct) |

`Sitemap: {baseUrl}/sitemap-index.xml` is present. AI crawlers (GPTBot,
ClaudeBot, CCBot, Google-Extended, Perplexity, etc.) are all explicitly
`Allow: /` per the owner's prior decision.

---

## 3. Re-validation of the A1–A24 audit findings against current code

| Finding (2026-05-18) | Status today |
|---|---|
| **PRIMARY:** language qualification gate noindexes ~47 languages missing the 15 required SEO keys | Mitigation in place — `seedSeoTranslationKeys()` + per-language seeding run at boot; Turkish (the reported case) had its 12 missing keys + values added and merged. Full per-language completeness is a DB/Phase-C item (needs `MONGODB_URI`). |
| Turkish region/country pages showed English country names (`tr` missing from `country-name-translations.ts`) | ✅ Resolved — `COUNTRY_NAME_TRANSLATIONS.tr` is now fully populated (Almanya, Cezayir, …). |
| `/api/image/` (logos) blocked from Googlebot | ✅ Fixed this pass. |
| `/api/og-image/` (rich-preview image) blocked | ✅ Was a false alarm (`/api/image/` ≠ `/api/og-image/`); explicit Allow added anyway. |
| `llms.txt` missing | ✅ Resolved — `/llms.txt` now served via `buildLlmsTxtBody()` with a static fallback. |
| Static template registries incomplete | ✅ genre/search/legal/static/region = 57/57; url-translations 56/57 (`en` default, expected); country-names now includes `tr`. |
| H1 geo-block / H6 SSR-not-rendering / H3 self-canonical / H13 robots / H15 global-noindex | ✅ All confirmed FALSE — not the cause. |
| `community-page-seo-templates.ts` missing 32 languages | ⏳ Open, **low priority** — affects only community/social pages (`/users`, `/recommendations`), does NOT trigger station noindex. Falls back to English copy under non-English paths. Recommended as a later content task. |

---

## 4. Per-page-type / per-language SEO posture (code-level)

All public page types build localized `<title>`, `<meta description>`,
canonical, hreflang alternates, OpenGraph and JSON-LD in `seo-renderer.ts`:

- **Home** — SSR-injects popular stations + top genres so Googlebot sees real
  content (not an empty swiper); `window.__INITIAL_DATA__` hydrates the client.
- **Country / region** — localized country names (incl. Turkish), top stations,
  cross-links.
- **Genre** — whitelist-gated; thin/non-whitelisted genres correctly `noindex`.
- **Station** — `RadioStation`/`BroadcastService` schema, breadcrumb; junk /
  numeric-slug / lang-ineligible stations `noindex` with canonical → `/en/...`.
- **Search** — localized meta, intentionally `noindex, follow`.
- **Legal / static / FAQ** — 57/57 template coverage.

Hreflang clusters are built from the indexable-language set, so qualified pages
do not advertise alternates pointing at noindex variants.

---

## 5. Remaining recommendations (require network / DB access — out of sandbox scope)

1. **Run the live audit** from a network-allowed box:
   `pnpm --filter @workspace/api-server exec tsx
   src/scripts/audit/seo-audit-full.mts --site https://www.themegaradio.com
   --api https://api.themegaradio.com` — populates the live sitemap/meta/schema
   sections that 403 from here.
2. **Phase C** — complete all 15 required SEO translation keys for every
   intended language in the `Translation` collection, then force a sitemap
   rebuild + IndexNow ping so Google re-evaluates the now-indexable URLs.
3. **community-page-seo-templates** — backfill the 32 missing languages to stop
   English copy rendering under non-English community URLs.
4. After deploy, re-test `/tr` in GSC URL Inspection (live test) to confirm the
   station-card logos now render and the page is no longer "thin".

---

_Code-level verification & fixes by automated SEO pass, 2026-05-29._

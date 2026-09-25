# MegaRadio radio guides: editorial and developer handoff

10 original articles × 14 complete language editions = 140 article URLs, plus 14 language-specific indexes.

## Contents and locations

The research brief and keyword/intent map are in `2026-09-radio-blog-brief.md`. These are directional demand clusters, **not verified current worldwide search-volume rankings**. No paid keyword service or AI batch job was started.

Full editable texts: `lib/seo-shared/src/blog/locales/{en,de,tr,fr,es,pt,it,ru,ar,he,zh,ja,ko,hi}.json`.
Each article includes a unique title, meta description, primary/secondary keyword brief, introduction, four substantial sections, practical checklist, two answered questions, localized internal links and descriptive illustration alt text. UI labels and disclosure are localized too. AI-assisted authorship is disclosed; no human expert review, test results or station rankings are fabricated.

Public routes on deployment:

- `/{locale}/blog` — guide index
- `/{locale}/blog/{stable-article-id}` — complete localized article
- `/sitemap-blog.xml` — 140 articles + 14 indexes; also linked from the main sitemap index and robots.txt

The English article ID stays constant across languages. This prevents slug-translation collisions; the locale prefix is authoritative. Country/preference cookies do not replace article language. Unsupported locales and invalid article IDs return a 404 instead of a duplicate English article.

## SEO and rendering

- Shared escaped semantic HTML renderer for both server and React; one H1, structured sections, visible FAQ, table of contents, related guides and listening-page links.
- Self-canonical per locale; 14 reciprocal hreflang links plus English x-default. Query parameters do not create new canonical articles.
- Localized BlogPosting, BreadcrumbList and collection-page schema. Schema headline, description, language, illustration caption and dates match visible content.
- No FAQ rich-result promise or fake ratings. Google decides whether to index, rank or show enhanced results.
- Versioned dates change only on substantive editorial changes, not each catalog sync. Update the first publication date if release is delayed to another date.
- Footer discovery link; standalone editorial sitemap does not wait for station DB or translation job readiness.
- SPA navigation retains the existing global player; table-of-contents, modified-click and external-link browser behavior is preserved.

## Performance and images

Blog component and JSON are lazy, per locale. The homepage/player bundle does not include 140 article bodies. Server rendering uses versioned content without a PostgreSQL query or OpenAI call. Public API/station descriptions are unchanged.

10 original vector illustrations, each with 640×336 and 1200×630 WebP variants. The 20 WebP files total about 191 KB. Full-size images are at `/images/blog/{id}-1200.webp`; each article has native-language alt text, explicit dimensions and responsive srcset. Hero loads eagerly; related/index artwork is lazy. SVG sources and a deterministic build script are included; no hotlinked/licensing-uncertain stock images.

Regenerate images from the repository root:

```powershell
node artifacts/api-server/scripts/build-blog-images.mjs
```

Local database-free visual preview (run from `artifacts/api-server`):

```powershell
node --import ./node_modules/tsx/dist/loader.mjs scripts/preview-radio-blog.ts
```

Then visit `http://127.0.0.1:4179/tr/blog`. The local preview is deliberately noindex and is not production. Stop the preview process after use.

## Editing and release checks

1. Edit all affected locale JSON files, retaining stable IDs and factual meaning. Do not pad word counts or add unsupported app features, health claims or arbitrary “best station” rankings.
2. Update illustration alt text when artwork changes. Keep prose out of illustrations so one original asset can serve all languages.
3. Update `BLOG_UPDATED`/`BLOG_REVISION` in `manifest.ts` when editorial content changes; retain the original `BLOG_PUBLISHED` date. Update `/blog.css` version if its layout changes and version image filenames when replacing artwork.
4. Run `blog-seo.test.ts`, `seo-sitemap-routes.smoke.test.ts` and `blog-page.test.tsx`, then server/frontend production builds.
5. After a normal deployment, check `/tr/blog`, `/de/blog/radio-data-usage`, `/ar/blog`, `/sitemap-blog.xml`, main sitemap inclusion and representative image HTTP responses. Use Search Console/Rich Results Test on the actual published URLs only; local schema tests are not Google approval.

Google references: [Article](https://developers.google.com/search/docs/appearance/structured-data/article), [localized versions](https://developers.google.com/search/docs/specialty/international/localized-versions), [images](https://developers.google.com/search/docs/appearance/google-images), [people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).

## Verification — 25 September 2026

- **258 backend tests passed** across blog SEO (including all 140 real renderer entries), sitemap HTTP/XML/ETag/robots smoke tests, existing localized static pages and station transient-recovery behavior.
- **60 frontend tests passed** across the new blog (14 locale render cases, SPA/player-element preservation, native link behavior and unsupported locales), footer language links, existing routing and profile/station breadcrumbs.
- `seo-shared` TypeScript build, API TypeScript check and frontend TypeScript check: passed.
- Production builds: Vite frontend, `src/index-web.ts`, `src/index-api.ts`: passed. Vite retained existing third-party sourcemap/large-chunk warnings; no build failure.
- Production manifest inspection: **14 locale JSON chunks; zero article-body chunks in the initial entry's static dependency graph**.
- Real local browser preview: German article on desktop/390px mobile, Arabic RTL on mobile and Turkish 10-card index. No horizontal overflow observed; native-language prose, headings and illustration displayed.
- Source/body contracts cover 140 localized descriptions/alt texts, 560 sections, 280 FAQ pairs and 420 listening-page links. All 154 sitemap URLs are unique, with reciprocal alternatives; 140 image entries are included.
- **Local preparation only. No commit, GitHub push, production deployment or Google submission was performed for this content task.** Production HTTP/Google Rich Results validation remains a post-deployment check, not something the local tests can certify. Existing unrelated audit-document edits were preserved.

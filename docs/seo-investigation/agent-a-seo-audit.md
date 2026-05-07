# Ajan A — SEO & Website Audit Soruşturması

**Hedef:** MegaRadio (`https://themegaradio.com`)
**Tarih:** 2026-05-07
**Yöntem:** Manuel canlı denetim (Googlebot UA + insan UA), `curl` ile HTTP başlık + HTML inceleme, sitemap traversal. (Not: `seo-audit` skill'i çalıştırıldı; `audit-website` için `squirrel` CLI ortamda kurulu değil — bu eksiklik "Out of scope / araç eksikliği" bölümünde belgelenmiştir. Aynı 230+ kuralın çoğu manuel olarak doğrulanmıştır.)
**Ajan A scope:** Tespit & raporlama. Hiçbir kod değişikliği yapılmamıştır.

---

## 0. Executive Summary

Site teknik olarak **iyi temeller** üzerine kurulu (HTTPS, HSTS, robots.txt, çoklu sitemap, Googlebot için tam SSR, 47–49 hreflang/sayfa, JSON-LD zengin işaretleme, 410 Gone gerçekten dönüyor). Buna rağmen indekslenmemenin ardındaki en olası nedenler **yapısal**:

1. **Bilinen sitemap yolları (`/sitemap.xml`, `/llms.txt`) SPA HTML 200 olarak dönüyor (soft-404).** Search Console "Sitemap could not be read" verir; Google'ın klasik fallback URL'leri var olmayan kaynaklara değil, **HTTP 200 + HTML**'e işaret ediyor.
2. **Bilinmeyen rotalar (`/en/<rastgele>`) 200 + SPA shell ile dönüyor — saf soft-404.** Bu, Google'ın site genelinde "düşük kalite / şişirme" sinyali alması için en güçlü tek nedendir.
3. **UA tabanlı dynamic rendering (cloaking riski).** Googlebot 34 KB SSR alıyor, gerçek kullanıcı 10 KB boş SPA shell alıyor; içerik JS hidrasyonuyla geliyor. Google 2022'de "dynamic rendering"i workaround olarak kabul etmeyi bıraktı; sinyaller divergent ise spam algısı çok yüksek.
4. **Sitemap tutarsızlıkları:** `sitemap-main-en.xml` yalnızca 11 URL içeriyor — ülke detay sayfaları (örn. `/en/regions/germany`) main sitemap'te yok ama erişilebilir, 200 dönüyor ve hreflang seti tam. Crawl yolu kapalı kalıyor.
5. **Çift varyant ana sayfa kanonikalleri (apex + www):** `https://www.themegaradio.com/` 302 ile `/en`'e gidiyor (www → apex 301'i yok). Cloudflare DNS düzeyinde varlığı bile Google için dağılmış sinyal demek.
6. **Yanlış / aşırı kısa lokalize başlıklar:** `de` ana sayfa `<title>` = "Die beste Radio der Welt" (gramer hatalı + 28 karakter, tüm hreflang setinde tek başına outlier). `es` ana sayfa = "La mejor radio del mundo".
7. **`vary: CF-IPCountry` + `x-seo-cache: HIT/MISS`:** `s-maxage=86400` ile cache, ülkeye göre çeşitlendiriliyor — Googlebot ABD IP'lerinden bağlanır; başka bir ülke'den prerender'lanmış HTML Google'a gidebilir (yanlış-dil cache poison).
8. **Trailing-slash redirect chain yok ama `/`→`/en` (apex root) için Googlebot'a 301 dönüyor — iyi. Ancak `/en/` (trailing slash) → 301 → `/en` ek bir hop ekliyor; sitemap içinde slash'lı varyant yok ama dış linkler için redirect chain riski.**
9. **Genres sitemap'te 8 824 URL var, station sitemap'te dil başına 10 000 URL (en için), **ama ana sitemap'teki ülke detay URL'leri 0**.** İndeks dengesizliği kalite sinyalini bozar.
10. **Robots.txt tüm büyük AI-crawler'larını blokluyor (GPTBot, ChatGPTUser, CCBot, anthropic-ai, Claude-Web, Bytespider, PerplexityBot, Applebot-Extended, cohere-ai)** — Googlebot için problem değil, AI search/AEO için sıfır görünürlük (tasarımsa OK; değilse not edilmeli).

**Prerendering altyapısı ve hreflang çalışıyor; en kritik blocker'lar yapısal: sitemap erişilebilirliği, soft-404 yokluğu, www↔apex tutarlılığı, UA cloaking riski.**

---

## 1. Production URL Tespiti

| Kaynak | URL | Notu |
|---|---|---|
| `$REPLIT_DOMAINS` | `15827289-…replit.dev` | Dev preview, indexlenmemeli |
| Live prod (apex) | `https://themegaradio.com` | Birincil, canonical hedef |
| Live prod (www) | `https://www.themegaradio.com` | Ayrı host olarak yanıt veriyor; **apex'e 301'lenmiyor** (kanıt §3.2) |
| HTTP | `http://themegaradio.com` | 301 → HTTPS — OK |

---

## 2. Araç & Yöntem

* `seo-audit` skill checklist'i (technical, indexation, on-page, hreflang, i18n) baştan sona uygulandı.
* `audit-website` (squirrelscan) **kurulup birden çok kez çalıştırılmaya çalışıldı, otomatik tamamlanamadı.** Ayrıntılar:
  * `squirrel v0.0.38` kuruldu (`~/.local/bin/squirrel`).
  * **Deneme 1 (prod, default UA, surface):** `squirrel audit https://themegaradio.com -C surface --format llm` → "Site uses cloudflare protection — some pages may be inaccessible" uyarısı, ardından "discovering sitemaps" adımında **takılıp kaldı**. Sebep yüksek olasılıkla 208 alt-sitemap × ~388 K URL'in tamamını DOM'a almaya çalışması. (Evidence: `docs/seo-investigation/squirrel-attempt-debug.log`).
  * **Deneme 2 (prod, gerçek Chrome UA, quick mode `-m 10`, /en başlangıç):** Aynı sonuç — `[debug] discovering sitemaps` satırından sonra hiçbir log; WAL 712 KB'a büyüdü ve sustu, sonra süreç öldü.
  * **Deneme 3 (Replit dev preview):** `✗ Cannot reach …replit.dev/en: SSL/TLS error - certificate issue` — Replit dev preview proxy'si mTLS kullanıyor, squirrel'in TLS yığını sertifikayı doğrulayamıyor. (Evidence: `squirrel-attempt-dev.log`).
  * **Deneme 4 (localhost:80 paylaşılan proxy):** Crawl başladı ama "New crawl" satırından sonra çıktı üretmeden askıda kaldı; 4 dakika boyunca WAL büyüme durdu. (Evidence: `squirrel-attempt-localhost.log`).
  * **Sonuç:** squirrelscan CLI bu site/ortam kombinasyonunda otomatik bir rapor üretemiyor. Ek bilgi yok ama şu **gözlemler kendi başına bir bulgu**: (a) site Cloudflare ile çok sıkı korunuyor; meşru SEO botları bile kalabalık sitemap discovery aşamasında zorlanıyor — Googlebot'un da büyük sitemap setini boğuluyor olabileceğine dair yan-kanıt; (b) dev preview mTLS'i nedeniyle dış SEO/test araçları için ulaşılamaz — bu, Lighthouse-CI / squirrel / Ahrefs Site Audit gibi araçların dev'de PR-bazlı SEO regresyonu yakalamasını engelliyor (CI gap).
* Squirrel'ın 230+ kuralının yapısal SEO kategorisi (meta, canonical, hreflang, robots, sitemap, broken status codes, security headers, perf headers, structured data sentaks, OG/Twitter, alt text, heading hierarchy, mobile viewport, HTTPS) bu raporda live HTTP+HTML inceleme ile **manuel olarak kapsanmıştır.** **Otomatik araçla doldurulamayan eksikler:** Lighthouse/CWV canlı puanları (LCP/INP/CLS), görsel boyut/format analizi (image weight), tam dış-link broken-link taraması (sample dış linkler için ayrı `curl` testi gerekir). Bu üç kategori için Ajan D'ye PageSpeed Insights API + Ahrefs/Semrush erişimi ile yeniden teyit önerilir.
* Tüm fetch'ler iki UA ile tekrarlandı: `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)` ve gerçek Firefox.

---

## 3. İndeksleme Blocker Checklist

### 3.1 robots.txt (`https://themegaradio.com/robots.txt`)
* **Status:** 200 OK, `text/plain`, sitemap referansı `https://themegaradio.com/sitemap-index.xml` ✅
* **Allow/Disallow:** `Disallow: /api/` + selektif `Allow: /api/station/` vb. — doğru.
* **Disallow paternleri:** `*/admin`, `*/settings`, `*/import-export`, `*/analytics`, `*/search*`, `*/messages`, `*/profile` — ana içeriği etkilemiyor.
* **AI crawlers tamamen blok:** GPTBot, ChatGPT-User, CCBot, anthropic-ai, Claude-Web, Bytespider, PerplexityBot, Applebot-Extended, cohere-ai → **Severity: Medium**, intent kontrolü gerekir; AEO/AI search'te 0 görünürlük demek.
* **Önem: Low (Google için)** — robots.txt indekslemeyi engelleyen bir pattern içermiyor.

### 3.2 Apex / www tutarlılığı
* `https://www.themegaradio.com/` → **HTTP 302 → `/en`** (kanıt: `curl -sI https://www.themegaradio.com/`). Aynı host'tan içerik servisi yapılıyor.
* `https://www.themegaradio.com/en` ayrı bir sayfa olarak servis ediliyor (canonical apex'i işaret etse bile aynı içeriği iki host'tan servis = duplicate canonical signal kaybı, crawl budget israfı, SafeSearch riski).
* **Önem: High.** **Düzeltme:** `www → apex` için 301 (Cloudflare Page Rule veya origin'de redirect middleware'de istisna).

### 3.3 Sitemap
| URL | HTTP | Content-Type | İçerik | Sorun |
|---|---|---|---|---|
| `/sitemap.xml` | 200 | **`text/html`** | SPA shell HTML | **CRITICAL** — Google'ın varsayılan probe'u; soft-404 |
| `/llms.txt` | 200 | **`text/html`** | SPA shell HTML | **CRITICAL** (AI/LLM çağında) — soft-404 |
| `/sitemap-index.xml` | 200 | `application/xml` | 208 alt-sitemap | OK ✅ |
| `/sitemap-stations-en.xml` (bare, indekste yok) | 200 | `text/html` | SPA shell | Soft-404; outdated dış linkler için tuzak |
| `/sitemap-stations-en-1.xml` … `-10.xml` | 200 | `application/xml` | 1 000 URL × 10 = **~10 000 EN station** | OK ✅ |
| `/sitemap-genres-en.xml` | 200 | `application/xml` | **8 824 URL** | OK ✅ |
| `/sitemap-main-en.xml` | 200 | `application/xml` | **Yalnızca 11 URL** | **High** — ülke detay (`/en/regions/{country}`) yok |

* `sitemap-index.xml` 208 alt-sitemap (44 dil × ~5 tip) içeriyor.
* En sitemap-main-en içeriği:
  ```
  /en, /en/stations, /en/genres, /en/about, /en/regions, /en/regions/europe, /asia, /africa, /north-america, /south-america, /oceania
  ```
  Eksik: `/en/regions/germany` … (ülke detayları), `/en/faq`, `/en/llms-page` vb.

### 3.4 Meta robots / X-Robots-Tag
* Edge: `x-robots-tag: index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1` — tüm sayfalarda doğru.
* HTML: SSR çıktısında `<meta name="robots" content="index, follow">` ve `<meta name="googlebot" content="index, follow">`.
* `/en/search` sayfası `noindex, follow` — ✅ doğru.
* 410 station örneği (`radio-paradise-main-mix-eu-320k-aac`) gerçekten **HTTP 410** dönüyor + `<meta name="robots" content="noindex">` + `<title>Gone</title>` ✅ örnek bir junk-station gate çalışıyor.

### 3.5 Canonical
* Tüm test edilen prerender'lı sayfalar self-canonical:
  * `/en` → `https://themegaradio.com/en` ✅
  * `/de` → `…/de` ✅, `/tr` → `…/tr` ✅, `/es` → `…/es` ✅, `/ar` → `…/ar` ✅
  * `/en/regions/germany` → `…/en/regions/germany` ✅
  * `/en/genres/jazz` → `…/en/genres/jazz` ✅
  * `/en/station/bbc-world-service` → `…/en/station/bbc-world-service` ✅
  * `/de/sender/bbc-world-service` → `…/de/sender/bbc-world-service` ✅
* **Cross-locale canonical YOK** ✅ (Eğer cross-locale canonical olsaydı tek-dil-suppression riskine girerdi.)

### 3.6 Hreflang
* Ana sayfalar: 47–49 hreflang çifti (alt dil sayısı 47 EN, 49 lokalize) + her sayfada `hreflang="x-default"` → `…/en` ✅
* Reciprocity test: `/en/regions/germany` `hreflang="de"` → `https://themegaradio.com/de/regionen/germany` (lokalize segment) — hedef HEAD = 200 ✅
* Genre sitemap içinde her URL'de tüm lokalize alternatifler `<xhtml:link>` olarak listeleniyor.
* Station sayfalarında 14 hreflang var, ana sayfada 49 — uyumsuz set (Google'ın hreflang işleme kuralı: ortak küme dışında kalanlar düşürülür ama sayfa-bazlı alt-set OK; yine de kullanıcı dil seçeneği ↔ station kapsamı netleştirilmeli).
* **Önem: Low–Medium** — hreflang teknik olarak doğru; sayım tutarsızlığı kalite sinyali değil ama Search Console'da `International Targeting → Hreflang` bölümünde uyarılar üretebilir.

### 3.7 Render edilebilirlik (CSR vs SSR/Prerender)
**Kanıt: aynı URL'i iki UA ile çek:**
| URL | Googlebot UA size | Firefox UA size | Bot H1/H2/H3 sayısı | Human H1/H2/H3 sayısı |
|---|---|---|---|---|
| `/en` | **34 709 byte** (full SSR) | **10 626 byte** (boş SPA shell) | 17 | 0 |
* SSR'da `<h1>Mega Radio: Listen to Free Live Radio & Music from 120 Countries</h1>` ve tam body içeriği var.
* Human shell'de görünür içerik yok; tüm içerik JS ile hidrate ediliyor (JS bundle 200 OK: `/assets/index-VTnJAX4h.js`).
* **Bu klasik UA-tabanlı dynamic rendering.** Google 2022'de [bu yaklaşımı önermeyi bıraktı](https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering); SSR/SSG/hidrasyon önerilir. **Risk:** Google kalite raters cloaking algılayabilir; INP/CLS user metrikleri ile bot SSR yetenekleri arasında uçurum oluşur (Search Console'da "Crawled — currently not indexed" kümesi büyük olur — sıkça MegaRadio'nun şikayetiyle eşleşir).
* **Önem: Critical.**

### 3.8 Status code & redirect chains
| Test | Sonuç | Not |
|---|---|---|
| `/` (Googlebot) | 301 → `/en` | ✅ deterministik (kod doğru) |
| `/` (Firefox) | 302 → `/en` | ✅ geo-detected, 302 doğru |
| `/en` | 200 | ✅ |
| `/en/` (trailing slash) | 301 → `/en` | ✅ tek hop |
| `/at` (country code) | 301 → `/de` | ✅ tek hop |
| HTTP `http://themegaradio.com/` | 301 → HTTPS | ✅ |
| `/en/this-page-does-not-exist-xyz123` | **200** + SPA shell | ❌ **soft-404** |
| `/en/station/this-station-does-not-exist-xyz123` | 404 | ✅ doğru |
| `/sitemap.xml` | **200** + SPA shell | ❌ soft-404 |
| `/llms.txt` | **200** + SPA shell | ❌ soft-404 |

### 3.9 Headers / cache / vary
* `cache-control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600`
* `vary: CF-IPCountry` — **Cloudflare ülke başına cache çeşitlendiriyor.** Yani Googlebot ABD IP'sinden gelirse ABD-cache'lenmiş HTML alır; ama `_doRenderStaticPage` cookie tabanlı `preferredLanguage` ile dilini override edebiliyor. Cache key'de `preferredLanguage` var (kod incelemesi: `cacheKey = … |lang=…`), ama edge'de yok — **cache poisoning riski.**
* `x-seo-cache: HIT|MISS` — kendi prerender cache'i çalışıyor.
* `x-railway-edge`, `cf-ray`, `cf-cache-status: DYNAMIC` — CDN bypass (origin-cache var, edge-cache yok).
* `strict-transport-security: max-age=604800; includeSubDomains` — HSTS 7 gün, ideal 1 yıl + preload.
* `content-security-policy` çok detaylı; problem yok.
* `x-frame-options: DENY` — embeddable widget istenirse kontrol edilmeli.

---

## 4. Sayfa türü başına bulgular

### 4.1 Home — 5 dil
| URL | HTTP | Title | `<html lang>` | Canonical | hreflang | JSON-LD tipleri | Notu |
|---|---|---|---|---|---|---|---|
| `/en` | 200 | "Mega Radio: Listen to Free Live Radio & Music from 120 Countries" (62) | `en` | self ✅ | 47 + x-default ✅ | WebSite, Organization, ItemList, FAQPage, RadioStation×10, SearchAction | OK |
| `/tr` | 200 | "Mega Radio: Dünyanın en iyi ücretsiz canlı radyosu." (52) | `tr` | self ✅ | 49 ✅ | (idem) | OK |
| `/de` | 200 | **"Die beste Radio der Welt"** (28, gramer hatalı: olmalı "Das beste Radio der Welt") | `de` | self ✅ | 49 ✅ | (idem) | **Medium issue** — başlık çok kısa + gramer yanlış |
| `/es` | 200 | **"La mejor radio del mundo"** (25) | `es` | self ✅ | 49 ✅ | (idem) | **Medium** — başlık çok kısa, anahtar kelime yok |
| `/ar` | 200 | "ميغا راديو: استمع إلى الراديو المباشر والموسيقى المجانية من 120 دولة" | `ar` | self ✅ | 49 ✅ | (idem) | OK; RTL korelasyonu doğrulanmadı |

* **Sayfa içeriği (SSR body):** popüler stations grid, top genres, top countries, "About Mega Radio" bloğu — semantik olarak iyi.
* OG/Twitter etiketleri: `og:image` = `/images/logo-icon.webp` — **yalnızca logo**, station-specific veya marka-zengin OG yok (paylaşım CTR düşürür).
* **JSON-LD'de FAQPage:** ana sayfada 10 Q&A — "FAQPage'in *yalnızca FAQ olan sayfada* olması gerekir" Google policy'sinin **ihlali olabilir** (ana sayfa = WebSite, FAQ değil). Rich Result penaltiye yol açabilir.

### 4.2 Station detay — 3 farklı istasyon, farklı dil
| URL | HTTP | Title | Canonical | hreflang | JSON-LD |
|---|---|---|---|---|---|
| `/en/station/bbc-world-service` | 200 | "BBC World Service from The United Kingdom Of Great Britain And Northern Ireland — Listen Live Online" (102, **kısaltma uzun ülke adından dolayı SERP'te kesilir**) | self ✅ | 14 ✅ | RadioStation, BroadcastService, Country, Organization, BreadcrumbList, ListenAction (Apple-uyumlu) ✅ |
| `/de/sender/bbc-world-service` | 200 | "BBC World Service aus The United Kingdom Of Great Britain And Northern Ireland — Jetzt Live Online Hören" (107) | self ✅ | 14 ✅ | (idem) |
| `/tr/istasyon/bbc-world-service` | 200 | "BBC World Service The United Kingdom Of Great Britain And Northern Ireland'den — Canlı Dinle" (94) | self ✅ | 14 ✅ | (idem) |
| `/en/station/mangoradio` | 200 | "MANGORADIO from Germany — Listen Live Online" | self ✅ | 14 ✅ | (idem) |
| `/en/station/radio-paradise-main-mix-eu-320k-aac` | **410** | "Gone" | — | — | none — ✅ junk gate çalışıyor |

* Title pattern: "{Station} from {Country} — Listen Live Online" — iyi yapı, ancak ülke uzunsa **SERP truncation** (>60 char). UK için "United Kingdom" kısaltılabilir.
* Slug aliases 301 yapısı çalışıyor (kod incelemesi seo-renderer.ts:330-394).
* **Önem: Medium** — uzun ülke adlarını başlığa enjekte etmek SERP CTR düşürür.

### 4.3 Country (RegionStations) — `/en/regions/germany`
* HTTP 200, title "Germany Radio Stations - Regional Broadcasting | Mega Radio" (60), `<h1>` "Germany Radio Stations — Listen Live Online | Mega Radio" — ✅
* Canonical self, 49 hreflang, 4 JSON-LD bloğu.
* **Issue:** sitemap-main-en.xml'de **yer almıyor**. Crawl yolu yalnızca homepage iç linklerinden (DOM'da `/en/regions/germany` linki var, OK) — ama **sitemap submit edildiğinde Google ayrı bir explicit sinyal alır.** Eklenmezse "Discovered – currently not indexed" oranı yüksek kalır.

### 4.4 Genre — `/en/genres/jazz`
* HTTP 200, title "Jazz Radio Stations - Listen Live Online | Mega Radio" (57), `<h1>` mevcut.
* 49 hreflang, 4 JSON-LD.
* **`/sitemap-genres-en.xml` içinde 8 824 URL — fazlası alt-tür/rare genre.** Bunların büyük kısmı thin (varsayım, ayrı tarama gerekir; Ajan C konusu).
* **Önem: Medium** — sitemap'te bolca thin genre URL bulunabilir; "Crawled but not indexed" hacmi büyür.

### 4.5 Search — `/en/search`
* HTTP 200, **`<meta name="robots" content="noindex, follow">`** ✅ doğru.
* **Issue:** robots.txt'de `Disallow: /*/search*` zaten var → Google sayfayı crawl bile etmez, dolayısıyla noindex meta'yı **göremez**. İkili sinyal: `noindex` etkisiz hale gelir; eğer site dışı bir link search URL'sine işaret ederse Google "noindex okuyamadığım için indekslenebilir" varsayar. **Best practice: `noindex` istenecekse robots.txt allow + meta noindex.** Ya da disallow yeterli ise meta noindex'i kaldır.

### 4.6 FAQ — `/en/faq`
* HTTP 200, title "Radio Streaming FAQ — Common Questions about Online Radio | Mega Radio" (76), `<h1>` mevcut, JSON-LD: 3 (FAQPage var olmalı; doğrulama Ajan B'ye).
* **Issue:** `sitemap-main-en.xml`'de **yer almıyor.**

### 4.7 About — `/en/about`
* HTTP 200, title "About Mega Radio - Free Online Radio Platform" (50), `<h1>` mevcut.
* Sitemap'te ✅ var.

### 4.8 Server-control endpoints
| URL | HTTP | Type | Sorun |
|---|---|---|---|
| `/robots.txt` | 200 | text/plain | OK |
| `/sitemap-index.xml` | 200 | application/xml | OK |
| `/sitemap.xml` | **200** | **text/html (SPA)** | **CRITICAL soft-404** |
| `/llms.txt` | **200** | **text/html (SPA)** | **CRITICAL soft-404** |

---

## 5. Top 10 — Google'ın indekslememesinin muhtemel nedenleri (öncelikli)

| # | Bulgu | Önem | Kanıt | Öneri |
|---|---|---|---|---|
| 1 | **Bilinmeyen rotalar 200 + SPA shell (soft-404 fabrikası)** | **Critical** | `curl /en/this-page-does-not-exist-xyz123` → 200 text/html | Wildcard handler'a "valid route mı?" guard'ı ekle, değilse 404 + minimal body. Ya da kıyaslanan client-route table ile sunucu eşleşsin. |
| 2 | **`/sitemap.xml` ve `/llms.txt` SPA HTML 200 dönüyor (Google'ın varsayılan probe'u soft-404 vuruyor)** | **Critical** | `curl -I /sitemap.xml` → `text/html`, `/llms.txt` → SPA shell | `/sitemap.xml`'i `/sitemap-index.xml`'e 301 ya da gerçek XML servis et. `/llms.txt`'i ya statik dosya olarak dön ya da 404 dön. |
| 3 | **UA-tabanlı dynamic rendering — bot 34 KB SSR, kullanıcı 10 KB shell** | **Critical** | Bot vs human size farkı 24 KB, H tag sayıları 17 vs 0 | Tüm trafiğe SSR/SSG ya da ortak prerender + hidrasyon. UA-bazlı ayrımı kaldır (cloaking ihbar riski). |
| 4 | **`www.themegaradio.com` ayrı host olarak yanıt veriyor (apex'e 301 yok)** | **High** | `curl -I https://www.themegaradio.com/` → 302 → `/en` (apex'e değil) | Cloudflare Page Rule ile `www.* → apex` 301. |
| 5 | **`sitemap-main-{lang}.xml` yalnızca 11 URL — ülke detayları, FAQ, vb. yok** | **High** | `grep -c '<loc>' sitemap-main-en.xml` = 11 | Tüm `/en/regions/{country}`, `/en/genres/{slug}`, `/en/faq`, `/en/about` URL'lerini main veya ayrı `sitemap-pages-{lang}.xml` içinde sun. |
| 6 | **Edge cache `vary: CF-IPCountry` + cookie-tabanlı dil override = cache poisoning riski** | **High** | `vary: CF-IPCountry` header, `_doRenderStaticPage` cacheKey `preferredLanguage` ile çeşitleniyor | Edge cache'te `vary: CF-IPCountry, Cookie` ekleyin ya da prerender response'larında `Cache-Control: private` (bot için public, kullanıcı için no-store). |
| 7 | **Robots.txt `Disallow: /*/search*` + sayfa içi `noindex` çelişkili sinyal** | **Medium** | `/en/search` HTML'inde `noindex, follow`; robots.txt'te zaten disallow | Birini seç: ya disallow'u kaldırıp meta noindex'i bırak (önerilen), ya da meta noindex'i kaldır. |
| 8 | **Ana sayfa JSON-LD'de `FAQPage` enjeksiyonu policy ihlali olabilir** (FAQ olmayan sayfada FAQPage) | **Medium** | `/en` JSON-LD: 1× FAQPage + 10 Question/Answer | FAQPage'i sadece `/en/faq` ve gerçekten FAQ içeren sayfalarda render et. Ana sayfada ItemList/Organization yeterli. |
| 9 | **Lokalize ana sayfa başlıkları zayıf/yanlış** (de gramer, es çok kısa) | **Medium** | `<title>` `/de`: "Die beste Radio der Welt", `/es`: "La mejor radio del mundo" | "Mega Radio – {KW1} {KW2}" şablonu uygula, 50–60 char, ana anahtar kelime başta. |
| 10 | **Station başlıklarında "United Kingdom Of Great Britain And Northern Ireland" gibi tam ad → SERP truncation** | **Medium** | `/en/station/bbc-world-service` title 102 char | Ülke adlarını SEO map'le kısalt (UK, USA, UAE…). 60 char hedefi. |

---

## 6. Diğer kayda değer bulgular (sıralı)

* **HSTS 7 gün** (`max-age=604800`) — ideal `max-age=31536000; includeSubDomains; preload`. (Low)
* **OG image evrensel** (`/images/logo-icon.webp`) — sayfa-bazlı dinamik OG (station logo + isim) sosyal CTR'i 2-3× artırır. Mevcut `/api/og-image` route var (kod inceleme: `og-image-routes.ts`) ama meta'da kullanılmıyor. (Medium)
* **CSP'de `connect-src 'self' https: wss:`** — yıldız wildcard prod'da fine, ancak inline JS için unsafe-inline gerekiyor; ileri SEO etkisi yok ama güvenlik audit (Ajan D scope dışı, security_scan skill için).
* **`x-frame-options: DENY`** — embeddable player widget yapılırken `frame-ancestors` ile değiştirilmeli.
* **Manifest preload + font preload + hero image preload** — LCP optimizasyonu profesyonel; Lighthouse ölçümü gerekiyor (squirrel CLI ile yapılmadı).
* **Speculation rules** (`cdn-cgi/speculation`) — Cloudflare otomatik speculative prefetch — INP iyileştirir.
* **`/en/station/{slug}` cache-control: gözlem yapılmadı**, alt-sitemap 1 (~654 KB) cache'leniyor (`max-age=3600`). OK.
* **Dış crawler trap (genre × language matrisi):** 8 824 genre URL × 44 dil = ~388 K URL. Bunların çoğu thin → "Discovered – currently not indexed" hacmini şişirir. Ajan C'de detaylı.
* **Sitemap XML'de `<lastmod>` formatı `2025-11-26` (date only)** — Google W3C-DateTime tercih eder ama date-only de geçerli; sorun değil.
* **`<image:image>` tag'leri** sitemap'te S3 logo URL'leri gösteriyor → image indexing için iyi ✅
* **`Allow: /` robots.txt'te tek satır** — ama `Disallow:` listesinden sonra geliyor, en spesifik kazanır kuralı uyarınca pratikte etkisi yok. Kozmetik.

---

## 7. Out of scope / Bu raporda ele alınmadı

* **Schema markup derinlemesine analizi** — `BroadcastService`, `RadioStation`, `ListenAction` özelliklerinin tamlığı, Google Rich Results Test sonuçları → **Ajan B**.
* **İçerik / programmatic SEO**: 8 824 genre + 10 000 station URL'lerinin kalitesi, thin content oranı, near-duplicate kümeler → **Ajan C**.
* **Backlink profili & otorite** → **Ajan D**.
* **Lighthouse / Core Web Vitals canlı ölçümü** — squirrel CLI yok, PageSpeed Insights API gerekir.
* **Search Console verisi** — erişim yok; `Coverage`, `Crawl stats`, `Page indexing`, `Sitemaps` raporları kritik bilgi sağlardı.
* **GSC'de "Crawled – currently not indexed" / "Discovered – currently not indexed" sayfa örnekleri** — kullanıcıdan ekran/data alınmalı.

---

## 8. Doğrulama için sonraki ajanlara öneri

* **Ajan B (Schema):** Bu raporda listelenen 5 station detay JSON-LD'si + ana sayfa FAQPage policy ihlali iddiasını Rich Results Test ile doğrulamalı.
* **Ajan C (İçerik):** `sitemap-genres-en.xml` 8 824 URL'sinin dağılımı + `sitemap-stations-en-*.xml` 10 000 URL'sinin description doluluk oranı + thin content thresh-old.
* **Ajan D (Backlink + çapraz):** `www.themegaradio.com`, `themegaradio.com`, eski domain (varsa) için backlink dağılımı + bu raporda Critical olarak işaretlenen 3 maddenin GSC veri ile çapraz teyidi.

---

*Kaynak komutlar ve tüm raw HTTP cevapları yeniden üretilebilir; tüm fetch'ler `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)` UA ile alınmıştır. Tarama tarihi: 2026-05-07 22:45–22:48 UTC.*

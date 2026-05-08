# Ajan E — Final Aksiyon Planı & Uygulama Yol Haritası

**Tarih:** 2026-05-08
**Hedef:** MegaRadio (`https://themegaradio.com`) — Google indekslemesini açmak
**Girdi:** `agent-d-validation.md` (12 doğrulanmış konsolide bloker §5 + 13 destekleyici hipotez §5b)
**Yöntem:** Ajan D'nin doğruladığı bulguları MegaRadio kod tabanına haritalandır → etki/efor/risk ile önceliklendir → uygulamaya hazır görev şablonları üret. Hiçbir kod değiştirilmedi.
**Kapsam dışı:** Yeni soruşturma, kod değişikliği, GSC verisi çekimi.

---

## 0. Yönetici Özeti

Google'ın MegaRadio'yu indekslememesi tek bir hatadan değil, **birbirini güçlendiren beş yapısal kök nedenden** kaynaklanıyor:

1. **Soft-404 fabrikası.** Sunucu, var olmayan veya hatalı URL'leri (örn. sitemap'teki XML escape sızıntılarından doğan `nl/regio&apos;s/germany`, bilinmeyen `genres/*` slug'ları) 404 yerine SPA shell + HTTP 200 ile döndürüyor. Google bunları "Discovered – currently not indexed" havuzuna atıyor. *(F1, F6)*
2. **Google'ın ilk dokunduğu yer kırık.** `/sitemap.xml` ve `/llms.txt` HTML SPA shell olarak 200 dönüyor; `sitemap-main-{lang}.xml` yalnızca 11 URL içeriyor (country/genre/faq yok). Yani crawl bütçesi en başında patlıyor. *(F2, F5)*
3. **UA-tabanlı dynamic rendering / cloaking riski.** Aynı path Googlebot UA'da 34 KB + 4 schema node, validator UA'da 10 KB + 2 node döndürüyor. Google 2022'den beri dynamic rendering önermiyor; bu yapı kalite/spam katmanında aktif risk. *(F3)*
4. **Host bölünmesi + thin/duplicate içerik kümesi.** `www → apex` 301 yok (link equity bölünüyor). 57 dilde region title/description tek tip İngilizce; %80 genre slug'ı thin/yanlış intent (FM frekansı, şehir, istasyon adı); FAQPage schema'sı yanlış sayfada (home'da var, `/en/faq`'da Q&A SSR'a girmiyor → "deceptive markup" sinyali). *(F4, F7, F8, F10)*
5. **Off-site otorite pratik olarak sıfır.** Wikipedia/Wikidata'da kayıt yok, public SERP'lerde 0 dış mention; üstüne 2013'ten beri kayıtlı eski domain üzerinde **historical link equity transferi yapılmamış** ve eski URL pattern'leri için 301 mapping yok. *(F24, F25)*

**Stratejik karar:** İlk dalga (Quick Wins, 1-2 gün) yalnızca config/sunucu seviyesinde 5 düzeltme — kod riski düşük, etki büyük. Bu beşi indekslemeyi açma olasılığının %50–70'ini tek başına taşıyor (hipotez; GSC ile doğrulanmalı). İkinci dalga (1-2 hafta) yapısal: SSR/SSG geçişi, schema temizliği, content template fix, slug whitelist. Üçüncü dalga (1+ ay) içerik genişletme + off-site otorite + AEO/AI search opt-in kararı.

**Kritik bağımlılık:** Hiçbir aksiyon GSC verisi alınmadan canlıya alınmamalı. Aşağıda §6'da minimum veri seti listelenmiştir.

---

## 1. Quick Wins (1–2 gün, sunucu/config seviyesi)

> Hepsi düşük riskli, deploy başına izole, hızlı geri alınabilir. Beşi de tek bir PR'a sığar ama gözden geçirme kolaylığı için 5 ayrı görev önerilir.

### QW-1 — Bilinmeyen rotalar için 404/410 (soft-404 fabrikasını kapat) — **F1**
- **Etki:** YÜKSEK (Discovered – currently not indexed havuzunun baskın nedeni)
- **Efor:** ~0.5 gün
- **Risk:** Düşük (whitelist tabanlı; yanlışlıkla geçerli sayfayı 404'leme riski regex testleriyle mitigate edilir)
- **Etkilenen dosyalar:**
  - `artifacts/api-server/src/seo-renderer.ts` (catch-all SSR yolu)
  - `artifacts/api-server/src/index-web.ts` (route kayıt sırası)
  - `artifacts/api-server/src/routes/slug-routes.ts` (geçerli slug doğrulama)
- **Yapılacak:**
  1. `/^/(?:[a-z]{2,5}/)?(?:genres|regions|stations|countries)/[^/]+$/` rotaları için **slug DB'de yoksa** HTTP 404 + minimum SSR 404 sayfası (bot için meaningful HTML).
  2. Bilinmeyen path tamamen reserved-prefix dışındaysa → 404.
  3. Eski/silinmiş slug'lar için 410 Gone (kalıcı silindi sinyali).
- **Doğrulama:** `curl -I` → 404; `curl -A "Googlebot"` → 404 + `<title>404</title>`; GSC URL Inspection.

### QW-2 — `/sitemap.xml` + `/llms.txt` doğru MIME ile (SPA shell'i kır) — **F2**
- **Etki:** YÜKSEK (Google'ın varsayılan probe'u kırık; crawl başlangıç noktası)
- **Efor:** ~0.25 gün
- **Risk:** Çok düşük
- **Etkilenen dosyalar:**
  - `artifacts/api-server/src/routes/seo-sitemap-routes.ts`
  - `artifacts/api-server/src/index-web.ts` (catch-all'dan **önce** mount)
  - `artifacts/api-server/src/seo/sitemap-manifest-builder.ts`
- **Yapılacak:**
  1. `/sitemap.xml` için sitemap index XML, `Content-Type: application/xml` döndür.
  2. `/llms.txt` için `text/plain` döndür.
  3. Bu route'ların catch-all SSR'dan **önce** matche ettiğini integration test ile sabitle.
- **Doğrulama:** `curl -I https://themegaradio.com/sitemap.xml` → `200 application/xml`; GSC Sitemaps "Couldn't read" temizlenmeli.

### QW-3 — `sitemap-main-{lang}.xml` kapsam genişletme (country + genre whitelist + faq) — **F5**
- **Etki:** YÜKSEK (discovery layer açılır)
- **Efor:** ~0.5 gün
- **Risk:** Düşük (slug whitelist QW-1 ile tutarlı olmalı; aksi takdirde sitemap'te 404 verir)
- **Etkilenen dosyalar:**
  - `artifacts/api-server/src/seo/sitemap-manifest-builder.ts`
  - `artifacts/api-server/src/utils/sitemap-translations.ts`
- **Yapılacak:**
  1. `sitemap-main-{lang}.xml`'a top-N country (örn. 30), whitelisted genre'ler, faq, about, popüler region URL'leri ekle.
  2. Sitemap index'te referansla; her sitemap < 50K URL, < 50 MB sınırına dikkat.
- **Doğrulama:** Her `sitemap-main-*.xml` ≥ 50 URL; GSC Sitemaps "Discovered URLs" sayısı artmalı.

### QW-4 — XML escape sızıntısı düzelt (`"/>`, `&apos;`) — **F6**
- **Etki:** YÜKSEK (F1'in alt-mekanizması; F1 düzelse bile bu sızıntı yeni 404'ler üretir)
- **Efor:** ~0.25 gün
- **Risk:** Çok düşük
- **Etkilenen dosyalar:**
  - `artifacts/api-server/src/seo/sitemap-manifest-builder.ts`
  - `artifacts/api-server/src/utils/sitemap-translations.ts`
  - `artifacts/api-server/src/routes/seo-sitemap-routes.ts`
- **Yapılacak:**
  1. Tek bir `xmlEscape()` util'i ile her `<loc>` alanı kaçışla; `'`, `"`, `&`, `<`, `>` için.
  2. Snapshot test: `nl/regio's/germany` → `nl/regio%27s/germany` veya doğru entity escape.
- **Doğrulama:** `curl https://themegaradio.com/sitemap-genres-en.xml | grep -c '"/>'` = 0; aynısı `&apos;` için.

### QW-5 — `www → apex` 301 redirect (Cloudflare) — **F4**
- **Etki:** ORTA-YÜKSEK (link equity konsolidasyonu; gelecekteki kazanımlara da faydalı)
- **Efor:** ~0.25 gün (kod değişikliği yok; Cloudflare Page Rule veya Worker)
- **Risk:** Çok düşük
- **Etkilenen dosyalar:** Yok (Cloudflare config); referans için `artifacts/api-server/src/middleware/url-redirect-middleware.ts` (sunucu-tarafı yedek)
- **Yapılacak:**
  1. Cloudflare'de `www.themegaradio.com/*` → `https://themegaradio.com/$1` 301 Bulk Redirect veya Page Rule.
  2. Sunucu tarafında belt-and-suspenders olarak Express middleware ile aynı 301'i kur.
- **Doğrulama:** `curl -I https://www.themegaradio.com/en/regions/germany` → `301 Location: https://themegaradio.com/en/regions/germany`.

---

## 2. Yapısal Düzeltmeler (1–2 hafta, kod + içerik)

### S-1 — UA bağımsız tek render path (dynamic rendering'i kaldır) — **F3**
- **Etki:** YÜKSEK (kalite katmanı riski; muhtemel "Crawled – currently not indexed" ana sebebi)
- **Efor:** 3–5 gün
- **Risk:** Orta-Yüksek (büyük yüzey; SSR cache key'leri etkilenir)
- **Etkilenen dosyalar:**
  - `artifacts/api-server/src/seo-renderer.ts` (UA dallanması varsa kaldır)
  - `artifacts/api-server/src/middleware/*` (UA-bazlı middleware)
  - `artifacts/api-server/src/index-web.ts` (cache key'den UA çıkar)
- **Yapılacak:**
  1. Tüm UA-bazlı dallanmaları kaldır; tek render path (SSR + hydration) bırak.
  2. Cache key'inden UA'yı çıkar; sadece path + lang + (gerekirse) country.
  3. `Vary: Accept-Encoding` bırak; `Vary: User-Agent` veya CF-IPCountry'yi sitemap/HTML'den kaldır.
- **Doğrulama:** `curl -A "Mozilla/5.0..." -A "Googlebot/2.1" ...` aynı byte boyutu (±1%); validator.schema.org ↔ Googlebot aynı node sayısı.

### S-2 — FAQPage schema'yı `/faq` sayfasına taşı + Q&A SSR'a sok — **F10**
- **Etki:** YÜKSEK (rich-result kaybı + "deceptive markup" sinyali)
- **Efor:** 1 gün
- **Risk:** Düşük
- **Etkilenen dosyalar:**
  - `artifacts/megaradio/src/pages/faq.tsx`
  - `artifacts/megaradio/src/shared/faq-schema.ts`
  - `artifacts/api-server/src/shared/faq-schema.ts`
  - `artifacts/api-server/src/seo-renderer.ts` (home'dan FAQPage kaldır)
- **Yapılacak:**
  1. Home (`/`, `/en`) sayfasından `FAQPage` JSON-LD'yi sil.
  2. `/faq` ve `/{lang}/faq` sayfalarına `FAQPage` ekle.
  3. Q&A bloklarını SSR HTML'inde `<h2>` + `<p>` olarak render et (visible content match).
- **Doğrulama:** Rich Results Test `/en/faq` valid FAQPage; home'da FAQPage yok.

### S-3 — Region template: 57 dilde benzersiz title + description — **F8**
- **Etki:** YÜKSEK (~5.280 duplicate cluster temizlenir)
- **Efor:** 2–3 gün (translation + template)
- **Risk:** Düşük
- **Etkilenen dosyalar:**
  - `artifacts/api-server/src/seo-renderer.ts` (region meta builder)
  - `artifacts/megaradio/src/components/SeoHead.tsx`
  - `artifacts/megaradio/src/pages/RegionStationsPage.tsx`
  - `artifacts/api-server/src/utils/sitemap-translations.ts`
  - Yeni: `artifacts/api-server/src/shared/region-seo-templates.ts`
- **Yapılacak:**
  1. Genre template (`shared/genre-seo-templates.ts`) muadili `region-seo-templates.ts`.
  2. 57 dilde {country} adı yerelleştirilmiş + 2 farklı template varyantı (uzun-kısa) çoğaltma azaltıcı.
  3. Eksik diller için canonical EN fallback (yarı-duplicate yaratmadan).
- **Doğrulama:** 57 dil için `<title>`/`<meta description>` dilden dile farklı; spot-check 10 ülke × 5 dil.

### S-4 — Genre slug whitelist + thin/yanlış intent slug'ları sil — **F7**
- **Etki:** YÜKSEK (kalite sinyali; ~7K thin URL temizlenir)
- **Efor:** 2–3 gün
- **Risk:** Orta (yanlış silme = trafik kaybı; staging'de slug-by-slug rapor şart)
- **Etkilenen dosyalar:**
  - `artifacts/api-server/src/routes/genres-countries-routes.ts`
  - `artifacts/api-server/src/shared/genre-seo-templates.ts`
  - `artifacts/api-server/src/seo/sitemap-manifest-builder.ts`
  - DB migration: invalid genre slug'ları işaretle
- **Yapılacak:**
  1. Whitelist: müzik türü / format / dil yapısı (örn. `pop`, `jazz`, `news-talk`). Reddet: FM frekans, şehir, istasyon adı, sayı-only.
  2. Whitelist dışı slug'lar için 410 Gone + sitemap'ten çıkar.
  3. Admin paneline whitelist düzenleme (proje task listesinde mevcut: "Let admins manage the genre whitelist from the dashboard" — *bunu önermiyoruz, mevcut*).
- **Doğrulama:** `sitemap-genres-*.xml` URL sayısı 8.824 → ≤ 1.500; whitelist dışı slug'lar 410.

### S-5 — Schema temizliği: RadioStation UNKNOWN_FIELD + entity ID konsolidasyonu — **F11, F12, F13, F15**
- **Etki:** ORTA (rich-result eligibility + KG fragmentasyonu önleme)
- **Efor:** 1–2 gün
- **Risk:** Düşük
- **Etkilenen dosyalar:**
  - `artifacts/megaradio/src/shared/structured-data.ts`
  - `artifacts/api-server/src/shared/structured-data.ts`
  - `artifacts/api-server/src/seo-renderer.ts` (schema injection)
  - `artifacts/api-server/src/index-web.ts`
  - `artifacts/megaradio/src/components/seo/StationStructuredData.tsx`
- **Yapılacak:**
  1. RadioStation'dan 5 UNKNOWN_FIELD warning'i kaldır (genre×2, inLanguage, encodingFormat, broadcastChannelId).
  2. RadioStation + BroadcastService çakışmasını çöz: tek birincil varlık seç, diğerine `@id` referansı.
  3. Cross-locale `@id` consolidation: aynı station/region için 57 dilde aynı `@id` (ör. `https://themegaradio.com/#station/{slug}`).
  4. Organization `logo` ≥ 112×112 + `sameAs` ile sosyal hesaplar.
- **Doğrulama:** validator.schema.org → 0 warning; GSC Enhancements geçerli item sayısı artar.

---

## 3. Uzun Vadeli İyileştirmeler (1+ ay)

### LT-1 — İçerik genişletme: About + FAQ + dil bütçesi — **F16, F17, F18**
- **Etki:** ORTA-YÜKSEK (EEAT + dil kapsama)
- **Efor:** 2–3 hafta (içerik üretimi)
- **Etkilenen dosyalar:**
  - `artifacts/megaradio/src/pages/about.tsx`, `pages/faq.tsx`
  - `artifacts/api-server/src/shared/genre-seo-templates.ts`
  - `artifacts/megaradio/src/shared/genre-seo-templates.ts`
- **Yapılacak:** About/FAQ ≥ 1.200 kelime + H2/H3 yapısı + iç linkler; ZH/JA dilleri için missing translation table tamamla; 29+ dil EN fallback yerine native template.
- **Doğrulama:** Page word count ≥ 1.200; GSC Crawl Stats rendered HTML size artar.

### LT-2 — Internal link grafı yeniden dengeleme — **F23**
- **Etki:** ORTA
- **Efor:** 1 hafta
- **Etkilenen dosyalar:** `artifacts/megaradio/src/pages/HomePage.tsx`, footer/menü bileşenleri, `routes/regions-recommendations-routes.ts`
- **Yapılacak:** Anasayfaya popüler 30 country + 20 whitelisted genre + 10 station modülü; rotasyonlu "trending" widget; her region sayfasından sibling region linkleri.
- **Doğrulama:** Crawl simulation (Screaming Frog) — orphan URL sayısı belirgin düşer.

### LT-3 — Off-site otorite stratejisi — **F24**
- **Etki:** YÜKSEK (uzun vadeli sıralama)
- **Efor:** Sürekli (ilk PR ~1 gün; outreach süreklidir)
- **Risk:** Düşük teknik / Orta itibar (Wikipedia notability reddi → entity yine oluşturulamaz; outreach spam algısı)
- **Etkilenen dosyalar:**
  - `artifacts/megaradio/src/shared/structured-data.ts` (Organization.sameAs)
  - `artifacts/api-server/src/shared/structured-data.ts`
  - `artifacts/api-server/src/seo-renderer.ts` (Organization SSR injection)
- **Yapılacak:**
  1. Wikipedia EN'de "MegaRadio" stub makalesi (notability'e dikkat) + Wikidata entity oluştur (entity collision riskini Q1917131'den ayır).
  2. Organization JSON-LD'de `sameAs` Wikidata + Wikipedia + sosyal hesaplar.
  3. Radio katalogları (radio-locator, OnlineRadioBox) listings + content marketing (5+ ülke için "best radio stations in X" PR).
- **Doğrulama:** GSC Links → Top linking sites sayısı +25 (T+6h); brand SERP "MegaRadio" → site #1 + Knowledge Panel; Wikidata'da yeni Q-id; validator.schema.org Organization.sameAs ≥ 3 referans.

### LT-4 — Eski domain redirect mapping audit — **F25**
- **Etki:** ORTA (hızlı kazanım fırsatı; eski equity recover)
- **Efor:** 3–5 gün
- **Etkilenen dosyalar:** `artifacts/api-server/src/middleware/url-redirect-middleware.ts`
- **Yapılacak:** Wayback CDX'ten 2013–2024 arası snapshot'ların URL listesini çek; her birini güncel URL'e 301 map et veya 410 Gone ver. Hiçbiri SPA shell 200 kalmasın.
- **Doğrulama:** Wayback URL listesinden örnek 100 URL → her biri 301/410.

### LT-5 — AI crawler intent kararı + AEO opt-in — **F22**
- **Etki:** ORTA (gelecekte büyük; bugün belirsiz)
- **Efor:** Karar + 0.5 gün
- **Risk:** Düşük teknik / Orta ürün (içerik bandwidth maliyeti + içerik scraping kaygıları → ürün kararı şart)
- **Etkilenen dosyalar:**
  - `artifacts/api-server/src/routes/seo-sitemap-routes.ts` (robots.txt + `/llms.txt` route)
- **Yapılacak:** Ürün ekibi ile karar: GPTBot/ChatGPT-User/PerplexityBot blok devam mı, kaldırma mı? Eğer açılırsa robots.txt'ten `Disallow` satırlarını kaldır; `/llms.txt` (QW-2'den faydalan) ile site haritası + tercih edilen alıntı kuralları yayınla.
- **Doğrulama:** `curl -A "GPTBot" https://themegaradio.com/` → 200 (eğer açıldıysa); ChatGPT/Perplexity'de "MegaRadio" sorgusu cevap içeriyor mu (T+4 hafta).

### LT-6 — Hijyen düzeltmeleri (paralel, batch PR) — **F9, F14, F19, F20, F21**
- **Etki:** DÜŞÜK-ORTA
- **Efor:** 1–2 gün toplam
- **Risk:** Düşük (her alt-bulgu izole; F14 için Google "first-party rating" politikası önce gözden geçirilmeli)
- **Etkilenen dosyalar:**
  - F9: `artifacts/megaradio/src/locales/*` (i18n çeviri dosyaları), `artifacts/api-server/src/seo-renderer.ts` (home title injection)
  - F14: `artifacts/megaradio/src/shared/structured-data.ts`, `artifacts/api-server/src/shared/structured-data.ts`, `artifacts/api-server/src/seo-renderer.ts`
  - F19: `artifacts/api-server/src/routes/seo-sitemap-routes.ts` (robots.txt), `artifacts/megaradio/src/components/SeoHead.tsx` (search sayfası noindex)
  - F20: `artifacts/api-server/src/index-web.ts` veya `index-api.ts` (HSTS header middleware)
  - F21: `artifacts/api-server/src/og-image-generator.ts`, `artifacts/megaradio/src/components/SeoHead.tsx`
- **Yapılacak:**
  - F9: `bs` home title broken i18n key + 16 dilde "Hero" prefix sızıntısı düzelt (i18n key audit).
  - F14: RadioStation SSR'a `aggregateRating` (önce policy review).
  - F19: `/*/search*` için robots Disallow ↔ noindex meta → birini seç (önerilen: `noindex` + robots'tan kaldır).
  - F20: HSTS `max-age=31536000; includeSubDomains; preload`.
  - F21: Per-page dinamik OG image (en azından country/genre/station için template OG); `og:image:width/height`'ı gerçek boyuta hizala.
- **Doğrulama:**
  - F9: 57 dilde `curl https://themegaradio.com/{lang}/` → `<title>` doğru ve "Hero" prefix yok.
  - F14: validator.schema.org RadioStation `aggregateRating` valid; GSC Enhancements rating görüntülenir.
  - F19: `curl https://themegaradio.com/robots.txt` → `Disallow: /*/search*` yok; `/en/search` HTML'inde `<meta name="robots" content="noindex">` var.
  - F20: `curl -I` → `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`; hstspreload.org submission valid.
  - F21: country/genre/station örneklerinde OG image URL farklı; `og:image:width`/`height` gerçek dosya boyutuyla eşleşiyor (Facebook OG debugger valid).

---

## 4. Aksiyon-Bulgu Çapraz Tablosu

| Aksiyon | Bulgu(lar) | Etki | Efor | Risk | Dalga |
|---|---|---|---|---|---|
| QW-1 | F1 | YÜKSEK | 0.5g | Düşük | 1 |
| QW-2 | F2 | YÜKSEK | 0.25g | Çok düşük | 1 |
| QW-3 | F5 | YÜKSEK | 0.5g | Düşük | 1 |
| QW-4 | F6 | YÜKSEK | 0.25g | Çok düşük | 1 |
| QW-5 | F4 | ORTA-YÜKSEK | 0.25g | Çok düşük | 1 |
| S-1 | F3 | YÜKSEK | 3-5g | Orta-Yüksek | 2 |
| S-2 | F10 | YÜKSEK | 1g | Düşük | 2 |
| S-3 | F8 | YÜKSEK | 2-3g | Düşük | 2 |
| S-4 | F7 | YÜKSEK | 2-3g | Orta | 2 |
| S-5 | F11, F12, F13, F15 | ORTA | 1-2g | Düşük | 2 |
| LT-1 | F16, F17, F18 | ORTA-YÜKSEK | 2-3 hafta | Düşük | 3 |
| LT-2 | F23 | ORTA | 1 hafta | Düşük | 3 |
| LT-3 | F24 | YÜKSEK (uzun) | Sürekli | Düşük | 3 |
| LT-4 | F25 | ORTA | 3-5g | Düşük | 3 |
| LT-5 | F22 | ORTA (karar) | 0.5g | Ürün kararı | 3 |
| LT-6 | F9, F14, F19, F20, F21 | DÜŞÜK-ORTA | 1-2g | Düşük | 3 (paralel) |

**Çift sayım kontrolü (Ajan D §7 uyarısı):** F1 (route shell) ↔ F6 (sitemap escape bug) ↔ F7 (slug evreni) **birbirini kapsamaz**. QW-1 catch-all'u kapatır, QW-4 sitemap'in yanlış URL üretmesini durdurur, S-4 zaten oluşmuş thin slug evrenini temizler. Üçü ayrı PR.

---

## 5. Önerilen Implementasyon Görev Listesi (Ajan E sonrası task şablonları)

> Aşağıdaki başlıklar — kullanıcı kabul ederse — `bulkCreateProjectTasks` için doğrudan kullanılabilir. Her birinin kapsamı dar (1 PR = 1 task).

1. **Catch-all SSR'da bilinmeyen slug'lar için 404/410 dön (F1)** — Kapsam: QW-1.
2. **`/sitemap.xml` ve `/llms.txt` doğru MIME ile sun (F2)** — Kapsam: QW-2.
3. **`sitemap-main-{lang}.xml` kapsamını country/genre/faq ile genişlet (F5)** — Kapsam: QW-3.
4. **Sitemap üreticisinde XML escape util ekle ve tüm `<loc>` çıkışlarını koru (F6)** — Kapsam: QW-4.
5. **`www → apex` 301 redirect kur (Cloudflare + Express belt-and-suspenders) (F4)** — Kapsam: QW-5.
6. **UA-tabanlı dynamic rendering kaldır, tek render path bırak (F3)** — Kapsam: S-1.
7. **FAQPage JSON-LD'yi home'dan kaldır, `/faq` sayfasına Q&A SSR ile birlikte ekle (F10)** — Kapsam: S-2.
8. **57 dilde region SEO template + benzersiz title/description (F8)** — Kapsam: S-3.
9. **Genre slug whitelist + whitelist dışı slug'lar için 410 Gone (F7)** — Kapsam: S-4.
10. **RadioStation UNKNOWN_FIELD warning'leri temizle + cross-locale `@id` konsolidasyonu (F11, F12, F13, F15)** — Kapsam: S-5.
11. **About + FAQ sayfalarını ≥ 1.200 kelimeye genişlet ve H2/H3 yapısı ekle (F16)** — Kapsam: LT-1 (alt-task).
12. **ZH/JA + 29+ dil için genre/region template native çevirisi (F17, F18)** — Kapsam: LT-1 (alt-task).
13. **Anasayfa + footer internal link grafını yeniden dengele (F23)** — Kapsam: LT-2.
14. **Off-site otorite: Wikidata entity + Organization sameAs + radio dizinlerine listing (F24)** — Kapsam: LT-3.
15. **Eski domain Wayback URL'leri için 301/410 redirect mapping (F25)** — Kapsam: LT-4.
16. **AI crawler erişim kararı (GPTBot/ChatGPT-User/PerplexityBot) + robots.txt güncellemesi (F22)** — Kapsam: LT-5.
17. **Hijyen batch: bs i18n title fix + HSTS 1y + per-page OG + search noindex/disallow netleştir (F9, F19, F20, F21)** — Kapsam: LT-6.

> Not: Proje tasks listesinde zaten mevcut olan "Stop publishing thousands of low-value 'genre' pages built from raw station tags", "Clean up genre records with malformed slugs in the database", "Let admins manage the genre whitelist from the dashboard", "Clean up the old junk genre records left over in the database", "Translate the rest of the country/region SEO copy beyond the top 15 languages", "Localize the country/region name itself, not just the surrounding sentence" başlıkları **S-3, S-4 ve LT-1 ile örtüşür**; yeni task açarken bunları parent referans olarak kullanın.

---

## 6. GSC'den Alınması Gereken Veriler (kod değişikliğinden önce)

Ajan D §4'te detaylandırıldı; özet — implementasyon başlamadan önce çekilmeli:

1. **Page indexing → Why pages aren't indexed** (Discovered + Crawled + Soft 404 + Duplicate sayıları + örnek 50 URL)
2. **Sitemaps** (Couldn't read/fetch durumu)
3. **Settings → Crawl stats** (200/3xx/4xx/5xx + response size dağılımı)
4. **Enhancements** (FAQs, Sitelinks searchbox, Breadcrumbs, Logos)
5. **Links** (Top linking sites + linking text + linked pages — 3 CSV export)
6. **International Targeting** (hreflang errors)
7. **URL Inspection** (manuel: F1, F2, F10 örnek URL'leri için Live test + indexed page diff)

Bu veriler S-4 (slug whitelist) ve LT-3 (otorite stratejisi) için **şart**, diğerleri için **şiddetle önerilir**.

---

## 7. GSC'de Yeniden Gönderim/Doğrulama Listesi

Quick Wins deploy edildikten **sonra** sırayla:

1. **Sitemaps**: Eski sitemap kayıtlarını sil → yeni sitemap index'i (`https://themegaradio.com/sitemap.xml`) yeniden gönder.
2. **URL Inspection → Request Indexing** (her dalga için temsili URL'ler):
   - Dalga 1 sonrası: `/`, `/en`, `/en/faq`, `/sitemap.xml`, top 10 country (`/en/regions/germany`, `/en/regions/united-states`, …), top 10 whitelisted genre.
   - Dalga 2 sonrası: 5 station detay sayfası, 5 region sayfası (lokalizeli — `/de/regions/germany`, `/zh/regions/china`), `/en/about`.
   - Dalga 3 sonrası: yeni içerik genişletilmiş `/en/about`, `/en/faq`, dile özel hreflang cluster örnekleri.
3. **Removals → Outdated Content**: 410 verdiğimiz eski URL'ler için açık temizlik talebi (opsiyonel, isteğe bağlı).
4. **Coverage / Page indexing**: Her dalga sonrası "Discovered – currently not indexed" + "Crawled – currently not indexed" + "Soft 404" + "Duplicate without canonical" eğrilerini takip et.
5. **Rich Results Test**: `/en/faq` (FAQPage), 5 station (RadioStation), home (Organization + WebSite + SiteNavigationElement) — her dalga sonrası çalıştır.

---

## 8. "İndeksleme Açıldığını Nasıl Anlarız?" — Başarı Metrikleri

| Metrik | Kaynak | Baseline (T0) | T+2 hafta hedefi | T+6 hafta hedefi | T+3 ay hedefi |
|---|---|---|---|---|---|
| Indexed pages | GSC Page indexing → Indexed | bugünkü değer | +%50 | ×3 | ×10+ |
| "Discovered – currently not indexed" | GSC | bugünkü değer | -%30 | -%70 | < %10 baseline |
| "Crawled – currently not indexed" | GSC | bugünkü değer | -%20 (S-1 sonrası) | -%60 | < %15 baseline |
| "Soft 404" | GSC | bugünkü değer | ≈ 0 | 0 | 0 |
| Sitemap "Discovered URLs" | GSC Sitemaps | ~11/lang | ≥ 200/lang | ≥ 1.000/lang (S-4 sonrası whitelisted) | stabil |
| Crawl rate (req/day) | GSC Crawl Stats | bugünkü değer | +%30 | ×2 | ×3 |
| Average response size — Googlebot | GSC Crawl Stats | bugün ~34 KB | ≈ 10–15 KB (S-1 sonrası tek render) | stabil | stabil |
| Valid FAQ rich results | GSC Enhancements | 0 (yanlış sayfada) | ≥ 1 (`/en/faq`) | tüm `/{lang}/faq` valid | stabil |
| Valid RadioStation enhancement | GSC Enhancements | warning'li | warning sayısı 0 (S-5) | valid item ↑ | stabil |
| Brand SERP "MegaRadio" → site #1 | manuel SERP check | belirsiz / entity collision | site #1 | + sitelinks | + Knowledge Panel |
| Organic clicks | GSC Performance | bugünkü değer | +%20 | ×2 | ×5+ |
| Organic impressions | GSC Performance | bugünkü değer | +%50 | ×3 | ×10+ |
| External referring domains | GSC Links / Ahrefs | DDG 0, Wikipedia 0 | +5 | +25 | +100 |

**Erken sinyal kontrol noktası (T+3 gün, sadece QW dalgası):** GSC Sitemaps "Couldn't read" temizlenmeli; Crawl Stats'te 200 oranı belirgin artmalı; "Soft 404" eğrisi düşmeye başlamalı. Bunlardan biri olmazsa, dalga 2'ye geçmeden önce kök neden tekrar gözden geçirilmelidir.

---

## 9. Out of Scope

- Kod değişikliği (yalnızca planlama).
- Yeni soruşturma — Ajan A/B/C/D çıktıları temel alındı.
- GSC verisi çekimi — kullanıcıdan istenecek.
- Ahrefs/SEMrush/Moz verisi — mevcut değil; LT-3 başlarken edinilmeli.
- Lighthouse/CWV ölçümü — Ajan A scope'undaki eksiklik; ayrı bir görev olarak ele alınmalı.

---

*Plan tarihi: 2026-05-08. Tüm dosya yolları MegaRadio pnpm monorepo HEAD'ine göre doğrulandı (`artifacts/api-server/src/`, `artifacts/megaradio/src/`).*

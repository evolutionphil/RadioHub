# Kök Neden: Google Neden Sadece 1 URL İndexledi (themegaradio.com/en)

Tarih: 2026-05-30
Yöntem: İki bağımsız Opus 4.8 araştırması — (1) kök neden taraması, (2) adversarial doğrulama

---

## Belirti

`themegaradio.com` haftalardır canlı olmasına rağmen Google Search Console'da
yalnızca **1 URL** indexli: `https://themegaradio.com/en`. 57 aktif dilin
diğer 56'sı ve binlerce istasyon/genre/ülke sayfası indexlenmemiş. `/tr` için
GSC "Crawled - currently not indexed" + "referring sitemap: none detected"
gösteriyor.

## Kök Neden (kesin)

```
nav_genres / nav_regions / nav_stations TranslationKey dökümanları HİÇ yaratılmıyor
  → hasCompleteSeoTranslations() HER dil için false döner
  → seedAllLanguagesSeoTranslations 56 dilin tamamı için erken return yapar
  → computeFromTranslations() yalnızca ['en'] üretir
  → sitemap-index /en'e çöker
  → Google tam olarak 1 URL indexler
```

### Neden bu 3 key hiç yaratılmıyor?

1. `seedSeoTranslationKeys()` (`translation-keys-routes.ts`) — `TranslationKey`
   dökümanlarını yaratan tek boot-time seeder — `seoKeys[]` dizisinde bu 3 nav
   anahtarını içermiyordu. 13 anahtar vardı, 3 zorunlu nav anahtarı eksikti.
2. `seedTurkishUiTranslations` ve `seedAllLanguagesSeoTranslations` mevcut
   anahtara değer YAZAR ama anahtar yoksa SKIP/return eder — yaratmaz.
3. `TranslationSyncService.scanForNewKeys()` frontend `.tsx` kaynağını tarayıp
   yeni anahtar yaratır — AMA production Docker imajında frontend kaynağı yok
   (`Dockerfile.api` yalnızca derlenmiş `dist/public` + prune'lu api-server'ı
   kopyalar). Üstelik `nav_regions` için frontend'de hiç `t('nav_regions')`
   çağrısı da yok. Yani bu yol da production'da çalışmaz.

`hasCompleteSeoTranslations()` (`seo-config.ts:1588`) 15 zorunlu anahtarın
HEPSİNİ ister: 7 `REQUIRED_STATION_SEO_KEYS` + 8 `REQUIRED_HOMEPAGE_SEO_KEYS`.
Eksik 3 nav anahtarı `REQUIRED_HOMEPAGE_SEO_KEYS` içinde → her dil gate'i
geçemiyor.

## Doğrulanan bulgular

| # | İddia | Sonuç |
|---|---|---|
| 1 | `seedSeoTranslationKeys` nav_genres/regions/stations'ı yaratmıyor | ✅ DOĞRULANDI |
| 2 | `seedAllLanguagesSeoTranslations` eksik key'de 56 dili erken-return ediyor | ✅ DOĞRULANDI |
| 3 | `index-web.ts` seed çağırmıyor (sadece api-server container seed eder) | ✅ DOĞRU ama ayrı bir neden DEĞİL — ikisi aynı MongoDB'yi paylaşır |
| 4 | Bozuk `['en']` LKG 30 gün kilitleniyor, kendiliğinden düzelmiyor | ❌ YANLIŞ POZİTİF |
| 5 | www / BASE_URL / robots.txt / canonical / noindex sorunlu | ✅ HEPSİ SORUNSUZ teyit edildi |

### İddia 4 neden yanlış pozitif

`qualified-languages.ts` SHRINK_PROTECTION mantığı yalnızca **küçülmeyi**
engeller (`computed.length < lkg.length * 0.5`). LKG `['en']` (uzunluk 1) iken
çeviriler düzeltilirse `computed=50` → `50 < 0.5` false → koruma tetiklenmez,
büyüme geçer ve LKG güncellenir. Memory cache 60 dk TTL'inde dolduğunda bir
sonraki organik istek canlı compute'u tetikler ve sistem **kendi kendine
~60 dk içinde düzelir**. Manuel `invalidateQualifiedLanguages({resetLkg:true})`
GEREKMEZ (anında etki için opsiyonel).

## Sorun OLMAYAN şeyler (teyit edildi)

- `getBaseUrl()` production'da koşulsuz `https://themegaradio.com` döner — www
  karışıklığı yok, canonical'lar non-www ve tutarlı.
- robots.txt: `Allow: /assets/*.js`, `Allow: /assets/*.css`, `Allow: /api/image/`,
  `Allow: /api/og-image/`, `Sitemap: https://themegaradio.com/sitemap-index.xml`
  — hepsi doğru. JS/CSS bloklanmıyor.
- noindex kararları doğru: yalnızca search, junk/numeric station, whitelist-dışı
  genre, auth sayfaları noindex. Home/country/qualified-station sayfaları index.
- `X-Robots-Tag` doğru. SSR herkese (sadece bota değil) servis ediliyor.
- hreflang kümeleri indexable dil setinden kuruluyor.

## Uygulanan düzeltmeler (bu PR)

1. **`seedSeoTranslationKeys` seoKeys[]'e 3 nav anahtarı eklendi** (en
   defaultValue ile). Bu, TranslationKey dökümanlarını boot'ta yaratır.
2. **`seedAllLanguagesSeoTranslations` erken-return yumuşatıldı** — eksik key
   olsa bile var olanları yazmaya devam eder (savunmacı; gelecekte yeni bir
   zorunlu key eklenirse tüm pipeline'ı bir daha çökertmesin).
3. (Önceki commit'ler) Boot seed sırası `seedSeoTranslationKeys().then(...)`
   olarak zincirlendi + 56 dil için 15 SEO anahtarının native çevirileri
   eklendi.

## Deploy sonrası beklenen sonuç

1. Railway restart → `seedSeoTranslationKeys` 3 nav anahtarını yaratır →
   `seedTurkishUiTranslations` + `seedAllLanguagesSeoTranslations` 57 dilin
   değerlerini yazar.
2. ~60 dk içinde (veya admin `/api/admin/sitemap/rebuild` ile anında)
   `qualifiedLanguages` 57'ye çıkar.
3. `/sitemap-index.xml` tüm diller için `<loc>` üretir.
4. Google/Bing tüm dilleri keşfeder.

## Deploy sonrası yapılacaklar (kullanıcı)

1. PR merge → Railway redeploy
2. (Opsiyonel, anında etki) Admin → `POST /api/admin/sitemap/rebuild`
3. GSC → Site Haritaları → `https://themegaradio.com/sitemap-index.xml` yeniden gönder
4. GSC → URL İncelemesi → `https://themegaradio.com/tr` → "Dizine eklenmesini iste"
5. 1-2 hafta sonra GSC Sayfa sayısı raporunda indexlenen URL sayısının arttığını doğrula

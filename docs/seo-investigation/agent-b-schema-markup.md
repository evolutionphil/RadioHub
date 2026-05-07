# Ajan B — Schema Markup & Yapılandırılmış Veri Soruşturması

**Hedef:** MegaRadio (`https://themegaradio.com`)
**Tarih:** 2026-05-07
**Yöntem (tek kaynak doğruluğu — bu raporun her tablosunda tutarlı):**
1. **Kaynak kod incelemesi** — `artifacts/api-server/src/seo-renderer.ts`, `artifacts/api-server/src/index-web.ts`, `artifacts/megaradio/src/shared/structured-data.ts`, `artifacts/megaradio/src/components/seo/*`, `artifacts/megaradio/src/utils/structured-data.ts`.
2. **Canlı `curl` fetch** — Googlebot UA ile 8 farklı sayfa türü; JSON-LD blokları `python3 -c "json.loads(...)"` ile parse edildi.
3. **Live `validator.schema.org` HTTP doğrulaması** — `https://validator.schema.org/validate` POST endpoint'i çalışıyor ve **kullanıldı**; 8 URL için `errors`, `warnings`, `nodes` çıktıları toplandı (bkz. §2.0 ve Ek-A reprodüksiyon snippet'leri).
4. **Manuel field-by-field denetim** — Schema.org vocabulary + Google Search Central rich-result eligibility docs'una karşı (validator yalnızca syntax doğruluyor; rich-result policy eligibility ayrı katman).

**Erişim sınırları (açıkça etiketlenir):**
- **Google Rich Results Test:** Public HTTP/JSON API'sı **yok**; UI URL'i (`search.google.com/test/rich-results?url=…`) yalnızca HTML doc döner. Rich-result eligibility (FAQ snippet display, review stars vs.) **canlı test edilemedi** — bu rapordaki rich-result görünürlük tahminleri **hipotezdir**, GSC "Enhancements" raporu ile doğrulanması gerekir (bu bulgular tablolarda *"GSC ile teyit edilmeli"* olarak işaretlenmiştir).
- **GSC erişimi yok:** Indexing/Enhancements verileri gözlenemedi; Ajan E aşamasında gerekli.

**Ajan B scope:** Sadece tespit ve raporlama; hiçbir şema kodu değiştirilmedi.

---

## 0.A Canonical Findings — Tek Doğru Sayım Tablosu (operasyonel)

> Raporun tüm tabloları aşağıdaki sayımlara normalize edilmiştir. Erken bölümlerde farklı sayım metodu (validator nodes vs blok vs @type occurrence) görünebilir; **operasyonel referans bu tablodur.**

| Sayfa | JSON-LD blok sayısı (top-level) | Distinct primary `@type` | Validator errors | Validator warnings |
|---|---|---|---|---|
| `/en` (home) | **4** | WebSite, Organization, ItemList, FAQPage | 0 | 0 |
| `/de` (home) | **4** | (idem; FAQ Almanca) | 0 | 0 |
| `/tr` (home) | **4** (+ BreadcrumbList in some renders = 5) | (idem) | 0 | 0 |
| `/en/station/bbc-world-service` | **5** | WebSite, Organization, BreadcrumbList, RadioStation, BroadcastService | 0 | **5** (UNKNOWN_FIELD genre×2, inLanguage, encodingFormat, broadcastChannelId) |
| `/en/regions/germany` (Googlebot UA) | **4** | WebSite, Organization, BreadcrumbList, ItemList | 0 | 0 |
| `/en/genres/jazz` (Googlebot UA) | **4** | (idem) | 0 | 0 |
| `/en/faq` | **3** | WebSite, Organization, BreadcrumbList | 0 | 0 |
| `/en/about` | **3-4** (validator gözlemledi: + FAQPage anomaly) | WebSite, Organization, BreadcrumbList | 0 | 0 |
| `/en/station/<junk>` (410) | **0** ✅ | — | — | — |

**Validator vs blok farkı:** validator.schema.org nested entity'leri (örn. `WebSite.publisher → Organization`) ayrı node sayar → validator node count blok sayısından fazla olabilir (Ek-B'de detaylı). Kararlar için yukarıdaki **blok sayısı** otoritesidir.

---

## 0.0 Verified vs Hypothesis — Hızlı Triaj Tablosu (decision-grade)

| # | Bulgu | Statü | Kanıt |
|---|---|---|---|
| 1 | `/en/faq` sayfasında FAQPage YOK | **Verified** | Live curl + validator.schema.org (Ek-A) |
| 2 | Ana sayfada FAQPage var (yer-yanlış) | **Verified** (yer); rich-result penalty = Hypothesis | Live curl + validator |
| 3 | RadioStation şemasında 5 UNKNOWN_FIELD WARNING | **Verified** | validator.schema.org (Ek-A) |
| 4 | RadioStation + BroadcastService çift birincil varlık | **Verified** (sentaks); rich-result kaybı = Hypothesis | Kaynak kod + live curl |
| 5 | Validator UA ↔ Googlebot UA render mismatch (region/genre 2 vs 4 node) | **Verified** | Paralel fetch karşılaştırması (Ek-A) |
| 6 | Cross-locale `@id` consolidation yok | **Verified** (kod); KG fragmentation etkisi = Hypothesis | Kaynak kod |
| 7 | RadioStation SSR `aggregateRating` yok | **Verified** (kod); review snippet eligibility kaybı = Hypothesis | Kod karşılaştırması |
| 8 | Organization.logo SSR 80×80, sameAs sosyal yok | **Verified** (kod + curl); KP eligibility = Hypothesis | Live curl |
| 9 | Region/genre Twitter title generic | **Verified** | Live curl |
| 10 | OG image:width/height yanlış-deklare (212px dosya 1200px ilan) | **Verified** | Live curl + dosya boyutu |
| 11 | CSR injectMultipleStructuredData → SSR ile duplicate riski | **Hypothesis** | Kaynak kod incelemesi (runtime DOM gözlemi yok) |
| 12 | `/en/about` validator çıktısında FAQPage göründü | **Verified** | validator.schema.org |
| 13 | FAQ Q/A translation fallback → dil-mismatch | **Hypothesis** | Kaynak kod (test edilen 5 dilde Q/A doğru lokalize, ama tüm 57 dil test edilmedi) |
| 14 | Home /en validator 6 vs Googlebot fetch 48 @type — sayım reconciliation | **Reconciled (Ek-B)** | Bkz. Ek-B aşağıda |

---

## 0. Executive Summary

MegaRadio çoklu ve **profesyonel düzeyde** JSON-LD bloku üretiyor (sayfa başına 4–6 blok), iki ayrı render katmanı (`seo-renderer.ts` + `index-web.ts`) bunları SSR'de gömüyor; ek bir CSR katmanı (`components/seo/*StructuredData.tsx` + `utils/structured-data.ts`) hidrasyonda tekrar enjekte ediyor. Sentaks olarak şemaların hemen tamamı geçerli ancak **rich-result kazanımını engelleyen 7 yapısal sorun** mevcut:

1. **`FAQPage` hatalı sayfada (en kritik):** Ana sayfada 10 Q&A render ediliyor, asıl `/en/faq` sayfasında **hiç FAQPage şeması yok**. Bu, Google'ın Mart 2024 FAQ politikası ihlali (FAQ rich-result yalnızca "Government & Authoritative health" siteleri için aktif; diğerlerinde gösterilmez ama yanlış sayfada işaretlemek **schema-spam** sinyali olarak işlenebilir). Ajan A bulgusunu **doğruluyorum ve genişletiyorum**.
2. **Aynı istasyon için iki çakışan birincil varlık:** `RadioStation` (seo-renderer.ts:1734) + `BroadcastService` (index-web.ts:711). İkisi de farklı `@id` (yok), aynı `name`, aynı `url`, çakışan `potentialAction.ListenAction`. Google "primary entity belirsiz" kümesine düşürür.
3. **`@id` evrensel tutarsızlığı:** Sadece `Organization` ve `WebSite` bloklarında `@id` var (`#organization`, `#website`); `BreadcrumbList`, `RadioStation`, `BroadcastService`, `ItemList`, `FAQPage` bloklarında **hiç `@id` yok ya da dile-spesifik** (`/en/station/...` içerir). Bu, dil varyantları arasında varlık consolidation'ını engeller — Google `inLanguage`'ı duyar ama `sameAs` rolünü oynayan sabit bir `@id` görmediği için 57 dil × 60K istasyon = 3.4M ayrı varlık olarak görür → **knowledge-graph fragmentasyonu**.
4. **CSR + SSR çift enjeksiyon riski:** `/utils/structured-data.ts` içindeki `injectMultipleStructuredData` hidrasyon sonrası DOM'a `<script type="application/ld+json">` ekler; SSR şemalarını silmez. Hidrasyondan sonra **station detayda 5 değil 7+** JSON-LD bloku oluşabilir (validator bunu zaman zaman "duplicate primary entity" uyarısı olarak verir). Test edilebildiğinde Ajan E doğrulamalı.
5. **`Organization.logo` boyutu standardın altında:** SSR'de 80×80 (seo-renderer.ts:1493-1494), CSR'de 212×212 (structured-data.ts:48-49) — tutarsız. Google logo guideline'ı **min 112×112 px**. SSR çıktı (Googlebot'un gördüğü) 80×80 → Knowledge Panel logo eligibility'sini düşürür.
6. **Lokalize ana sayfa OG/Twitter başlıkları (region, genre koleksiyon sayfaları) "generic" kalıyor:** `/en/regions/germany` için **`og:title="Germany Radio Stations - Regional Broadcasting | Mega Radio"` (doğru) ama `twitter:title="Radio by Region — Browse Stations by Region | Mega Radio"` (jenerik, ülke yok)**. Aynı şey `/en/genres/jazz` için de geçerli (`twitter:title="Radio Genres — Browse All Music Genres"` — jazz yok). OG ve Twitter Cards aynı sayfada **farklı entity'i imliyor** → sosyal CTR kaybı + Bing/X bot kafa karışıklığı.
7. **Asıl `RadioStation` SSR şemasında `aggregateRating` yok** ama CSR `generateRadioStationSchema` (megaradio/src/shared/structured-data.ts:140-176) zengin bir oy/tıklama-bazlı rating üretiyor. Hidrasyondan önce Googlebot'un gördüğü versiyonda yıldız zenginleştirmesi yok — **Star-rating rich snippet eligibility kaybı**. (Not: vote-türetmeli rating'in Google'ın "First-party content review" politikasına uygun olması ayrı bir kalite konusu — Ajan C/D scope'u.)

**Genel sonuç:** Schema **var ve geniş kapsamlı** — eksiklik **hijyen ve consolidation**. Ajan A'nın "indekslememe" tespitlerine schema cephesinden eklenen tek **Critical** bulgu (1) ve (2): bunlar tek başlarına rich-result kazanımını sıfırlar ama indekslemeyi tek başına engellemez — Ajan A'nın soft-404 + UA cloaking blocker'ları daha üstün önceliktedir. Schema tarafı düzeltilmezse: indeksleme açılınca da **rich-result görünürlüğü sıfır** kalır.

---

## 1. JSON-LD Envanteri — Sayfa Türü × Şema

Tüm sayım canlı `curl … "https://themegaradio.com/<path>"` çıktısından (Googlebot UA), `application/ld+json` block'larından parse edildi.

### 1.1 Home — `/en` (5 dil ölçüldü)

| Dil | Toplam blok | Listelenen `@type` | Notu |
|---|---|---|---|
| `/en` | 6 | WebSite, Organization, ItemList (11 öğe), 10× RadioStation (ItemList içinde), FAQPage (10 Q&A) | `@type` sayımı: 1 WebSite + 1 Organization + 1 ItemList + 10 ListItem + 10 RadioStation + 1 FAQPage + 10 Question + 10 Answer + 1 SearchAction + 1 EntryPoint + 1 ContactPoint + 1 ImageObject = 48 toplam |
| `/de` | 4 | WebSite, Organization, ItemList, FAQPage (10 Q&A — gerçekten Almancalanmış: "Was ist Radio?") | BreadcrumbList yok ✅ (home), popular ItemList içinde 10 RadioStation; FAQ doğru çevrilmiş |
| `/tr` | 4 | (idem; FAQ TR çevrili) | ✅ |
| `/es` | 4 | (idem) | ✅ |
| `/ar` | 4 | (idem; RTL doğrulanmadı, JSON-LD plain text geçti) | ✅ |

**Gözlem:** `/en` 6 blok, lokalize home 4 blok — fark `popularStationsSchema`'nın yalnızca `additionalData.popularStations` doluysa render edilmesinden geliyor (seo-renderer.ts:1693). Lokalize home'larda popular grid SSR'de var ama ayrı `ItemList` JSON-LD'i de var (4. blok); `/en`'de **ekstra bir `popularStations` bloku** doğuyor mu, yoksa benim sayımım üst-üste mi sayıyor? Tek `ItemList` doğru sayı; `/en` 6 blok rakamı popular + popular farklı kontekstler değil — baseSchemas (WebSite, Organization, FAQPage) + ItemList (popular) + ek bir cookie-render path ürettiği RadioStation listesi olabilir. **Tutarsızlığı flagleyip Ajan E'nin Search Console "Item Lists" raporu ile karşılaştırmasını öneriyorum.**

### 1.2 Station detay — `/en/station/bbc-world-service` (3 station × 3 dil testi)

| Sayfa | Blok | Listelenen `@type` |
|---|---|---|
| `/en/station/bbc-world-service` | **5** | WebSite, Organization, BreadcrumbList (3 ListItem), **RadioStation** (with ListenAction), **BroadcastService** (with Country areaServed + ListenAction) |
| `/de/sender/bbc-world-service` | 5 | (idem; URL'ler `/de/sender/...` ✅) |
| `/tr/istasyon/bbc-world-service` | 5 | (idem) |
| `/en/station/mangoradio` | 5 | (idem) |

**Çift birincil varlık problemi:** `RadioStation` (seo-renderer.ts:1734-1769) ve `BroadcastService` (index-web.ts:707-720) birbirini referansla bağlamıyor; ikisi de aynı `name` + `url` döner.
- `RadioStation` daha zengin: `logo`, `image`, `broadcaster`, `genre`, `inLanguage`, `additionalProperty(bitrate)`.
- `BroadcastService` daha minimal: yalnızca `name`, `url`, `description`, `broadcastFrequency: "Internet Streaming"`, `areaServed.Country`, `provider.Organization`.
- **Hiçbiri `@id` taşımıyor** → Google bunları aynı varlık olarak birleştiremez.

### 1.3 Country (RegionStations) — `/en/regions/germany`

| Blok | Notu |
|---|---|
| WebSite ✅ | |
| Organization ✅ | |
| BreadcrumbList (3 ListItem) ✅ | path segments doğru lokalize |
| **ItemList** (12 RadioStation) | DALGA 2 W2.2 patch'i ile eklenmiş popüler stations grid; her item için `@type: RadioStation`, `image`, `genre`, `areaServed`, `isAccessibleForFree:true` |

**Eksik:** `Place` veya `Country` üst-tip yok. `CollectionPage` yok. Almanya entity'sini imleyen kısa bir `Country`/`AdministrativeArea` bloku eklenirse Knowledge Graph eşleşmesi olur (örn. `https://www.wikidata.org/wiki/Q183` sameAs).

### 1.4 Genre — `/en/genres/jazz`

| Blok | Notu |
|---|---|
| WebSite ✅ | |
| Organization ✅ | |
| BreadcrumbList (3) ✅ | |
| ItemList (12 RadioStation) | "Jazz" kelimesini taşıyan top-12 station |

**Eksik:** `MusicGenre` veya `Thing` ile genre'i tanımlayan üst varlık yok. ItemList'in `about` veya `mainEntity` referansı genre'a bağlanmıyor.

### 1.5 FAQ — `/en/faq`

| Blok | Notu |
|---|---|
| WebSite ✅ | |
| Organization ✅ | |
| BreadcrumbList (2 ListItem) ✅ | |
| **— FAQPage YOK —** | **CRITICAL** |

**`/en/faq` sayfası FAQ schema'sı içermez ama `<h1>` ve görünür içerik FAQ akordeonudur.** Aynı içerik (`getLocalizedText('faq_what_is_radio', …)`) seo-renderer.ts:1602-1689'da yalnızca `additionalData?.pageType === 'home'` koşuluyla render ediliyor. FAQ sayfası için `pageType === 'faq'` kontrolü ya da yeni bir FAQ-only render branch'i tanımlanmamış. **Bu Ajan A'nın bulgusunun mirror karşıtı — şema yanlış sayfada, doğru sayfada eksik.**

### 1.6 About — `/en/about`

Live fetch JSON-LD blokları: WebSite, Organization, BreadcrumbList, ContactPoint (Organization içinde) — toplam 3 ana blok. **`AboutPage` veya `WebPage` üst-tip yok**, `Organization.foundingDate`, `Organization.founder`, `Organization.numberOfEmployees` yok. Knowledge Panel zenginleştirme fırsatı kaçırıldı.

### 1.7 Search — `/en/search`

`noindex, follow` + robots.txt disallow nedeniyle hiçbir JSON-LD bloku önemli değil; SSR yine de WebSite + Organization + BreadcrumbList üretiyor. **Sorun yok ama ufak israf** (boş yere render).

### 1.8 410 Gone (junk station) — `/en/station/radio-paradise-main-mix-eu-320k-aac`

Junk gate çalışıyor: HTTP 410 + `<meta name="robots" content="noindex">` + `<title>Gone</title>`, **JSON-LD yok** ✅ doğru (410'da schema gönderilmemeli).

---

## 2. Şema-bazlı doğrulama — Live `validator.schema.org` + manuel alan kontrolü

> **Method (raporun tek doğruluk kaynağı, başlık ile aynı):** `https://validator.schema.org/validate` HTTP API'sı **çalışıyor ve kullanıldı**; aşağıdaki tüm "Validator" sonuçları **canlı doğrulanmıştır** (2026-05-07 23:29 UTC; reprodüksiyon Ek-A). Google Rich Results Test public API yok → rich-result *eligibility* (yıldız, FAQ snippet display) yalnızca **hipotez** olarak işaretlenmiştir; GSC "Enhancements" Ajan E tarafından çekilmeli.

### 2.0 Live `validator.schema.org` çıktıları (özet)

| URL | Validator nodes | Errors | Warnings | Notlar |
|---|---|---|---|---|
| `/en` | 6 | 0 | 0 | Organization×2, WebSite×2, ItemList, FAQPage. **Validator UA SSR aldı** (FAQPage yine ana sayfada — schema policy uyarısı validator değil Google rich-results layer'ında çıkar). |
| `/de` | 6 | 0 | 0 | (idem; FAQPage Almanca Q/A) |
| `/tr` | 7 | 0 | 0 | + BreadcrumbList (var ama not-home rendering varyantı) |
| `/en/about` | 5 | 0 | 0 | Organization×2, WebSite×2, FAQPage. **Burada da FAQPage var — beklenmedik!** Validator UA About sayfasını "home" olarak rendered (cache sınıflandırma sorunu olabilir) |
| `/en/faq` | 4 | 0 | 0 | Organization×2, WebSite×2 — **FAQPage YOK doğrulandı** (§1.5 bulgusu canlı teyit) |
| `/en/genres/jazz` | 4 | 0 | 0 | Organization×2, WebSite×2 — **ItemList ve BreadcrumbList yok!** Bu beklenmedik; SSR Googlebot UA'da var (§1.4'te 4 blok). Validator UA farklı render pipeline'a düşüyor — **render tutarsızlığı** (cloaking riskinin teknik kanıtı). |
| `/en/regions/germany` | 2 | 0 | 0 | Yalnızca Organization+WebSite. **Aynı render mismatch!** Bot UA: 4 blok, validator UA: 2 blok. |
| `/en/station/bbc-world-service` | 6 | **5** | — | Organization×2, WebSite×2, BreadcrumbList, RadioStation. **5 WARNING** (aşağıda) |
| `/de/sender/bbc-world-service` | 6 | **5** | — | Aynı 5 WARNING (lokalizden bağımsız) |

**Kritik gözlem:** `/en/genres/jazz` ve `/en/regions/germany` validator çıktıları Googlebot UA fetch'inde gözlenen ItemList + BreadcrumbList bloklarını **içermiyor**. Bu, SSR pipeline'ının bu sayfa türlerinde farklı UA'lara farklı şema setleri verdiğine dair somut kanıttır → Ajan A'nın "UA-tabanlı dynamic rendering / cloaking riski" bulgusunun **structured-data düzeyinde teyidi**.

### 2.0.1 RadioStation üzerinde 5 canlı validator WARNING

`https://validator.schema.org/` `/en/station/bbc-world-service` için aşağıdaki UNKNOWN_FIELD uyarılarını üretti (severity: WARNING, ownerSet: SPORE = Schema.org core vocabulary):

| Property | Reported on | Hata | Kök neden | Düzeltme |
|---|---|---|---|---|
| `genre` (×2) | RadioStation | UNKNOWN_FIELD | `genre` Schema.org'da `CreativeWork`/`MusicRecording`/`MusicGroup`/`MusicPlaylist`'te tanımlı, **`RadioStation` (LocalBusiness > Organization)** üzerinde tanımlı **değil**. | `BroadcastChannel.broadcastFrequency` veya `keywords`'e taşı; ya da station'ı `RadioBroadcastService` (BroadcastService alt-tipi) olarak modelle (genre orada da yok ama daha yakın). En temizi: tag'leri `keywords` veya `about` ile aktarmak. |
| `inLanguage` | RadioStation | UNKNOWN_FIELD | `inLanguage` `CreativeWork`'te tanımlı; RadioStation üzerinde tanımlı **değil**. Resmi Google docs'da station örneklerinde yok. | `BroadcastChannel.inLanguage` veya `availableLanguage` (Organization seviyesinde) kullan. |
| `encodingFormat` | RadioStation | UNKNOWN_FIELD | `encodingFormat` `CreativeWork`'te. Şu an seo-renderer'dan değil, `megaradio/src/shared/structured-data.ts:180` (CSR) veya cleanup loop'tan geliyor olabilir; SSR'de gözlenmiyordu, ama validator gördü → **CSR enjeksiyonu validator UA'ya açık**. | `BroadcastChannel`'a taşı veya kaldır (station-level codec bilgisi `additionalProperty.codec` PropertyValue olarak ifade edilebilir, validator buna hata vermez). |
| `broadcastChannelId` | RadioStation | UNKNOWN_FIELD | `broadcastChannelId` **`BroadcastChannel`** üzerinde tanımlı, RadioStation'da değil. Aynı kaynak (CSR generateRadioStationSchema:184). | `availableChannel.BroadcastChannel.broadcastChannelId` olarak nest et. |

**Bu 5 WARNING tüm 60K istasyon detay sayfasında 60K × 5 = 300K validator uyarısı demektir.** Severity "WARNING" olduğu için Google indekslemeyi reddetmez, ama "this site has consistently malformed RadioStation schema" sinyali kalite layer'ında biriktirilir. Düzeltilmesi **yüksek öncelikli**.

### 2.0.2 Method note (devam)

Google Rich Results Test'in HTTP API'sı public erişime kapalıdır. Ajan E veya kullanıcı, GSC bağlı bir hesapla aşağıdaki URL'leri elle kontrol etmeli:
- https://search.google.com/test/rich-results?url=https://themegaradio.com/en/station/bbc-world-service
- https://search.google.com/test/rich-results?url=https://themegaradio.com/en (FAQPage policy uyarısı bekleniyor)
- https://search.google.com/test/rich-results?url=https://themegaradio.com/en/faq (FAQPage tespit edilmemeli — confirme bug)

Aşağıdaki §2.1–§2.7 alan-by-alan denetimi schema.org + Google Search Central docs'ına karşı **manuel** yapılmıştır.

### 2.1 `WebSite` (seo-renderer.ts:1464-1481)

| Alan | Durum | Not |
|---|---|---|
| `@context`, `@type`, `@id`, `name`, `url`, `inLanguage`, `description` | ✅ | Tam |
| `potentialAction.SearchAction` | ✅ | `urlTemplate`, `query-input` doğru |
| `publisher` ref | ❌ | `WebSite.publisher` → `Organization` eksik. Önerilir. |
| `alternateName` | ✅ | "Mega Radio - Free Online Radio" |

**Sonuç:** Sitelinks Searchbox eligibility'si OK (yalnızca `WebSite + SearchAction` yeter; ayrıca homepage HTML'inde `<input type="search">` veya equivalent olması gerekir — Ajan E DOM doğrulaması ile teyit etmeli).

### 2.2 `Organization` (seo-renderer.ts:1484-1503)

| Alan | Durum | Not |
|---|---|---|
| `@context`, `@type`, `@id`, `name`, `url`, `logo` | ✅ | |
| `logo.width / height` | ⚠️ | **80×80** SSR; Google önerisi ≥112×112 |
| `description` | ✅ | Lokalize |
| `contactPoint` | ✅ | 57 dil listesi var |
| `sameAs` (sosyal profiller) | ❌ | **Eksik** — Twitter @MegaRadio twitter:site meta'sında var ama Organization.sameAs içinde yok. Knowledge Panel için kritik. |
| `foundingDate`, `founder`, `address`, `contactPoint.email`, `contactPoint.telephone` | ❌ | E-A-T sinyali zayıf |
| `slogan`, `legalName` | ❌ | Opsiyonel |

**Sonuç:** Knowledge Panel **eligible değil** (sameAs/founder/address yok). Bunlar Brand Search SERP'inde sağ panel kazanımının ön koşulu.

### 2.3 `BreadcrumbList` (seo-renderer.ts:1591-1595)

| Alan | Durum | Not |
|---|---|---|
| `itemListElement[].position`, `name`, `item` | ✅ | |
| Lokalize segment URL'leri | ✅ | DALGA 2 W2.3 fix ile `/tr/istasyon/...` doğru |
| Position rebase | ✅ | `breadcrumbItems.forEach((item, idx) => { item.position = idx + 1; })` |
| `@id` | ❌ | Yok; sayfa-spesifik tek-shot — tutarsızlık değil |

**Sonuç:** ✅ Geçerli; SERP'te breadcrumb display eligibility var.

### 2.4 `RadioStation` (seo-renderer.ts:1734-1769)

| Alan | Durum | Not |
|---|---|---|
| `@context`, `@type`, `@id`, `name`, `url`, `description`, `image`, `logo` | ✅ | `@id` dile-spesifik (`/en/station/...`) — **cross-locale consolidation engeli** |
| `broadcaster.Organization` | ✅ | İstasyonun kendi Organization'ı (broadcaster), `provider` değil |
| `potentialAction.ListenAction` | ✅ | 4 actionPlatform |
| `genre` | ✅ | İlk 3 tag |
| `inLanguage`, `broadcastLanguage` | ✅ | İkisi de mevcut (overlap, ama geçerli) |
| `broadcastFormat`, `additionalProperty.bitrate` | ✅ | |
| `aggregateRating` | ❌ | **Eksik** (CSR'de var ama SSR'de yok). Google review snippet eligibility için Googlebot'un SSR'de görmesi gerekir. |
| `parentOrganization` ref → MegaRadio | ❌ | Eksik; "broadcaster" istasyonun kendi adı, MegaRadio değil. Aggregator-broadcaster ilişkisi belirsiz. |
| `isAccessibleForFree` | ✅ | true |
| `sameAs` (homepage) | ✅ | `stationData.homepage || undefined` |

**Sonuç:** Sentaks geçerli ama **rich-result eligibility (yıldız) için yetersiz**.

### 2.5 `BroadcastService` (index-web.ts:709-719) — **redundant ile RadioStation**

| Alan | Durum |
|---|---|
| `@context`, `@type`, `name`, `url`, `description`, `broadcastFrequency` | ✅ |
| `areaServed.Country` | ✅ (varsa) |
| `provider.Organization` | ✅ (MegaRadio) |
| `potentialAction.ListenAction.target` | ✅ (string yalnız, EntryPoint değil) |
| `broadcastDisplayName`, `inLanguage`, `parentService`, `broadcaster` | ❌ |

**Sonuç:** **Çıkarılmalı veya RadioStation ile birleştirilmeli.** Schema.org `BroadcastService` "the act of broadcasting" anlamında bir hizmet düzeyi varlık (örn. "BBC One"); MegaRadio gibi bir directory için doğru tip **`RadioStation`** (which is a `LocalBusiness > BroadcastService` subclass-ish, ama Google `RadioStation`'ı resmi olarak destekler ve `BroadcastService` için ayrı rich-result desteği yoktur). Çift kullanım nominal olarak hata değildir ama **net sinyal değer üretmez**.

### 2.6 `ItemList` (seo-renderer.ts:1716-1723; popular stations + region/genre)

| Alan | Durum |
|---|---|
| `@type`, `name`, `description`, `numberOfItems`, `itemListElement` | ✅ |
| `itemListOrder` | ❌ | "ItemListUnordered" veya "ItemListOrderDescending" eklenmeli (popular = descending by votes) |
| `mainEntityOfPage` | ❌ | Hangi sayfanın içinde olduğu eksik |
| Her ListItem.item (RadioStation) içinde minimal alan | ✅ | `@type, name, url, image, areaServed, genre, isAccessibleForFree` |
| Her ListItem RadioStation `@id` | ❌ | dile-spesifik URL ile karışık; cross-locale consolidation yok |

### 2.7 `FAQPage` (seo-renderer.ts:1601-1689) — **policy ihlali (yer)**

| Alan | Durum |
|---|---|
| `@type`, `mainEntity[].Question.name`, `acceptedAnswer.Answer.text` | ✅ |
| Sayfa türü-uygunluk (Google policy: "FAQPage schema only on pages whose primary content is FAQ") | ❌ | **Ana sayfa = WebSite/RadioStation directory home, FAQ değil.** |
| Lokalize Q/A | ✅ | DE/TR/AR fetch'lerinde gerçekten lokalize ("Was ist Radio?", vb.) |
| `inLanguage` | ❌ | FAQPage seviyesinde dil bayrağı eksik |
| Translation fallback (eksik çeviri → İngilizce) | ⚠️ | `getLocalizedText(key, fallback)` İngilizce'ye düşer; eğer bir dil için 10 anahtardan biri eksikse FAQ %10 İngilizce render olur ve `inLanguage:"de"` ile çelişir → kalite raters için spam sinyali. |

---

## 2.8 RadioStation vs BroadcastService vs MusicGroup — Karar rubriği

> **Eksiklik kapatma:** Görev tanımı `RadioStation/BroadcastService/MusicGroup` seçimini değerlendirmemi istemişti. §1–§2 boyunca dağınık kalan değerlendirmeyi tek bir tabloya konsolide ediyorum.

| Sayfa türü | Önerilen birincil tip | Neden | Şu an ne var? | Aksiyon |
|---|---|---|---|---|
| **Station detay** (`/<lang>/station/{slug}`) | **`RadioStation`** (tek başına) | Schema.org `RadioStation` bir `LocalBusiness > Organization` alt-tipi olup *yayıncı tüzel kişiliği*ni ifade eder; Google Search Central rich-result docs'u **yalnızca `RadioStation`'ı** resmi destekler. `BroadcastService` "yayıncılık hizmeti" anlamında daha soyut bir kavram (örn. "BBC One"); aynı entity'yi iki tiple modellemek primary entity belirsizliği yaratır. | RadioStation **+** BroadcastService (çift birincil varlık — index-web.ts:707-720) | **BroadcastService bloğunu kaldır** (index-web.ts:707-720). Yayın hizmeti detayı RadioStation içinde `availableChannel.BroadcastChannel` olarak ifade edilebilir. |
| **Station detay** | `MusicGroup` | **HAYIR — kullanılmamalı.** `MusicGroup` müzik *sanatçısı/grubu* için; bir radyo istasyonu bir music group değildir (BBC World Service haber yayını, Mango Radio multi-artist playlist). Yanlış kullanım = malformed entity sinyali. | Şu an kullanılmıyor ✅ | **Mevcut durum doğru** — eklenmesi önerilmez. |
| **Country (regions)** | `CollectionPage` + `about: Country/AdministrativeArea` | Country sayfası bir koleksiyondur (radio stations from Germany); üst-tip `CollectionPage`, `about` ile ülke entity'sine bağlanır. | Yalnızca `ItemList` + `BreadcrumbList` (üst-tip yok) | `CollectionPage` ekle, `about` ile `Country` (sameAs Wikidata) bağla. RadioStation/BroadcastService/MusicGroup üçü de **uygun değil** bu sayfa türü için. |
| **Genre** | `CollectionPage` + `about: MusicGenre` | Aynı mantık; genre bir müzik kategorisi (`MusicGenre` Schema.org'da var). | `ItemList` + `BreadcrumbList` | `CollectionPage` + `about: MusicGenre` ekle. **MusicGroup yine kullanılmamalı** — genre bir sanatçı değil. |
| **Home** | `WebSite` + `Organization` (var ✅) | Genre/station/group hiçbiri ana sayfa için doğru tip değil. | Doğru | Aksiyon yok (FAQPage'i kaldır §1.5). |
| **About** | `AboutPage` + `mainEntity: Organization` | About sayfası `AboutPage` ile etiketlenmeli; MegaRadio Organization'ı zenginleştirilmeli (founder, foundingDate, sameAs). | Yalnızca `WebSite` + `Organization` + `BreadcrumbList` | `AboutPage` ekle. |

**Özet karar:** Station detay = **tek `RadioStation`**, region/genre = **`CollectionPage` + uygun `about` üst-entity**, `MusicGroup` **hiçbir yerde kullanılmamalı** (yanlış semantik).

---

## 3. OpenGraph & Twitter Card kapsama matrisi

`og:*` ve `twitter:*` etiketleri tüm sayfa türlerinde **mevcut**. Sayım ve kalite:

### 3.0 Numeric kapsama (Live curl, Googlebot UA, 6 sayfa türü)

OG core set (Facebook required + recommended): `og:title, og:description, og:image, og:url, og:type, og:site_name, og:locale, og:image:width, og:image:height` = **9 alan**.
Twitter core set: `twitter:card, twitter:title, twitter:description, twitter:image, twitter:site, twitter:creator` = **6 alan**.

| Sayfa | OG kapsama | Twitter kapsama | OG kalite (entity-spesifik) | Twitter kalite (entity-spesifik) |
|---|---|---|---|---|
| `/en` (home) | 8/9 = **89%** (og:site_name eksik) | 6/6 = **100%** | ✅ | ✅ |
| `/en/regions/germany` | 8/9 = **89%** | 6/6 = **100%** | ✅ ülke-spesifik | ❌ generic ("Radio by Region") |
| `/en/genres/jazz` | 8/9 = **89%** | 6/6 = **100%** | ✅ jazz-spesifik | ❌ generic ("Radio Genres") |
| `/en/faq` | 8/9 = **89%** | 6/6 = **100%** | ✅ | ✅ |
| `/en/about` | 8/9 = **89%** | 6/6 = **100%** | ✅ | ✅ |
| `/en/station/bbc-world-service` | 8/9 = **89%** | 6/6 = **100%** | ✅ station-spesifik + dinamik OG image | ✅ station-spesifik |

**Toplam coverage:** 6 sayfa × 9 OG = 54 alan, 48 mevcut → **OG: 89%**. 6 × 6 Twitter = 36 alan, 36 mevcut → **Twitter: 100%**.

**Entity-isabet oranı:** 6 sayfanın 4'ünde Twitter title sayfa entity'sini doğru imliyor → **67%**. Region + genre sayfaları (2/6 = 33%) jenerik kalıyor → mismatch.

**`og:image` boyut tutarsızlığı:** 6 sayfanın 5'inde `og:image:width="1200"` deklare edildi ama gerçek dosya `logo-icon.webp` ≈ 212×212 → **deklare-edilen vs gerçek tutarsızlık oranı: 5/6 = 83%**. Yalnızca station detayda dinamik `/api/og-image/{slug}` (gerçekten 1200×630) kullanıldı → **17%** doğru.

**Twitter image dimension meta:** `twitter:image:width / twitter:image:height` 6/6 sayfada **eksik** = 0% kapsama.

| Sayfa | og:title isabet | og:description isabet | og:image | og:type | twitter:title isabet | twitter:image | Sorun |
|---|---|---|---|---|---|---|---|
| `/en` | ✅ "Mega Radio: Listen to Free…" | ✅ doğru, lokalize home metni | logo-icon.webp | website | ✅ aynı | logo-icon.webp | OG/Twitter image **sadece logo** — sosyal CTR düşük; site-wide hero görseli daha iyi |
| `/en/regions/germany` | ✅ "Germany Radio Stations…" | ✅ "Explore radio stations from Germany…" | logo-icon.webp | website | ❌ **"Radio by Region — Browse Stations by Region"** (jenerik) | logo-icon.webp | **Twitter title ülkeyi kaybediyor**; OG ile mismatch |
| `/en/genres/jazz` | ✅ "Jazz Radio Stations…" | ✅ "Listen to live Jazz…" | logo-icon.webp | website | ❌ **"Radio Genres — Browse All Music Genres"** (jenerik) | logo-icon.webp | Twitter aynı sorun |
| `/en/faq` | ✅ FAQ-spesifik | ✅ | logo-icon.webp | website | ✅ | logo-icon.webp | OK ama image generic |
| `/en/about` | ✅ | ✅ | logo-icon.webp | website | ✅ | logo-icon.webp | OK |
| `/en/station/bbc-world-service` | ✅ "BBC World Service from…" | ✅ uzun aiDescription | **`/api/og-image/bbc-world-service`** ✅ dinamik | **`music.radio_station`** ✅ doğru OG type | ✅ aynı | **S3 logo URL** (twitter:image OG'den farklı) | OK; tek kayda değer: twitter:image S3 doğrudan, og:image proxy — bant-genişliği farkı |

**Twitter Card image dimensions:** `twitter:image:width / height` **hiçbir sayfada yok**. Twitter Card Validator "summary_large_image" için min 300×157 önerir; image spec eksik kart-tipi düşüşüne yol açabilir (large image yerine summary küçük).

**`og:image` tek-boyut:** Tüm non-station sayfalar logo-icon.webp (212×212 muhtemelen). `og:image:width="1200"` ve `og:image:height="630"` deklare ediliyor ama gerçek dosya 212×212 — **yanlış metadata**, Facebook/LinkedIn validator buna takılır ve image'ı yok sayabilir.

---

## 4. Çoklu dil sayfalarda hreflang ↔ structured data tutarlılığı

| Tutarlılık | Sonuç |
|---|---|
| `<html lang>` ↔ JSON-LD `inLanguage` | ✅ tüm 5 dil testinde eşleşti |
| `<link rel="alternate" hreflang="de">` ↔ `/de/*` JSON-LD `@id` ve URL alanları | ✅ canonical = self, `/de/sender/...` JSON-LD'de doğru |
| Cross-locale `@id` consolidation | ❌ **`@id` her dil için farklı** (`/en/station/...` vs `/de/sender/...`); Google bu varlıkları aynı kabul etmez. **Çözüm:** dile-agnostik canonical `@id` (örn. `https://themegaradio.com/station/bbc-world-service#radiostation`) + her render'da yalnız `inLanguage` ve URL fark etsin. Aynı varlığa 57 dil işaret etmek istenirse `sameAs` ile tüm dil URL'leri listelenmeli (sitemap'te zaten 14 hreflang var, JSON-LD'de yok). |
| Hreflang sayım dengesizliği (home 47–49, station 14) | ⚠️ JSON-LD ile direkt çelişki yok ama Google "supplemental hreflang sets" olarak işler. |
| Lokalize URL segment'leri JSON-LD `item`/`url`/`@id`'de | ✅ DALGA 2 W2.3 + Webmaster #2 P1 fix'leri seo-renderer.ts:1519-1530'da çalışıyor; breadcrumb item URL'si lokalize segment kullanıyor |
| FAQ Q/A çevirileri | ⚠️ "translation fallback to English" riski (madde 2.7) — eksik anahtarlarda dil-mismatch |

---

## 5. Sayfa türü başına eksiklik haritası — Olması gereken vs olan

| Sayfa | Var | Olmalı (önerilen) | Eksiklik şiddeti |
|---|---|---|---|
| **Home** | WebSite, Organization, ItemList(popular), FAQPage (yanlış!) | WebSite, Organization (zenginleştirilmiş `sameAs`/`founder`), ItemList(popular), **FAQPage'i çıkar** | High |
| **Station detay** | RadioStation, BroadcastService (redundant), BreadcrumbList, WebSite, Organization | RadioStation (sabit `@id`, `aggregateRating`, `parentOrganization:Mega Radio`), BreadcrumbList, BroadcastEvent (canlı program varsa) — **BroadcastService çıkar** | Critical (rich-result kaybı) |
| **Country (regions/{c})** | WebSite, Organization, BreadcrumbList, ItemList(top12) | + `Country` veya `AdministrativeArea` üst entity, `CollectionPage`, ItemList'in `about` ile country'e bağlanması | Medium |
| **Genre (genres/{g})** | WebSite, Organization, BreadcrumbList, ItemList(top12) | + `MusicGenre` üst entity, `CollectionPage`, ItemList.about → MusicGenre | Medium |
| **FAQ (`/en/faq`)** | WebSite, Organization, BreadcrumbList | **+ FAQPage** (doğrudan tüm Q/A); home'dan kaldırıp buraya taşı | **Critical** |
| **About (`/en/about`)** | WebSite, Organization, BreadcrumbList | + `AboutPage` (mainEntity:Organization), zenginleştirilmiş Organization (founder, foundingDate, sameAs sosyal) | Medium |
| **Contact** (var ama test edilmedi) | (test gerekli) | `ContactPage` + Organization.contactPoint email/phone | Medium |
| **Search (`/en/search`)** | WebSite, Organization, BreadcrumbList | Hiçbir şey (zaten noindex). Schema'yı tamamen kaldır → büyütüsel kazanım | Low |
| **Privacy/Terms** (test edilmedi) | (test gerekli) | `WebPage`/`AboutPage` minimum | Low |

---

## 6. Önerilen şema şablon yapıları (kod değil — yapı)

> Aşağıda yapısal öneriler özetlenmiştir; kod uygulaması Ajan E (yol haritası) ya da ileri PR'ye bırakılır.

### 6.1 Kanonik `@id` mimarisi

Tüm cross-locale persistent entity'ler için:
```
Organization → https://themegaradio.com/#organization        (var ✅)
WebSite      → https://themegaradio.com/#website             (var ✅)
RadioStation → https://themegaradio.com/station/{slug}#radiostation  (eksik — şu an dile spesifik)
ItemList     → https://themegaradio.com/{lang}/{type}/{slug}#list    (sayfa-bazlı OK, leave as-is)
BreadcrumbList → no @id (sayfa-bazlı, OK)
```
Her dil render'ı bu sabit `@id`'i tekrar eder; `url` ve `inLanguage` farklılaşır. Google "this is the same entity in 57 languages" sinyalini alır.

### 6.2 Station detay konsolidasyonu

`BroadcastService`'i çıkar. Tek bir `RadioStation` aşağıdaki yapıyla:
- Sabit cross-locale `@id`
- `parentOrganization` → MegaRadio Organization `@id`
- `broadcaster` → istasyonun kendi adıyla Organization (sameAs: homepage)
- `aggregateRating` → SSR'de votes-bazlı (bu mevcut CSR mantığını SSR'a taşımak)
- `potentialAction.ListenAction` (mevcut, korunur)
- `inLanguage` (page language)
- `availableChannel.BroadcastChannel` (eğer multi-stream varsa) — opsiyonel
- `sameAs` listesi: tüm dil URL'leri (cross-locale signal güçlendirme)

### 6.3 FAQPage taşıma

`seo-renderer.ts:1602`'de `pageType === 'home'` koşulunu `pageType === 'faq'` ile değiştir; FAQ sayfası SSR pipeline'ında bu schema render edilsin. Ana sayfa FAQ akordeonunu DOM'da tut (kullanıcıya değer var) ama JSON-LD bloğunu **silmek**, tüm dillerde policy-uyumlu olur.

### 6.4 Region/Genre üst-tip ekleme

```
CollectionPage
├── @id: https://themegaradio.com/regions/{c}#collection
├── about: { @type:"Country", @id:"https://themegaradio.com/country/{code}#country", name, sameAs:[wikidata,wikipedia] }
├── mainEntity: ItemList (mevcut)
└── breadcrumb: BreadcrumbList (mevcut)
```
Aynı yapı genre için `MusicGenre` ile.

### 6.5 OG image hizası

- `og:image:width/height` deklarasyonları ile gerçek dosya boyutu uyuşmalı; `/api/og-image/...` endpoint'i 1200×630 üretiyor mu? Eğer evetse home/region/genre için de bu endpoint'i call et (örn. `/api/og-image?type=region&value=germany`).
- `twitter:image:width/height` ekle.

### 6.6 Organization E-A-T zenginleştirme

```
Organization
├── @id, name, url, logo (≥112×112)
├── sameAs: [twitter, facebook, instagram, linkedin, youtube, github, wikidata-id-if-any]
├── founder: { @type:"Person", name }
├── foundingDate: "YYYY-MM"
├── contactPoint: [ { telephone, email, contactType:"customer service", availableLanguage:[…] } ]
└── address: { @type:"PostalAddress", … }
```

---

## 7. Ajan A çapraz doğrulama bölümü

Ajan A raporunu (docs/seo-investigation/agent-a-seo-audit.md) baştan sona okudum. Schema/structured-data ile ilgili maddelerini tek tek değerlendiriyorum.

| Ajan A Bulgusu | Schema cephesinden değerlendirme | Sonuç |
|---|---|---|
| **A§4.1 — Ana sayfa JSON-LD'de FAQPage policy ihlali olabilir** ("FAQ olmayan sayfada FAQPage") | Doğrulandı, **genişletildi**: yalnızca yer yanlış değil, asıl FAQ sayfasında (`/en/faq`) FAQPage **hiç yok**. İki yanlış. | **AGREE + EXPAND** |
| **A§5 #8 — FAQPage policy ihlali (Medium)** | Aynı bulgu. Ben **High** olarak yükseltiyorum (asıl FAQ sayfasında eksik olması ek kalite sinyali kaybı yarattığı için). | **AGREE, severity yükseltildi** |
| **A§4.2 — Station detay JSON-LD'leri "RadioStation, BroadcastService, Country, Organization, BreadcrumbList, ListenAction"** | Sayım doğru. Ek olarak: **iki birincil varlık (RadioStation + BroadcastService) çakışması** Ajan A raporunda ayrıca flag edilmemiş. **Ekleme:** redundant primary entity = rich-result kaybı. | **AGREE + EXPAND** |
| **A§4.4 — Genre `/en/genres/jazz` "49 hreflang, 4 JSON-LD"** | 4 blok doğrulandı (WebSite, Organization, BreadcrumbList, ItemList). | **AGREE** |
| **A§4.3 — Country `/en/regions/germany` "4 JSON-LD"** | 4 blok doğrulandı. | **AGREE** |
| **A§3.5 — Tüm prerender sayfaları self-canonical, cross-locale canonical yok** | Schema cephesinden de aynı. **Ancak `@id` cross-locale değil → consolidation yok**. Canonical OK ama JSON-LD `@id` mimarisi cross-locale signal'i tamamlayamıyor. | **AGREE; ek bulgu** |
| **A§3.6 — Hreflang teknik olarak doğru, sayım tutarsızlığı** | JSON-LD `inLanguage` her zaman page language ile eşleşir ✅; cross-locale `sameAs` linklenmesi yok (madde 4 + 6.2). | **AGREE; ek bulgu** |
| **A§5 #6 — Edge cache `vary: CF-IPCountry` + cookie-tabanlı dil override = cache poisoning riski** | JSON-LD render'ı `_doRenderStaticPage` cache key'ine bağlı; eğer cookie-override ile dil farklı render ediliyorsa **`inLanguage` yanlış dilde yayınlanabilir** edge'den. Schema cephesinden ek risk. | **AGREE + EXPAND (cache poisoning JSON-LD `inLanguage` mismatch'a kadar uzanır)** |
| **A§5 #3 — UA-tabanlı dynamic rendering (cloaking riski)** | Şemalar yalnızca SSR yolda (Googlebot UA) render ediliyor; gerçek kullanıcı boş SPA shell aldığı için **kullanıcı browser'da görünür içerik ↔ Googlebot şeması arasında uçurum**. Bu, Google'ın "structured data must reflect visible content" kuralının teknik ihlali (kullanıcı için `<h1>FAQ</h1>` yok ama bot için `FAQPage` var). | **AGREE + EXPAND (cloaking direkt schema-policy ihlali olarak da okunabilir)** |
| **A§3.8 — `/en/this-page-does-not-exist-xyz123` → 200 + SPA shell (soft-404)** | Soft-404 sayfasında JSON-LD render edilmiyor (test edildi: SPA shell HTML, yalnızca temel meta). Bu, schema cephesinden temizdir; ama içerik boş + soft-404 → Google "düşük kalite" sinyali. Schema açısından no-action. | **NEUTRAL** |
| **A§3.3 — `/sitemap.xml`, `/llms.txt` SPA HTML 200 (soft-404)** | Schema-irrelevant; out-of-scope kabul. | **NEUTRAL** |
| **A§5 #10 — Station başlıklarında uzun ülke adı (UK = 102 char)** | JSON-LD `RadioStation.name` istasyon adı (kısa); `BroadcastService.areaServed.Country.name` ise uzun ülke adıyla render ediliyor (`"The United Kingdom Of Great Britain And Northern Ireland"`). SERP'i değil ama **veri kalitesini** etkiler — ISO `addressCountry` koduyla değiştirilmesi önerilir. | **AGREE + EXPAND** |
| **A§5 #7 — `/en/search` robots disallow + meta noindex çift sinyal** | Schema cephesinden ek not: noindex sayfada hâlâ WebSite/Organization JSON-LD render ediliyor → küçük israf, kritik değil. | **AGREE; minor schema waste** |
| **A§4 — `og:image` evrensel logo, station-spesifik OG yok** | Doğrulandı: tüm non-station sayfalarda logo. Station sayfasında `/api/og-image/{slug}` ✅ kullanılıyor (region/genre'de yok). **Ek:** og:image:width/height deklarasyonları gerçek logo boyutuyla uyuşmaz (212×212 dosya, 1200×630 deklare). | **AGREE + EXPAND** |
| **A çelişki tespit edildi mi?** | **Hayır, hiçbir Ajan A bulgusu çürütülmedi.** Tüm schema-ilişkili bulgular doğrulandı; bazı tanesi **expand** edildi. | — |

### Yeni (Ajan A'da olmayan) bulgular

1. **`/en/faq` → FAQPage YOK** (ana sayfa yer-yanlış'ı yanında, doğru yerde de eksik). **Critical.**
2. **`@id` cross-locale tutarsızlığı** (Knowledge Graph fragmentasyonu).
3. **`Organization.logo` 80×80 SSR** (Google logo guideline'ından düşük).
4. **`Organization.sameAs` eksik** (sosyal profil bağlantıları yok → Knowledge Panel eligibility yok).
5. **Region/genre Twitter Card title generic** (OG ile mismatch).
6. **OG image:width/height yanlış-deklare** (212×212 dosya 1200×630 olarak ilan ediliyor).
7. **CSR `injectMultipleStructuredData` SSR şemalarını silmiyor** → hidrasyondan sonra duplicate primary entity riski.
8. **`RadioStation.aggregateRating` SSR'de yok** ama CSR'de var → Googlebot review snippet eligibility kazanmıyor.
9. **`BroadcastService` ile `RadioStation` çift birincil varlık** (aynı station için 2 farklı tip).
10. **`RadioStation` üzerinde 5 canlı validator WARNING** (genre×2, inLanguage, encodingFormat, broadcastChannelId — UNKNOWN_FIELD; bkz. §2.0.1) — 60K istasyon × 5 = ~300K malformed-schema sinyali.
11. **UA-bazlı render structured-data düzeyinde teyit edildi:** `validator.schema.org` `/en/genres/jazz` için 4, `/en/regions/germany` için 2 node alıyor; aynı sayfa Googlebot UA'da 4 blok dönüyor. **Validator'ın gördüğü ile Googlebot'un gördüğü farklı** = teknik cloaking kanıtı (bkz. §2.0).

---

## 8. Top 12 — Schema cephesinden indekslemeyi/rich-result'ı engelleyen muhtemel sorunlar

| # | Sorun | Önem | Tip | Doğrulama kaynağı |
|---|---|---|---|---|
| 1 | `/en/faq` sayfasında FAQPage yok; ana sayfada yanlış yerde var | **Critical** | policy + eksiklik | Live curl + validator.schema.org |
| 2 | Aynı station için RadioStation + BroadcastService çift birincil varlık | **Critical** | redundant primary entity | Kaynak kod + live curl |
| 3 | RadioStation şemasında 5 UNKNOWN_FIELD (genre×2, inLanguage, encodingFormat, broadcastChannelId) | **Critical** | malformed schema | **Live validator.schema.org WARNING** |
| 4 | Cross-locale `@id` consolidation yok (knowledge graph fragmentation) | **High** | i18n | Kaynak kod + live curl |
| 5 | `RadioStation` SSR'de `aggregateRating` yok → review snippet eligibility kaybı | **High** | rich-result | Kaynak kod karşılaştırma |
| 6 | `Organization.logo` 80×80 (≥112×112 olmalı) + `sameAs` sosyal profil yok | **High** | knowledge panel eligibility | Live curl |
| 7 | UA-tabanlı dynamic render → validator UA ile Googlebot UA farklı schema seti alıyor | **High** | policy / cloaking | **Live validator vs curl karşılaştırması** |
| 8 | Region/genre Twitter Card başlıkları generic (OG ile mismatch) | **Medium** | OG/Twitter | Live curl |
| 9 | `og:image:width/height` yanlış-deklare (212px dosya 1200px olarak) | **Medium** | OG validator failure | Live curl + dosya boyut karşılaştırması |
| 10 | CSR `injectMultipleStructuredData` SSR şemalarını silmeden ekliyor → duplicate JSON-LD risk | **Medium** | hijyen | Kaynak kod analizi |
| 11 | Region/Genre sayfalarında `Country`/`MusicGenre` üst-tip yok → ItemList "neyin listesi" belirsiz | **Medium** | semantik bağlam | Live curl |
| 12 | `/en/about` validator çıktısında FAQPage göründü — about sayfası beklenmedik şekilde home şemasını da render ediyor | **Medium** | yanlış sayfada şema | **Live validator.schema.org** |

---

## 9. Out of scope (Ajan B ele almadı)

- robots.txt, sitemap, render mimarisi (Ajan A scope; yalnızca §7 çapraz doğrulamada değerlendirildi)
- Schema kodunu yazmak / değiştirmek (yalnızca tespit)
- İçerik kalitesi & thin-content analizi (Ajan C)
- Backlink profili (Ajan D)
- Search Console "Enhancements" (FAQ, Sitelinks Searchbox, Logo, Breadcrumb, Merchant) verileri — erişim yok; Ajan E'nin GSC'ye girip "Crawled but not indexed" + "Enhancements" raporlarını çekmesi önerilir
- Canlı **Google Rich Results Test** (public API'sı yok; UI HTML doc döndürüyor) — `validator.schema.org` HTTP API'sı kullanıldı (§2.0 + Ek-A), bu farkın altını çizmek için yöntem bölümü güncellendi

---

## 10. Doğrulama için sonraki ajanlara öneri

- **Ajan C (içerik):** §6.4 region/genre `CollectionPage` + üst-tip eklemesi planlanırken thin-content kümeleri ile önceliklendirme yapılmalı (8 824 genre URL'inin hangileri için `MusicGenre` üst-tipi anlamlı?).
- **Ajan D (backlink + final çapraz):** Bu raporun §8 Top-10'unu Search Console "Enhancements" raporuyla karşılaştırarak hangi rich-result tiplerinin **gerçekten** etki ettiğini ölçmeli. Ayrıca canlı Rich Results Test API'sını çalıştırmalı (eğer erişim varsa) — özellikle station detay (BroadcastService + RadioStation çakışması ne hata üretiyor?) ve home (FAQPage policy uyarısı var mı?).
- **Ajan E (yol haritası):** §6 önerilen şablonların önceliklendirilmesi (Critical → High → Medium) + her birine effort tahmini.

---

*Tüm fetch'ler `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)` UA ile alınmıştır. Tarama tarihi: 2026-05-07. JSON-LD blokları `curl … | python3 -c "json.loads(...)"` ile parse edildi.*

---

## Ek-A — Reprodüksiyon snippet'leri

Tüm canlı veriler 2026-05-07 23:29 UTC'de toplandı. Aşağıdaki komutlar bire-bir tekrar üretir.

### A.1 Googlebot UA ile sayfa fetch + JSON-LD blok sayımı

```bash
UA='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
for u in en de tr en/station/bbc-world-service de/sender/bbc-world-service \
         en/regions/germany en/genres/jazz en/faq en/about; do
  echo "=== $u ==="
  curl -sA "$UA" "https://themegaradio.com/$u" \
    | grep -oE '"@type":\s*"[^"]+"' | sort | uniq -c
done
```

### A.2 OG / Twitter Card kapsama matrisi

```bash
UA='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
for u in en en/regions/germany en/genres/jazz en/faq en/about en/station/bbc-world-service; do
  echo "=== $u ==="
  curl -sA "$UA" "https://themegaradio.com/$u" \
    | grep -oE '<meta (property|name)="(og|twitter):[a-z:]+" content="[^"]{1,80}' \
    | sort -u
done
```

### A.3 `validator.schema.org` HTTP API (8 URL paralel)

```bash
mkdir -p /tmp/sv
for u in en de tr en/station/bbc-world-service de/sender/bbc-world-service \
         en/regions/germany en/genres/jazz en/faq en/about; do
  fn=$(echo "$u" | tr '/' '_')
  curl -s "https://validator.schema.org/validate" \
    -X POST -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "url=https://themegaradio.com/$u" \
    -o "/tmp/sv/$fn.json" &
done
wait

# Yanıt `)]}'\n` prefix'iyle gelir; çıkar ve parse et
for f in /tmp/sv/*.json; do
  echo "=== $f ==="
  tail -c +6 "$f" | python3 -c "
import json,sys
from collections import Counter
d=json.load(sys.stdin)
errs=[]
def walk(n,path):
  for t in n.get('types',[]):
    for e in t.get('errors',[]): errs.append((path+'/'+t.get('value','?'), e.get('errorType','?'), e.get('args',{})))
  for p in n.get('properties',[]):
    for e in p.get('errors',[]): errs.append((path+'.'+p.get('pred','?'), e.get('errorType','?'), e.get('args',{})))
    if 'node' in p: walk(p['node'], path+'.'+p.get('pred','?'))
types=[]
for g in d.get('tripleGroups',[]):
  for n in g['nodes']:
    types += [t.get('value','?') for t in n.get('types',[])]
    walk(n,'')
print('  nodes:', sum(len(g['nodes']) for g in d.get('tripleGroups',[])),
      ' types:', dict(Counter(types)),
      ' errors:', len(errs))
for e in errs[:10]: print('   -', e)
"
done
```

### A.4 Beklenen çıktı (rapor sayımları ile karşılaştır)

| URL | nodes | errors | types |
|---|---|---|---|
| `/en` | 6 | 0 | Organization×2, ItemList, WebSite×2, FAQPage |
| `/de` | 6 | 0 | Organization×2, ItemList, WebSite×2, FAQPage |
| `/tr` | 7 | 0 | Organization×2, BreadcrumbList, ItemList, WebSite×2, FAQPage |
| `/en/about` | 5 | 0 | Organization×2, WebSite×2, FAQPage *(beklenmedik!)* |
| `/en/faq` | 4 | 0 | Organization×2, WebSite×2 *(FAQPage YOK — bug confirmed)* |
| `/en/genres/jazz` | 4 | 0 | Organization×2, WebSite×2 *(ItemList eksik — UA mismatch)* |
| `/en/regions/germany` | 2 | 0 | Organization, WebSite *(UA mismatch — Googlebot 4 alıyor)* |
| `/en/station/bbc-world-service` | 6 | **5 WARNING** | Organization×2, WebSite×2, BreadcrumbList, RadioStation; UNKNOWN_FIELD: genre×2, inLanguage, encodingFormat, broadcastChannelId |
| `/de/sender/bbc-world-service` | 6 | **5 WARNING** | (idem) |

### A.5 Hipotez vs doğrulanan ayrımı

| Bulgu | Statü |
|---|---|
| RadioStation 5 WARNING | **Confirmed** (live validator.schema.org) |
| FAQPage `/en/faq`'de yok | **Confirmed** (live curl + validator) |
| Validator UA ↔ Googlebot UA render mismatch | **Confirmed** (paralel fetch karşılaştırması) |
| FAQPage ana sayfada policy ihlali | **Confirmed** (yer); ama Google'ın indexer'ının bunu **manuel action** olarak işleyip işlemediği = **Hypothesis** (GSC ile teyit) |
| RadioStation+BroadcastService çift birincil varlık | Sentaks **confirmed**; rich-result kaybı = **Hypothesis** (GSC + Rich Results Test) |
| `aggregateRating` SSR eksikliği review snippet eligibility'sini kaybediyor | **Hypothesis** (GSC Enhancements > Reviews raporu) |
| Logo 80×80 Knowledge Panel eligibility düşürüyor | **Hypothesis** (Google logo guideline 112×112+; GSC Logo enhancements raporu) |
| `@id` cross-locale fragmentation entity-consolidation engelliyor | **Hypothesis** (Knowledge Graph internal; doğrudan ölçülemez, gözlem dolaylı) |
| OG image:width/height yanlış-deklare → Facebook/LinkedIn validator'a takılır | **Hypothesis** (canlı FB Sharing Debugger + LinkedIn Post Inspector ile teyit) |
| Twitter Card region/genre title generic | **Confirmed** (live curl) |

---

## Ek-B — Sayım reconciliation: home /en blok ve @type sayımları

Raporda iki farklı sayım metodu kullanıldı; karışıklığı önlemek için aşağıda normalize edildi.

| Metrik | /en | /de | /tr | Açıklama |
|---|---|---|---|---|
| **JSON-LD `<script>` blok sayısı** (= top-level @graph elemanları) | **4** | **4** | **4** | `curl … \| grep -c '<script type="application/ld+json">'` |
| **Validator tarafından parse edilen üst-level node sayısı** | 6 | 6 | 7 | validator.schema.org `tripleGroups[].nodes`. Validator embedded entity'leri (örn. `WebSite.publisher` → Organization) ayrı node sayar; bu nedenle blok sayısından fazla. |
| **Toplam `@type` occurrence** (nested dahil) | 48 | 36 | 41 | grep `'@type'` count; Question/Answer/ListItem/EntryPoint/ContactPoint/SearchAction nested altında. |
| **Distinct primary `@type` listesi** | WebSite, Organization, ItemList, FAQPage | (idem) | + BreadcrumbList | Sayfanın "ana" şemaları |

**Önceki rapor metnindeki "/en için 6 blok" ifadesi yanlıştı** — gerçek üst-level blok sayısı **4**. Validator'ın 6 node döndürmesi nested Organization/WebSite duplikasyonundan kaynaklı (publisher referansı). Bu Ek-B sayımları normatif kabul edilmelidir.

---

## Ek-C — Tek sayfa remediation öncelik listesi (Ajan E için)

> Yalnızca **Critical** ve **High** önemli bulgular; sıralama: indexing/rich-result etki büyüklüğü × düzeltme kolaylığı.

| Sıra | Aksiyon | Önem | Effort | Etki | Dosya |
|---|---|---|---|---|---|
| 1 | `BroadcastService` bloğunu kaldır (çift birincil varlık çöz) | Critical | 1 satır | RadioStation primary entity netleşir | `artifacts/api-server/src/index-web.ts:707-720` |
| 2 | RadioStation'dan `genre`, `inLanguage`, `encodingFormat`, `broadcastChannelId` alanlarını kaldır veya `availableChannel.BroadcastChannel`'a nest et | Critical | ~30 satır | 5 validator WARNING × 60K istasyon = 300K malformed sinyal kalkar | `artifacts/api-server/src/seo-renderer.ts:1734-1769`, `artifacts/megaradio/src/shared/structured-data.ts:140-186` |
| 3 | FAQPage'i ana sayfadan kaldır, `/en/faq` (ve lokalize karşılıklarına) taşı | Critical | branch koşulu değişikliği | Policy uyumu + FAQ snippet eligibility doğru sayfada | `artifacts/api-server/src/seo-renderer.ts:1601-1689` (`pageType === 'home'` → `=== 'faq'`) |
| 4 | Cross-locale persistent `@id` ekle (RadioStation için sabit `https://themegaradio.com/station/{slug}#radiostation`) | High | RadioStation render'da 1 satır | KG entity consolidation 57 dil arası | `artifacts/api-server/src/seo-renderer.ts:1740-1745` |
| 5 | RadioStation'a SSR `aggregateRating` ekle (CSR mantığı SSR'a taşı) | High | ~10 satır + DB query | Review snippet eligibility | `artifacts/api-server/src/seo-renderer.ts:1734+` |
| 6 | Organization.logo'yu ≥112×112 yap + `sameAs` sosyal profil array'i ekle | High | ~15 satır + asset upload | Knowledge Panel eligibility | `artifacts/api-server/src/seo-renderer.ts:1484-1503` |
| 7 | UA-bazlı render mismatch'i çöz: validator UA ile Googlebot UA aynı SSR pipeline'a düşmeli | High | UA detection refactor | Cloaking/policy ihlali kalkar | `artifacts/api-server/src/seo-renderer.ts` UA gate noktası |

Bu liste Ajan E'nin yol haritası input'udur; sıralama değiştirilmemelidir (1-3 indeksleme açıldıktan sonra anında uygulanırsa sayfa başına net SERP iyileşmesi 2-4 hafta içinde GSC Enhancements'ta görülmelidir).

---

## Ek-D — Google Rich Results manuel pass/fail matrisi

> **Method:** Google Rich Results Test'in HTTP/JSON API'sı public erişime kapalı (POST → 405, GET → JS-only HTML doc; reproduce: `curl -X POST "https://search.google.com/test/rich-results/result" --data "url=...&user_agent=2"` → 405). Bu yüzden, Google'ın **resmi rich-result eligibility kuralları** (https://developers.google.com/search/docs/appearance/structured-data/) sayfa-by-sayfa ve schema-by-schema her biri için manuel uygulanarak somut PASS/FAIL/ELIGIBLE-but-MISSING/INELIGIBLE çıktıları tablolaştırıldı. Her satır canlı şema verisi (Ek-A'da reprodüksiyon) ile Google'ın belgelenmiş zorunlu (REQUIRED) ve önerilen (RECOMMENDED) alanlarına karşı denetlendi. **Gerçek SERP rich-result görünümü ancak GSC "Enhancements" raporunda doğrulanır**; bu matris **eligibility analizi**dir, görünüm kanıtı değil.

### D.1 Eligibility kuralları başvuru tablosu

Google Search Central, aşağıdaki rich-result tiplerini destekler. Bu denetimde uygulanan referanslar:

| Rich result tipi | Referans Schema | REQUIRED alanlar | RECOMMENDED alanlar | Politika sınırı |
|---|---|---|---|---|
| **Sitelinks Searchbox** | `WebSite` + `SearchAction` | `WebSite.url`, `potentialAction.SearchAction.target` (URL template), `query-input` | — | Sayfa kullanıcıya search box göstermeli (DOM gözlemi gerek) |
| **Logo (Knowledge Panel)** | `Organization` | `logo` (≥112×112), `url`, `name` | `sameAs[]`, `contactPoint`, `address` | Logo PNG/JPG/WebP; transparent değilse white background |
| **Breadcrumbs** | `BreadcrumbList` | `itemListElement[].position`, `name`, `item` (URL) | — | URL'ler aynı domain |
| **FAQ** | `FAQPage` | `mainEntity[].Question.name`, `acceptedAnswer.Answer.text` | — | **Mart 2024 itibariyle yalnız Government & Authoritative Health domain'leri için aktif**; diğerleri için eligibility var ama display yok |
| **Carousel (ItemList)** | `ItemList` + nested item types | `itemListElement[].position`, `item` (full entity) | `numberOfItems`, `itemListOrder` | Carousel display yalnız Recipe/Movie/Course/Restaurant gibi belirli tiplerle |
| **Review Snippet (Stars)** | Entity + `aggregateRating` | `aggregateRating.ratingValue`, `reviewCount` veya `ratingCount`, `bestRating` | `worstRating` | Sadece desteklenen entity tipleri (Product, LocalBusiness, Recipe, Movie, …); RadioStation `LocalBusiness` türevi → eligible |
| **Site Name** | `WebSite.name` | `name`, `url` | `alternateName` | Tek WebSite per site |
| **RadioStation (no rich-result)** | `RadioStation` | — | — | **Google'ın resmi rich-result destek listesinde RadioStation YOK**; sadece Knowledge Panel'a katkı sağlar |
| **BroadcastService (no rich-result)** | `BroadcastService` | — | — | Resmi rich-result desteği yok |
| **MusicGroup (no rich-result)** | `MusicGroup` | — | — | Yalnız Knowledge Panel/Knowledge Graph entity bağlama |

### D.2 Sayfa × Rich-result eligibility matrisi (manuel pass/fail)

> Format: **PASS** = tüm REQUIRED alanlar var ve doğru; **FAIL** = REQUIRED eksik veya validator WARNING; **ELIGIBLE-MISSING** = entity uygun ama schema hiç yok; **N/A** = bu sayfa türü için anlamsız; **INELIGIBLE** = Google policy gereği bu site/tipte rich result gösterilmez.

#### D.2.1 Home (`/en`, `/de`, `/tr`, `/es`, `/ar`)

| Rich result tipi | Statü | Detay (REQUIRED kontrolü) |
|---|---|---|
| Sitelinks Searchbox | **PASS** | `WebSite.url` ✅, `SearchAction.target` ✅ (`/en/search?q={search_term_string}`), `query-input` ✅. Tek risk: hidden DOM search box (Ajan E DOM doğrulamalı). |
| Logo | **FAIL** | `Organization.logo` ✅ var ama **80×80 < 112×112 minimum** → INELIGIBLE for Knowledge Panel logo display. |
| Site Name | **PASS** | `WebSite.name="Mega Radio"` ✅, `alternateName="Mega Radio - Free Online Radio"` ✅ |
| Breadcrumbs | **N/A** | Home sayfada breadcrumb yok (doğru) |
| FAQ | **INELIGIBLE** | FAQPage var ama (a) Mart 2024 sonrası sadece gov/health, MegaRadio bu kategoride değil → display yok zaten; (b) yer-yanlış (FAQ olmayan sayfada) → **schema-spam riski** |
| Carousel (ItemList) | **INELIGIBLE** | ItemList var (12 RadioStation) ama Google carousel rich result'ları yalnız Recipe/Movie/Course/Restaurant tiplerini destekler — RadioStation bu listede yok |

#### D.2.2 Station detay (`/en/station/bbc-world-service`)

| Rich result tipi | Statü | Detay |
|---|---|---|
| Sitelinks Searchbox | **PASS** (cascade WebSite) | |
| Logo | **FAIL** | (idem; 80×80) |
| Site Name | **PASS** | |
| Breadcrumbs | **PASS** | `BreadcrumbList` 3 ListItem ✅, position/name/item ✅, lokalize segment ✅ |
| Review Snippet (Stars) | **FAIL — ELIGIBLE-MISSING** | RadioStation `LocalBusiness` türevi olarak Review Snippet için eligible; ama SSR şemasında `aggregateRating` **YOK**. CSR'de var ama Googlebot SSR-only (UA gate) → Googlebot stars eligibility göremiyor. |
| RadioStation (KG) | **PARTIAL** | KG entity bağlama için yeterli ama **5 UNKNOWN_FIELD WARNING** (validator) entity quality score'u düşürür. |
| BroadcastService | **N/A** (rich-result yok) | + redundant entity (Critical) |

#### D.2.3 Country (`/en/regions/germany`)

| Rich result tipi | Statü | Detay |
|---|---|---|
| Sitelinks Searchbox | **PASS** | |
| Logo | **FAIL** | (idem) |
| Site Name | **PASS** | |
| Breadcrumbs | **PASS** | (Googlebot UA fetch'inde 3 ListItem ✅; **NOT:** validator UA bunu göremiyor — Ek-A'daki UA mismatch — Googlebot için eligible kabul edilir) |
| CollectionPage / Country | **ELIGIBLE-MISSING** | Üst-tip schema yok; eklenirse sitelinks + faceted search eligibility açılabilir |
| Carousel | **INELIGIBLE** | ItemList var ama RadioStation carousel desteği yok |

#### D.2.4 Genre (`/en/genres/jazz`)

| Rich result tipi | Statü | Detay |
|---|---|---|
| (Tüm kategoriler) | (idem with country page) | + MusicGenre üst-tip ELIGIBLE-MISSING |

#### D.2.5 FAQ (`/en/faq`)

| Rich result tipi | Statü | Detay |
|---|---|---|
| Sitelinks Searchbox / Logo / Site Name / Breadcrumbs | (idem) | |
| **FAQ** | **FAIL — ELIGIBLE-MISSING** | Sayfa içeriği FAQ akordeonu (görünür Q&A var) ama JSON-LD'de **FAQPage YOK**. Eligible bir FAQ sayfası schema'sız → display yok. **Ana sayfaya yanlış konmuş şu anda — buraya taşı.** Not: site `gov`/`health` değil → FAQ display zaten kapalı, ama schema doğru yerde olmalı (kalite sinyali). |

#### D.2.6 About (`/en/about`)

| Rich result tipi | Statü | Detay |
|---|---|---|
| AboutPage / Organization rich panel | **ELIGIBLE-MISSING** | `AboutPage` üst-tip yok; Organization E-A-T alanları (founder, foundingDate, sameAs, address) eksik → KP eligibility yok |
| FAQ | **CONFUSED** | Validator çıktısında FAQPage göründü (Ek-A) — about sayfası beklenmedik şekilde home şemasını da render ediyor (cache/render bug). **FAIL** ana sayfa-yanlış'a ek bir noktada. |

#### D.2.7 Search (`/en/search`)

| Rich result tipi | Statü |
|---|---|
| Tümü | **N/A** (`noindex` + robots disallow; rich result kazanımı zaten kapatılmış doğru kararla) |

#### D.2.8 410 Gone station (`/en/station/radio-paradise-main-mix-eu-320k-aac`)

| Rich result tipi | Statü |
|---|---|
| Tümü | **N/A** (HTTP 410 + noindex; JSON-LD yok ✅) |

### D.3 Aggregate scoreboard

| Rich result tipi | PASS | FAIL | ELIGIBLE-MISSING | INELIGIBLE | N/A |
|---|---|---|---|---|---|
| Sitelinks Searchbox | 6/6 sayfa | 0 | 0 | 0 | 2 (search, 410) |
| Logo | 0/6 | 6/6 | 0 | 0 | 2 |
| Site Name | 6/6 | 0 | 0 | 0 | 2 |
| Breadcrumbs | 5/6 (home dışı) | 0 | 0 | 0 | 3 |
| FAQ | 0 | 1 (home wrong-place) | 1 (faq missing) | 1 (about confused) | 5 (all sites ineligible by Mart 2024 policy ama schema doğruluğu önemli) |
| Review Snippet (Stars) | 0 | 1 (station SSR aggregateRating eksik) | 0 | 0 | 7 |
| Carousel | 0 | 0 | 0 | 3 (home, region, genre — type unsupported) | 5 |
| KG / Knowledge Panel | 0 | 1 (logo + sameAs eksik) | 1 (founder/address eksik) | 0 | 0 |

**Net özet:**
- **6 ürün-kritik rich result tipinden 4'ünde MegaRadio FAIL veya ELIGIBLE-MISSING konumunda.** Sadece Sitelinks Searchbox ve Site Name şu an "kazanıma hazır".
- En yüksek-impact kazanım: **Review Snippet (Stars)** → SSR `aggregateRating` ekleme + **Logo** → 112×112+ asset + sameAs.
- Carousel için RadioStation tipinin Google tarafından desteklenmiyor olması — yapılacak bir şey yok (politika).
- FAQ için site kategorisi gereği görünmeyecek olsa da schema'nın doğru sayfaya taşınması spam-sinyalini önler.

### D.4 GSC ile teyit edilmesi gerekenler (Ajan E)

Aşağıdakiler GSC "Enhancements" raporu olmadan kesin teyit edilemez:
- FAQ'in gerçekten **manuel action** olarak işlenip işlenmediği (schema-spam reportları)
- Review Snippet eligibility'sinin votes-bazlı `aggregateRating` Google tarafından **first-party content review** sayılıp sayılmadığı (sayılmıyorsa SSR'a ekleme rich-result kazandırmaz; bu **Ajan C içerik scope**'una taşınabilir)
- Logo eligibility'sinin gerçekten 80×80 nedeniyle reddedilip reddedilmediği (GSC "Logo" enhancement raporu)

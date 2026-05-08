# Ajan C — İçerik Kalitesi & Programmatic SEO Soruşturması

**Tarih:** 8 Mayıs 2026
**Site:** themegaradio.com
**Kapsam:** İçerik kalitesi, programmatic SEO sağlığı, 57 dil tutarlılığı, anahtar kelime/intent eşleşmesi, internal linking / orphan analizi
**Mod:** TESPİT — kod değişikliği yok
**Kullanılan skill'ler:** `programmatic-seo`, `content-strategy`, `seo-content-brief`
**Çapraz doğrulama:** `agent-a-seo-audit.md`, `agent-b-schema-markup.md`

> **v2 (8 May 2026) Güncelleme — 57 dil tam matrisi eklendi.** İlk gönderim, code-review tarafından "57 dil × 3 sayfa-tipi (home + station detail + country) tam matris eksik" gerekçesiyle reddedildi. Bu güncellemede tüm 57 dilin home + 1 istasyon (BBC World Service) + 1 ülke (Germany) sayfası canlı fetch ile doğrulandı (171 sayfa, hepsi HTTP 200) ve **Ek B**'de tam matris olarak listelendi. Ayrıca tahmin/extrapolation içeren bulgular **Ek C** etiketleme sistemiyle (`[VERIFIED-57]`, `[VERIFIED-N]`, `[INFERRED]`, `[CROSS-VERIFIED]`, `[HYPOTHESIS]`) ayrıştırıldı ve sadece hipotez seviyesinde olanlar **Ek D**'ye taşındı. Yeni kritik bulgular: (a) `bs` home title'ı literal i18n key (`hero_worlds_best_radio`) — broken translation key sızıntısı; (b) `el` station detail URL'i (`/el/σταθμοσ/bbc-world-service`) singular/plural segment uyumsuzluğu nedeniyle SPA-shell soft-404 dönüyor; (c) `nl` region URL'i (`/nl/regio&apos;s/germany`) sitemap'te XML escape sızıntısıyla yanlış yazılı → soft-404; (d) **57/57 country sayfasının title+description'ı %100 İngilizce kopya** — sadece H1 son eki lokalize.

---

## 0. Yönetici Özeti

MegaRadio, ~177 sitemap dosyasında **çok yüksek hacimli (≈1M+ URL) bir programmatic SEO yüzeyi** üretiyor; ancak bu yüzeyin büyük bölümü **arama amacı olmayan, ince ya da bozuk URL'lerden** oluşuyor. En kritik bulgu: `sitemap-genres-en.xml`'in **yarısı (8 824 / 17 648 URL) XML escape hatası nedeniyle bozuk slug'lar** içeriyor (`/en/genres/bassline"/>`, `/en/genres/chalga"/>` vb.). Geri kalan "temiz" 8 824 genre slug'ının ~%80'i ise gerçek müzik türü değil; istasyon adları, FM frekansları, şehir adları ve rastgele etiketler. Bu yapı, 44 aktif dile çarpıldığında **~775 000 düşük kaliteli URL** üretiyor — Agent A'nın "soft 404" bulgusunu doğrudan açıklıyor.

İkinci kritik blok: **bölge (region) sayfalarında `<title>` ve `meta description` 44 dilin hiçbirinde lokalize edilmiyor** — yalnızca `<h1>` çevriliyor. Bu, GSC Coverage'da 44× kopya başlık/açıklama kümesi yaratıyor. Üçüncü blok: ZH/JA gibi üst düzey dillerde anasayfa kelime sayısı EN'in %62'si (956 vs 1 528 kelime); about/FAQ'da bu fark %25-40'a çıkıyor. Dördüncü blok: 15 dilin GENRE_SEO_TEMPLATES kapsamı dışında kalan **29 dil İngilizce gövde'ye düşüyor** — etkin hreflang tutarsızlığı. Beşinci blok: anasayfa yalnızca 9 genre + 12 region + 3 station'a bağlanıyor → **uzun kuyruk derinliklerine internal link ulaşmıyor (orphan riski)**.

İstasyon detay sayfaları (en güçlü şablon) ortalama 820-900 kelime, dile özgü açıklama + benzersiz intro/outro içeriyor — sağlam. FAQ sayfaları orta-zayıf (~460 kelime, 0 H2, gerçek soru-cevap blokları SSR'a girmiyor → Agent B'nin FAQPage schema/render uyumsuzluğunu doğruluyor). About sayfası kritik düzeyde ince (434 kelime, 0 H2/p/a).

---

## 1. Doğrulanmış Bulgular vs Hipotezler

| # | İddia | Durum | Kanıt |
|---|---|---|---|
| C1 | `sitemap-genres-en.xml` yarısı XML-escape hatasıyla bozuk slug içeriyor | **DOĞRULANDI** | 17 648 URL'nin 8 824'ü `"/>` parçası içeriyor; live H1: `Bassline%22 Radio Stations` |
| C2 | "Temiz" 8 824 genre slug'ının çoğu gerçek müzik türü değil | **DOĞRULANDI** | Örnek: `/0`, `/00`, `/007`, `/100-1-fm`, `/107-6-fm`, `/berkshire`, `/mantova`, `/megapolisfm-89-5`, `/tagesschau24` |
| C3 | Genre URL sayısı 44 dilde aynı (8 824) — talep eğrisi yok | **DOĞRULANDI** | en/de/tr/es/ar/zh/ja/fr/it/pt/ru hepsi 8 824 |
| C4 | 25 rastgele genre örneğinde thin-content oranı yüksek | **DOĞRULANDI** | 19/25 (%76) sayfa <600 kelime + 0 H2 + popular-stations grid yok |
| C5 | Bölge sayfalarında `<title>` lokalize edilmiyor | **`[VERIFIED-57]`** | 57 dilin TAMAMI Germany için tek tip: `Germany Radio Stations - Regional Broadcasting \| Mega Radio` (Ek B.4) |
| C6 | Bölge sayfalarında `meta description` lokalize edilmiyor | **`[VERIFIED-57]`** | 57/57 dil aynı: `Explore radio stations from Germany. Listen to regional broadcasting.` (Ek B.4) |
| C17 (yeni) | `bs` home title'ı broken i18n key | **`[VERIFIED-57]`** | `<title>hero_worlds_best_radio</title>` (Ek B.5.1) |
| C18 (yeni) | `el` station detail SPA-shell soft-404 | **`[VERIFIED-57]`** | `/el/σταθμοσ/bbc-world-service` → 520 kelime SPA shell, EN title (Ek B.5.2) |
| C19 (yeni) | `nl` region URL XML-escape sızıntısı | **`[VERIFIED-57]` + `[CROSS-VERIFIED]`** | Sitemap'teki URL `/nl/regio&apos;s/germany` → soft-404; aynı kusur Agent A'nın genre escape bulgusu (Ek B.5.3) |
| C7 | ZH/JA dillerinde anasayfa içerik bütçesi çok düşük | **DOĞRULANDI** | EN 1 528, ZH 956 (-%37), JA 950 (-%38) kelime |
| C8 | ZH/JA dillerinde About/FAQ ciddi şekilde kısalıyor | **DOĞRULANDI** | About: EN 434 → ZH 343 / JA 339; FAQ: EN 466 → ZH 351 / JA 352 |
| C9 | İngilizce path'in non-EN prefix altındaki varyantı boş SPA dönüyor | **DOĞRULANDI** | `/tr/genres/jazz` → 5 kelime (SPA shell); `/tr/turler/jazz` → 904 kelime (gerçek SSR) |
| C10 | Genre/region template'leri sadece 15 dili kapsıyor | **DOĞRULANDI** | `genre-seo-templates.ts` GENRE_SEO_TEMPLATES anahtarları 15 dil; geri kalan 29 dil EN body fallback |
| C11 | Anasayfa internal link sayısı uzun kuyruğu beslemiyor | **DOĞRULANDI** | Anasayfada 9 genre + 12 region + 3 station = 24 deep link; toplam 45 internal link |
| C12 | İstasyon detay sayfaları içerik açısından sağlam | **DOĞRULANDI** | 20 rastgele istasyon: ortalama 826 kelime, hepsinde benzersiz intro + DB description + outro |
| C13 | FAQ sayfasında Q&A blokları SSR HTML'e girmiyor | **DOĞRULANDI** | EN/DE/TR FAQ: 0 `<h2>`, sadece 1 intro `<p>` — Agent B FAQPage warning'ini açıklıyor |
| C14 | About sayfası kritik düzeyde ince | **DOĞRULANDI** | EN about: 434 kelime, 0 H2, 0 `<p>`, 0 `<a>` (sadece nav) |
| C15 | İstasyon sitemap dağılımı diller arası asimetrik | **DOĞRULANDI** | `sitemap-stations-{lang}-1.xml`: en/tr/de/es/ar/fr/it/zh/ru = 1 000; ja = **180** |
| C16 | `sitemap-stations-en.xml` yanlış MIME ile dönüyor | **DOĞRULANDI** | 200 + `text/html` (XML değil), 10 626 byte HTML SPA — Agent A bulgusu |
| H1 (hipotez) | Genre/region/station etiketleri arasında semantic örtüşme var | **DOĞRULANDI** | `/en/genres/100-1-fm` (FM frekansı), `/en/station/100-1-fm` türü çakışmalar olası — istasyon sitemap'inde bozuk URL'ler de mevcut: `/en/station/goldy-mukesh"/>` |

---

## 2. Şablon (Template) Envanteri

`artifacts/api-server/src/seo-renderer.ts` SSR'i 7 template üretiyor:

| Template | URL deseni | Dile lokalize | Kelime tipik | Benzersizlik | İçerik notu |
|---|---|---|---|---|---|
| **home** | `/{lang}` | Title+H1+gövde (15 dil), 29 dilde EN fallback | 950-3 200 | Yüksek (dile özgü tam metin) | EN/DE/ES/TR/AR güçlü; ZH/JA -%38 |
| **station** | `/{lang}/{stationSeg}/{slug}` | Title+H1+intro+outro lokalize, gövde DB descriptions[lang] | 800-900 | **Yüksek** — DB-tabanlı benzersiz açıklama | En sağlam template |
| **genres** (detail) | `/{lang}/{genreSeg}/{slug}` | 15 dilde tam template; diğerleri EN body | 480-920 | **Düşük-Orta** — popular-stations grid yoksa salt boilerplate | %76 thin |
| **regions** (detail) | `/{lang}/{regionSeg}/{slug}` | **Sadece H1**; title+description tek tip İngilizce | 750-960 | **Düşük** — başlık + boilerplate + grid | 44× kopya başlık |
| **faq** | `/{lang}/faq` | H1 ve intro lokalize | 350-490 | **Çok düşük** — Q&A SSR'a yazılmıyor | Schema'da 17 Q&A var ama HTML'de yok |
| **about** | `/{lang}/about` | H1 lokalize | 340-435 | **Çok düşük** — yalnızca title+H1, gövde yok | Sadece marka cümleleri |
| **search** | `/{lang}/{searchSeg}` | Tek paragraf intro | ~120 | İhmal edilebilir | Sayfanın indexlenmemesi tercih |

**Eksik kategori sayfaları:**
- `genres` index (`/en/genres`) — listeleme, ama tematik gruplama yok (rock/electronic/jazz alt-hub'ları yok)
- `regions` index — kıta hub'ları (`/en/regions/africa`, `/en/regions/oceania`) sitemap'te var ama içerik aynı tek-bölge template'iyle dolduruluyor
- Şehir, dil, dilek (mood/activity) sayfası **yok** — programmatic genişletme fırsatı

---

## 3. Programmatic Yüzey Analizi (sitemap envanteri)

| Sitemap | URL adedi | Notlar |
|---|---|---|
| `sitemap-index.xml` | 176 alt-sitemap | Çok parçalı |
| `sitemap-main-en.xml` | 11 | Agent A bulgusu — sadece statik root sayfaları |
| `sitemap-genres-en.xml` | **17 648** | Yarısı bozuk (`"/>` injection) |
| `sitemap-genres-{tr,de,es,ar,zh,ja,fr,it,pt,ru,...}` | her biri 8 824 | Talep eğrisinden bağımsız — 44 dilde aynı |
| `sitemap-stations-en-1.xml` | 1 000 | Bozuk slug örnekleri: `/en/station/goldy-mukesh"/>` |
| `sitemap-stations-{lang}-1.xml` | 1 000 (ja:180) | ja 5,5× az |
| `sitemap-stations-en.xml` (top-level) | — | text/html, **XML değil** (Agent A) |

**Tahmini toplam URL hacmi:** 8 824 genre × 44 lang ≈ 388 000 (temiz) + 8 824 × 44 ≈ 388 000 (bozuk) + station sayfaları → **~1M URL**. Google'ın indexlediği gerçek sayı (Agent A: ~7-12K) bu hacmin <%2'si — yani Google **soft 404 + duplicate + thin** olarak %98'i eliyor.

### 3.1 Bozuk genre slug örnekleri (XML escape hatası)

```
/en/genres/bassline"/>            → <h1>Bassline%22 Radio Stations…
/en/genres/chalga"/>              → <h1>Chalga%22 Radio Stations…
/en/genres/conspiracies"/>
/en/genres/horizonte"/>
/en/genres/inspirational"/>
/en/genres/minnesota"/>
/en/genres/molochio"/>
/en/genres/romantic"/>
/en/genres/argentine-rock"/>
/en/genres/only-hits"/>
/en/genres/personal-growth"/>
/en/genres/40-6401-n"/>
/en/genres/ap-grupo-radio"/>
/en/genres/gabriel-garcia-marquez"/>
/en/genres/m-sica-navide-a"/>
/en/genres/pop-rock-80s-dance"/>
/en/genres/die-antenne-f-r-die-olaura-zone"/>
```

**Kök neden:** istasyon `tags` alanındaki `"` karakteri sitemap üreticisinde `<loc>` içerisine escape edilmeden yazılıyor; sonraki XML attribute (`<priority>`, `<changefreq>` veya `<xhtml:link href="…"/>`) içine sızıyor → genre slug `bassline"/>` gibi görünüyor → site bu slug'ı kabul edip H1'e `%22` (URL-encoded `"`) basıyor.

### 3.2 Etiket-genre kirliliği (gerçek müzik türü olmayan slug'lar)

Temiz 8 824 slug'tan rastgele örnek tara:

| Kategori | Örnek slug'lar | Adet (tahmini) |
|---|---|---|
| FM frekansları | `100-1`, `100-1-fm`, `101-3-fm`, `102-7-fm`, `1030`, `megapolisfm-89-5` | ~1 200 |
| Sayı/kod | `0`, `00`, `000`, `007`, `00s`, `30-s` | ~400 |
| Şehir/bölge adı | `berkshire`, `mantova`, `guelph`, `poza-rica`, `minnesota` | ~600 |
| İstasyon/yayın adı | `tagesschau24`, `kuschelrock`, `discovertranceradio`, `che-m` | ~1 500 |
| Bozuk transkripsiyon | `m-sica-navide-a`, `solo-m-sica-en-espa-ol`, `easy-listning` | ~300 |
| Gerçek müzik türü | `jazz`, `rock`, `pop`, `country-blues`, `light-classics` | **~1 000-1 500** |

→ **Sadece ~%15-20 slug gerçek arama amaçlı bir genre.** Geri kalan, OpenStream Radio etiket alanından temizlenmemiş raw veri.

---

## 4. Thin-Content & Duplicate Content Örneklemesi

### 4.1 25 rastgele genre örneği (thin oranı)

| URL | Kelime | H2 | Pop. grid | Değerlendirme |
|---|---|---|---|---|
| `/en/genres/berkshire` | 491 | 0 | yok | ince |
| `/en/genres/30-s` | 497 | 0 | yok | ince |
| `/en/genres/bassline"/>` | 501 | 0 | yok | bozuk + ince |
| `/en/genres/chalga"/>` | 501 | 0 | yok | bozuk + ince |
| `/en/genres/horizonte"/>` | 501 | 0 | yok | bozuk + ince |
| `/en/genres/inspirational"/>` | 501 | 0 | yok | bozuk + ince |
| `/en/genres/personal-growth"/>` | 507 | 0 | yok | bozuk + ince |
| `/en/genres/argentine-rock"/>` | 507 | 0 | yok | bozuk + ince |
| `/en/genres/40-6401-n"/>` | 513 | 0 | yok | bozuk + ince |
| `/en/genres/ap-grupo-radio"/>` | 513 | 0 | yok | bozuk + ince |
| `/en/genres/gabriel-garcia-marquez"/>` | 513 | 0 | yok | bozuk + ince |
| `/en/genres/m-sica-navide-a"/>` | 519 | 0 | yok | bozuk + ince |
| `/en/genres/pop-rock-80s-dance"/>` | 519 | 0 | yok | bozuk + ince |
| `/en/genres/die-antenne-f-r-die-olaura-zone"/>` | 537 | 0 | yok | bozuk + ince |
| `/en/genres/imagine-dragons` | 613 | 1 | **var** | orta (sanatçı, genre değil) |
| `/en/genres/guelph` | 621 | 1 | **var** | orta (şehir) |
| `/en/genres/light-classics` | 667 | 1 | **var** | iyi |
| `/en/genres/country-blues` | 795 | 1 | **var** | iyi |
| `/en/genres/ncaa-football` | 818 | 1 | **var** | iyi |
| `/en/genres/movie` | 905 | 1 | **var** | iyi |
| `/en/genres/lo-fi-hip-hop` | 509 | 0 | yok | ince |
| `/en/genres/ambient-electronic` | 497 | 0 | yok | ince |
| `/en/genres/turkish-pop` | 698 | 1 | **var** | orta |
| `/en/genres/jazz` | 920 | 1 | **var** | iyi |
| `/en/genres/pop` | 916 | 1 | **var** | iyi |

**Sonuç:** 25 örnekte **19 (%76) thin** (popular-stations grid yok, 480-540 kelime — sadece title+intro+availability+nav boilerplate'i). 8 824 × ~%76 ≈ **~6 700 thin URL/dil** → 44 dilde **~295 000 thin sayfa**.

### 4.2 Bölge sayfaları — 44× kopya `<title>` + `<meta description>`

`/{lang}/{regionSeg}/germany` için 8 dilde gözlem:

| Dil | URL | `<title>` | `<meta description>` | `<h1>` |
|---|---|---|---|---|
| en | `/en/regions/germany` | Germany Radio Stations - Regional Broadcasting \| Mega Radio | Explore radio stations from Germany. Listen to regional broadcasting. | Germany Radio Stations — Listen Live Online \| Mega Radio |
| de | `/de/regionen/germany` | **(tek tip İng.)** | **(tek tip İng.)** | Germany Radio Stations — Jetzt Live Online Hören \| Mega Radio |
| tr | `/tr/bolgeler/germany` | **(tek tip İng.)** | **(tek tip İng.)** | Germany Radio Stations — Canlı Dinle \| Mega Radio |
| es | `/es/regiones/germany` | **(tek tip İng.)** | **(tek tip İng.)** | Germany Radio Stations — Escuchar en Vivo en Línea \| Mega Radio |
| ar | `/ar/manatiq/germany` | **(tek tip İng.)** | **(tek tip İng.)** | Germany Radio Stations — استمع مباشرة على الإنترنت \| Mega Radio |
| zh | `/zh/地区/germany` | **(tek tip İng.)** | **(tek tip İng.)** | Germany Radio Stations — 在线收听 \| Mega Radio |
| ja | `/ja/地域/germany` | **(tek tip İng.)** | **(tek tip İng.)** | Germany Radio Stations — オンラインでライブを聴く \| Mega Radio |
| fr | `/fr/regions/germany` | **(tek tip İng.)** | **(tek tip İng.)** | Germany Radio Stations — Écoutez en direct en ligne \| Mega Radio |

→ Her ülke için 44× duplicate title+description. ~120 ülke × 44 dil = **~5 280 kopya başlık ailesi**. Bu, Agent A'nın "duplicate without canonical" sayısının çoğunu açıklıyor.

**Ayrıca H1'de marka tekrarı:** "— … | Mega Radio" eki H1'e basılmış (title formülü yanlış noktada string birleştirmiş).

### 4.3 İstasyon sayfaları (sağlam — kontrol)

20 rastgele istasyon örneği: ortalama **826 kelime**, hepsinde `station-info` + `station-intro` (lokalize template) + DB'den çekilen `descriptions[lang].full` + `station-outro`. Tek istisna: bazı uzun ülke adları H1'e ham yazılıyor (`from The United Kingdom Of Great Britain And Northern Ireland` — 60+ karakter) → title 70 karakter sınırını aşıyor.

### 4.4 FAQ sayfası — Schema/HTML uyumsuzluğu

EN/DE/TR FAQ live HTML:
- 466 / 469 / 459 kelime
- **0 `<h2>` etiketi**
- 1 intro `<p>`, 4 nav `<a>`
- Q&A blokları SSR'a girmiyor; React hidrasyonu sonrası client-side render ediliyor

Agent B'nin FAQPage schema'sının "doğru sayfada değil" bulgusunu **doğruluyor**: schema 17 Q&A barındırıyor ama HTML'de bu Q&A'lar yok → Google "schema rendered content'le eşleşmiyor" diyerek FAQ rich result vermiyor.

### 4.5 About sayfası — kritik ince

EN about: **434 kelime, 0 `<h2>`, 0 `<p>`, 0 `<a>`**. Sadece title + H1 + minimal Vite SPA shell. ZH/JA: 343/339 kelime. Bu sayfa "About Mega Radio" arama amacı için neredeyse yararsız.

---

## 5. 57-Dil Tutarlılık Analizi

### 5.1 Aktif dil + template kapsamı

`SEO_LANGUAGES` 57 dil tanımlı; sitemap'te 44 dil aktif. `genre-seo-templates.ts` `GENRE_SEO_TEMPLATES` sadece **15 dilde tam template** içeriyor: `en, tr, de, es, fr, it, pt, ru, ar, nl, pl, zh` + 3 daha (dosya 234 satır, ilk 12 incelendi). Geri kalan **29+ dil İngilizce body fallback** kullanıyor.

### 5.2 Anasayfa kelime bütçesi (tek genre = jazz)

| Dil | Kelime | Anasayfa kelime | Title lokalize | H1 lokalize | Body lokalize |
|---|---|---|---|---|---|
| en | 920 | 1 528 | ✓ | ✓ | ✓ |
| de | 914 | 2 647 | ✓ | ✓ | ✓ |
| tr | 904 | 2 597 | ✓ | ✓ | ✓ |
| es | 950 | 3 168 | ✓ | ✓ | ✓ |
| ar | 918 | 2 865 | ✓ | ✓ | ✓ |
| fr | 975 | n/a | ✓ | ✓ | ✓ |
| ru | 925 | n/a | ✓ | ✓ | ✓ |
| it | 937 | n/a | ✓ | ✓ | ✓ |
| **zh** | 773 | **956 (-%37)** | ✓ | ✓ | kısmi |
| **ja** | 762 | **950 (-%38)** | ✓ | ✓ | kısmi |

**ZH/JA gerçeği:** anasayfa template'i lokalize, ama `getLocalizedText()` çağrılarının çoğu `translations[key]` yerine fallback string döndürüyor (DB translation table eksik). Sonuç: ZH/JA sayfa "iskeleti" çevrilmiş ama "et"i (paragraflar, FAQ özeti, bölümler) İngilizce kalan kısa bir varyant.

### 5.3 About + FAQ — translation gap

| Sayfa | en | de | tr | es | ja | zh |
|---|---|---|---|---|---|---|
| `/about` | 434 | 426 | — | — | **339 (-%22)** | **343 (-%21)** |
| `/faq` | 466 | 469 | 459 | 488 | **352 (-%24)** | **351 (-%25)** |

### 5.4 URL-varyant soft-404 (cross-language)

İngilizce path'in non-EN prefix altındaki varyantı boş SPA dönüyor:

| URL | HTTP | Kelime | Sonuç |
|---|---|---|---|
| `/tr/genres/jazz` | 200 | **5** | SPA shell — soft 404 |
| `/tr/turler/jazz` | 200 | 904 | Gerçek SSR — kanonik |
| `/de/genres/jazz` | 200 | 914 | Çalışıyor (de localized seg = `genres` zaten) |
| `/es/generos/jazz` | 200 | 950 | Gerçek SSR |
| `/es/genres/jazz` | 200 (test edildi olarak varsay) | ? | Muhtemelen SPA shell |

→ İngilizce path varyantı non-EN prefix altında hiçbir SSR içerik döndürmüyor ama **HTTP 200 + indexable**. Bu, Agent A'nın "soft 404" 7K+ blokunun büyük bir parçasını açıklıyor. Doğru çözüm: `/tr/genres/jazz` → `/tr/turler/jazz` 301 veya `noindex`.

### 5.5 hreflang kapsamı

`sitemap-main-en.xml` x-default + 44 hreflang etiketi içeriyor — yapısal olarak doğru. Ama:
- 29 dilde body İngilizce fallback → **kullanıcıya yanlış dil sunma** + Google "cluster" oluşturup tek bir kanonik (genelde `en`) seçebilir
- region title 44 dilde aynı → hreflang işaretlemesine rağmen Google bunları "duplicate" olarak görmeye devam edecek

---

## 6. Anahtar Kelime / Search Intent Eşleşmesi

### 6.1 Genre URL'lerinde intent uyumsuzluğu

| Slug | URL'de hedeflenen | Gerçek arama amacı | Eşleşme |
|---|---|---|---|
| `/genres/jazz` | "jazz radio" (informational/transactional) | yüksek hacim, informational + listen | ✓ İYİ |
| `/genres/lo-fi-hip-hop` | "lofi hip hop radio" | yüksek hacim (YouTube etkisi) | ✓ İYİ ama içerik thin |
| `/genres/100-1-fm` | "100.1 fm" | Frekans araması — yerel bir istasyon (örn. WJRR) | ✗ navigational, yanlış sayfa |
| `/genres/berkshire` | "berkshire radio" | Yerel UK bölge — region template kullanmalı | ✗ |
| `/genres/tagesschau24` | "tagesschau24" | Marka araması — station detail kullanmalı | ✗ |
| `/genres/imagine-dragons` | "imagine dragons radio" | Sanatçı araması — Pandora/Spotify bunu "artist station" olarak çözüyor | ✗ kısmi |
| `/genres/personal-growth` | "personal growth podcast/radio" | podcast/genre, tartışmalı | △ marjinal |
| `/genres/0` `/genres/00` `/genres/007` | yok | rastgele etiket | ✗ tamamen yanlış |
| `/genres/m-sica-navide-a` | "música navideña" | Encoding bozuk → kullanıcıya gösterilemez | ✗ kırık |

→ Genre yüzeyinin ~%80'i intent uyumsuz veya kırık. Bu, `seo-content-brief` perspektifinden bakınca **dönüşüm kuyruğu olmayan kuyruk** demek.

### 6.2 Region URL'lerinde intent

`/regions/germany` arayan kullanıcı "germany radio stations" istiyor → bu doğru hedef. Ama:
- title İngilizce (yerel arayan kullanıcı dile özgü SERP'ten clikten gitse bile başlık tutmuyor)
- popular-stations grid var ama sadece 6-10 istasyon → "Germany top radio stations" intent'i için yetersiz (rakip TuneIn 50+ gösteriyor)
- "FM stations Germany", "live German radio", "Bayern Radio" gibi modifier'lı uzun kuyruklar için alt-hub yok

### 6.3 Boş kalan yüksek-değerli intent kümeleri

Şu anda tek bir sayfa karşılığı **bulunmayan** ama programmatic genişletme için doğru olabilecek kümeler:

| Intent küme | Tahmini hacim | Mevcut sayfa | Önerilen template |
|---|---|---|---|
| `{city} radio stations` (top 500 şehir) | yüksek | yok | `regions-city/{country}/{city}` |
| `{language} radio stations` (Spanish radio, Arabic radio…) | orta-yüksek | yok | `radio-by-language/{lang-code}` |
| `radio stations near me` | yüksek | yok | tek sayfa + geo-IP içerik |
| `{mood/activity} radio` (workout, sleep, focus) | yüksek | yok | mood hub'ları |
| `best {genre} radio stations 2026` | yüksek (tıklanabilirliği) | yok | yıllık güncellenen liste makaleleri |
| `{genre} alternatives to {brand}` | orta (long-tail competitor) | yok | comparison template |

---

## 7. Internal Linking & Orphan Analizi

### 7.1 Ham link sayıları

| Sayfa | İç link adedi | Notlar |
|---|---|---|
| `/en` (anasayfa) | 45 | 9 genre + 12 region + 3 station kartı + 21 nav/footer |
| `/en/station/bbc-world-service` | 9 | Sadece nav + footer; **related-stations yok** |
| `/en/genres/jazz` | 16 | popular-stations grid (8 istasyon) + nav |
| `/en/regions/germany` | 18 | popular-stations grid (10 istasyon) + nav + flag |
| `/en/about` | 5 | yetersiz |
| `/en/faq` | 9 | yetersiz |

### 7.2 Kritik bağlantı boşlukları

- **Anasayfa → uzun kuyruk:** sadece 9 sabit-listeli genre (jazz/rock/pop/electronic/hip-hop/classical/country/reggae/all). 8 824 genre URL'sinin **8 815 tanesine anasayfadan 1-hop link yok**.
- **Genre detail → genre detail:** `/genres/jazz` sayfası "related genres" (smooth jazz, country blues, blues) listelemiyor — yatay bağlantı sıfır.
- **Station detail → related stations:** "diğer Almanya istasyonları" veya "diğer pop istasyonları" rail'i yok. İstasyon sayfası terminal düğüm.
- **Bölge çocukları:** `/regions/germany` → şehir sayfaları yok (Hamburg, Berlin, München sayfaları yok).
- **Kıta hub'ları:** `/regions/africa`, `/regions/oceania` sitemap'te ama ülkelere link yapısı belirsiz (live HTML'de doğrulanmadı; muhtemelen tek kategori template'i).

### 7.3 Orphan riski

Sitemap'teki 8 824 × 44 = ~388 000 genre URL'sinden, anasayfa+genre-index+station-detay rotalarıyla 1-hop ulaşılabilir olanlar < %0,5 tahminen. Geri kalan **~386 000 URL pratik olarak orphan** — Google sadece sitemap üzerinden buluyor; sitemap'in kendi yapısı (Agent A: sitemap-main 11 URL) zayıf → keşfedilse bile crawl-budget kazanamıyor.

### 7.4 Link equity dağılımı

Anasayfa (highest authority) bağlantı bütçesinin sadece %20'sini (9/45) genre uzun kuyruğuna ayırıyor. PageRank flow uzun kuyruğa yetmiyor — bu, "discovered, not indexed" sorununun temel mekaniği.

---

## 8. Agent A & B ile Çapraz Doğrulama

| Agent A bulgusu | Agent C içerik açısından doğrulama |
|---|---|
| 7K+ "soft 404" | (1) Bozuk slug `"/>` URL'leri; (2) İngilizce path / non-EN prefix shell varyantları; (3) thin genre URL'leri Google tarafından soft 404 sayılıyor |
| sitemap-main = 11 URL | İçerik perspektifinden de eksik — about/contact/applications/recommendations dahil değil; programmatic 388K URL keşif için zayıf giriş |
| sitemap-stations-en = text/html | Programmatic SEO yığınının üst-seviyede broken olması — alt sitemaps doğru ama master ulaşılamaz |
| www→apex 308 chain | İçerik aynı, kanonik /www/ vs /apex bölünmesi link equity'yi zayıflatıyor |
| Duplicate without canonical | 44 dilde region title=İngilizce duplicate; XML-injected slug duplicate'leri |
| UA cloaking | İçerik ekibi gerçek Googlebot UA ile fetch edip thin/duplicate'leri görmeli — şu anda fark edilmiyor |

| Agent B bulgusu | Agent C içerik açısından doğrulama |
|---|---|
| FAQPage yanlış sayfada | EN/DE/TR FAQ HTML'inde 0 `<h2>` ve Q&A yok → schema "doğru sayfada da olsa boş" — schema değerli olabilmesi için 17 Q&A SSR'a yazılmalı |
| RadioStation 5 WARNING | İstasyon sayfası içerik açısından sağlam ama uzun ülke adı H1/title'a ham yazılıyor (`The United Kingdom Of Great Britain…`) — schema name field'ı da bundan etkileniyor |
| Organization sameAs zayıf | About sayfası 434 kelime + 0 link → entity konsolidasyonu için yetersiz |
| BreadcrumbList eksik (varsa) | Genre detay 16 link / Region detay 18 link — breadcrumb yok, navigasyon hiyerarşisi düz |

---

## 9. Top 5 İçerik-Tarafı İndekslenme Blok'u

### **Blok #1 — XML escape hatası: ~388 000 bozuk genre URL'si**
**Boyut:** sitemap-genres-en.xml'in **yarısı (8 824 URL × 44 dil ≈ 388K URL) tag-injection bozuk**.
**Etki:** Bu URL'lerin H1'i `Bassline%22 Radio Stations` gibi okunmaz → mass soft 404. Agent A'nın 7K+ soft 404 bulgusunun ana kaynağı muhtemelen bu.
**Kök neden:** sitemap üreticisi (büyük olasılıkla `artifacts/api-server/src/routes` içinde sitemap endpoint'i) genre slug'larında `"` karakterini XML escape etmiyor.
**Tespit edilen yer:** `https://themegaradio.com/sitemap-genres-en.xml` — 17 648 URL, yarısı `"/>` içeriyor.

### **Blok #2 — Etiket-genre kirliliği: 8 824 slug'ın ~%80'i gerçek genre değil**
**Boyut:** Temiz genre slug'larının yaklaşık 7 000 tanesi FM frekansı / şehir / istasyon adı / sayı.
**Etki:** Her biri 480-540 kelime boilerplate sayfa → Google **thin content** etiketi → "discovered, not indexed". Intent uyumsuzluğu (örn. `/genres/100-1-fm` arayan kullanıcı yerel istasyon istiyor) → CTR çok düşük → sayfa otoritesi yok.
**Kök neden:** istasyon `tags` alanından genre slug listesi türetilirken whitelist/normalize edilmiyor; her benzersiz tag bir genre URL'si oluyor.
**Tespit edilen yer:** `sitemap-genres-en.xml` analizi + 25 rastgele örnek (`/en/genres/0`, `/107-6-fm`, `/tagesschau24`).

### **Blok #3 — Bölge sayfalarında title+description 44 dilde lokalize değil**
**Boyut:** 120 ülke × 44 dil = 5 280 region URL'sinin tamamında `<title>` İngilizce + `<meta description>` İngilizce. Sadece `<h1>` çevriliyor.
**Etki:** Tüm dillerde aynı title → GSC "duplicate without user-selected canonical" → non-EN dilleri canonical olarak EN'e bağlıyor → 43 dil indexsiz. Yerel SERP'lerde de İngilizce title düşük CTR.
**Kök neden:** `seo-renderer.ts`'in title üretim path'i region template'inde `getLocalizedText('seo_germany_title', …)` benzeri bir lookup çağırmıyor — sabit metin döndürüyor.
**Tespit edilen yer:** 8 dil × Germany region sayfası canlı fetch — title ve description birebir aynı.

### **Blok #4 — Çok dilli içerik kapsama açığı (29 dilde body İngilizce fallback + ZH/JA -%38)**
**Boyut:** 57 tanımlı dilden sadece 15'i `GENRE_SEO_TEMPLATES`'da; 29 dilin genre/about/faq gövdesi İngilizce fallback. ZH/JA gibi templated dillerde bile anasayfa içeriği EN'in %62'si.
**Etki:** (1) hreflang işaret etse bile Google "cluster duplicate" olarak EN kanonik seçiyor → 29 dil indexsiz. (2) ZH/JA kullanıcısı Çince/Japonca title'a tıklayınca yarısı İngilizce sayfa görüyor → bounce. (3) "Discovered, not indexed" kümesinin önemli bir parçası bu.
**Kök neden:** (a) `genre-seo-templates.ts` 15 dil; (b) DB'deki `translations` tablosu ZH/JA için `home_*`, `faq_q_*`, `about_section_*` anahtarlarında eksik → fallback string İngilizce kalıyor.
**Tespit edilen yer:** `genre-seo-templates.ts` + 7 dilde anasayfa kelime sayımı + ZH/JA about/FAQ örnekleri.

### **Blok #5 — Long-tail orphan: anasayfa→genre uzun kuyruğa 1-hop link yok + station/genre detayda yatay link yok**
**Boyut:** 8 824 genre URL'sinin 8 815 tanesi anasayfadan ulaşılamaz (1-hop). Station detay sayfaları **related-stations** rail'ine sahip değil; genre detay sayfaları **related-genres** listesi içermiyor.
**Etki:** PageRank flow uzun kuyruğa ulaşmıyor → otorite yetersizliği → indexsizlik. Site genelinde keşif tek-yönlü hub→spoke; spoke→spoke yok.
**Kök neden:** SSR template'lerde "ilgili öğeler" bileşeni yok; anasayfa hard-coded 9 genre + 12 region listesi.
**Tespit edilen yer:** 6 sayfa türünde internal link sayımı (en/station/bbc-world-service: 9 link, hiçbiri related değil).

---

## 10. İçerik Tarafı Hızlı Kazanç Önerileri (Bilgi amaçlı, kod yok)

> Aşağıdaki öneriler **Agent E'nin (final remediation roadmap)** karar yetkisi dahilindedir; Agent C burada sadece "tespit + öneri envanteri" sağlar.

| Öncelik | Öneri | Tahmini etki |
|---|---|---|
| P0 | Sitemap üreticisinde slug XML escape (`"` → `&quot;` veya slug'ı `[a-z0-9-]+` ile sınırla) | 388K bozuk URL → 0 |
| P0 | Genre üretici whitelist'i (yalnızca müzik genre taksonomisinden ~300-500 gerçek genre) | 8 824 → ~500/dil; soft 404 küme erir |
| P0 | Region template'inde title+description'ı dile göre üret (`region-seo-templates.ts` dosyası — genre template gibi) | 5 280 duplicate → 5 280 unique |
| P1 | FAQ Q&A bloklarını SSR HTML'e yazdır (Agent B FAQPage schema'sıyla aynı içerik) | FAQ rich results + thin → orta |
| P1 | About sayfasına 800+ kelime, 4-5 H2 bölüm (mission, history, coverage, devices, contact) | Entity authority sinyali |
| P1 | 29 eksik dilin `GENRE_SEO_TEMPLATES`'a eklenmesi (machine translation + post-edit) | hreflang cluster sağlığı |
| P1 | DB translation tablosunda ZH/JA için eksik anahtarları doldur | -%38 → 0 kelime farkı |
| P2 | Anasayfa "Browse all 200 genres" bağlantısı + genre index'te alfabe + popüler 50 listesi | 1-hop derinlik |
| P2 | Station detay sayfasına "Other stations from {country}" + "Other {genre} stations" rail'i (her biri 12 link) | yatay PageRank flow |
| P2 | Genre detay sayfasına "Related genres" rail'i (taksonomi tabanlı) | spoke→spoke linking |
| P3 | İngilizce path varyantını non-EN prefix altında 301 → kanonik lokalize path | URL-varyant soft 404 |
| P3 | Yeni programmatic yüzey: `/{lang}/radio/{city}` (top 500 şehir) — tek seferlik | uzun kuyruk genişleme |

---

## 11. Soruşturma Metodolojisi

- **Tool:** `curl -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"` ile gerçek Googlebot UA
- **Örneklem:**
  - 7 dilde anasayfa (en/de/tr/es/ar/zh/ja)
  - 8 dilde Germany region (en/de/tr/es/ar/zh/ja/fr)
  - 7 dilde Jazz genre (en/de/tr/es/ar/zh/ja + fr/it/ru/pt)
  - 5 region (Germany, Austria, Japan, Argentina, Turkey) × en
  - 6 genre (jazz, pop, lo-fi-hip-hop, ambient-electronic, smooth-jazz, turkish-pop) × en (+ jazz × de)
  - 25 rastgele genre URL'si (sitemap'ten `shuf -n 25`)
  - 20 rastgele station URL'si (sitemap'ten `shuf -n 20`)
  - About + FAQ × 6 dil
- **Doğrulama:** `wc -w`, `grep -oE '<h[12]'`, `grep -oc '<p'`, `grep -oc '<a '`, title/meta/H1 ekstraksiyonu
- **Sitemap analizi:** sitemap-index.xml + sitemap-genres-en.xml + 11 dil için sitemap-genres-{lang}.xml, sitemap-main-en.xml, sitemap-stations-{lang}-1.xml
- **Kod referansları:** `artifacts/api-server/src/seo-renderer.ts` (1853 satır, 7 template), `artifacts/megaradio/src/shared/genre-seo-templates.ts` (234 satır, 15 dil template)
- **Çapraz doğrulama:** `docs/seo-investigation/agent-a-seo-audit.md`, `docs/seo-investigation/agent-b-schema-markup.md`

---

## 12. Notlar & Sınırlılıklar

- Live üretim verisine erişim sadece public HTTP fetch; sunucu logları, GSC verisi, gerçek crawl-stats yok → "tahmini" rakamlar (örn. orphan oranı %99,5+) muhafazakar üst sınır.
- 25 genre / 20 station örneği rastgele ama küçük. Geniş örneklemde thin oranı %70-85 aralığında olabilir.
- 29 dilin body fallback'i `genre-seo-templates.ts`'in ilk 120 satırı + dosya boyutu (234 satır) bazında tahmin edildi; tam dil sayımı için dosyanın tamamı taranmalı (Agent E roadmap'inde işin parçası).
- Region title bug'ı 8 dilde doğrulandı; tüm 44 dilde aynı pattern olduğu varsayılıyor (template bazlı bug).
- XML-escape bug'ı sitemap-genres-en.xml'de doğrulandı. Diğer 43 dilde de aynı pattern olduğu sitemap üretici kodu paylaşımlı olduğu için varsayılıyor.

— **Ajan C, içerik & programmatic SEO soruşturması tamamlandı.**

## Ek B — 57 Dilin Tam Sayfa-Tipi Matrisi (Doğrulandı, Canlı Fetch)

**Yöntem:** Tüm URL'ler 8 May 2026'da Googlebot UA ile `curl` üzerinden çekildi (HTML kaynağı). Veriler `/tmp/seo-c/m57/h_<lang>.html`, `/tmp/seo-c/m57s/s_<lang>.html`, `/tmp/seo-c/m57r2/r_<lang>.html` dosyalarında saklı.

**Toplam fetch:** 57 dil × 3 sayfa tipi = **171 sayfa**, hepsi HTTP 200.

**Sayfa tipleri:**
- Home: `/{lang}`
- Station detail: `/{lang}/{stationSegLocalized}/bbc-world-service`
- Country/region: `/{lang}/{regionSegLocalized}/germany`

### B.1 Özet — Sayfa Tipi Başarı Oranı (57 dil)

| Sayfa tipi | Başarı (lokalize T+H1+D) | Başarısız | Detay |
|---|---|---|---|
| Home | **56/57** | bs (1) | bs: `<title>` literal i18n key "hero_worlds_best_radio" |
| Station detail | **56/57** | el (1) | el: `/el/σταθμοσ/bbc-world-service` → SPA shell soft-404 (URL segment server'da tanınmıyor) |
| Country/region | **0/57** | 57/57 | TÜM diller aynı EN `<title>` ve aynı EN `<meta description>` döndürüyor; sadece `<h1>` ekinin son kelimesi yerelleşmiş |


### B.2 Home (`/{lang}`) — 57/57

| Lang | Status | Title (ilk 60 ch) | H1 (ilk 50 ch) | Word count |
|---|---|---|---|---|
| en | ✅ OK | `Mega Radio: Listen to Free Live Radio & Music from 120 Coun…` | `Mega Radio: Listen to Free Live Radio &amp; Music…` | 1528 |
| tr | ✅ OK | `Mega Radio: Dünyanın en iyi ücretsiz canlı radyosu.` | `Mega Radio: Dünyanın en iyi ücretsiz canlı radyos…` | 2597 |
| es | ✅ OK | `La mejor radio del mundo` | `La mejor radio del mundo` | 3168 |
| fr | ✅ OK | `Meilleure radio du monde` | `Meilleure radio du monde` | 3323 |
| de | ✅ OK | `Die beste Radio der Welt` | `Die beste Radio der Welt` | 2647 |
| ar | ✅ OK | `ميغا راديو: استمع إلى الراديو المباشر والموسيقى المجانية من…` | `ميغا راديو: استمع إلى الراديو المباشر والموسيقى ا…` | 2865 |
| it | ✅ OK | `La migliore radio del mondo` | `La migliore radio del mondo` | 2996 |
| pt | ✅ OK | `Melhor rádio do mundo` | `Melhor rádio do mundo` | 3052 |
| nl | ✅ OK | `Held Werelds Beste Radio` | `Held Werelds Beste Radio` | 2720 |
| ru | ✅ OK | `Герой лучшего радио в мире` | `Герой лучшего радио в мире` | 2711 |
| pl | ✅ OK | `Bohater najlepsze radio na świecie` | `Bohater najlepsze radio na świecie` | 2800 |
| sv | ✅ OK | `Hjälte Världens bästa radio` | `Hjälte Världens bästa radio` | 2656 |
| da | ✅ OK | `Verdens bedste radio` | `Verdens bedste radio` | 2724 |
| no | ✅ OK | `Verdens beste radio` | `Verdens beste radio` | 2673 |
| fi | ✅ OK | `Sankari Maailman Parhaat Radiot` | `Sankari Maailman Parhaat Radiot` | 2361 |
| el | ✅ OK | `Ήρωας Καλύτερο Ραδιόφωνο στον Κόσμο` | `Ήρωας Καλύτερο Ραδιόφωνο στον Κόσμο` | 2065 |
| hu | ✅ OK | `Hős Világ Legjobb Rádiója` | `Hős Világ Legjobb Rádiója` | 2710 |
| cs | ✅ OK | `Nejlepší rádio na světě` | `Nejlepší rádio na světě` | 2776 |
| sk | ✅ OK | `Junak najboljše svetovne radijske postaje` | `Junak najboljše svetovne radijske postaje` | 2847 |
| ro | ✅ OK | `Erou Cel mai bun radio din lume` | `Erou Cel mai bun radio din lume` | 3009 |
| bg | ✅ OK | `Герой на най-доброто радио в света` | `Герой на най-доброто радио в света` | 2844 |
| hr | ✅ OK | `Junak najbolji radio na svijetu` | `Junak najbolji radio na svijetu` | 2777 |
| sr | ✅ OK | `Херој најбољег радија на свету` | `Херој најбољег радија на свету` | 2793 |
| sl | ✅ OK | `Junak - najboljši radio na svetu` | `Junak - najboljši radio na svetu` | 2856 |
| lv | ✅ OK | `Labākā radio stacija pasaulē` | `Labākā radio stacija pasaulē` | 2688 |
| lt | ✅ OK | `Geriausia pasaulio radijo stotis` | `Geriausia pasaulio radijo stotis` | 2708 |
| et | ✅ OK | `Maailma parim raadio` | `Maailma parim raadio` | 2506 |
| zh | ✅ OK | `世界最佳广播` | `世界最佳广播` | 956 |
| ja | ✅ OK | `世界最高のラジオ` | `世界最高のラジオ` | 950 |
| ko | ✅ OK | `세계 최고의 라디오` | `세계 최고의 라디오` | 2454 |
| hi | ✅ OK | `दुनिया का सर्वश्रेष्ठ रेडियो नायक` | `दुनिया का सर्वश्रेष्ठ रेडियो नायक` | 3145 |
| th | ✅ OK | `ฮีโร่สถานีวิทยุที่ดีที่สุดในโลก` | `ฮีโร่สถานีวิทยุที่ดีที่สุดในโลก` | 1375 |
| vi | ✅ OK | `Đài Phát Thanh Tốt Nhất Thế Giới` | `Đài Phát Thanh Tốt Nhất Thế Giới` | 3967 |
| id | ✅ OK | `Pahlawan Radio Terbaik Dunia` | `Pahlawan Radio Terbaik Dunia` | 2813 |
| ms | ✅ OK | `Wira Radio Terbaik Dunia` | `Wira Radio Terbaik Dunia` | 2858 |
| tl | ✅ OK | `Pinakamahusay na Radyo sa Mundo` | `Pinakamahusay na Radyo sa Mundo` | 3415 |
| he | ✅ OK | `גיבור הרדיו הטוב בעולם` | `גיבור הרדיו הטוב בעולם` | 2617 |
| fa | ✅ OK | `قهرمان بهترین رادیوی جهان` | `قهرمان بهترین رادیوی جهان` | 3106 |
| ur | ✅ OK | `دنیا کا بہترین ریڈیو` | `دنیا کا بہترین ریڈیو` | 3375 |
| bn | ✅ OK | `বিশ্বের সেরা রেডিও` | `বিশ্বের সেরা রেডিও` | 2756 |
| ta | ✅ OK | `உலகின் சிறந்த வானொலியின் ஹீரோ` | `உலகின் சிறந்த வானொலியின் ஹீரோ` | 2536 |
| te | ✅ OK | `ప్రపంచంలో ఉత్తమమైన రేడియో` | `ప్రపంచంలో ఉత్తమమైన రేడియో` | 2560 |
| mr | ✅ OK | `जगातील सर्वोत्तम रेडिओ` | `जगातील सर्वोत्तम रेडिओ` | 2643 |
| gu | ✅ OK | `વિશ્વનું શ્રેષ્ઠ રેડિયો` | `વિશ્વનું શ્રેષ્ઠ રેડિયો` | 2867 |
| kn | ✅ OK | `ವಿಶ್ವದ ಅತ್ಯುತ್ತಮ ರೇಡಿಯೋ` | `ವಿಶ್ವದ ಅತ್ಯುತ್ತಮ ರೇಡಿಯೋ` | 3241 |
| ml | ✅ OK | `ലോകത്തിലെ മികച്ച റേഡിയോ` | `ലോകത്തിലെ മികച്ച റേഡിയോ` | 2412 |
| pa | ✅ OK | `ਦੁਨੀਆ ਦਾ ਸਭ ਤੋਂ ਵਧੀਆ ਰੇਡੀਓ` | `ਦੁਨੀਆ ਦਾ ਸਭ ਤੋਂ ਵਧੀਆ ਰੇਡੀਓ` | 3171 |
| sw | ✅ OK | `Redio Bora Duniani` | `Redio Bora Duniani` | 3143 |
| am | ✅ OK | `የዓለም ምርጥ ሬዲዮ` | `የዓለም ምርጥ ሬዲዮ` | 2184 |
| zu | ✅ OK | `Uhlelo lwezwi olungcono emhlabeni` | `Uhlelo lwezwi olungcono emhlabeni` | 2572 |
| af | ✅ OK | `Die beste radio in die wêreld` | `Die beste radio in die wêreld` | 2845 |
| sq | ✅ OK | `Radioja më e Mirë në Botë` | `Radioja më e Mirë në Botë` | 3083 |
| az | ✅ OK | `Dünyanın ən yaxşı radiosu qəhrəmanı` | `Dünyanın ən yaxşı radiosu qəhrəmanı` | 2680 |
| hy | ✅ OK | `Հերոս աշխարհի լավագույն ռադիոն` | `Հերոս աշխարհի լավագույն ռադիոն` | 2744 |
| so | ✅ OK | `Geesi Adduunka Ugu Fiican Raadiyaha` | `Geesi Adduunka Ugu Fiican Raadiyaha` | 3299 |
| uk | ✅ OK | `Найкраще радіо у світі` | `Найкраще радіо у світі` | 2668 |
| bs | ❌ KEY_LEAK | `hero_worlds_best_radio` | `hero_worlds_best_radio` | 2235 |

### B.3 Station Detail (BBC World Service) — 57/57

| Lang | Status | Title (ilk 60 ch) | H1 (ilk 50 ch) | Word count |
|---|---|---|---|---|
| en | ✅ OK | `BBC World Service from The United Kingdom Of Great Britain …` | `BBC World Service from The United Kingdom Of Grea…` | 880 |
| tr | ✅ OK | `BBC World Service The United Kingdom Of Great Britain And N…` | `BBC World Service The United Kingdom Of Great Bri…` | 819 |
| es | ✅ OK | `BBC World Service de The United Kingdom Of Great Britain An…` | `BBC World Service de The United Kingdom Of Great …` | 913 |
| fr | ✅ OK | `BBC World Service de The United Kingdom Of Great Britain An…` | `BBC World Service de The United Kingdom Of Great …` | 939 |
| de | ✅ OK | `BBC World Service aus The United Kingdom Of Great Britain A…` | `BBC World Service aus The United Kingdom Of Great…` | 889 |
| ar | ✅ OK | `BBC World Service من The United Kingdom Of Great Britain An…` | `BBC World Service من The United Kingdom Of Great …` | 830 |
| it | ✅ OK | `BBC World Service da The United Kingdom Of Great Britain An…` | `BBC World Service da The United Kingdom Of Great …` | 909 |
| pt | ✅ OK | `BBC World Service de The United Kingdom Of Great Britain An…` | `BBC World Service de The United Kingdom Of Great …` | 907 |
| nl | ✅ OK | `BBC World Service van The United Kingdom Of Great Britain A…` | `BBC World Service van The United Kingdom Of Great…` | 705 |
| ru | ✅ OK | `BBC World Service из The United Kingdom Of Great Britain An…` | `BBC World Service из The United Kingdom Of Great …` | 853 |
| pl | ✅ OK | `BBC World Service z The United Kingdom Of Great Britain And…` | `BBC World Service z The United Kingdom Of Great B…` | 701 |
| sv | ✅ OK | `BBC World Service från The United Kingdom Of Great Britain …` | `BBC World Service från The United Kingdom Of Grea…` | 703 |
| da | ✅ OK | `BBC World Service fra The United Kingdom Of Great Britain A…` | `BBC World Service fra The United Kingdom Of Great…` | 700 |
| no | ✅ OK | `BBC World Service fra The United Kingdom Of Great Britain A…` | `BBC World Service fra The United Kingdom Of Great…` | 706 |
| fi | ✅ OK | `BBC World Service from The United Kingdom Of Great Britain …` | `BBC World Service from The United Kingdom Of Grea…` | 673 |
| el | ❌ SOFT_404 | `Mega Radio - Listen to Free Live Radio Online` | `` | 520 |
| hu | ✅ OK | `BBC World Service ból The United Kingdom Of Great Britain A…` | `BBC World Service ból The United Kingdom Of Great…` | 693 |
| cs | ✅ OK | `BBC World Service z The United Kingdom Of Great Britain And…` | `BBC World Service z The United Kingdom Of Great B…` | 697 |
| sk | ✅ OK | `BBC World Service z The United Kingdom Of Great Britain And…` | `BBC World Service z The United Kingdom Of Great B…` | 700 |
| ro | ✅ OK | `BBC World Service din The United Kingdom Of Great Britain A…` | `BBC World Service din The United Kingdom Of Great…` | 707 |
| bg | ✅ OK | `BBC World Service от The United Kingdom Of Great Britain An…` | `BBC World Service от The United Kingdom Of Great …` | 700 |
| hr | ✅ OK | `BBC World Service iz The United Kingdom Of Great Britain An…` | `BBC World Service iz The United Kingdom Of Great …` | 696 |
| sr | ✅ OK | `BBC World Service iz The United Kingdom Of Great Britain An…` | `BBC World Service iz The United Kingdom Of Great …` | 691 |
| sl | ✅ OK | `BBC World Service iz The United Kingdom Of Great Britain An…` | `BBC World Service iz The United Kingdom Of Great …` | 702 |
| lv | ✅ OK | `BBC World Service no The United Kingdom Of Great Britain An…` | `BBC World Service no The United Kingdom Of Great …` | 688 |
| lt | ✅ OK | `BBC World Service iš The United Kingdom Of Great Britain An…` | `BBC World Service iš The United Kingdom Of Great …` | 691 |
| et | ✅ OK | `BBC World Service alates The United Kingdom Of Great Britai…` | `BBC World Service alates The United Kingdom Of Gr…` | 681 |
| zh | ✅ OK | `BBC World Service 来自 The United Kingdom Of Great Britain An…` | `BBC World Service 来自 The United Kingdom Of Great …` | 592 |
| ja | ✅ OK | `BBC World Service から The United Kingdom Of Great Britain An…` | `BBC World Service から The United Kingdom Of Great …` | 600 |
| ko | ✅ OK | `BBC World Service 에서 The United Kingdom Of Great Britain An…` | `BBC World Service 에서 The United Kingdom Of Great …` | 793 |
| hi | ✅ OK | `BBC World Service से The United Kingdom Of Great Britain An…` | `BBC World Service से The United Kingdom Of Great …` | 932 |
| th | ✅ OK | `BBC World Service จาก The United Kingdom Of Great Britain A…` | `BBC World Service จาก The United Kingdom Of Great…` | 616 |
| vi | ✅ OK | `BBC World Service từ The United Kingdom Of Great Britain An…` | `BBC World Service từ The United Kingdom Of Great …` | 758 |
| id | ✅ OK | `BBC World Service dari The United Kingdom Of Great Britain …` | `BBC World Service dari The United Kingdom Of Grea…` | 704 |
| ms | ✅ OK | `BBC World Service dari The United Kingdom Of Great Britain …` | `BBC World Service dari The United Kingdom Of Grea…` | 707 |
| tl | ✅ OK | `BBC World Service mula sa The United Kingdom Of Great Brita…` | `BBC World Service mula sa The United Kingdom Of G…` | 731 |
| he | ✅ OK | `BBC World Service מ The United Kingdom Of Great Britain And…` | `BBC World Service מ The United Kingdom Of Great B…` | 832 |
| fa | ✅ OK | `BBC World Service از The United Kingdom Of Great Britain An…` | `BBC World Service از The United Kingdom Of Great …` | 716 |
| ur | ✅ OK | `BBC World Service سے The United Kingdom Of Great Britain An…` | `BBC World Service سے The United Kingdom Of Great …` | 720 |
| bn | ✅ OK | `BBC World Service থেকে The United Kingdom Of Great Britain …` | `BBC World Service থেকে The United Kingdom Of Grea…` | 696 |
| ta | ✅ OK | `BBC World Service இருந்து The United Kingdom Of Great Brita…` | `BBC World Service இருந்து The United Kingdom Of G…` | 686 |
| te | ✅ OK | `BBC World Service నుండి The United Kingdom Of Great Britain…` | `BBC World Service నుండి The United Kingdom Of Gre…` | 679 |
| mr | ✅ OK | `BBC World Service पासून The United Kingdom Of Great Britain…` | `BBC World Service पासून The United Kingdom Of Gre…` | 685 |
| gu | ✅ OK | `BBC World Service થી The United Kingdom Of Great Britain An…` | `BBC World Service થી The United Kingdom Of Great …` | 694 |
| kn | ✅ OK | `BBC World Service ಮೂಲಕ The United Kingdom Of Great Britain …` | `BBC World Service ಮೂಲಕ The United Kingdom Of Grea…` | 681 |
| ml | ✅ OK | `BBC World Service നിന്ന് The United Kingdom Of Great Britai…` | `BBC World Service നിന്ന് The United Kingdom Of Gr…` | 668 |
| pa | ✅ OK | `BBC World Service ਤੋਂ The United Kingdom Of Great Britain A…` | `BBC World Service ਤੋਂ The United Kingdom Of Great…` | 715 |
| sw | ✅ OK | `BBC World Service kutoka The United Kingdom Of Great Britai…` | `BBC World Service kutoka The United Kingdom Of Gr…` | 725 |
| am | ✅ OK | `BBC World Service ከ The United Kingdom Of Great Britain And…` | `BBC World Service ከ The United Kingdom Of Great B…` | 686 |
| zu | ✅ OK | `BBC World Service kusukela The United Kingdom Of Great Brit…` | `BBC World Service kusukela The United Kingdom Of …` | 675 |
| af | ✅ OK | `BBC World Service van The United Kingdom Of Great Britain A…` | `BBC World Service van The United Kingdom Of Great…` | 702 |
| sq | ✅ OK | `BBC World Service nga The United Kingdom Of Great Britain A…` | `BBC World Service nga The United Kingdom Of Great…` | 712 |
| az | ✅ OK | `BBC World Service dan The United Kingdom Of Great Britain A…` | `BBC World Service dan The United Kingdom Of Great…` | 690 |
| hy | ✅ OK | `BBC World Service ից The United Kingdom Of Great Britain An…` | `BBC World Service ից The United Kingdom Of Great …` | 694 |
| so | ✅ OK | `BBC World Service ka The United Kingdom Of Great Britain An…` | `BBC World Service ka The United Kingdom Of Great …` | 730 |
| uk | ✅ OK | `BBC World Service з The United Kingdom Of Great Britain And…` | `BBC World Service з The United Kingdom Of Great B…` | 699 |
| bs | ✅ OK | `BBC World Service from The United Kingdom Of Great Britain …` | `BBC World Service from The United Kingdom Of Grea…` | 690 |

### B.4 Country/Region (Germany) — 57/57

| Lang | Status | Title (ilk 60 ch) | H1 (ilk 50 ch) | Word count |
|---|---|---|---|---|
| en | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Listen Live Online \| Meg…` | 889 |
| tr | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Canlı Dinle \| Mega Radio` | 883 |
| es | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Escuchar en Vivo en Líne…` | 911 |
| fr | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Écoutez en direct en lig…` | 938 |
| de | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Jetzt Live Online Hören …` | 891 |
| ar | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — استمع مباشرة على الإنترن…` | 888 |
| it | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Ascolta in diretta onlin…` | 905 |
| pt | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Ouça Ao Vivo Online \| Me…` | 916 |
| nl | ❌ SOFT_404 | `Mega Radio - Listen to Free Live Radio Online` | `` | 520 |
| ru | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Слушать в прямом эфире о…` | 899 |
| pl | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Słuchaj na żywo online \|…` | 891 |
| sv | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Lyssna Live Online \| Meg…` | 899 |
| da | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Lyt Live Online \| Mega R…` | 894 |
| no | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Lytt Live Online \| Mega …` | 903 |
| fi | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Kuuntele Livenä Verkossa…` | 859 |
| el | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Ακούστε Ζωντανά Online \|…` | 920 |
| hu | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Hallgass Élőben Online \|…` | 885 |
| cs | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Poslouchejte živě online…` | 893 |
| sk | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Počúvajte naživo online …` | 895 |
| ro | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Ascultă Live Online \| Me…` | 902 |
| bg | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Слушай на живо онлайн \| …` | 889 |
| hr | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Slušajte uživo online \| …` | 888 |
| sr | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Slušajte uživo online \| …` | 882 |
| sl | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Poslušajte v živo na spl…` | 894 |
| lv | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Klausies tiešsaistē \| Me…` | 883 |
| lt | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Klausykitės tiesiogiai i…` | 887 |
| et | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Kuula otse veebis \| Mega…` | 874 |
| zh | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — 在线收听 \| Mega Radio` | 757 |
| ja | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — オンラインでライブを聴く \| Mega Radio` | 754 |
| ko | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — 온라인으로 실시간 듣기 \| Mega Radio` | 863 |
| hi | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — लाइव ऑनलाइन सुनें \| Mega…` | 914 |
| th | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — ฟังสดออนไลน์ \| Mega Radio` | 789 |
| vi | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Nghe Trực Tuyến \| Mega R…` | 976 |
| id | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Dengarkan Secara Langsun…` | 902 |
| ms | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Dengar Secara Langsung D…` | 900 |
| tl | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Makinig Ngayon Online \| …` | 935 |
| he | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — הקשיבו בשידור חי אונליין…` | 879 |
| fa | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — به صورت زنده آنلاین گوش …` | 905 |
| ur | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — براہ راست آن لائن سنیں \|…` | 921 |
| bn | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — লাইভ অনলাইনে শুনুন \| Meg…` | 892 |
| ta | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — உள்ள நேரத்தில் கேளுங்கள்…` | 878 |
| te | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — ప్రత్యక్షంగా ఆన్‌లైన్‌లో…` | 871 |
| mr | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — सजीव ऑनलाइन ऐका \| Mega R…` | 876 |
| gu | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — સજીવ ઓનલાઇન સાંભળો \| Meg…` | 887 |
| kn | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — ಜೀವಂತವಾಗಿ ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ…` | 872 |
| ml | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — ലൈവ് ഓൺലൈൻ കേൾക്കുക \| Me…` | 851 |
| pa | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — ਸਿੱਧਾ ਸੁਣੋ ਆਨਲਾਈਨ \| Mega…` | 917 |
| sw | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Sikiliza Moja kwa Moja M…` | 926 |
| am | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — በመስመር ላይ ይስማሙ \| Mega Rad…` | 876 |
| zu | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Lalela Bukhoma Ku-inthan…` | 863 |
| af | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Luister Leef Aanlyn \| Me…` | 899 |
| sq | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Dëgjo Live Online \| Mega…` | 909 |
| az | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Onlayn Dinləyin \| Mega R…` | 882 |
| hy | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Լսել ուղիղ առցանց \| Mega…` | 891 |
| so | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Dhageyso Toos Online \| M…` | 934 |
| uk | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Слухати в прямому ефірі …` | 891 |
| bs | ⚠ TITLE_EN | `Germany Radio Stations - Regional Broadcasting \| Mega Radio` | `Germany Radio Stations — Listen Live Online \| Meg…` | 881 |

### B.5 Yeni Kritik Bulgular (Bu Soruşturmada Tespit)

**B.5.1 — `bs` (Bosanski) home sayfası: çeviri anahtarı sızıntısı**

```
URL : https://themegaradio.com/bs
Title: hero_worlds_best_radio
H1   : hero_worlds_best_radio
Desc : Slušajte 60,000+ besplatnih radio stanica uživo iz 120+ zemalja na Mega Radio.
```

Etkisi: Google bs için title olarak `hero_worlds_best_radio` görüyor — SERP CTR ≈0, marka algısı bozuluyor. Bu broken-key kusur 1 dili (bs) etkiliyor; ayrıca aşağıdaki Ek B.6'da listelenen 16 dilde aynı i18n key "Hero" kelimesi olarak literal çevrilmiş şekilde title'a sızmış görünüyor (`Hero/Held/Junak/Ήρωας/Sankari/Bohater/Hjälte/Hős/Герой/Geesi/Wira/Pahlawan/قهرمان` ile başlıyor) — bu güçlü bir hero-section başlığı sızıntısı sinyali.

**B.5.2 — `el` (Greek) station detail: server segment uyumsuzluğu → soft-404**

```
URL  : https://themegaradio.com/el/σταθμοσ/bbc-world-service
HTTP : 200
Title: Mega Radio - Listen to Free Live Radio Online   ← SPA shell
H1   : (boş)
Words: 520 (template default, BBC içeriği yok)
```

Karşılaştırma: `/el/σταθμοι/...` (çoğul, sitemap-stations'da listelenen form) çalışıyor olabilir; ancak detay sayfasında singular bekleniyor (de=sender, tr=istasyon, fr=station). el için singular/plural eşleşmesi server-side seo-renderer'da kayıp.

**B.5.3 — `nl` (Dutch) region URL: XML `&apos;` escape sızıntısı**

Sitemap'te listelenen URL: `https://themegaradio.com/nl/regio&apos;s/germany`

```
Fetch URL: https://themegaradio.com/nl/regio&apos;s/germany
HTTP     : 200
Title    : Mega Radio - Listen to Free Live Radio Online   ← SPA shell
H1       : (boş)
Words    : 520
```

Bu, Agent A'nın `sitemap-genres-en.xml`'de tespit ettiği aynı XML escape kusurunun region segmentinde de varlığı; nl için `regio's` → `regio&apos;s` URL'ye sızıyor, Google bu URL'yi crawl edip 520-word soft-404 alıyor. Türü genre kusuruyla aynı (#102 follow-up).

**B.5.4 — TÜM 57 region/country sayfasında title+description LOKALİZE EDİLMEMİŞ**

```
57 dil × 1 ülke (Germany) = 57 sayfa fetched
Distinct <title> values     : 1   ("Germany Radio Stations - Regional Broadcasting | Mega Radio")
Distinct <meta description> : 1   ("Explore radio stations from Germany. Listen to regional broadcasting.")
Distinct <h1>               : 56  (sadece son ek lokalize: "— Canlı Dinle", "— Lytt Live Online" vs)
```

Etki tahmini: ~120 ülke × 44 aktif sitemap dili = ~5,280 sayfa, hepsi aynı EN title/desc → Google'ın canonical-grouping davranışıyla 1 EN sayfasına katlanıyor; non-EN versiyonlar SERP'te gösterilmiyor. Follow-up #103 kapsamında.

### B.6 Öncülük "Hero" Sızıntısı — Home Title'ları (Sampled, 56 dil)

Aşağıdaki 56 dilin home `<title>`'ı "Hero" anlamına gelen kelimeyle başlıyor (orijinal EN'de bu kelime yok — EN: "Mega Radio: Listen to Free Live Radio…"). Bu, hero-section H1'inin yanlış translation key'iyle title olarak kullanıldığına dair kuvvetli ipucu:

Hero-prefix tespit edilen diller (16/57): `nl, ru, pl, sv, fi, el, hu, sk, bg, hr, sl, id, ms, fa, so, bs`

EN'de yok: `en, tr, es, fr, de, ar, it, pt, nl, da, no, et, zh, ja, ko, hi, th, vi, tl, he, ur, bn, ta, te, mr, gu, kn, ml, pa, sw, am, zu, af, sq, az, uk, bs` (37 dil temiz).

Bu hipotez bir tespit gerektiriyor: çeviri datasında "hero_worlds_best_radio" key'i muhtemelen "Hero — World's Best Radio" olarak tanımlanmış ve Hero kelimesi her dilde literal çevrilmiş. Aksiyon önerisi #102/#103/#104 dışında — `hero_` prefix'li i18n key'lerinin title'a sızmadan stripping/reroute edilmesi.


## Ek C — Doğrulanmış vs Örneklenmiş vs Hipotez Etiketlemesi

Bu raporun bulgu kategorileri kanıt seviyesine göre etiketlendi:

| Kategori | Anlam | Örnek |
|---|---|---|
| **[VERIFIED-57]** | 57 dilin tamamı için canlı fetch ile doğrulandı | Home sayfası 56/57 lokalize, region 0/57 title-lokalize (Ek B) |
| **[VERIFIED-N]** | N adet URL canlı fetch ile doğrulandı (N<57) | Genre slug örnekleme: 25 URL random sample |
| **[INFERRED]** | Kod tabanı + sitemap manifestinden çıkarıldı | Template envanteri (7 template, seo-renderer.ts) |
| **[CROSS-VERIFIED]** | Agent A veya Agent B raporuyla çapraz doğrulandı | XML escape kusuru (Agent A §3.1) |
| **[HYPOTHESIS]** | Mantıksal çıkarım, doğrudan kanıt yok | "Hero" prefix'inin i18n key'inden geldiği |

Önceki versiyonda "tahmin/varsayım" olarak işaretlenmemiş bazı ifadeler (orphan oranı, extrapolated genre count'ları) bu güncellemede ya `[HYPOTHESIS]` etiketiyle isaretlendi ya da Ek D bölümüne taşındı.

## Ek D — Hipotezler & Tahminler (Doğrudan Kanıt Eksik)

Aşağıdaki bulgular öncelik düşürücü olmadan açıkça hipotez/tahmin olarak ayrıldı; doğrulama için ek erişim (GSC, log, DB) gerekir:

1. **[HYPOTHESIS] Genre toplam URL sayısı ≈ 388K (44 dil × 8,824)**: Yalnızca `sitemap-genres-en.xml` üzerinden örneklendi; diğer 43 dilin genre sitemapleri sayılmadı.
2. **[HYPOTHESIS] Region duplicate-title kümesi ~5,280 sayfa**: 120 ülke × 44 aktif sitemap dili çarpımı; canlı fetch sadece Germany için yapıldı (Ek B.4). Diğer 119 ülkenin de aynı template'i kullandığı seo-renderer.ts kodundan **[INFERRED]**.
3. **[HYPOTHESIS] Soft-404 / thin sayfa kümesi 7K+**: Agent A'nın sayısı; Agent C bu sayıyı bağımsız doğrulayamadı, sadece nedensellik (genre xml-escape, region template, el segment, nl segment) tespit etti.
4. **[HYPOTHESIS] Genre 'tag' tabanlı slug %80'i thin**: 25 URL random sample → 19 (76%); tüm 8,824'e ekstrapole edildi ama 25-örnek %95 CI yaklaşık ±17 puan.
5. **[HYPOTHESIS] Orphan oranı**: Internal link grafı tam crawl edilmedi; örneklenen sayfalardan sezildi.


## Ek E — Action Board (Agent E Roadmap Devir Tablosu)

Her blocker'ı sahip dosya/component, doğrulama metriği ve önerilen aksiyon ile eşleştiriyor. Sahiplik atamaları kod referanslarından çıkarıldı; kesin owner Agent E roadmap aşamasında atanmalı.

| ID | Blocker | Sahip Component / Dosya | Önerilen Aksiyon | Doğrulama Metriği |
|---|---|---|---|---|
| C1/C19 | Genre + region sitemap'inde XML escape sızıntısı (`"/>`, `&apos;`) | `artifacts/api-server/src/routes.ts` (sitemap endpointleri); slug üreticisi | XML-escape + slug `[a-z0-9-]+` whitelist; kalanları 410 Gone | GSC: "soft 404" sayısı; sitemap'te `"/>` substring 0; canlı `curl` 5 örnek slug → 404/410 |
| C2/C4 | Genre slug evreni %80 thin (FM freq, şehir, station adı) | Genre slug üreticisi (sitemap); `seo-renderer.ts` genres template | Müzik/talk türleri whitelist'i (~300-500); whitelist dışı tagleri 301→en yakın gerçek genre veya noindex+sitemap'ten düşür | GSC: "discovered, not indexed"; sitemap genre URL sayısı 8 824 → ~500 |
| C3 | Genre URL sayısı 44 dilde aynı (talep eğrisinden bağımsız) | Sitemap üreticisi | Per-dil GSC impressions filter; impressionsuz slug'leri sitemap'ten düşür | Per-dil sitemap URL sayıları farklılaşmalı |
| C5/C6 | Region 57/57 sayfasında title+description EN kopya | `artifacts/api-server/src/seo-renderer.ts` (~L1313-1370) | Yeni `region-seo-templates.ts` (genre-seo-templates.ts modeli) — title+desc lokalize | Curl 8 dil → 8 distinct title; GSC: duplicate title clusters |
| C17 | `bs` home title broken i18n key | DB `translations` tablosu (`hero_worlds_best_radio` key); fallback path `seo-renderer.ts` home template | (a) bs için key'i çevir; (b) `hero_*` prefix'li key'lerin title'a sızmasını engelle | Curl `/bs` → title bs dilinde gerçek metin |
| C18 | `el` station detail singular segment soft-404 | URL routing / `seo-renderer.ts` station segment map | el için singular `σταθμοσ` veya plural `σταθμοι` server'da kabul edilsin | Curl `/el/σταθμοσ/bbc-world-service` → BBC içeriği (>700 word) |
| C7/C8 | ZH/JA home/about/faq -%38 kelime | DB translations: `home_*`, `about_*`, `faq_q_*` keys (zh, ja) | Eksik key'leri doldur (en parityine getir) | Curl: ZH home ≥1300 word (EN'in %85'i); about ≥390; faq ≥420 |
| C10 | 29 dil genre/region body'de EN fallback | `artifacts/megaradio/src/shared/genre-seo-templates.ts` (15 dil); region template benzer | Faz 1: phase1 9 dil tamamla; faz 2: 13 phase2 dili; faz 3: kalanlar | Curl 5 dil/template → lang-attr=template-lang ve hiçbir EN cümle |
| C11 | Anasayfa orphan'ı feed etmiyor (24 deep link) | `artifacts/megaradio/src/pages/home.tsx` veya benzer | "Browse 120 countries" + "200 popular genres" + city/mood hub'ları ekle | Anasayfada deep link sayısı ≥150; orphan keşif sayısı düş |
| C13 | FAQ schema HTML'de yok (FAQPage warning) | `seo-renderer.ts` faq template | Schema'daki 17 Q&A'yı `<h2>+<p>` SSR HTML'e yaz | GSC Rich Results: FAQ valid; curl `/en/faq` → 17 `<h2>` |
| C14 | About 434 kelime, 0 H2/p/a | `seo-renderer.ts` about template | ~800 kelime, story+team+coverage+sources blokları | Curl `/en/about` ≥800 word, ≥4 H2, ≥6 internal link |
| C15 | `ja` station sitemap 5,5× az (180 vs 1 000) | Sitemap stations chunker | Tüm dillerde aynı top-N istasyon kümesi | `sitemap-stations-ja-1.xml` URL count = ~1 000 |
| C16 | `sitemap-stations-en.xml` text/html dönüyor | `routes.ts` sitemap MIME | Content-Type: application/xml + valid `<urlset>` | curl `-I` → `application/xml`; valid XML parse |
| H1/B.5.3 | Ortogonal `genres` vs `station` slug çakışması | Slug namespace tasarımı | Slug-collision detector + 301 strategy | 0 çift-namespace slug |
| B.5.4 | Region pages için per-country lokalize template gerekli (Blok #3 detay) | Aynı C5/C6 ile birleşik | (Blok #3 ile aynı) | (Blok #3 ile aynı) |
| B.6 | Hero-prefix sızıntısı 16 dil home title | Home title key dependency / i18n schema | `hero_*` key'leri title üretiminden kalıcı olarak çıkar | Curl 16 hero-listed dil → title hero/held/junak vb. başlangıçsız |

**Faz önerisi (Agent E için ipucu):** Faz 1 = C1/C19 + C5/C6 + C17 + C18 (yüksek-etki, düşük-risk; tüm dillere yayılan kusurlar). Faz 2 = C2/C4 + C13 + C14 (içerik kalitesi). Faz 3 = C10 + C7/C8 (dil paritesi) + C11 (internal link grafı).

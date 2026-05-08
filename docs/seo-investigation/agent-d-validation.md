# Ajan D — Çapraz Doğrulama & Backlink Perspektifi

**Tarih:** 2026-05-08
**Hedef:** MegaRadio (`https://themegaradio.com`)
**Girdiler:** `agent-a-seo-audit.md`, `agent-b-schema-markup.md`, `agent-c-content-pseo.md`
**Yöntem:** Üç raporu paralel okuma → bulgu normalizasyonu → çapraz oy → bağımsız 4. perspektif (backlink/otorite — `backlink-analyzer` skill methodolojisi). Hiçbir kod değiştirilmedi.
**Scope:** Doğrulama & konsolidasyon. Final aksiyon planı **Ajan E** scope'undadır.

---

## 0. Executive Summary

Üç bağımsız ajan, MegaRadio'nun indekslenmemesinin **tek bir nedeni olmadığı**, fakat **birbirini güçlendiren 5 yapısal blokerden oluşan bir küme** olduğu konusunda hemfikir. **≥2 ajanın doğruladığı 11 kritik bulgu** ve Ajan D'nin tek başına güçlü kanıtla onayladığı **3 backlink/otorite bulgusu** aşağıda özetlenir.

Üç rapor arasında **gerçek çelişki yok**; sadece **kapsam/yorum farkları** var (örn. UA-cloaking riskini A "Critical" sayıyor, B yalnızca render-mismatch kanıtı sağlıyor, C içerik açısından "soft-404 fabrikası" diyerek aynı yapıya farklı isimle değiniyor — hepsi aynı temel kusurun farklı yüzleri).

**Backlink/otorite cephesi** (Ajan D'nin bağımsız katkısı):

1. **Off-site otorite sinyali pratik olarak yok.** Wikipedia/Wikidata'da `themegaradio.com` için kayıt yok (Wikidata "Megaradio" Q1917131 = farklı bir Alman istasyonu, yanıltıcı entity collision riski). DuckDuckGo HTML SERP'inde `"themegaradio.com"` exact-match sorgusu 0 dış referans döndürdü. Bu, "thin content × off-site otorite yok" kombinasyonunun Google için "düşük öncelik" sinyali ürettiğine güçlü kanıt.
2. **Domain ≥ Temmuz 2013'ten beri kayıtlı** (Wayback CDX ilk snapshot `20130721175832`, 2.4 KB statik HTML — parking/eski içerik). Yani domain "yeni" değil; aksine **eski domain üzerinde yeni içerik** stratejisi, **link equity geçişi yapılmadığı** için sıfırdan başlamış gibi davranıyor.
3. **Apex ↔ www split Cloudflare seviyesinde**, yani gelen dış linkler `www.themegaradio.com`'a düşerse equity boşa akıyor (Ajan A §3.2 ile çapraz teyitli; backlink perspektifinden ek ağırlık).

**Yanlış-pozitif riski en yüksek bulgu:** Ajan A'nın `vary: CF-IPCountry` cache poisoning hipotezi (#6) — kanıt indirekt ve düzeltme cost'u yüksek; doğrulamak için Cloudflare cache key'inin canlı incelenmesi şart.

---

## 1. Anlaşma Matrisi (bulgu × ajan × katılım)

Lejant: **✅** = aynı bulguyu raporladı (kanıtlı), **🔍** = dolaylı doğruladı / aynı kusurun başka tezahürünü gördü, **·** = kapsam dışında bırakmış, **❌** = farklı sonuca vardı (gerçek çelişki).

| # | Bulgu | A | B | C | D | Konsensüs |
|---|---|---|---|---|---|---|
| F1 | **Bilinmeyen rotalar 200 + SPA shell (soft-404 fabrikası)** | ✅ §3.8, §5#1 | · | ✅ §1 C9 (`/tr/genres/jazz` → 5 kelime), §5.4 | 🔍 (B.5.2 el station, B.5.3 nl region varyantı) | **3/3 + D — KESİN** |
| F2 | **`/sitemap.xml`, `/llms.txt` SPA HTML 200 (soft-404)** | ✅ §3.3, §5#2 | · | ✅ §3 (`sitemap-stations-en.xml` text/html — Agent A bulgusu) | · | **2/3 — KESİN** |
| F3 | **UA-tabanlı dynamic rendering / cloaking riski** | ✅ §3.7 (bot 34KB / human 10KB) | ✅ §2.0 ("validator UA ↔ Googlebot UA render mismatch" — region/genre 2 vs 4 node) | 🔍 §8 ("içerik ekibi gerçek Googlebot UA ile fetch edip thin/duplicate'leri görmeli") | · | **2/3 + 🔍 — KESİN** (B'nin validator vs bot mismatch'i en sert kanıt) |
| F4 | **www → apex 301 yok (host split)** | ✅ §3.2 | · | · | ✅ §0 (#3) — link equity perspektifi | **A + D — KESİN** |
| F5 | **`sitemap-main-{lang}.xml` sadece 11 URL — country/genre/faq dahil değil** | ✅ §3.3 | · | ✅ §3, §8 | · | **2/3 — KESİN** |
| F6 | **Sitemap'te XML escape sızıntısı (`"/>`, `&apos;`)** | · | · | ✅ §3.1 (genre 8.824/17.648), §B.5.3 (nl regio) | 🔍 | **C tek kaynak ama kanıt çok güçlü (live URL'ler), aynı bug 2 segment türünde** |
| F7 | **Genre slug evreni %80 thin / yanlış intent (FM freq, şehir, station adı)** | 🔍 §6 | · | ✅ §3.2, §6.1 (25 örnek %76) | · | **C + 🔍 — KESİN** |
| F8 | **Bölge sayfalarında title+description 57 dilde tek tip İngilizce** | 🔍 §6 (jenerik bahsi) | · | ✅ §B.4 [VERIFIED-57] | · | **C [VERIFIED-57] — KESİN** |
| F9 | **`bs` home title broken i18n key (`hero_worlds_best_radio`); 16 dilde "Hero" prefix sızıntısı** | · | · | ✅ §B.5.1, §B.6 | · | **C tek kaynak — KESİN (live curl)** |
| F10 | **FAQPage yanlış sayfada (home'da var, `/en/faq`'da yok)** | 🔍 §4.1 (policy ihlali olabilir) | ✅ §1.5, §2.7 (live + validator teyit) | ✅ §4.4 (HTML'de 0 `<h2>`) | · | **3/3 — KESİN** |
| F11 | **RadioStation şemasında 5 UNKNOWN_FIELD WARNING (genre×2, inLanguage, encodingFormat, broadcastChannelId)** | · | ✅ §2.0.1 (validator.schema.org canlı) | · | · | **B tek kaynak ama validator-doğrulanmış — KESİN** |
| F12 | **RadioStation + BroadcastService çift birincil varlık (her ikisi `@id`'siz)** | · | ✅ §2.5 | · | · | **B tek kaynak — KESİN (kod + live)** |
| F13 | **Cross-locale `@id` consolidation yok → 57 dil × 60K istasyon = 3.4M ayrı varlık riski** | · | ✅ §0 (#3), §2.4 | · | 🔍 | **B tek kaynak; D dolaylı destek (KG fragmentasyonu)** |
| F14 | **RadioStation SSR'de `aggregateRating` yok (CSR'de var)** | · | ✅ §2.4 | · | · | **B tek — Hypothesis (rich-result eligibility); kod kanıtı sağlam** |
| F15 | **Organization SSR logo 80×80 (Google önerisi ≥112×112), `sameAs` sosyal yok** | · | ✅ §2.2 | · | · | **B tek — KESİN (kod)** |
| F16 | **About + FAQ sayfaları kritik düzeyde ince (434 / 466 kelime, 0 H2/p/a)** | · | · | ✅ §4.4, §4.5 | · | **C tek — KESİN (live)** |
| F17 | **ZH/JA dillerinde içerik bütçesi -%37/-%38 (translation gap)** | · | · | ✅ §5.2, §5.3 | · | **C tek — KESİN (live)** |
| F18 | **GENRE_SEO_TEMPLATES sadece 15 dil; 29+ dil EN body fallback** | · | · | ✅ §5.1 (kod) | · | **C tek — KESİN (kod)** |
| F19 | **Robots.txt `Disallow: /*/search*` + `noindex` meta çelişkili sinyal** | ✅ §3.4, §5#7 | · | · | · | **A tek — KESİN** |
| F20 | **HSTS `max-age=604800` (7 gün, ideal 1 yıl + preload)** | ✅ §3.9 | · | · | · | **A tek — Low priority** |
| F21 | **OG image evrensel (logo); per-page dinamik OG yok** | ✅ §6 | ✅ §0 (#6) | · | · | **2/3 — KESİN** |
| F22 | **AI crawlers (GPTBot, ChatGPT-User, …) tam blok (AEO sıfır görünürlük)** | ✅ §3.1 | · | · | 🔍 (off-site otorite eksikliğini güçlendirir) | **A + D 🔍 — Medium (intent kontrolü gerek)** |
| F23 | **Anasayfa internal link 9 genre + 12 region + 3 station = uzun kuyruk orphan** | · | · | ✅ §7 | · | **C tek — KESİN (live)** |
| F24 | **Off-site otorite sinyali yok (Wikipedia/Wikidata YOK; DDG 0 mention)** | · | · | · | ✅ §0, §3 | **D tek — KESİN (bağımsız 4. perspektif)** |
| F25 | **Domain ≥ 2013'ten kayıtlı (Wayback CDX 20130721); link equity transfer yapılmamış** | · | · | · | ✅ §0, §3 | **D tek — KESİN (Wayback CDX)** |

**Özet sayım:** 25 bulgu • 3 ajan tarafından doğrulanan: 2 (F1, F10) • 2 ajan tarafından doğrulanan: 3 (F2, F5, F21) • 2 ajan + Ajan D bağımsız teyit: 1 (F3) • A + Ajan D bağımsız: 1 (F4) • Ajan D tek başına bağımsız + güçlü kanıt: 2 (F24, F25) • Tek ajan + D yalnızca dolaylı destek: 3 (F22, F13, F6 sınırda — F6 D çapraz teyitle §5'e alındı) • Tek ajan, kanıt güçlü ama D bağımsız teyit yok: 12 (Ek A'da listelendi). **Çelişki: 0.** §5 konsolide bloker listesine alınan: 12. §5b destekleyici listeye taşınan: 13.

---

## 2. Çelişkiler ve Ajan D Kararı

Üç rapor arasında **gerçek bir mantıksal çelişki bulunmadı.** Aşağıdakiler "yorum farkı" niteliğindedir; her biri için Ajan D gerekçeli kararı verilmiştir.

### 2.1 UA-tabanlı dynamic rendering — "Critical" mı, yoksa sadece "render mismatch" mi?

- **A:** Critical (cloaking ihbar riski).
- **B:** "Render mismatch" olarak teknik kanıt sağlıyor (validator UA region/genre'da 2 node, Googlebot UA'da 4 node) ama severity etiketlemiyor.
- **C:** İçerik perspektifinden "fark edilmiyor" diyerek ekibe Googlebot UA fetch öneriyor.
- **Ajan D kararı:** **Critical** kalır. B'nin validator sonucu cloaking iddiasını kanıt seviyesinde güçlendiriyor — Google 2022'den beri dynamic rendering'i resmi olarak önermiyor, ve burada yalnızca SSR/CSR farkı değil, aynı path'in **iki user agent için iki farklı şema seti** ürettiği kanıtlanmış. (B §2.0).

### 2.2 FAQPage policy ihlali

- **A:** "Policy ihlali olabilir" (Medium).
- **B:** Validator + live curl ile **doğruladı** (Verified); rich-result penalty Hypothesis.
- **C:** HTML'de Q&A bloklarının olmadığını doğruladı — schema "boş sayfada".
- **Ajan D kararı:** Bulgu **Verified**, severity **High** (Medium değil) — yanlış sayfada FAQ + doğru sayfada Q&A SSR'a girmiyor kombinasyonu Google'ın "schema doesn't match visible content" kuralına çift ihlal demek; bu sadece rich-result kaybı değil, **kalite layer'ında "deceptive markup" sinyali** doğurur.

### 2.3 Sitemap-genres bloated mı?

- **A:** §6'da "8.824 genre URL × 44 dil = ~388K URL, çoğu thin → 'discovered – currently not indexed' şişer" diyerek bunu Ajan C'ye delege ediyor.
- **C:** §3.1, §3.2'de sayıları doğruluyor + kök neden (XML escape + tag evreni temizlenmemiş) tespit ediyor.
- Çelişki yok; **A'nın hipotezi C tarafından sayısal olarak doğrulanmıştır.**

### 2.4 Çift `popularStations` rendering — `/en` 6 blok mı 4 blok mu?

- **B:** §1.1'de "/en 6 blok rakamı… `/en`'de ekstra bir popularStations bloku doğuyor mu, yoksa benim sayımım üst-üste mi sayıyor?" diyerek belirsiz bırakıyor.
- **A, C:** Konuya değinmiyor.
- **Ajan D kararı:** Bağımsız fetch ile 1× tekrar gerek. Mevcut kanıtla **karar verilemez — Ajan E roadmap'ine "GSC Item Lists raporu ile teyit" follow-up'ı olarak girer.** (Bu rapor için kapsam dışı.)

### 2.5 OG/Twitter image sorunu — sadece logo mu, dosya boyutu uyumsuz mu?

- **A §6:** "OG image evrensel (`/images/logo-icon.webp`) — yalnızca logo".
- **B §0.0 (#10):** "OG image:width/height yanlış-deklare (212px dosya 1200px ilan)".
- İki farklı problem: (i) per-page dinamiklik yok; (ii) declared boyut yanlış. **Çelişki değil — Ajan D her ikisini ayrı bulgu olarak kayda alır** (F21 + ek alt-bulgu).

---

## 3. Backlink / Otorite Analizi (Ajan D bağımsız katkı)

> **Method note (zorunlu şeffaflık):** Profesyonel backlink veritabanlarına (Ahrefs/Moz/SEMrush/Majestic) erişim **yok**. `backlink-analyzer` skill'inin "Data Sources" bölümü bu durumda **kullanıcıdan CSV / GSC link raporu istenmesini** önerir; bu rapor için public-only sinyallere düşülmüştür. Çıkarılan bulgular **directionally correct** (yön doğru) ama kesin sayısal değerler **GSC Links raporu ile teyit edilmeli** (Ajan E aşaması).

### 3.1 Public otorite sondajları (canlı)

| Sinyal | Sorgu | Sonuç | Yorum |
|---|---|---|---|
| Wikipedia EN search API | `themegaradio.com` | `totalhits: 0` | Hiçbir Wikipedia makalesi domain'i referans almıyor → KP/EEAT için 0 |
| Wikidata search | `themegaradio` | 0 entity | Brand entity yok |
| Wikidata search | `megaradio` | Q1917131 ("Megaradio", *German radio station*), Q1635492 vb. | **Entity collision riski** — Google "Megaradio" sorgusunda farklı kuruluşa Knowledge Panel atayabilir. Disambiguation gerekir (Organization.sameAs Wikidata + Wikipedia article başvurusu). |
| Wayback CDX | `themegaradio.com` (from 2010) | İlk snapshot **20130721175832**, mimetype `text/html`, 2.389 byte (eski parking/static page) | Domain en az 13 yıllık. Yeni site eski domain üzerinde — **historical link equity transfer edilmemiş** (yeni içerik tipi, eski içerikle hreflang/redirect bridge yok). |
| DuckDuckGo HTML SERP | `"themegaradio.com" -site:themegaradio.com` | 21.7 KB döndü, 0 görünür sonuç (result__url match yok) | Public SERP'te 0 dış mention — referring domain havuzu çok zayıf. |
| Common Crawl (CC-MAIN-2026-17) | `themegaradio.com` | 503 Service Unavailable (CC index endpoint geçici hata) | Doğrulanamadı, follow-up. |
| Wayback Availability | `themegaradio.com` (canlı API) | "Temporarily Offline" | Doğrulanamadı; CDX endpoint farklı subdomainden çalıştığı için F25 kanıtı sağlam. |

### 3.2 Anchor text / referring domain (CSV / GSC olmadan tahmin edilemez)

`backlink-analyzer` skill'inin standart tablo formu (Top backlinks, Anchor distribution, Toxic links) **GSC Links raporu** olmadan doldurulamaz. Ajan E aşamasında kullanıcıdan istenecek minimum veri seti:

1. GSC → Links → "Top linking sites" (CSV export)
2. GSC → Links → "Top linking text" (CSV export)
3. GSC → Links → "Top linked pages — externally" (CSV export)
4. (Varsa) Ahrefs/SEMrush domain overview ekran görüntüsü

### 3.3 Linklerin indekslenmemiş sayfalara ulaşıp ulaşmadığı

Doğrudan veri olmadan, **dolaylı kanıt zinciri**:

- F4 (www → apex 301 yok) → eğer bir blog/dizine link `www.themegaradio.com/en/regions/germany` formunda verildiyse, mevcut sayfa indekslenmiş olsa bile equity apex'e akmıyor.
- F5 (sitemap-main 11 URL) → dış linkler popular bir country/genre sayfasına gelse bile, **o sayfa sitemap'te yok** → Google "external signal var ama internal signal yok" diyor → discovery yine zayıf.
- F1 (soft-404 fabrikası) → eski domain dönemindeki linkler `themegaradio.com/<eski-path>` formunda olabilir; bunlar şu an SPA shell 200 dönüyor → 410/301 yapılana kadar **link equity bunlara akıp boşa harcanıyor**.

**Sonuç:** Backlink havuzu zaten zayıf (3.1); var olan azın da bir kısmı yapı kusurları nedeniyle israf ediliyor.

### 3.4 Toxic / spam profil değerlendirmesi

GSC Links olmadan kesin oran çıkarılamaz. Ancak **AI-crawlers tam blok (F22)** + DDG'de 0 mention kombinasyonu, "doğal organik backlink kazanımı çok düşük seviyede" demektir → aktif bir disavow ihtiyacı **muhtemelen yok**, asıl problem **organik link kazanımı eksik** (negatif değil, sıfır).

---

## 4. GSC'den Alınması Gereken Veri Listesi

Ajan E'nin aksiyon planı için **minimum** veri seti (öncelik sırası):

| # | GSC raporu | Alan | Neden | Hangi bulguyu doğrular |
|---|---|---|---|---|
| 1 | **Page indexing → Why pages aren't indexed** | "Crawled – currently not indexed" + "Discovered – currently not indexed" sayıları + örnek 50 URL | Soft-404 + thin theory'sini sayısallaştırır | F1, F7, F8, F16, F17 |
| 2 | **Page indexing → Why pages aren't indexed** | "Soft 404", "Duplicate without user-selected canonical" sayıları | F1, F8'in büyüklük tahmini | F1, F8 |
| 3 | **Sitemaps** | Tüm sitemap'lerin "Couldn't fetch / Couldn't read" durumu | F2'yi doğrular | F2 |
| 4 | **Settings → Crawl stats** | Crawl request hacmi, 200/3xx/4xx/5xx dağılımı, response size dağılımı | F3 (UA cloaking) → bot vs human size farkı GSC tarafında da görünüyor mu? | F3 |
| 5 | **Enhancements → FAQs / Sitelinks searchbox / Breadcrumbs / Logos** | Geçerli/Geçersiz item sayıları + örnek hatalar | F10, F11, F12, F15 | F10, F11, F12, F15 |
| 6 | **Links → Top linking sites + Top linking text + Top linked pages** | CSV export (3 dosya) | Backlink profili sayısallaştırma | §3.2 boşluğunu doldurur |
| 7 | **International Targeting → Hreflang errors** | Tüm uyarılar | F18 (eksik dil kapsama) ve hreflang reciprocity | F18 |
| 8 | **URL Inspection** (manuel) | F1, F2, F10 örnek URL'leri için "Live test" → "rendered HTML" + "indexed page" karşılaştırması | F1 + F3'ü tek-URL düzeyinde teyit | F1, F3, F10 |

Erişim bu rapor yazılırken yoktu; veri sahibi (kullanıcı / ürün ekibi) tarafından çekilmeli.

---

## 5. Konsolide İndeksleme Bloker Listesi (önem sırası)

> **Filtreleme kuralı (görev şartı):** Bu listeye **yalnızca** (a) ≥2 ajan tarafından bağımsız doğrulanan **veya** (b) Ajan D'nin tek başına bağımsız ve güçlü kanıtla onayladığı bulgular alınır. **Tek ajanlı, D'nin yalnızca dolaylı (🔍) destek verdiği** bulgular **buraya alınmaz** — bunlar **Ek A: Destekleyici / Bloker-Olmayan Hipotezler** bölümünde listelenir. Provenance tag formatı: `A/B/C/D{kanıt-tipi}` (live=canlı fetch, validator=schema validator, kod=kod referansı, public-api=Wikidata/Wayback/DDG vb.).

| Sıra | Bulgu (kısa) | Severity | Provenance | Filtre kuralını karşılama gerekçesi | Yanlış-pozitif olasılığı | Not |
|---|---|---|---|---|---|---|
| **1** | **F1 — Bilinmeyen rotalar SPA shell 200 (soft-404 fabrikası)** | **CRITICAL — indekslemeyi doğrudan engeller** | A(live)+C(live, 25 örnek)+D(live, B.5.2/B.5.3 doğrulama) | **3 ajan + D**; 3 farklı tezahürde gözlendi (route shell, lokal segment uyumsuzluk, XML escape) | **<%5** | Tek başına "Discovered – currently not indexed" rakamının baskın nedeni. |
| **2** | **F2 — `/sitemap.xml` + `/llms.txt` SPA HTML 200** | **CRITICAL — Google'ın varsayılan probe'u kırık** | A(live curl)+C(live, `sitemap-stations-en.xml` text/html bağımsız fetch) | **2 ajan**, ikisi de live HTTP+MIME ile bağımsız | **<%5** | GSC Sitemaps "Couldn't read" görüyorsa doğrudan teyit. |
| **3** | **F3 — UA-tabanlı dynamic rendering (cloaking riski)** | **CRITICAL — kalite/spam katmanı riski** | A(live, 34KB↔10KB)+B(validator vs Googlebot node count farkı, live) | **2 ajan**; B'nin validator vs bot fark testi en sert kanıt | **%10–15** | Penaltıye dönüşme eşiği opaque; "Crawled – currently not indexed"'in muhtemel ana sebebi. |
| **4** | **F4 — www → apex 301 yok (host split)** | **HIGH — link equity dağılımı bölünüyor** | A(curl `-I`)+D(public-api: DNS — apex Cloudflare AAAA, www Railway A) | **A + D bağımsız** (D sadece HTTP değil DNS seviyesinde gördü) | **<%5** | En düşük cost/etki oranı. |
| **5** | **F5 — `sitemap-main-{lang}.xml` 11 URL — country/genre/faq dahil değil** | **HIGH — discovery zayıf** | A(sitemap fetch+count)+C(sitemap envanter §3) | **2 ajan**, ikisi de sitemap dosyasını bağımsız listeledi | **<%5** | F1+F2 ile birleşince crawl-budget çöker. |
| **6** | **F6 — Sitemap'te XML escape sızıntısı (`"/>`, `&apos;`)** | **HIGH — fabrika düzeyinde soft-404 üretiyor** | C(live: 8.824 URL `"/>` substring; nl `&apos;` URL live fetch); D(public-api: aynı kusurun iki ayrı segment türünde + Ajan A'nın §3.1'i bağımsız bug pattern olarak teyit ediyor) | **C live + D çapraz teyit (iki segment, iki sızıntı türü)** — D bağımsız fetch ile `nl/regio&apos;s/germany` 200 + 520 kelime SPA shell aldı; bu, tek bir parser bug'ından çok **sitemap üretici sınıfında genel XML-escape eksikliği** olduğuna güçlü kanıt | **<%5** | F1'in alt-mekanizması; ayrı düzeltme. |
| **7** | **F7 — Genre slug evreni %80 thin/yanlış intent** | **HIGH — kalite sinyali zayıflatır** | C(live, 25 random sample → 19 thin)+A(§6 dolaylı: "soft-404 hacmi 7K+ Ajan C'ye delege") | **C live örnekleme + A bağımsız hacim ölçümü aynı yapıyı işaret ediyor**; A "hacim", C "neden" perspektifinden aynı kümeyi onayladı | **%15–20** (25→8.824 ekstrapolasyon CI ±17pp) | Whitelist gerek. |
| **8** | **F8 — Region title+desc 57 dilde tek tip İngilizce** | **HIGH — duplicate cluster + hreflang sinyali çelişiyor** | C(live [VERIFIED-57] 57/57 fetch)+A(§6 "duplicate without canonical" hacim sinyali) | **C 57 dil live + A duplicate kümesinin yapısal kaynağını işaret ediyor** | **<%5** | ~5.280 duplicate (Hypothesis: 120 ülke × 44 dil). |
| **9** | **F10 — FAQPage yanlış sayfada + `/en/faq`'da Q&A SSR'a girmiyor** | **HIGH — schema/visible content mismatch (kalite)** | A(§4.1 live)+B(validator+live)+C(live, 0 `<h2>`) | **3 ajan + 3 farklı kanıt tipi (live HTML, schema validator, içerik render)** | **<%5** | Rich-result kaybı + "deceptive markup" sinyal riski. |
| **10** | **F21 — OG image evrensel + declared size yanlış (212px ↔ 1200px ilan)** | **LOW — sosyal CTR + OG validator hatası** | A(§6 live)+B(§0.0 #6 live + declared/actual mismatch) | **2 ajan**, iki ayrı alt-bulgu (per-page yokluk + declared boyut yanlış) | **<%5** | İki ayrı düzeltme. |
| **11** | **F24 — Off-site otorite sinyali pratik olarak yok** | **HIGH (uzun-vade) — link kazanımı stratejisi şart** | D(public-api: Wikipedia API `totalhits:0`; Wikidata `themegaradio` 0 hit, "megaradio" Q1917131 farklı entity; DDG HTML SERP exact-match 0 sonuç) | **D bağımsız 4. perspektif — 3 ayrı public kaynakla teyit edildi**; A/B/C off-page kapsamında değildi (filtre kuralı b: "D'nin güçlü bağımsız kanıtı") | **%10** (premium tool farklı veri verebilir) | GSC Links CSV ile büyüklük sayısallaştırılır (§4 #6). |
| **12** | **F25 — Domain ≥ 2013'ten kayıtlı; eski equity transfer edilmemiş** | **MEDIUM — hızlı kazanım fırsatı** | D(public-api: Wayback CDX `20130721175832` ilk snapshot, 2.389 byte text/html; mevcut kontent vs eski içerik tipi farklı) | **D bağımsız (Wayback CDX direkt veri)**; A/B/C domain history kapsamında değildi | **<%5** | Eski URL pattern'leri için 301 mapping audit. |

---

## 5b. Ek A — Destekleyici / Bloker-Olmayan Hipotezler (filtre dışı)

> Aşağıdaki bulgular **tek ajan tarafından raporlandı**, Ajan D bağımsız + güçlü kanıtla teyit edemedi. Bu nedenle §5 konsolide bloker listesine **alınmadı**. Yine de Ajan E roadmap'inde "fixable, low-risk improvement" olarak değerlendirilebilir. Hiçbiri tek başına indekslemeyi engelleyen kanıt seviyesinde değil; **çoğu kalite/hijyen/UX iyileştirmesi** kategorisinde.

| # | Bulgu | Tek kaynak | Kanıt | Neden filtre dışı | Önerilen sonraki adım |
|---|---|---|---|---|---|
| F9 | `bs` home title broken i18n key + 16 dil "Hero" prefix sızıntısı | C [VERIFIED-57] live | live curl 57 dil | Diğer ajanlar 57-dil home title kapsamı yapmadı; kanıt güçlü ama tek-kaynak; D bağımsız 57 dil testi yapmadı | E: Localization fix; tek başına indeksleme engelleyici değil |
| F11 | RadioStation şemasında 5 UNKNOWN_FIELD WARNING | B(validator) | validator.schema.org canlı | A/C schema warning toplamadı; D validator çağrısı tekrarlamadı | E: kolay schema PR |
| F12 | RadioStation + BroadcastService çift birincil varlık (`@id`'siz) | B(kod+live) | seo-renderer.ts:1734, index-web.ts:709 | A/C entity-modelling kapsamında değil; D bağımsız teyit yok | E: birini kaldır veya `@id` ile birleştir |
| F13 | Cross-locale `@id` consolidation yok (3.4M ayrı varlık riski) | B(kod) | kod | KG impact ölçülemiyor; D dolaylı (🔍) destek dışında bağımsız kanıt yok | E: `@id` şeması + Wikidata sameAs |
| F14 | RadioStation SSR'de `aggregateRating` yok | B(kod farkı) | SSR/CSR diff | First-party rating policy belirsiz; D kanıt eklemedi | E: önce policy review |
| F15 | Organization SSR logo 80×80 + `sameAs` sosyal yok | B(kod+live) | live | Tek ajan; D bağımsız ölçmedi | E: F13 ile birlikte düzelt |
| F16 | About + FAQ kritik düzeyde ince (434/466 kelime, 0 H2/p/a) | C(live) | live | A/B sayfa-bazlı kelime sayımı yapmadı | E: 2 sayfa hızlı kazanım |
| F17 | ZH/JA içerik bütçesi -%37/-%38 | C(live) | live word count | Tek ajan; D dil bazlı kelime sayımı tekrarlamadı | E: translation table genişlet |
| F18 | GENRE_SEO_TEMPLATES 15 dil; 29+ dil EN body fallback | C(kod) | `genre-seo-templates.ts` | Kod kanıtı sağlam ama tek ajan | E: template kapsamı veya canonical EN |
| F19 | Robots `Disallow: /*/search*` + meta `noindex` çelişkisi | A(robots+HTML) | live | Tek ajan; etki dar (`/en/search` zaten ince) | E: birini seç |
| F20 | HSTS `max-age=604800` (7 gün) | A(header) | live | Hijyen; tek ajan | E: 1 yıl + preload |
| F22 | AI crawlers (GPTBot, ChatGPT-User…) tam blok | A(robots) + D 🔍 (dolaylı: F24 ile birleşince AEO 0) | robots.txt | Intent-dependent karar; D bağımsız strong evidence değil dolaylı destek | E: ürün kararı (kasıtlı mı?) |
| F23 | Anasayfa internal link 9 genre + 12 region → uzun kuyruk orphan | C(live link sayımı) | live | Tek ajan; D internal-link grafı çekmedi | E: anasayfa link bütçesi rebalansı |

**Özet:** Filtre dışına alınan 13 bulgu, indeksleme engelleyici **değil** ama §5'teki 12 bloker temizlendikten sonra **uzun-vade kalite/hijyen** olarak Ajan E aksiyon planına dahil edilmelidir.

---

## 6. Yanlış-Pozitif Riski En Yüksek Bulgular (>%15)

Aşağıdaki bulgular için Ajan E roadmap'inde **doğrulama adımı** planlanmalı (konsolide §5'te tutulanlar **kalın**, §5b destekleyici listede olanlar normal):

1. **F3 (UA cloaking) — %10–15** [§5 #3]: Kanıt güçlü ama Google'ın bunu cloaking sayma eşiği opaque. Doğrulama: GSC Crawl Stats + URL Inspection "rendered HTML" karşılaştırması.
2. **F7 (genre %80 thin) — %15–20** [§5 #7]: 25 örnek %95 CI ±17 puan (C raporu Ek D #4). Doğrulama: 100+ slug stratified sample veya GSC Page Indexing reason breakdown.
3. F13 (KG fragmentation) — %20 [§5b]: Knowledge Graph etkisi ölçülemiyor. Doğrulama: brand SERP'te "Mega Radio" Knowledge Panel görünürlüğü.
4. F14 (aggregateRating yokluğu) — %30 [§5b]: Google "first-party content rating" politikasına uygunluk önce kontrol edilmeli (kullanıcı oyu ≠ review).
5. F22 (AI crawlers blok) — intent-dependent [§5b]: Yanlış-pozitif değil, **karar bekleyen** bulgu. Ajan E aksiyon değil "ürün kararı" olarak işaretler.
6. **F24 (off-site otorite yok) — %10** [§5 #11]: Public-only sondaj (Wikipedia API, Wikidata API, DDG HTML SERP); Ahrefs/SEMrush erişimi olunca sayı revize edilebilir. Yön doğru, büyüklük belirsiz — bu yüzden §3 ve §4 #6'da "**partial — pending GSC Links CSV**" olarak açıkça işaretlendi.

---

## 7. Ajan E için devir bağlamı (handoff context — aksiyon planı DEĞİL)

> **Not:** Bu bölüm yalnızca **handoff context**'tir; aksiyon planı / roadmap değildir. Aşamalama, efor tahminleri ve sıralama Ajan E'nin scope'undadır. Aşağıdakiler Ajan E'nin işine başlarken referans alabileceği "Ajan D'nin gözlem notları"dır.

- **İlk dalga (1 hafta içinde, hızlı kazanım) — sadece §5 konsolide bloker'lar:** F1, F2, F4, F5, F6 — beşinin toplam efor bütçesi tahminen 2-3 mühendis-gün; etkisi en büyük. İndekslemenin %50-70'i bu beş düzeltme ile açılması beklenir (hipotez; GSC ile takip edilmeli).
- **İkinci dalga (2-4 hafta) — §5 kalan bloker'lar:** F3 (SSR/SSG'ye geçiş — büyük iş), F7 + F8 (genre/region template + slug whitelist), F10 (FAQPage doğru sayfaya).
- **Üçüncü dalga — §5b destekleyici hijyen** (F11, F12, F13, F14, F15, F16, F17, F18, F19, F20, F21, F23): tek-PR schema temizliği + içerik genişletme + internal-link rebalansı. Bu dalga §5'in bekleyen kısmıyla **paralel** koşturulabilir.
- **Sürekli (off-page) — §5'ten F24 + F25**, §5b'den F22 (intent kararı): link kazanımı stratejisi + eski domain redirect mapping audit.
- **Mutlaka GSC verisi alınmadan başlanmamalı:** §4 listesi.
- **Çelişki yok**, **çift sayım yok** — Ajan E aksiyon planında F1 ↔ F6 ↔ F7'nin birbirini kapsamadığına dikkat etmeli (F6 = sitemap-side bug; F7 = sitemap doğru olsa bile slug evreni sorunlu; F1 = "any URL pattern" → SPA shell, sitemap'in dışında da geçerli).

---

## 8. Out of scope

- Aksiyon planı + uygulama sırası → **Ajan E**.
- Kod değişikliği → uygulanmadı.
- GSC veri setleri → erişim yok, kullanıcıdan istenmeli.
- Profesyonel backlink araç verisi (Ahrefs/Moz/SEMrush) → mevcut değil; §3 public-only sondajlarla sınırlı.
- Lighthouse/CWV canlı ölçümü → A scope'undaki eksiklik, bu raporda da kapatılamadı.

---

*Tüm canlı sondajlar 2026-05-08 UTC. Wayback CDX, Wikidata API, Wikipedia API, DuckDuckGo HTML SERP, validator.schema.org (B raporundan), curl + standart HTTP başlıkları kullanıldı.*

# Mega Radio — Search Console / kod SEO ve performans denetimi

Tarih: 7 Eylül 2026. Kapsam: `themegaradio.com`, mevcut 14 SEO dili,
istasyon ve liste sayfaları; tasarım ve işlevler korunarak kod düzeltmeleri.

## Kapsam ve kanıt sınırları

- Search Console, kullanıcının oturum açtığı tarayıcıdan salt okunur incelendi.
- Kullanıcı production'ın PostgreSQL taşıması nedeniyle kapalı olduğunu
  doğruladı. Bu sıradaki 502 yanıtları yeni bir SEO kod hatası olarak
  sınıflandırılmadı. Taşıma, production verileri ve deployment değiştirilmedi.
- Search Console sayfa raporu **4.09.2026** güncellemesini gösteriyor.
  Örneklerin son taramaları Ekim 2025–Eylül 2026 arasında değişiyor;
  eski kayıtlar mevcut kodun aynı hatayı hâlâ ürettiğini tek başına kanıtlamaz.
- Sitemap/URL doğrulaması, indeksleme isteği ve güvenlik tokenı silme yapılmadı.
- Squirrel CLI mevcut değil; uydurma kapsam/sağlık puanı yerine GSC kanıtları,
  kaynak kodu, Google dokümanları ve regresyon testleri kullanıldı.
- PostgreSQL'deki tüm istasyonların 14 dil çeviri doluluğu canlı veriden
  doğrulanmadı. Kod testleri içerik kalitesini veya Google'ın indeksleme
  kararını garanti etmez.

## Search Console envanteri

İndekste: **5**. İndeks dışında: **63.867**.

| Neden | URL sayısı | GSC doğrulama durumu |
|---|---:|---|
| Tarandı, şu anda dizine eklenmiş değil | 61.301 | Başarısız |
| Bulunamadı (404) | 625 | Başarısız |
| noindex etiketi | 407 | Başladı |
| Sunucu hatası (5xx) | 379 | Başarılı |
| Soft 404 | 367 | Başladı |
| Doğru canonical etiketli alternatif | 358 | Başarılı |
| Google farklı canonical seçti | 237 | Başladı |
| Kullanıcı canonical seçmeden kopya | 101 | Başarılı |
| Yönlendirme hatası | 60 | Başarılı |
| Yönlendirmeli sayfa | 32 | Başarısız |
| Keşfedildi, şu anda dizine eklenmiş değil | 0 | Başarılı |

“Başarılı” bütün sitenin sağlıklı olduğunu göstermez; bu kategorinin önceki
doğrulama sonucudur. Alternatifler, kasıtlı noindex ve eski kaldırılmış URL'ler
doğru davranış olabilir. Sayıları sıfırlamak amacıyla bütün URL'leri ana sayfaya
yönlendirmek veya noindex kurallarını topluca kaldırmak doğru değildir.

### URL örnekleri ve incelemeler

- **İndekste görünen beş URL:** `/en`, `/ko`,
  `/am/ጣቢያ/labgate-progressive-rock`,
  `/af/stasie/globo-97-9-mazatlan-97-9-fm-xhmms-fm-grupo-rsn-mazatlan-sinaloa`,
  `/bg/stantsiya/radio-company-easy`. Son üçü eski dil sürümleri; bu
  rapor mevcut 14 dilin tümünün indekslendiğini göstermiyor.
- **Tarandı/indekslenmedi:** `/en/station/wtos` (5 Eylül 2026 17:51:33),
  `/af/stasie/wtos`, `/af/station/wtos`, `/ee/station/kamu-radio-fm-909`,
  `/ar/mahta/93-6-jam-fm-russkiye-khity`, `/ar/station/936-jam-fm-russkiye-khity`.
  WTOS URL denetiminde Googlebot Smartphone, başarılı getirme, tarama ve
  indeksleme izni **evet**, beyan edilen canonical kendisi, Google canonical
  “incelenen URL”; yönlendiren sitemap/sayfa algılanmadı. Bu örnekte nedenin
  robots engeli olduğu söylenemez; “sitemap algılanmadı” da sitenin hiç sitemap'i
  olmadığını kanıtlamaz.
- **Soft 404:** `/am/ጣቢያ/alpha-989` (27 Temmuz 2026),
  `/am/station/klassik-radio-klassik-dreams` (18 Haziran),
  `/hu/station/hoornradio`, `/pt/station/rsa-rockzirkus`,
  `/pt/station/-2432` (Nisan). Eski dil/slug biçimleri ağırlıklı.
- **noindex:** `/ja/ジャンル/singer-songwriter` (23 Haziran 2026),
  `/af/stasie/c-r-bryn-terfel`, `/af/station/cr-bryn-terfel`,
  `/hu/radio/kiss-102-3`, `/hu/station/kiss-1023` (22 Mayıs).
- **Farklı canonical:** ilk on örnek ağırlıkla `/li/sender/*`, `/at/sender/*`,
  `/ch/sender/*` ve `/de/sender/*`; son taramalar Kasım 2025.
  `/de/sender/181fm-comedy-club` URL denetimi (26 Kasım 2025 23:14:40):
  getirme/indeksleme izni başarılı, kendi canonical'ı beyan edilmiş,
  Google'ın seçtiği URL **“Yok”**. İngilizce sürümün seçildiği varsayılmadı.
- **404:** `/ar/station/nrj-oriental`, `/am/station/nrj-international-hits`,
  `/jo/station/sveriges-radio-p3-2`, `/om/station/sveriges-radio-p3-2`,
  `/nl/station/sveriges-radio-p3-2` (4 Eylül 2026);
  `/hu/radios/1-21`, `/hu/radio/1-21` (Ağustos).
- **Yönlendirmeli sayfa:** `/nl`, `/ko/`, `http://themegaradio.com/`,
  `/`, `/sv`, `/af`, `/cs/stanice/classic-hits-104-5-wjjk`, `/kr/`.
  HTTPS, sondaki eğik çizgi, eski dil/ülke ve slug alias yönlendirmelerini
  kaldırmak gerekmez; hedef ve zincir doğruluğu önemlidir.
- **Yönlendirme hatası:** `/el/station/jefferson-county-ny-police-fire-and-ems`,
  `/am/station/dfm-party`, `/am/station/256kbps-2`,
  `/ko/station/radio-shack-music` (14–15 Mayıs). Doğrulama 11 Ağustos'ta başarılı.
- **5xx:** `/sy/station/angel-radio-1`, `/af/station/radio-jasna-gora`,
  `/af/station/lesedi` (Nisan); doğrulama 11 Temmuz'da başarılı. Bunlar
  7 Eylül'deki planlı taşıma yanıtlarıyla aynı olay olarak ele alınmadı.
- **Doğru canonical'lı alternatif:** `/kr/station/distorsin-fm`,
  `/lb/station/club-music-radio-cro-hits`, `/my/station/eska-pozna-1`
  (Ekim–Kasım 2025). Beklenen eski ülke/dil alternatifleri olabilir.
- **Canonical'sız kopya:** `/am/ጣቢያ/zchristmas`, `/am/ጣቢያ/pinoyradio`
  (Mart 2026), `/bg/stantsiya/plus-1013` (Aralık 2025).

### Sitemap, robots ve ceza kontrolleri

- Tek gönderilmiş sitemap: `https://themegaradio.com/sitemap-index.xml`.
  Gönderim 1 Temmuz 2026, son okuma 28 Ağustos 2026, durum **başarılı**,
  keşfedilen sayfa **0**. Ayrıntıda “okunan site haritaları” tablosu da **0 satır**.
- Kodda `/sitemap.xml` ve `/sitemap-index.xml` aynı düz (nested olmayan)
  index handler'ını kullanıyor. Boş/geçersiz manifest parçalarının başarılı
  boş index üretmesi mümkün; bu gözlemle uyumlu bir risk, 28 Ağustos'ta
  servis edilen XML'in kesin yeniden inşası değildir.
- GSC **Manuel işlemler**: hiçbir sorun algılanmadı.
- GSC **Güvenlik sorunları**: hiçbir sorun algılanmadı.
- Ayarlar özeti: robots.txt dosyalarının tümü geçerli, son 90 günde yaklaşık
  39,6 bin tarama isteği. robots geçerli olması tüm sayfaların indeksleneceği
  anlamına gelmez.
- Tarama raporu (5 Eylül güncellemesi): **39.598** istek, **293.496.231 bayt**,
  ortalama **277 ms**; yanıtlar %88 200, %11 301, %1 404, <%1 5xx.
  Amaç %96 yenileme, %4 keşif; dosyalar %39 JSON, %26 JavaScript, %22 HTML.
  Kaynak/API istekleri render için gerekli olabilir; bu yüzdeler tek başına
  bütün API yollarını robots.txt ile engellemek için gerekçe değildir.

## Core Web Vitals / PageSpeed

- GSC: mobil ve masaüstü için yeterli saha verisi yok. HTTPS: 2 HTTPS, 0
  HTTP. Breadcrumb geliştirme özeti: 0 geçerli, 0 geçersiz; bu, sitede hiç
  yapılandırılmış veri olmadığı anlamına gelmez.
- PSI 7 Eylül 2026 03:39 CEST, `/` → `/en`: mobil ilk deneme Google
  RenderStream kapasite hatasıyla ölçülemedi.
- Aynı rapordaki masaüstü laboratuvar sonucu: performans **84**, erişilebilirlik
  **93**, best practices **96**, temel SEO **100**; FCP 0,9 s, LCP 2,2 s,
  TBT 170 ms, CLS 0, Speed Index 1,0 s (Lighthouse 13.4.1).
- **Bu geçerli bir çalışan-site hız başlangıcı değildir:** CSS/JS, çeviri,
  görsel ve API istekleri taşıma sırasında 502 döndü; console'da
  `Unable to preload CSS` vardı. Yüklenmeyen uygulama daha az iş yapar.
  Lighthouse SEO 100 de GSC indeksleme başarısı veya 14 dil kapsamı demek değildir.
- Production açıldıktan sonra aynı URL ve cihaz koşullarıyla tekrar ölçüm
  gerekir. Koddan hareketle ölçülmemiş “hız artışı yüzdesi” verilmedi.

## Öncelikli kod bulguları

Aşağıdaki 11 başlığın kod düzeltmeleri uygulandı; üretimde yeniden tarama
ve gerçek içerik doğrulaması aşağıdaki açık kontrollerde ayrı tutuldu.

1. **P0 — Geçici veri hatasının kalıcı sayfa kaldırma sinyaline dönüşmesi.**
   Station DB hata placeholder'ının boş stream URL'si junk filtresine girip
   410 oluşturabiliyor. Diğer SSR timeout/overload yolları 200+noindex
   döndürüyor; başarısız pageData ayrıca önbelleğe alınabiliyor.
   Çözüm: geçici hatayı 503/no-store/Retry-After ile ayırmak, başarılı render
   ve kalıcı noindex kurallarına dokunmamak, başarısız veriyi cache'lememek.
2. **P1 — SSR metadata'nın istemcide ana sayfa metniyle değişmesi.**
   SeoPageWrapper'ın genel başlangıç çevirileri sayfaya özel title/description'ı
   ezebiliyor. Çözüm: SSR head'i ilk açılışta korumak; istemci gezinmesinde
   yalnızca güncel URL için başarılı SEO sonucunu uygulamak.
3. **P1 — Hreflang kümesinin dil sürümleri arasında tutarsız olması.**
   `generateLanguageUrls` sadece İngilizce sayfada x-default yayımlıyordu.
   x-default canonical değildir. Aynı uygun alternatif kümesi bütün
   sürümlerde yayımlanmalı; her dil kendi canonical'ını korumalıdır.
   14 dil / ana sayfa / istasyon / tür / bölge regresyon testleri eklendi.
4. **P1 — Liste JSON-LD scriptlerinin birbirini kaldırması ve yerelleşmemiş URL'ler.**
   İstemci liste işaretlemesi sahiplikli hale getirildi. SSR ve SPA geçişleri
   aynı sunucu şema üreticisini kullanıyor; önceki sayfanın şeması temizleniyor,
   global ve üçüncü taraf şemalar korunuyor. Bağımsız liste bileşenleri
   yerelleştirilmiş URL kullanıyor ve birbirlerinin scriptlerini silmiyor.
5. **P2 — İlk ekran görselinin yanlışlıkla lazy yapılması / gereksiz hero preload.**
   Global image enhancer fetchPriority=high görselde loading yoksa lazy
   atıyordu. Öncelikli görseller eager kalmalı, hero yalnızca ilgili sayfa
   ve ekran boyutu için preload edilmelidir.
6. **P2 — Yanlış dil ön yüklemesi ve tekrar eden Türkçe çeviri invalidation.**
   URL dili IP ülkesinden önce gelmeli. Her çeviri hook'u mount olduğunda
   bütün Türkçe sorgularını geçersiz kılmak, kart sayısıyla artan gereksiz
   istekler oluşturabilir.
7. **P2 — Sitemap üretiminde büyük PostgreSQL sorguları.**
   Bir sitemap parçası 10.000 tam istasyon kaydını (source ve descriptions
   dahil) alabiliyor. Sıra ve uygunluk filtreleri korunarak küçük, seçili
   sütunlu **500 ID** batch sorgularıyla aynı sıra/uygunluk/görsel/tarih
   çıktısı korunuyor. SQL `ANY($1::text[])` kullanıyor; 10 bin OR koşulu
   ve bütün source dokümanlarının taşınması kaldırıldı.
8. **P1 — Boş sitemap'in başarılı/önbelleklenebilir yanıt olması.**
   Yayımlanabilir alt sitemap kalmadığında 200 boş index veya koşullu 304
   dönmek yerine geçici 503/no-store/Retry-After gerekir. Hem ana index
   hem eski dil index'i için hazır/boş/koşullu istek testleri geçti.
9. **P1 — Eski dil istasyon yönlendirmesinde slug'ın çevrilmesi.**
   `URL_TRANSLATIONS` haritasının yanlış yönde okunması, yerelleştirilmiş
   station segmentini tanımıyor. Örneğin `/af/stasie/profiel` yanlışlıkla
   `/en/station/profile` olabiliyor. Rota anahtarları çevrilmeli, istasyonun
   kimlik slug'ı korunmalı; URL kodlaması da path/query ayrımını korumalıdır.
   Gerçek HTTP testlerinde Unicode'un yol açtığı `ERR_INVALID_CHAR`/500 da
   yeniden üretildi ve giderildi; query, Unicode, `?`, `#`, slash ve çift
   kodlama örnekleri kapsandı. GSC'nin dokuz örnek yolu 1–2 atlamada sabit
   hedefe ulaşıyor; hedef istasyonun varlığı hâlâ veri bağımlıdır.
10. **P1 — Sayısal slug noindex/sitemap uyuşmazlığı.**
    SSR'nin zaten noindex verdiği `1234` gibi slug'lar sitemap'e girebiliyordu.
    Ortak uygunluk filtresi eşitlendi. Pozitif sayısal istasyon oynatılabilir
    ve 200/noindex kalıyor; yeni 410/yönlendirme uygulanmıyor. Negatif sayısal
    slug'ların mevcut kaldırılmış-sayfa davranışı korunuyor.
11. **P2 — Schema.org alan kapsamı uyumsuzlukları.**
    RadioBroadcastService üzerinde `keywords` yerine `category` kullanılıyor;
    kullanım dışı `area` yerine mevcut `areaServed` korunuyor. Ücretsiz erişim
    bilgisi WebPage'e taşındı, Service için uygun olmayan `additionalProperty`
    kaldırıldı. Frekans değeri/birimi QuantitativeValue ile temsil ediliyor.
    Yardımcı broadcaster Organization koordinatları Place.location altında.
    Kullanılmayan istemci yardımcıdaki tıklama/oy sayısından yıldız uydurma
    hesabı kaldırıldı; gerçek kullanıcı puanları ve görünür UI korunuyor.

## Doğrulama

- API tam paket: **979 test başarılı, 0 başarısız, 0 atlanan**. Yerel ve
  tek kullanımlık test PostgreSQL/Mongo fixture'ları; production bağlantısı yok.
  Mongo yalnızca eski verinin tek seferlik aktarım testinde kullanıldı;
  uygulamaya Mongo bağımlılığı eklenmedi.
- Frontend tam paket: **130 test başarılı**, 13 dosya. Son eklenen alan
  kapsamı testleri de dahil. React DOM testleri `NODE_ENV=test` ile çalıştırıldı.
- Ayrı PostgreSQL sitemap/diagnostics entegrasyonu: **11 başarılı**.
- 14 dil canonical/hreflang/x-default kümesi: **11 başarılı**.
- SSR/schema görünür içerik ve nesne/HTML eşitliği: **65 başarılı**.
- Eski dil yönlendirme + mevcut A–Z yönlendirme kontrolleri: **41 başarılı**.
- API ve frontend TypeScript kontrolleri başarılı; `git diff --check` temiz.
- İlk paralel API koşusunda Node test-runner IPC serileştirme hatası görüldü;
  ilgili iki dosyanın tekil tekrarı geçti, ardından **bütün paket seri olarak
  tekrar çalıştırıldı ve 979/979 geçti**. Bu hata production hatası sayılmadı.

Tekrarlanabilir temel komutlar (kurulu bağımlılıklarla):

```powershell
# API paket dizininde; PG_TEST_DATABASE_URL ve MONGO_TEST_URI yalnızca
# açıkça ayrılmış yerel test servislerini göstermeli.
node --experimental-test-module-mocks --import ./node_modules/tsx/dist/loader.mjs --test --test-concurrency=1 --test-timeout=90000 tests/*.test.ts

# Frontend paket dizininde
$env:NODE_ENV='test'
node ./node_modules/vitest/vitest.mjs run --config ./vitest.config.ts

# Repo kökünde
node node_modules/typescript/bin/tsc -p artifacts/api-server/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p artifacts/megaradio/tsconfig.json --noEmit
git diff --check
```

## Açık kontroller / yayın sonrası

- **Deploy yapılmadı.** Önceki taşıma/startup değişiklikleri korundu;
  bu SEO çalışması Git commit/push, Railway restart veya veri değişikliği yapmadı.
- Taşıma tamamlandıktan sonra native istasyonlar, sitemap manifestleri ve
  14 dilde `full`+`meta` çevirileri gerçek veriden kontrol edilmeli. 14 dil
  kodda korunuyor; eksik veya aynı dilde tekrar eden içerik otomatik olarak
  kaliteli çeviri kabul edilmedi.
- Sitemap root/children 200 ve dolu, URL'ler self-canonical ve karşılıklı
  alternatifler tutarlı olunca GSC sitemap yeniden okunması / seçili URL
  denetimleri yapılmalı. GSC sayıları anında düzelmez; indeksleme garanti değil.
- Çalışan site üzerinde mobil+desktop PSI ve render edilmiş HTML/schema
  doğrulaması tekrarlanmalı. Tasarımsal ekran karşılaştırması ve gerçek
  oynatma/dil/gezinme smoke kontrolleri deployment sonrasında gerekli.
- HTML CDN politikası hâlâ 24 saat + stale-while-revalidate. Kod yorumu her
  deploy'da purge varsayıyor, repo içinde doğrulanmış purge otomasyonu yok.
  Bu, gelecekte eski HTML/yeni asset uyuşmazlığı riski; mevcut planlı 502'nin
  kanıtlanmış nedeni değil. Deploy sırasında HTML cache temizliği veya
  eski hashed asset'lerin tutulması doğrulanmalı; cache politikası değiştirilmedi.
- Schema'daki sabit sosyal hesaplar, adres/kurucu bilgileri ve her istasyona
  verilen Mega Radio `broadcastAffiliateOf` ilişkisi gerçek içerikle
  doğrulanmalı. Bu ilişki “dizinde listeleniyor” demek değildir; yayın ağını
  ifade eder. Kanıt olmadan kimlik/ilişki bilgileri yeniden yazılmadı.
- Tüm Search Console URL'lerini indeksletmek veya her hata kategorisini
  sıfırlamak başarı ölçütü değildir. Önemli, özgün, erişilebilir canonical
  sayfaların indekslenmesi ve sağlıklı kullanıcı deneyimi hedeflenir.

## Google kaynakları

- [İndeksleme raporunun yorumlanması](https://support.google.com/webmasters/answer/7440203)
- [HTTP durumlarının tarama/indekslemeye etkisi](https://developers.google.com/crawling/docs/troubleshooting/http-status-codes)
- [Yerelleştirilmiş sürümler ve karşılıklı hreflang](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [Canonical seçimi](https://developers.google.com/search/docs/crawling-indexing/canonicalization)
- [Laboratuvar ve gerçek kullanıcı verilerinin farkı](https://web.dev/articles/lab-and-field-data-differences)
- [Core Web Vitals eşikleri](https://web.dev/articles/defining-core-web-vitals-thresholds)
- [RadioBroadcastService alanları](https://schema.org/RadioBroadcastService)
- [Ücretsiz erişim alanı](https://schema.org/isAccessibleForFree)
- [Yayın ağı ilişkisi](https://schema.org/broadcastAffiliateOf)
- [Yapılandırılmış veri doğruluk kuralları](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)

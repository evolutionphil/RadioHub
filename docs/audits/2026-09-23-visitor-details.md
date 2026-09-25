# Tekil IP dashboard detayları

## Kapsam

Admin dashboard'un Active unique IPs / Unique IPs today / Unique IPs last 7 days kartları bir detay penceresi açar. Kayıtlı hesap sayısı ziyaretçi sayısı değildir; o karta bu pencere bağlanmaz. Görünüm mevcut admin tasarımını korur, dar ekranda tek sütun filtreler ve kaydırılabilir içerik kullanır. Escape ile kapatma, klavye odağını karta geri verme, yüklenme/boş/hata/yeniden deneme durumları bulunur.

Detaylar: ülke, kanal (web/app/TV), platform, cihaz sınıfı, işletim sistemi, tarayıcı, maskelenmiş ağ, ilk/son etkinlik ve bilginin kaynağı. Ülke/platform/cihaz filtreleri ve 25 kayıtlık sayfalama vardır. Dağılımlar filtrelerden önce tüm seçilen zaman aralığını gösterir.

## Sayımın anlamı ve sınırları

- Her kanonik IP için tek PostgreSQL kaydı; aynı IP farklı kullanıcı, sekme veya cihazlarla gelirse çoğalmaz.
- Aktif = son 30 dakika, bugün = Europe/Berlin gece yarısından beri, hafta = son 7 gün. Bunlar doğrulanmış insan, eşzamanlı dinleyici veya cihaz sayısı değildir.
- Atıf en son örneklenen başarılı uygulama isteğine aittir; cihaz/ülke değiştiğinde aynı IP kaydı güncellenir. Ayrı cihaz geçmişi ve önceki günlerin coğrafi raporu üretilmez.
- Yazmalar yanıt tamamlandıktan sonra başlar, aynı IP istekleri süreç başına 30 saniyelik aralıklarda birleştirilir. Bot/monitor/admin/statik dosya/stream istekleri ve başarısız yanıtlar hariçtir. Cache'den görüntülenen sayfalar veya yalnızca ses dinlemeye devam etmek yeni API isteği üretmeyebilir.
- Özet ve detay bağımsız, kısa ömürlü anlık görüntülerdir; zaman damgaları farklıysa artan/azalan aktif sayılar eşit olmak zorunda değildir.
- Eski kayıtların cihaz/ülkesi geriye dönük tahmin edilmez. `dimensionsStartedAt` migration zamanı, `contextCollectedAt` son metadata ölçümüdür. Eski kayıt yeni uygun istek yapana kadar bilinmiyor kalır.

## İstemci ve ülke tespiti

`X-MegaRadio-Platform` allowlist: `web`, `ios`, `android`, `tizen`, `webos`, `tvos`, `androidtv`, `desktop`. Başlık beyanı kimlik doğrulama değildir. CORS'ta başlık izinli; origin politikası gevşetilmedi. Native kod bu depoda bulunmadığından mevcut uygulamalara uzaktan başlık eklenmiş değildir; [mobil API rehberi](../mobile/API.md) entegrasyonunu uygulama geliştiricisi yapmalıdır. Başlık zorunlu değildir, geriye uyumluluk korunur.

Başlık yoksa kaba User-Agent sınıflandırması yapılır. Samsung Internet telefonu Tizen TV sanılmaz; LG'nin `Web0S` yazımı desteklenir. Yalnız `okhttp` veya `CFNetwork/Darwin` platform kanıtı değildir. Masaüstü görünümü isteyen tabletler User-Agent nedeniyle masaüstü gibi algılanabilir. Samsung/LG platform tespiti TV tarayıcısı ile paketlenmiş uygulama arasında kesin ayrım vaat etmez. [Samsung UA belgesi](https://developer.samsung.com/browser/user-agent-string-format.html), [Samsung WebSetting API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/websetting-api.html), [LG web motoru belgesi](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine).

Ülke yalnız mevcut güvenilen özel proxy/Cloudflare IP zinciri üzerinden gelen geçerli ISO2 `CF-IPCountry` değeridir; `XX`, `T1`, hatalı/eksik kodlar bilinmiyor olur. Seçili ülke, dil, profil veya doğrudan public bağlantıdan sahte CF başlığı ülke kaynağı değildir. Proxy'nin edge başlıklarını koruma/temizleme sözleşmesi mevcut IP sayımıyla aynıdır; origin erişim kontrolü yerine geçmez. VPN, paylaşımlı NAT ve mobil operatörler ülkeyi/tekilliği etkileyebilir. Ülke bilgisi yaklaşık IP konumudur, fiziksel konum değildir. [Cloudflare başlık belgesi](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

## API, saklama ve performans

`GET /api/admin/visitor-metrics/details?window=active&page=1&limit=25`

Opsiyonel filtreler: `country=DE|unknown`, `platform=<enum>`, `deviceType=desktop|mobile|tablet|tv|unknown`. Zaman aralığı `active|today|week`; limit en fazla100, page en fazla999999. Beklenmeyen/tekrarlanan/hatalı parametreler400; yönetici oturumu zorunlu; veri kaynağı başarısızsa503 ve eski veri/uydurma sıfır gösterilmez. Yanıt private/no-store. API sözleşmesi için kaynak: [route](../../artifacts/api-server/src/routes/visitor-metrics-routes.ts), [query/types](../../artifacts/api-server/src/data/postgres-visitor-metrics.ts).

Yeni tablo yok; migration0038 mevcut `qualified_visitor_presence` tablosuna sınırlı metadata kolonları ekler. Raw User-Agent, model/seri numarası, parmak izi, token veya kullanıcı kimliği bu ölçüme kaydedilmez. Mevcut kanonik IP anahtarı sunucuda kalır; admin API yanıtında SQL tarafından IPv4 /24 ve IPv6 /48 ağ maskesi uygulanır. Aynı maskeyi paylaşan satırlar farklı IP'ler olabilir. Saklama mevcut 30 günlük son-etkinlik temizliğine bağlıdır.

Detay sorgusu yalnız modal açıkken; sıralı/filtreli sonuçlar tek SQL anlık görüntüsünden, mevcut last_seen indeksi ile en fazla7 günlük aralıktan gelir. 15 saniyelik/128 anahtarlık sunucu cache'i aynı okumaları birleştirir; süreç başına aynı anda en fazla4 farklı detay okuması çalışır. Her okuma read-only transaction içinde yerel 3 saniyelik PostgreSQL statement timeout kullanır; hata halinde rollback, her durumda bağlantı bırakma ve başarısız rollback halinde bağlantı imhası vardır. Ortak havuzun oturum timeout'u değiştirilmez. Tarayıcı sorgusu kapanış/değişiklikte iptal edilir. Harici ücretli GeoIP/analytics servisi, yeni heartbeat veya normal kullanıcı sayfasına ek JS/HTTP ölçüm isteği yoktur.

## Yayın ve doğrulama

Bu çalışma yerel kod değişikliğidir; canlıya gönderim yapılmadan yeni dashboard görünmez. Yayın sırasında mevcut migration runner0038'i backend başlamadan uygulamalıdır. Ardından yeni normal web/app/TV istekleri metadata'yı doldurur; eski sayaçlar backfill edilmez. Eski istemcileri kıracak zorunlu parametre yoktur.

Doğrulama:

- Yayın öncesi `main`, uzak `3085b609a` commit'ine fast-forward edildi; mevcut mobil sosyal giriş düzeltmeleri korundu. Birleşimden sonra ziyaretçi ve mobil Google/Apple doğrulama testleri birlikte **63/63**, API TypeScript ve production build kontrolleri başarılı. Railway'deki 37 çeviri işi incelendi; çalışan iş yok. Son ana iş ve sitemap yayın aşaması tamamlanmış; 40 başarısız kayıt tamamlandı diye gizlenmedi.

- Backend: **59/59 test**, atlanan yok. PGlite üzerinde gerçek PostgreSQL0037+0038 migration/query semantiği, sayım pencereleri, metadata güncelleme, subnet maskeleme, admin yetkisi, giriş doğrulama, cache/concurrency, transaction timeout ve pool bırakma senaryoları geçti.
- Frontend tam regresyon: **127 dosya / 1.791 test** geçti. İlk toplu koşuda yeni testlerin ikisi cache hit'te gereksiz ağ isteği beklediği için başarısızdı; testler doğru UI/cache davranışını doğrulayacak şekilde düzeltildi, tüm suite tekrar geçti.
- Kütüphaneler, API ve frontend TypeScript kontrolleri başarılı.
- API production bundle ve Vite frontend production build başarılı. Vite'ın mevcut sourcemap/chunk-size uyarıları devam eder; build hatası değildir.
- Gerçek bileşen ve mevcut admin CSS ile loopback üzerinde açıkça sentetik fixture kullanılarak masaüstü,390px ve320px tarayıcı görünümü kontrol edildi. LG webOS filtresi yalnız doğru fixture kaydını gösterdi; her iki mobil genişlikte yatay sayfa taşması yoktu.320px'de parçalanan dağılım etiketleri için380px altı tek sütuna geçirildi. Canlı müşteri verisi/oturumu fixture'a taşınmadı, dış API erişimi yoktu; geçici tarayıcı boyutu geri alındı.
- Canlı deploy veya gerçek native cihaz ölçümü yapılmadı. Mevcut bağlı tarayıcıda canlı sayaç endpoint'ini açma denemesi `ERR_BLOCKED_BY_CLIENT` ile engellendi; bu yüzden canlı sayı/ülke/cihaz doğrulaması iddia edilmez. Tarayıcı güvenlik/gizlilik ayarları değiştirilmedi.

## Yayın sonrası doğrulama — 23 Eylül 2026

Yukarıdaki son madde yayın öncesi durumu kaydeder. Kullanıcının deploy onayıyla `2ed71a411ae2a1b5706eaed63aef5a6620f9b4eb`, GitHub Desktop'taki mevcut `evolutionphil` hesabıyla `main` dalına gönderildi; uzak HEAD eşleşmesi doğrulandı. İlgisiz GSC raporu commit'e alınmadı.

- Railway web deployment `a9751b8f` ve API deployment `d196ac6b` aynı commit için **Active / Deployment successful**. Stream servisi mevcut GitHub otomasyonuyla da build aldı ve Online kaldı. Ek restart yapılmadı; PostgreSQL veya stream ayarlarına dokunulmadı.
- `radiohub_schema_migrations` tablosunda `0038_qualified_visitor_dimensions.sql` uygulanmış: `2026-09-23 07:13:56`. Önceki0037/collection başlangıcı korunmuş.
- Yetkili canlı dashboard'da aktif, bugün ve son7gün detayları açıldı. Haftalık sayfalama1→2 çalıştı; LG webOS filtresi mevcut veride dürüst boş sonuç gösterdi. Yeni gerçek isteklerde HK/US ülke, web kanal/platform ve desktop cihaz sınıfı görülürken eski kayıtlar unknown kaldı. Maskeleme ve ölçüm başlangıç açıklamaları görünür. Yeni iOS/Android/TV uygulama sürümü veya fiziksel cihaz testi yapılmadı.
- Son tek geçişli kontroller: `/en`200 HTML; API `/readyz`200 ready:true; `/api/health`200 PostgreSQL connected; bir kayıt istenen katalog200 JSON+pagination. Yetkisiz ziyaretçi detay endpoint'i401 JSON, private/no-store, ziyaretçi satırı yok.
- Önceki tarayıcı engeli yeni sayfa yüklemesinde tekrarlanmadı; gizlilik veya güvenlik ayarları değiştirilmedi.

Bu yayın sonrası not yerel doğrulama kaydıdır; yalnızca notu yayımlamak için ikinci build/restart tetiklenmedi.

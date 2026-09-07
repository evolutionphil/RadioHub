# Railway: otomatik ilk PostgreSQL kurulumu

Bu otomasyon kodu canlı aktarımın tamamlandığı anlamına gelmez. Yalnızca
`DATABASE_URL` bağlantısı, eski MongoDB adresini veya diğer servislerin yazmayı
bıraktığını belirlemeye yetmez. Bağlantılar ve güvenli geçiş koşulları bir kez
hazırlandıktan sonra SQL veya aktarım komutu elle çalıştırılmaz.

## Otomatik akış

1. API ve web başlangıç script'i 24 sürümlü SQL değişikliğini kilit altında
   uygular. Uygulanmış dosyaları SHA-256 ile kontrol edip atlar; mevcut şemayı
   sıfırlamaz. Şema hatasında uygulamayı başlatmaz.
2. Ayrı, geçici `postgres-initializer` servisi de aynı şema kurucusunu kullanır.
   İlk kurulumda MongoDB primary üzerinden bütün koleksiyonları okur,
   PostgreSQL tablolarına aktarır, kimlik/içerik/ilişki doğrulamasını çalıştırır.
3. API ve web doğrulama tamamlanana kadar uygulama modüllerini ve işleri yüklemez.
   Başlangıç kontrolü varsayılan olarak süre sınırı olmadan, 5 saniyelik aralıklarla
   bekler. Şema kurulduktan ve veri aktarımının henüz hazır olmadığı belirlendikten
   sonra aynı `PORT` üzerinde küçük bir bakım sunucusu açılır. `/healthz` yalnız
   sürecin çalıştığını bildirir (200, `ready:false`); `/readyz` ve uygulama istekleri
   503 kalır. Web bakım sayfası otomatik yenilenir; yanıtlar önbelleğe alınmaz.
   Doğrulama tamamlanınca bakım sunucusu portu bırakır ve gerçek uygulama otomatik
   başlar. Manuel normalize/verify/başlat komutu gerekmez. Gerçek yapılandırma,
   şema veya bağlantı hataları başarı gibi gösterilmez.
4. Başarılı aktarım kalıcı `migration_runs` ve `migration_checkpoints` kayıtlarıyla
   belirlenir. Sonraki initializer çalışmaları MongoDB'ye bağlanmadan çıkar.
   PostgreSQL yazma yetkisi zaten etkinse eski kaynağı hiçbir zaman tekrar oynatmaz.

API, web ve proxy imajlarında MongoDB sürücüsü bulunmaz. Sürücü yalnızca ayrı
tek seferlik operatör imajındadır; uygulamanın bağımlılığı değildir.

## Bir kez yapılması gereken Railway bağlantıları

Önce bağımsız, geri yüklenebilir MongoDB yedeği alınmalı ve **bütün eski API/web,
worker, cron ve WebSocket yazıcıları durdurulmalıdır**. Rolling deploy bunu
garanti etmez: yeni sürüm hazır olana kadar eski sürüm yazmaya devam edebilir.
Bu script başka servisleri kapatmaz, yedek aldığını varsaymaz, MongoDB'yi kilitlemez
ve kaynak veriyi silmez. Onay değişkenleri bu işlemlerin yerine geçmez.
Uygulama yazıcılarını durdurmak MongoDB'nin TTL silmelerini durdurmaz; kaynak
dondurma koşulları aşağıdaki TTL kontrol listesiyle birlikte sağlanmalıdır.

Yeni bir geçici servis, aynı GitHub deposunu ve depo kökünü kullanır. **Yeni
servislerde Dashboard ayarlarını açıkça yapılandırın:** build türü Dockerfile,
dosya `Dockerfile.migration`, başlangıç Docker CMD'si (`node dist/bootstrap.mjs`),
HTTP healthcheck kapalı, restart politikası `ON_FAILURE` ve en fazla **3** yeniden
deneme. Public domain veya cron gerekmez. Başarılı süreç `0` ile çıkar; sürekli
yeniden başlatan `Always` politikasını kullanmayın.

**Railway yapılandırma değişikliği (2026-09-07 kontrolü):** Config as Code artık
deprecated durumdadır. Dashboard uyarısına göre 2026-08-28'den itibaren bu özelliği
daha önce kullanmamış servisler yeni katılım yapamaz. Mevcut legacy
`railway.json` / `railway.toml` kullanımları ise 2026-12-01'e kadar desteklenir.
[Resmî Config as Code belgesi](https://docs.railway.com/config-as-code) yeni
servislerin katılamadığını ve bu son tarihi doğrular. Depodaki
`railway.migration.json` yalnız desteklenen mevcut kullanımlar için referanstır;
dosyayı eklemek veya push etmek yeni servisin Dashboard ayarlarını değiştirmez.

Deployment detayında gerçekten kullanılan Dockerfile, başlangıç komutu,
healthcheck ve restart değerlerini kontrol edin; yalnız dosyanın varlığına
güvenmeyin. Legacy dosya gerçekten etkinse Dashboard değerlerini geçersiz
kılabilir. Railway'in yerine önerdiği
[Infrastructure as Code](https://docs.railway.com/infrastructure-as-code)
proje kapsamlıdır; bu ilk aktarım runbook'u bütün projeyi otomatik IaC'ye taşımaz.
Çalışan aktarım servisini sırf başlangıç iyileştirmesi için yeniden deploy etmeyin.

| Servis | Değişken / ayar |
| --- | --- |
| PostgreSQL | Mevcut veritabanı; uygulama veya importer Dockerfile'ını bu servise uygulamayın. |
| Geçici initializer | `DATABASE_URL`: aynı PostgreSQL servisinden referans. |
| Geçici initializer | `MONGODB_URI`: eski uygulamanın gerçek Mongo bağlantısı; URL'de uygulama veritabanı adı açıkça bulunmalı. |
| Geçici initializer | `MIGRATION_SOURCE_WRITERS_STOPPED=true`: gerçekten tüm kaynak yazıcılar durdurulduktan sonra. |
| Geçici initializer | `MIGRATION_TARGET_WRITERS_STOPPED=true`: gerçekten tüm hedef yazıcılar durdurulduktan sonra. |
| Geçici initializer | `MIGRATION_SOURCE_BACKUP_CONFIRMED=true`: bağımsız yedeğin geri yüklenebilirliği doğrulandıktan sonra. |
| API ve web | Mevcut PostgreSQL `DATABASE_URL` referansı; doğru TLS/CA ayarları. `POSTGRES_INIT_MODE` varsayılanı `import`, değiştirmeyin. |
| API ve web | Dockerfile sırasıyla `Dockerfile.api` ve `Dockerfile.web`; eski özel Start Command varsa kaldırın, yeni Docker CMD kullanılsın. |
| API ve web | Railway Settings → Deploy → Healthcheck Path: `/healthz`. `/readyz` gerçek uygulama hazırlığını izlemek içindir; uzun ilk aktarım sırasında Railway deploy kontrolü olarak kullanılmaz. |
| API ve web | `POSTGRES_INIT_WAIT_MS` yoksa süresiz bekler. Eski sonlu değer varsa kaldırın veya `forever` kullanın. Yeni değişken zorunlu değildir. |
| API | Mevcut güçlü `SESSION_SECRET` korunur. |
| Web | `BACKEND_API_URL` gerçek API servis adresini göstermeli. |

Kaynak MongoDB bilgilerini API/web değişkenlerine veya Git dosyalarına eklemeyin.
Initializer başarılı olduktan sonra kaynak bağlantısını bu geçici servisten
kaldırabilirsiniz. MongoDB'yi hemen silmeyin; yedek ve karşılaştırma süresi boyunca
salt okunur tutun.

`POSTGRES_SSL_CA` gerektiren bağlantıda doğru CA sağlayın; sertifika doğrulamasını
sadece bağlantıyı çalıştırmak için kapatmayın. Özel ağdaki PostgreSQL referansı
kullanılabilir; bu akış veritabanını public ağa açmayı gerektirmez.

**Zaten durmuş eski sürüm:** Yeni launcher kodu eski/crashed container'ı uzaktan
başlatamaz. Yeni kodun API/web'e bir kez deploy edilmesi ve yukarıdaki sağlık
kontrolünün seçilmesi gerekir; bundan sonra devam eden aktarımın bitişi otomatik
algılanır. Dockerfile sağlık kontrolü değişikliği Railway Dashboard ayarını
değiştirmez. Aynı GitHub push aktarım servisini de yeniden deploy edecekse önce
aktarımın bitmesini bekleyin veya yalnız API/web'i hedefleyen dağıtım kullanın.
Railway'de bakım sunucusu `Active` görünse bile bu veri aktarımının tamamlandığını
göstermez; gerçek hazır olma ölçütü uygulama `/readyz` yanıtıdır.

## Kaynağı gerçekten dondurma: TTL kontrolü ve güvenli kurtarma

MongoDB TTL temizliği `mongod` içindeki arka plan işlemiyle yürür. API, web,
worker ve cron kapalıyken de süresi dolan kayıtlar silinebilir. Kaynak bağlantı
hesabını salt okunur yapmak veya `MIGRATION_SOURCE_WRITERS_STOPPED=true` vermek
bu işlemi durdurmaz. Time-series koleksiyonlarında koleksiyon düzeyindeki
saklama süresi de ayrıca incelenmelidir. Bu davranış MongoDB'nin
[TTL belgelerinde](https://www.mongodb.com/docs/manual/core/index-ttl/) açıklanır.

İlk aktarım veya kaynak değiştikten sonra yeni aktarım için kontrol listesi:

1. Bütün kaynak koleksiyonlarında TTL indekslerini ve time-series saklama
   ayarlarını salt okunur envanterleyin. İndeks tanımlarını, `expireAfterSeconds`,
   varsa kısmi filtreleri ve koleksiyon seçeneklerini **özgün değerleriyle**
   bağımsız olarak yedekleyin. Sadece uygulama şema dosyasına bakmak, canlı
   indekslerin aynı olduğunu kanıtlamaz.
2. İlgili tarih alanlarının türlerini, eksik/geçersiz değerlerini, en eski/yeni
   tarihlerini ve UTC zamanını doğrulayın. Ancak bundan sonra, gerekiyorsa,
   aktarım ve doğrulamaya yetecek **sınırlı ve geri alınabilir** bir saklama
   düzenlemesi planlayın. Her değişiklik için kapsam, son zaman sınırı ve özgün
   ayara dönüş planı bulunmalıdır. Körlemesine uzun bir TTL değeri atamayın,
   indeksleri silmeyin veya kayıtların tarih/sona erme alanlarını değiştirmeyin.
   Uygun sınırlı dondurma sağlanamıyorsa değişmez, izole bir kaynak anlık
   görüntüsü kullanın. Bu belge herhangi bir canlı TTL değişikliğini otomatik
   olarak yapmaz veya onaylamaz.
3. Tüm eski uygulama yazıcılarını ve hedef yazıcılarını durdurun; rolling deploy,
   zamanlanmış işler ve başka replikaların yazmaya devam etmediğini doğrulayın.
   Dondurulmuş kaynağın ve mevcut PostgreSQL'in bağımsız yedeklerini alın.
   Yedeklerin yalnız oluştuğunu veya listeye açıldığını kontrol etmek yetmez:
   izole ortama gerçekten geri yükleyin; bütün tablo/koleksiyon sayılarını,
   kimlikleri, JSON/BSON checksum'larını ve ilişkileri doğrulayın. Kaynak aktarım
   boyunca aynı kalmalı; kısa süreli eşit sayımlar tek başına bunu garanti etmez.
4. Önceki aktarımda kaynak sayısı/içeriği zaten değişmişse eski PostgreSQL'i,
   `legacy_documents` kayıtlarını, kontrol noktalarını ve yedeklerini koruyun.
   Doğrulanmış sabit kaynaktan **yeni, boş ve izole bir PostgreSQL veritabanına**
   aktarın; mevcut veritabanını/şemayı sıfırlamayın. Aynı şemada yazma yetkisini
   veya çalışma işaretlerini silerek yeniden başlatmayın. Sayıları eşitlemek için
   `MIGRATION_PRUNE` açmayın; süresi dolmuş token, oturum veya geçici kayıtları
   canlı MongoDB'ye geri yüklemeyin ve sürelerini yenilemeyin. Eski arşivde kalan
   kayıtlarla güncel kaynak arasındaki farkı açıklamadan kayıpsızlık iddia etmeyin.
5. Yeni hedefte tüm kopyalama, normalizasyon ve doğrulama adımları başarıyla
   bitmeden uygulama bağlantılarını değiştirmeyin. Kalıcı çalışma/kontrol noktası
   başarısı, kaynak-hedef karşılaştırması ve gerçek uygulamanın `/readyz` yanıtını
   birlikte kontrol edin. Varsa geçici saklama ayarlarını özgün değerlerine
   döndürmek ayrı, kontrollü bir adımdır; yeniden etkinleşen silmelerin etkisini
   değerlendirin ve yedekleri koruyun.

**Başarılı yedek veya geri yükleme, tamamlanmış veri aktarımı değildir.** Örneğin
`legacy_documents` içeriğinin doğrulanması o arşivin sağlamlığını gösterir;
`stations`, `users` ve diğer uygulama tablolarının dolduğunu, güncel MongoDB'nin
tamamının taşındığını veya production'ın hazır olduğunu tek başına göstermez.

## Hata / yeniden deneme

- Yarım aktarım nedeniyle başlangıç durursa initializer, mevcut PostgreSQL
  kayıtlarından `[bootstrap:diagnostic]` satırlarını üretir. Son çalışmanın
  durumu/zamanı, kontrol noktalarındaki ilerleme ve varsa kayıtlı hatanın güvenli
  kategorisi gösterilir. Bu teşhis yalnız okuma yapar; aktarımı yeniden oynatmaz,
  kayıt silmez ve MongoDB'ye bağlanmaz. Ham hata metni, bağlantı bilgileri ve
  müşteri verileri loga yazılmaz.
- Son çalışma `running` kalmış ve hata kaydedilmemişse kesintinin nedeni bu
  kayıttan belirlenemez. Bellek sınırı, zorla sonlandırma veya deployment değişimi
  varsayılmamalıdır; Railway kapanış bilgisi ayrıca kontrol edilmelidir. Teşhis
  çıktısının alınması, aktarımın tamamlandığı veya güvenle yeniden başlatılabileceği
  anlamına gelmez.
- `[mirror]` aşamasında veriler PostgreSQL'deki `legacy_documents` tablosuna
  paketler halinde kalıcı yazılır; ilerleme `migration_checkpoints` içindedir.
  Bütün koleksiyonlar kopyalandıktan sonra `[normalize]` uygulama tablolarını
  doldurur. Bu yüzden henüz `stations` veya `users` içinde satır görünmemesi,
  hiçbir verinin aktarılmadığı anlamına gelmez.
- Eksik bağlantı/onay veya doğrulama hatasında boş sistem başarıyla açılmış gibi
  davranılmaz; API/web'in ilk PostgreSQL yazma yetkisi verilmez.
- İlk kopyalama kesildiyse sınırlı, **silmesiz otomatik devam** vardır: yalnız tek
  `all` çalışması, aynı kaynak veritabanı, aynı çalışmaya ait `legacy_documents`,
  boş uygulama tabloları ve etkinleşmemiş PostgreSQL yazma yetkisi kabul edilir.
  Eski `running` / hatasız yarım kayıt veya yeni kodun yalnız kopyalama sırasında
  kaydettiği tanımlı `interrupted` işareti gerekir. Sıradan `failed` kayıtlar,
  normalizasyon sonrası kesintiler ve belirsiz durumlar otomatik oynatılmaz.
- Devam etmeden önce **bütün mevcut kopyalar** MongoDB primary üzerindeki kaynakla
  BSON türü, kimlik, içerik ve checksum açısından salt okunur doğrulanır. Kayıp veya
  değişmiş kayıt, bilinen kaynak sayısındaki değişiklik ya da yeni hedef verisi
  varsa durur. Daha önce okunmamış kaynak kayıtlarının geçmiş hâli doğrulanamaz;
  kaynak yazıcıları kapalı tutma ve bağımsız yedek koşulları geçerliliğini korur.
- `Initial capture resume refused source-count drift` bir koruma reddidir:
  kaynağın eski kontrol noktasındaki sayısı değiştiği için yazmadan durur.
  Yeni hata metni koleksiyon adı/kimlik/içerik yerine sıralı koleksiyon
  numarasını (`collection <sıra>/<toplam>`), `recorded` ve `current` sayılarını,
  `change=growth` (artış) veya `change=shrink` (azalış) bilgisini gösterir.
  Bu çıktı nedeni tek başına kanıtlamaz; uygulama yazıları, TTL envanteri ve
  kaynak kimliği ayrıca incelenir. Aynı koşullarda sürekli yeniden başlatmak
  hatayı gidermez. Kontrol noktasındaki sayıyı değiştirmeyin, checksum/kimlik
  korumalarını atlamayın; yukarıdaki dondurma ve yeni hedef kurtarma akışını
  uygulayın.
- Doğrulama geçerse aynı çalışma baştan okunur: mevcut kayıtlar yeniden yazılmaz,
  yalnız eksikler eklenir. Kayıtlar ve checkpoint aynı transaction içinde yazılır.
  `[resume:validation]`, `[mirror:progress]` ve aşama logları ilerlemeyi gösterir.
  İşlem tamamlanana kadar yeni deployment başlatmayın; aktarım servisinin HTTP
  healthcheck'i kapalı, etkin Dockerfile/başlangıç/restart ayarları yukarıdaki
  Dashboard kontrol listesiyle uyumlu olmalıdır.
- Diğer yarım aktarımlar veya önceden var olan satırlar otomatik silinmez. Böyle
  bir durumda güvenli yeniden uzlaştırma runbook'u gerekir. `MIGRATION_PRUNE`
  normal ilk kurulumda veya silmesiz devamda açılmaz; yalnız durdurulmuş
  kaynak/hedef ve tam kaynak kimliğiyle incelenmiş uzlaştırmada kullanılabilir.
- `PostgreSQL already owns application writes` mesajı **Mongo aktarımının yapıldığına
  kanıt değildir**; artık geçmiş veriyi tekrar yazmanın güvenli olmadığını söyler.
  Erken başlatılmış boş bir hedefte yazma-yetkisi işaretlerini silmeyin.
- `POSTGRES_INIT_MODE=empty` yalnız eski verilerin taşınmayacağı bilinçli, sıfırdan
  kurulum içindir. Bu projenin mevcut verilerini taşırken **kullanmayın**. Başlamış
  veya başarısız bir aktarımı atlatmak için de kullanılamaz.

Şema bekleme / sorgu sınırları: `POSTGRES_INIT_WAIT_MS` (varsayılan veya `forever`:
süresiz; açıkça verilen sayı: 0–3600000 ms), `POSTGRES_MIGRATION_LOCK_TIMEOUT_MS` (varsayılan 60000),
`POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS` (varsayılan 300000).

Aktarım paketi varsayılan olarak 250 belge ve 4 MiB serileştirilmiş JSON+BSON
bütçesiyle sınırlıdır. Yeni değişken eklemek gerekmez. İsteğe bağlı
`MIGRATION_BATCH_SIZE` (10–1000) ve `MIGRATION_BATCH_MAX_BYTES` (65536–16777216)
tam sayı olmalıdır; geçersiz değer bağlantı açılmadan reddedilir. Tek büyük belge
ayrı işlenir, atılmaz. Devam doğrulamasında tek belgenin birleşik JSON+BSON
sınırı 16 MiB'dir; daha büyüğü sessizce atlanmadan inceleme için durdurulur.

PostgreSQL havuzu ve kilit bağlantısı hataları, SIGTERM/SIGINT ve koordinatör
bağlantı kaybı kontrollü kesinti sayılır. Tüm aktarım SQL'i aynı veri kilidini
tutan fiziksel bağlantıyı kullanır. Kesintiden sonra yeni yazı başlatılmaz;
uzayan SQL için 5 saniyelik kapanış toleransından sonra bağlantı sonlandırılır.
Railway'in zorla kapatması veya işletim sistemi bellek sınırı kodla engellenemez;
bu durumda hata işareti yazılamayabilir. Yukarıdaki doğrulamalar güvenli devam
için tekrar uygulanır; bu korumalar production kesintisinin nedenini kanıtlamaz.

Operatör ortamında eşdeğer giriş: `pnpm --filter @workspace/legacy-migration bootstrap`.
Bu komut ve tek seferlik imaj aynı akışı kullanır. Üretim API/web imajları bu
paketi çalıştırmaz veya yüklemez.

Kaynaklar: [Railway sağlık kontrolleri](https://docs.railway.com/deployments/healthchecks),
[Railway config-as-code desteği](https://docs.railway.com/config-as-code),
[yeniden başlatma politikaları](https://docs.railway.com/deployments/restart-policy),
[PostgreSQL servis bağlantıları](https://docs.railway.com/databases/postgresql).

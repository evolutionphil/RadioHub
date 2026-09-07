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
   Başlangıç kontrolü varsayılan olarak 4 dakika, 5 saniyelik aralıklarla bekler;
   hâlâ hazır değilse sıfır olmayan kodla çıkar. Yeniden başlatmada tekrar kontrol
   eder. Çok büyük aktarımlarda platformun healthcheck ve retry süreleri de
   aktarım süresine uygun olmalıdır; eski canlı deployment kendiliğinden durmaz.
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

Yeni bir geçici servis, aynı GitHub deposunu ve depo kökünü kullanır. Yalnız bu
servisin Railway Config File yolu `/railway.migration.json` olmalıdır. Bu ayar
`Dockerfile.migration` imajını ve otomatik başlangıç komutunu seçer. Public domain,
HTTP healthcheck veya cron gerekmez. Başarılı süreç `0` ile çıkar; sürekli yeniden
başlatan `Always` politikasını kullanmayın.

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
| API | Mevcut güçlü `SESSION_SECRET` korunur. |
| Web | `BACKEND_API_URL` gerçek API servis adresini göstermeli. |

Kaynak MongoDB bilgilerini API/web değişkenlerine veya Git dosyalarına eklemeyin.
Initializer başarılı olduktan sonra kaynak bağlantısını bu geçici servisten
kaldırabilirsiniz. MongoDB'yi hemen silmeyin; yedek ve karşılaştırma süresi boyunca
salt okunur tutun.

`POSTGRES_SSL_CA` gerektiren bağlantıda doğru CA sağlayın; sertifika doğrulamasını
sadece bağlantıyı çalıştırmak için kapatmayın. Özel ağdaki PostgreSQL referansı
kullanılabilir; bu akış veritabanını public ağa açmayı gerektirmez.

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
- Yarım kalmış aktarım veya önceden var olan satırlar otomatik silinmez. Böyle
  bir durumda güvenli yeniden uzlaştırma runbook'u gerekir. `MIGRATION_PRUNE`
  normal ilk kurulumda açılmaz; yalnız durdurulmuş kaynak/hedef ve tam kaynak
  kimliğiyle incelenmiş uzlaştırmada kullanılabilir.
- `PostgreSQL already owns application writes` mesajı **Mongo aktarımının yapıldığına
  kanıt değildir**; artık geçmiş veriyi tekrar yazmanın güvenli olmadığını söyler.
  Erken başlatılmış boş bir hedefte yazma-yetkisi işaretlerini silmeyin.
- `POSTGRES_INIT_MODE=empty` yalnız eski verilerin taşınmayacağı bilinçli, sıfırdan
  kurulum içindir. Bu projenin mevcut verilerini taşırken **kullanmayın**. Başlamış
  veya başarısız bir aktarımı atlatmak için de kullanılamaz.

Şema bekleme / sorgu sınırları: `POSTGRES_INIT_WAIT_MS` (0–3600000, varsayılan
240000), `POSTGRES_MIGRATION_LOCK_TIMEOUT_MS` (varsayılan 60000),
`POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS` (varsayılan 300000).

Operatör ortamında eşdeğer giriş: `pnpm --filter @workspace/legacy-migration bootstrap`.
Bu komut ve tek seferlik imaj aynı akışı kullanır. Üretim API/web imajları bu
paketi çalıştırmaz veya yüklemez.

Kaynaklar: [Railway config-as-code](https://docs.railway.com/config-as-code/reference),
[yeniden başlatma politikaları](https://docs.railway.com/deployments/restart-policy),
[PostgreSQL servis bağlantıları](https://docs.railway.com/databases/postgresql).

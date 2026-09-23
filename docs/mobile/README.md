# Mega Radio — iOS / Android geliştirme rehberi

Bu doküman, mobil geliştiricinin mevcut Mega Radio backend'ine güvenli biçimde bağlanıp webdeki özellikleri iOS ve Android'e taşıması için hazırlanmıştır.

**Kod inceleme tarihi:** 21 Eylül 2026. **Referans:** `da23ccda1`.

**Son ekleme:** 23 Eylül 2026, temel kaynak `3085b609a` + ziyaretçi detay özelliği. [Güvenli Swift/Kotlin API başlığı örnekleri](API.md#native-platform-header) ve mevcut native Google/Apple audience doğrulaması güncellenmiştir; aşağıdaki geniş envanterin ilk inceleme kapsamı korunmuştur.

Bu depoda React web uygulaması ve TypeScript backend bulunur; Swift/Kotlin veya başka bir native uygulama projesi bulunmamaktadır. Aşağıdaki native mimari ve uygulama adımları bir geliştirme önerisidir; tamamlanmış mobil uygulama ya da mağaza sertifikasyonu iddiası değildir. Endpoint'lerin varlığı kaynak koddan doğrulanmıştır; tüm mobil senaryoların üretimde çalıştığı ayrıca cihaz testleriyle doğrulanmalıdır.

## Okuma sırası

1. Bu README: kurulum, mimari, uygulama sırası ve yayın kriterleri.
2. [API sözleşmeleri](API.md): endpoint, istek gövdesi, yanıt ve entegrasyon tuzakları.
3. [Web özellik envanteri](FEATURES.md): mobilde hangi özelliğin nasıl karşılanacağı.

## 1. Sistem sınırları

| Bileşen | Adres / kaynak | Mobil uygulamanın ilişkisi |
| --- | --- | --- |
| Ürün API'si | `https://api.themegaradio.com` | HTTP JSON; aşağıdaki yollar zaten `/api` içerir |
| Web / paylaşım | `https://themegaradio.com` | Canonical paylaşım, yasal içerik, doğrulanmış deep link |
| Stream proxy | `https://stream.themegaradio.com` | Gerektiğinde radyo akışı; ürün API'sinden ayrı servis |
| PostgreSQL | Backend'in özel ağı | Mobil doğrudan bağlanmaz; SQL / DB şifresi uygulamaya girmez |
| Radyo / resim kaynakları | Backend'in döndürdüğü URL'ler | Harici hostlara kullanıcı Bearer token'ı gönderilmez |
| Admin, AI çeviri, sitemap, senkronizasyon | Backend / admin | Mobil tüketici uygulamasında çalıştırılmaz |

Temel akış: **mobil ekran → repository/API client → backend → PostgreSQL**. Ses akışı ayrı olarak **native player → yayın URL'si / stream proxy** üzerinden gider. Ses byte'larını genel JSON client veya ekran state'i üzerinden taşımayın.

### Kaynak kod haritası

| Konu | Başlangıç noktası |
| --- | --- |
| Monorepo / komutlar | [package.json](../../package.json), [pnpm-workspace.yaml](../../pnpm-workspace.yaml) |
| API giriş noktası | [index-api.ts](../../artifacts/api-server/src/index-api.ts), [routes](../../artifacts/api-server/src/routes/) |
| Web ekranları ve yönlendirme | [App.tsx](../../artifacts/megaradio/src/App.tsx), [pages](../../artifacts/megaradio/src/pages/) |
| Player davranışı | [useGlobalPlayer.tsx](../../artifacts/megaradio/src/hooks/useGlobalPlayer.tsx), [global-player.tsx](../../artifacts/megaradio/src/components/global-player.tsx) |
| API client referansı | [queryClient.ts](../../artifacts/megaradio/src/lib/queryClient.ts) |
| Profil ayarları | [profile-settings.tsx](../../artifacts/megaradio/src/pages/profile-settings.tsx) |
| Dil ve URL kuralları | [seo-config.ts](../../lib/seo-shared/src/seo-config.ts), [url-translations.ts](../../lib/seo-shared/src/url-translations.ts) |
| Veritabanı | [lib/db](../../lib/db/), [PostgreSQL mimarisi](../POSTGRES_ARCHITECTURE.md) |
| Mevcut OpenAPI | [openapi.yaml](../../lib/api-spec/openapi.yaml) — yalnızca health tanımı; ürün API'sinin tam sözleşmesi değil |

## 2. İlk gün: sırayla yapılacaklar

1. Mevcut mobil repo varsa onun sahibiyle devam edin; sırf bu depoda yok diye ikinci bir uygulama oluşturmayın. Bundle/package kimliği ve imzalama sahipliğini doğrulayın.
2. Geliştirme/test backend'i, normal test kullanıcısı ve test istasyonlarını alın. Admin hesabıyla uygulama testi yapmayın; gerçek kullanıcı mesajlarına veya production aboneliklerine dokunmayın.
3. API client, kimlik eşleme, hata modeli ve güvenli token deposunu hazırlayın.
4. Anonim katalog → radyo detay → tek bir stream oynatma dikey dilimini bitirin.
5. Telefon kilitliyken ve ekranlar arasında gezerken oynatmayı doğrulayın.
6. Mobil login → favori → geçmiş → logout akışını ekleyin.
7. 14 dil, profil/topluluk/mesajlar, premium, push ve cast özelliklerini aşamalı ekleyin.
8. En sondaki kabul matrisini iki platformda tamamlamadan release çıkarmayın.

### Ekipten alınacak yapılandırma

| Girdi | Neden gerekli / sınır |
| --- | --- |
| Staging API / web / proxy origin'leri | Üretim dışı yazma ve satın alma testleri; bu belgede staging adresi uydurulmamıştır |
| Native repo ve minimum OS sürümleri | Bu web reposundan çıkarılamaz; ürün kararı ve mevcut uygulamayla eşleştirilir |
| Apple team / bundle ID; Android applicationId / imza | Mevcut mağaza uygulamasının devamlılığını korumak için |
| OAuth client ID / redirect yapılandırması | Google ve Apple native girişini backend doğrulamasıyla eşleştirmek için |
| Mağaza ürünleri / sandbox kullanıcıları | Backend ürün haritasıyla aynı olmalı; fiyat native store SDK'dan alınmalı |
| Push sağlayıcı konfigürasyonu | APNs / FCM / Expo token türü ve gerçek teslimat hattı birlikte doğrulanmalı |
| Test medya örnekleri | MP3, AAC, HLS, yönlendirme, erişilemeyen / coğrafi kısıtlı yayın, eksik logo |

DB, AWS/S3, OpenAI, Apple private key, Google service-account JSON, Paddle secret ve admin token'ları **mobil uygulamaya gömülmez**. Public client ID ile secret aynı şey değildir. Örnek konfigürasyon dosyası kullanılabilir; gerçek sırlar Git'e yazılmaz.

## 3. Yerel backend ve web referansını açma

Native geliştirmek için bu backend'i mutlaka yerelde kurmanız gerekmez; ekipçe sağlanan staging API tercih edilebilir. Yerel kurulumda Dockerfile ile aynı **Node.js 24 / pnpm 11.19.0** kullanın. npm/yarn kullanmayın ve lockfile'ı yeniden üretmeyin.

Depo kökünde:

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

macOS notu: mevcut workspace override'ları bazı Darwin esbuild paketlerini dışlıyor. Native iOS projesi bundan ayrı olsa da bu JS monorepo'sunun temiz macOS kurulumu ayrıca doğrulanmalıdır; paketleri rastgele değiştirmek yerine Linux/Docker backend veya staging kullanın.

### API — PowerShell örneği

Önce **yalnızca geliştirmeye ait, boş ve atılabilir PostgreSQL** hazırlayın. Aşağıdaki URL ve secret gerçek kimlik bilgisi değildir; kendi yerel değerlerinizle değiştirin. `POSTGRES_INIT_MODE=empty` production/import engelini aşmak için kullanılmaz; katalog oluşturmaz veya production verisi taşımaz.

```powershell
$env:NODE_ENV = 'development'
$env:PORT = '5000'
$env:DATABASE_URL = 'postgresql://DEV_USER:DEV_PASSWORD@localhost:5432/megaradio_dev'
$env:POSTGRES_SSL = 'disable' # Sadece yerel, TLS'siz PostgreSQL için.
$env:POSTGRES_INIT_MODE = 'empty' # Sadece yeni, atılabilir yerel DB.
$env:BACKGROUND_JOBS_ENABLED = 'false'
$env:SESSION_SECRET = 'REPLACE_WITH_LOCAL_RANDOM_SECRET'
$env:CORS_ALLOWED_ORIGINS = 'http://localhost:3000'
$env:FRONTEND_URL = 'http://localhost:3000'
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/api-server start
```

POSIX shell'de aynı değişkenleri `export NAME=value` biçiminde tanımlayın. Mevcut API `dev` script'i POSIX `export` içerdiğinden PowerShell'de yukarıdaki açık build/start akışını kullanın. Başlangıç script'i migration uygulayabilir; yanlış DB URL'siyle çalıştırmayın. Import modunda doğrulanmış veri aktarımı bekleyen boş DB'nin 503 vermesi migration'ın tamamlandığı anlamına gelmez.

Kontrol: `GET http://localhost:5000/readyz` ve `GET http://localhost:5000/api/health`. Boş katalog beklenir; test seed'i ve normal kullanıcıyı backend geliştiricisinden alın. Mobil geliştirme adına production import, AI, sync veya backfill başlatmayın.

### Web referansı — ikinci PowerShell terminali

```powershell
$env:PORT = '3000'
$env:BASE_PATH = '/'
$env:VITE_API_BASE_URL = 'http://localhost:5000'
pnpm --filter @workspace/megaradio dev
```

Vite konfigürasyonunda otomatik `/api` proxy'si yoktur; `VITE_API_BASE_URL` bu yüzden önemlidir. Native emulator/telefon `localhost` adresini geliştirme bilgisayarı sanmaz; erişilebilir geliştirme hostunu yapılandırın. Geliştirmede HTTP istisnası gerekiyorsa yalnızca debug yapılandırmasıyla sınırlayın; release'te genel cleartext/ATS bypass açmayın.

Bu komutlar mevcut script'lere göre hazırlanmıştır; bu dokümantasyon çalışmasında temiz kurulum veya native build yapılmamıştır.

## 4. Önerilen native mimari

Platform dilinden bağımsız sınırlar:

```text
Ekranlar / gezinme
  ├─ CatalogRepository       → istasyon, arama, tür, ülke
  ├─ AccountRepository       → oturum, profil, favori, geçmiş
  ├─ CommunityRepository     → kullanıcı, takip, mesaj, bildirim
  ├─ BillingRepository       → native satın alma + backend entitlement
  └─ PlayerCoordinator      → tek player, kuyruk, metadata, media controls

Ortak: ApiClient, SecureTokenStore, LocaleStore, ImageLoader, Cache
```

- Player ekranın/sekmenin yaşam döngüsüne bağlı olmamalı; detay kapanınca ses kesilmemeli.
- API yanıtlarını ekranlara ham JSON olarak dağıtmayın. Endpoint'e özel DTO → ortak domain model dönüşümü yapın.
- İstasyonun `_id` değerini uygulama içi anahtar yapın. `stationuuid`, `slug`, kullanıcı kimliği ve stream URL'si farklı kavramlardır.
- Sayfalama yanıtları tek tip değil: bazı yollar dizi, bazıları `{stations,...}`, bazıları ID anahtarlı nesne döndürür. Ayrıntı [API.md](API.md)'de.
- Eksik alanları tolere edin. Bilinmeyen mesafeyi `0 km`, bilinmeyen puanı `0/5`, eksik görseli kırık URL olarak göstermeyin.
- Oturum kapanınca kullanıcıya özel cache/polling temizlensin; başka kullanıcıya eski mesaj/favori gösterilmesin. Anonim radyo oynatma devam edebilir.

## 5. Oturum ve hesap yaşam döngüsü

1. Native login için `POST /api/auth/mobile/login` kullanın.
2. Dönen opaque `mrt_...` token'ı güvenli OS deposunda saklayın; JWT gibi decode etmeye çalışmayın.
3. Korunan API isteklerine `Authorization: Bearer <token>` ekleyin. Token'ı URL'ye, loga, analytics'e veya üçüncü taraf yayın URL'sine koymayın.
4. Açılışta `/api/auth/mobile/me` ile doğrulayın. Bu endpoint **200 + `authenticated:false`** döndürebilir; yalnızca HTTP 200'e güvenmeyin.
5. Token süresi şu an sabit **90 gün**; refresh endpoint'i yoktur. `/me` süresini uzatmaz. Geçersiz oturumda yeniden giriş isteyin; sessiz sonsuz refresh döngüsü yazmayın.
6. Signup token vermez ve otomatik giriş yapmaz. Başarılı kayıttan sonra mobil login akışını çalıştırın. `emailVerificationRequired` bayrağını bütün doğrulama yolunun hazır olduğuna kanıt saymayın.
7. Logout önce mevcut cihaz push kaydını kaldırmaya çalışmalı, sonra sunucu token'ını iptal edip yerel sırları temizlemeli. Chat socket'ini de kapatın. Ağ yoksa yerel çıkış yapılır; uzaktaki token iptalinin gerçekleştiğini iddia etmeyin.

Standart auth middleware session'ı Bearer'dan önce değerlendirir; `/api/auth/me` Bearer girişinden cookie session oluşturabilir. Native Bearer client'ında gereksiz cookie persistence'ı kapatın veya logout/hesap değişiminde cookie jar'ı da temizleyin; hesap A'nın cookie'si hesap B'nin token'ını gölgelememeli.

Google/Apple SDK çıktısını doğru backend endpoint'ine gönderin; yalnızca email/name göndererek oturum açılmaz. Ürün hesapları ile `/api/admin/*` yetkisini karıştırmayın. Giriş/şifre/satın alma hatalarını kullanıcıya gösterin ancak parola, token ve receipt loglamayın.

## 6. Radyo oynatma — kritik uygulama kuralları

Önerilen durum modeli: `idle → loading → playing ↔ paused`; bağlantı kesilince `reconnecting`, sınırlı deneme sonunda `error`. Kullanıcının pause işlemi otomatik retry tarafından geri alınmamalı.

- Aynı anda tek aktif player ve stream bağlantısı bulunsun. İstasyon değişiminde eski isteği/retry'ı/metadata timer'ını iptal edin; generation/request ID ile geç gelen sonucu reddedin.
- `urlResolved` / `url` seçimi, proxy ve metadata ayrıntıları [API.md](API.md)'de. Mobilde CORS gerekçesiyle her HTTPS yayını zorunlu proxy'den geçirmeyin; maliyet ve gecikme artar.
- HTTP, codec, HLS, TLS, yönlendirme ve coğrafi engel ayrı hata sınıflarıdır. Telefonda bir kez timeout olması istasyonu küresel olarak offline yapmaz.
- Oynatma başladıktan sonra geçmiş/listen-event kaydedin; play tuşuna basmak ile gerçekten ses oynatmak farklıdır. Liste kartları için stream probe yapmayın.
- Metadata yalnızca aktif istasyon için yenilensin. Ekran kapalıyken ses servisi devam edebilir; bütün katalog ve mesaj polling'ini arka planda sürdürmeyin.
- Native öneri: sınırlı exponential backoff + jitter; internet yokken retry beklesin, bağlantı dönünce yalnızca kullanıcının oynatma niyeti sürüyorsa devam etsin.
- Canlı yayın pause/resume genellikle yayın anına geri bağlanır; kayıt/DVR veya geçmiş saniyeden sürdürme vaat etmeyin.
- Arayüz dili, ülke, sekme veya favori değişimi player'ı yeniden yaratmamalı.

### iOS

AVPlayer tabanlı tek ses bileşeni, uygun `AVAudioSession` playback yapılandırması ve Background Modes / Audio ile uygulayın. Telefon çağrısı, başka ses oturumu, kulaklık çıkarılması ve Bluetooth geçişlerini gerçek cihazda test edin. Kilit ekranı metadata'sını ve play/pause komutlarını native MediaPlayer API'leriyle eşleyin; web Wake Lock / HTMLAudioElement kodunu native'e kopyalamayın. [Apple audio session](https://developer.apple.com/documentation/avfaudio/avaudiosession), [MPRemoteCommandCenter](https://developer.apple.com/documentation/MediaPlayer/MPRemoteCommandCenter).

### Android

Önerilen yapı Media3 ExoPlayer + `MediaSessionService`; player Activity/Compose ekranından bağımsız yaşar. Manifest'te ilgili foreground-service izinlerini ve `mediaPlayback` servis türünü yapılandırın. Bildirim / kilit ekranı kumandalarını aynı session'a bağlayın; servis kaynaklarını doğru kapatın. Arka plan, audio focus, kulaklık çıkarılması, Bluetooth ve uygulamanın recent listeden kaldırılmasını cihazda test edin. [Android background playback](https://developer.android.com/media/media3/session/background-playback).

Android Auto, CarPlay, Wear OS, widget ve offline ses indirme bu depoda tamamlanmış özellik olarak kabul edilmemelidir; ayrı kapsam/onay gerektirir.

## 7. Dil, ülke, görsel ve deep link

### 14 dil

Aktif 14 dil kümesi: `en`, `es`, `fr`, `de`, `pt`, `it`, `ru`, `ar`, `zh`, `tr`, `ja`, `ko`, `hi`, `he`. Kaynak: `ACTIVE_SITEMAP_LANGUAGES` ve universal14. Daha geniş `SEO_LANGUAGES` veya DB dil listesi, bütün bu dillerde ürünün tamamlandığı anlamına gelmez.

- Önerilen öncelik: kullanıcının açık tercihi → desteklenen cihaz dili → `en`. Bölge alt etiketini normalize edin (`de-AT` → `de`); **AT ülke, de dil**.
- Dil sözlüğü ile istasyon açıklaması farklı veri kaynaklarıdır. `GET /api/translations/de` arayüz anahtarlarını getirir; radyo metni detayın `descriptions.de` alanından gelir.
- Eksik metinde kontrollü fallback gösterin; açıklamayı cihazda AI ile yeniden üretmeyin. Yanlış dilde metni doğru çeviri gibi etiketlemeyin.
- Arapça/İbranice RTL, büyük fontlar, çoğul ekleri, tarih/sayı biçimleri ve uzun Almanca butonlar test edilmeli.
- Dil değiştirirken player ve hesap oturumu korunur; ülke filtresi dil ile zorunlu değiştirilmez.

### Logolar / avatarlar

Backend'in `logoAssets` / logo URL'lerini ve boyuta uygun varyantlarını tercih edin; bucket yolu veya istasyon adına göre dosya adı tahmin etmeyin. S3 erişim anahtarı istemcide olmaz. Backend/proxy URL'si, harici favicon ve boş görsel olasılıklarını destekleyin. Native image cache, sabit boyut, hata fallback'i kullanın. Profil fotoğrafı yoksa baş harf veya ürünün ortak avatarı gösterilir; sahte insan fotoğrafı üretilmez. Ayrıntılar [API.md](API.md)'de.

### Deep link için mevcut durum ve açık kontrol

[seo-sitemap-routes.ts](../../artifacts/api-server/src/routes/seo-sitemap-routes.ts) iki association endpoint'i tanımlar. Kaynak kodda iOS app ID `M6T85HP76P.com.visiongo.megaradio`, Android package `com.visiongo.megaradio` ve bir sertifika fingerprint'i bulunmaktadır. Bunlar **kodda bulunan değerlerdir**; mevcut mağaza imzasının/doğru hesabın doğrulandığı anlamına gelmez.

Önemli açık nokta: mevcut iOS path listesi `/station/*`, `/genre/*`, `/user/*` ve bunların tek dil segmentli varyantlarını kapsıyor. Webde çoğul ve çevrilmiş route'lar da var; bütün 14 dilin canonical URL'lerinin yakalandığı varsayılmamalı. Mobil/backend geliştiricisi birlikte route matrisi hazırlayıp gerekli association güncellemesini ayrıca test etmeli.

1. Paylaşımda gerçek localized canonical URL'yi kullanın; `_id` veya rastgele çevrilmiş path oluşturmayın.
2. İzin verilen host/path'leri parse edin; bilinmeyen URL güvenli web fallback'ine gitsin.
3. Link açmak otomatik mesaj gönderme, favori silme veya satın alma işlemi başlatmamalı.
4. iOS entitlement ile AASA app ID; Android release/Play App Signing fingerprint ile assetlinks eşleşmeli.
5. Kurulu/kurulu değil, cold start/warm start ve en/de/tr + RTL dahil diğer diller için deneyin.

Resmî kurallar: [Apple associated domains](https://developer.apple.com/documentation/Xcode/supporting-associated-domains), [Android assetlinks](https://developer.android.com/training/app-links/configure-assetlinks). Android association dosyası HTTPS üzerinden JSON olarak, redirect olmadan erişilebilir olmalı. Bu belgede association dosyaları değiştirilmemiştir.

## 8. Premium, reklam ve bildirim

- Web Paddle akışını native IAP ile aynı kabul etmeyin. Varsayılan native plan: platform mağaza SDK'sı → gerçek receipt/purchase token → backend doğrulama → sunucunun entitlement yanıtı.
- `isPremium=true`, fiyat, plan veya expiry'yi istemci gönderdi diye yetki verilmez. Restore purchases ve başka hesaba bağlı receipt çatışması ele alınmalıdır.
- Mevcut iOS backend receipt sözleşmesi ile StoreKit sürümünün çıktısı birlikte doğrulanmalı; StoreKit 2 JWS'yi base64 receipt yerine gelişi güzel göndermeyin.
- Store aboneliği yönetimi ilgili mağazaya gider. Webden alınmış aboneliğin yönetim yolu farklı olabilir; [API.md](API.md)'deki `manage_in_store` davranışını uygulayın.
- Mağaza kuralları bölge/programa göre değişebilir. Yayından önce [Apple ödeme kuralları](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase) ve [Google Play Payments](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en) üzerinden kullanılan satış yöntemini doğrulayın; Paddle linkini her native uygulamada serbest varsaymayın.
- Premium uygulamanın kendi reklamlarını kaldırabilir; yayıncının ses akışına gömdüğü reklamları kaldıramaz.
- Web AdSense kodunu native SDK sanmayın. Native reklam SDK'sı, consent, test reklam kimlikleri ve placement politikası ayrı entegrasyondur. Mesaj/profil/form/player kumandalarının üstüne reklam koymayın.
- Push token kayıt endpoint'inin bulunması APNs/FCM teslimatının hazır olduğunu kanıtlamaz. Kayıt, token yenilenmesi, logout, farklı kullanıcıya geçiş ve gerçek cihaz teslimatı ayrı test edilir. Web Push aboneliği native token değildir.
- Somut mevcut fark: görünür sosyal/mesaj bildirimi yolu `PushNotificationService.sendToMobileUser` ile yalnızca Expo token'larını kullanıyor. Ayrı `SilentPushService` APNs/FCM/Expo arka plan bildirimlerini destekleyen kod içeriyor. Swift/Kotlin uygulaması doğrudan APNs/FCM kullanacaksa görünür bildirim hattının backend entegrasyonu tamamlanmadan bu özelliği hazır saymayın.

## 9. Hız, güvenilirlik ve mahremiyet

- Ana ekran için sınırlı kart listesi alın; her kart için detay/stream/metadata isteği üretmeyin. Görünmeyen sekmeyi önceden yüzlerce kayıtla doldurmayın.
- Aramada öneri: yaklaşık 300 ms debounce, önceki isteği iptal, yalnızca son sorgunun sonucunu gösterme. Liste boyutlarını ve API limitlerini [API.md](API.md)'ye göre ayarlayın.
- Public istasyon cache'i görünürlük doğruluğu için sunucuda en fazla 60 saniye freshness sınırına sahiptir. Native katalog cache'i eski offline/merged istasyonları uzun süre yeniden dolaşıma sokmamalı; foreground'da revalidate edin. Çevrimdışı görüntüyü açıkça eski veri olarak işaretleyin.
- Görseller disk cache'de tutulabilir; özel mesaj/favori/hesap yanıtları kullanıcıya göre ayrılmalı, çıkışta temizlenmeli. Receipt ve token analytics'e gitmez.
- GET için sınırlı retry düşünülebilir. Mesaj gönderme veya ödeme POST'unu idempotency garantisi varmış gibi otomatik tekrarlamayın; belirsiz yanıt sonrası mevcut sonucu sorgulayın.
- 401/403/404/409/429/503 farklı UI davranışları ister. 503'te boş listeyi başarılı veri diye cache'lemeyin. HTML hata sayfasını JSON decode hatası arkasına gizlemeyin.
- Görsel/mesaj polling'i uygulama görünürlüğüyle sınırlandırılsın. Audio service hariç gereksiz sürekli arka plan işleri çalıştırmayın.
- Loglar istek yolu (hassas query'siz), status, süre ve correlation ID gibi tanısal alanlarla sınırlı olsun. User email, parola, token, receipt ve özel mesaj içeriğini kaydetmeyin.
- Normal ürün API isteklerine iOS'ta `X-MegaRadio-Platform: ios`, Android'de `android` ekleyin; yalnızca tam API origin'inde ve redirect güvenliğiyle. Bu tekil-IP ölçümünü sınıflandırır; kimlik/cihaz doğrulaması veya ek heartbeat gerektirmez. [Örnekler ve ölçüm sınırları](API.md#native-platform-header).

## 10. Geliştirme sırası ve teslim kriterleri

| Aşama | Teslimat | Bitmiş sayılma kriteri |
| --- | --- | --- |
| 1 — Temel | API client, katalog, arama, detay, logo fallback | Başarılı/boş/hatalı/ağsız durumların hepsi görüntülenir |
| 2 — Ses | Tek player, mini/full player, metadata, background | 30 dk gerçek cihaz dinleme; kilit, çağrı, ağ değişimi, hızlı istasyon geçişi |
| 3 — Hesap | Login, signup, profil, favori, geçmiş, logout | İki test hesabı arasında veri/oturum sızıntısı yok |
| 4 — Sosyal | Topluluk, takip, mesaj, bildirim | İki test kullanıcısı; okunma/sayfalama/görsel/hata senaryoları |
| 5 — Yerelleştirme | 14 dil, RTL, locale/country, paylaşım | Dil değişince ses kesilmez; link doğru istasyonu açar |
| 6 — Gelir / cihaz | IAP, restore, premium, push; gerekiyorsa TV/cast | Sandbox satın alma + backend yetki doğrulaması; gerçek push teslimatı |
| 7 — Release | Güvenlik, erişilebilirlik, ölçüm, mağaza checklist | Release imzalı paket, staging kabul testleri, izlenebilir sürüm |

### İki platform için kabul matrisi

- [ ] Anonim açılış; desteklenen cihaz dili; kayıtlı dil tercihi; bağımsız ülke seçimi.
- [ ] Popüler/genre/ülke listesi, arama, sayfalama, boş/hatalı yanıt; ekranda duplicate kart yok.
- [ ] Internal ID / provider UUID / slug ayrımı; merge edilmiş eski link; görünmez istasyonun doğrudan detay bağlantısı.
- [ ] MP3/AAC/HLS örnekleri; HTTP/TLS/hata/geoblock; logo/metadata eksikliği.
- [ ] Background, kilit ekranı, Bluetooth, kulaklık çıkarma, çağrı; hızlı 10 istasyon değişiminde eski ses geri başlamaz.
- [ ] Dil/ülke/profil/mesaj ekranı değişiminde oynatma ve seçili istasyon korunur.
- [ ] Token yok/geçerli/geçersiz/süresi dolmuş; logout/all-devices; hesap A → B; şifre sıfırlama.
- [ ] Favori ekle/kaldır, sunucu hatasında rollback; geçmiş gerçekten oynatılan istasyonlarla güncellenir.
- [ ] Rating, vote ve favorite birbirine karışmaz; başka istasyona puan state'i sızmaz.
- [ ] Profil adı, username, avatar fallback; dosya boyutu/türü hataları; ayarlar kaydı.
- [ ] Mesaj listesi/konuşma, okunma, pagination, uzun metin, keyboard/safe-area, hata sonrası tekrar deneme.
- [ ] 14 dil ekran smoke testi; ar/he RTL; büyük yazı; VoiceOver/TalkBack; kontrast ve erişilebilir buton adları.
- [ ] IAP satın alma/restore/iptal/expiry/replay; premium sunucuda doğrulanır; web aboneliği yanlışlıkla silinmez.
- [ ] Push izin reddi/kabul/token rotation/logout/hesap değişimi; doğru conversation deep link.
- [ ] App Links/Universal Links 14 dilde; cold/warm start; app kurulu değilken web fallback.
- [ ] Zayıf ağ ve düşük seviye cihazda açılış, scroll, bellek, pil, istek sayısı ölçümü.
- [ ] API'de 401/429/503 ve proxy'de timeout için sonsuz spinner/retry yok.
- [ ] Release'te secret/debug endpoint/log yok; privacy beyanları gerçek SDK ve veri akışıyla uyumlu.

Ölçüm raporuna cihaz/OS, build, ağ koşulu, cold/warm açılış, ilk listenin görünmesi, ilk ses süresi ve p50/p95 sonuçlarını yazın. Web PageSpeed puanı native uygulama performansının ölçüsü değildir; ölçülmemiş hız veya mağaza onayı vaat etmeyin.

## 11. Bilinen entegrasyon açıkları

1. Native kaynak, signing, SDK sürümleri ve minimum OS bilgileri bu repoda yok.
2. OpenAPI dosyası tüm endpoint'leri kapsamıyor; önce bu rehber ve gerçek route handler'larını kullanın, sözleşme testleriyle genişletin.
3. Refresh-token akışı yok; signup otomatik login yapmıyor; email doğrulama akışı ayrıca backend işi gerektirebilir.
4. Bazı eski web endpoint'leri sadece cookie/session tanıyor. Native için [API.md](API.md)'de önerilen Bearer uyumlu yolları kullanın.
5. Deep-link path listesi bütün çevrilmiş/çoğul web route'larını otomatik kapsamıyor.
6. IAP receipt formatı, mağaza ürünleri, OAuth audience ve push teslimatı release öncesi uçtan uca doğrulanmalı.
7. `/api/app/info` içindeki sürüm ve mağaza linkleri statik/boş olabilir; zorunlu güncelleme sistemi gibi kullanmayın.

Bu açıklar dokümante edilmiştir; bu teslimde uygulama kodu, production konfigürasyonu veya mağaza ayarları değiştirilmemiştir.

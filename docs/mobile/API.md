# Mega Radio — mobil API başvuru kılavuzu

[Ana geliştirme rehberi](README.md) · [Web özellik listesi](FEATURES.md)

21 Eylül 2026, `da23ccda1` kaynak koduna göre hazırlanmıştır. Örneklerdeki `<...>` alanları gerçek ID/token değildir. Bu belge consumer mobil entegrasyonunu kapsar; admin/AI/senkronizasyon endpoint'leri mobil uygulamanın kullanacağı API değildir. Mevcut OpenAPI yalnızca health tanımı içerdiğinden aşağıdaki sözleşmeler gerçek route handler'larına dayanır.

**Son ekleme:** 23 Eylül 2026, temel kaynak `3085b609a` + bu sürümde eklenen ziyaretçi platform detayları. Native başlık örnekleri ve Google/Apple audience notu bu tarihte kontrol edilmiştir; tüm eski sözleşmeler için yeni bir production/native test iddiası değildir.

## 1. Ortak sözleşme

**23 Eylül 2026 eklemesi — ziyaretçi platform bilgisi:** Yeni dashboard detayları için uygulamanın normal Mega Radio API isteklerine `X-MegaRadio-Platform: ios` veya `X-MegaRadio-Platform: android` ekleyin. Bu başlık kimlik doğrulama/izin değildir; mevcut Bearer oturumunu değiştirmez. Yalnızca Mega Radio API origin'ine gönderin, stream/logo gibi harici URL'lere taşımayın. Bu değişiklik backend yayınıyla etkinleşir; eski uygulamalar başlıksız çalışmaya devam eder.

Diğer desteklenen değerler: `tizen` (Samsung TV), `webos` (LG TV), `tvos`, `androidtv`, `desktop` (kurulu masaüstü uygulaması), `web`. `desktop` bir masaüstü tarayıcısı anlamına gelmez. Web tarayıcıları normal User-Agent ile algılanır; sırf ölçüm için tüm web isteklerine yeni başlık veya ek polling eklemeyin. Yeni bir telemetry endpoint'i çağırmak gerekmez.

Başlık yoksa User-Agent'tan mümkün olduğunca ayrım yapılır; sadece `okhttp` Android'i, sadece `CFNetwork/Darwin` iOS'u kanıtlamaz ve platform `unknown` kalabilir. TV User-Agent'ı yerleşik tarayıcı ile paketlenmiş TV uygulamasını kesin ayıramaz. Platform bildirimi istemci beyanıdır, doğrulanmış cihaz kimliği değildir. Ülke seçimi/UI dili ziyaretçinin coğrafi ülkesi olarak gönderilmez; ülke güvenilen edge IP ülke bilgisinden alınır, yoksa bilinmiyor kalır. Ek IP konumlandırma servisi çağrısı yapılmaz.

Sayaçlar kullanıcı hesabı veya cihaz bazlı değil **tekil IP** bazlıdır: aynı ağdaki bir telefon ve TV toplamda bir kez sayılır, detayda son örneklenen istemci gösterilir. Normal başarılı API etkinliği ölçülür; yalnızca stream dinlemek, uygulamanın açık kalması veya yerel cache'den ekran göstermek aktif dinleme/ziyaret garantisi değildir. Native QA: normal katalog isteği → admin olmayan oturum → panelde ilgili platformu doğrulama; aynı IP için yazma aralığı 30 saniyeye kadar olabilir.

Ölçüm pencereleri: aktif son 30 dakika, bugün `Europe/Berlin` gece yarısından itibaren, hafta son 7 gün; kayıt saklama 30 gün. Her IP tek kayıttır, platform dağılımı o IP'nin son **örneklenen** isteğine aittir; tüm cihazların veya geçmişteki her platformun toplamı değildir. Bilinen bot/admin/health/stream/statik istekler hariç tutulur; kapasite veya DB hatasında ölçüm atlanabilir. Ülke yaklaşık IP konumudur, GPS/ikamet doğrulaması değildir. Eski kayıtlarda ülke/cihaz bilinmeyebilir; geçmiş için tahminle doldurulmaz. Admin detayları IPv4 `/24`, IPv6 `/48` maske gösterir; farklı IP'ler aynı görünen maskeyi paylaşabilir. `/api/admin/visitor-metrics` ve `/details` **yalnızca admin** içindir; mobil uygulama bunları çağırmaz.

<a id="native-platform-header"></a>

<a id="visitor-page-activity"></a>

### 24 Eylül 2026: isteğe bağlı ekran hareketi ölçümü

Platform başlığı mevcut sayımlar için yeterli olmaya devam eder. **Ekran geçmişi farklı bir özelliktir:** yerel cache'den açılan ekranı backend bilemez. Bu özellik sunucuda yayımlandıktan sonra, ölçüm tercihleri izin veriyorsa, gerçek ekran açılışında aşağıdaki isteğe bağlı isteği arka planda gönderebilirsiniz:

```http
POST https://api.themegaradio.com/api/visitor-activity/page-view
Content-Type: application/json
X-MegaRadio-Platform: ios

{"path":"/de/station/kral-fm","referralCategory":"direct-or-unknown"}
```

Android için başlık `android`. Yanıt `204`, olayın kesin saklandığına dair teslim garantisi değildir; kapasite/gizlilik filtreleri ölçümü atlayabilir. Mevcut oturum yönetimini değiştirmeyin. Bu endpoint'e kullanıcı ID, IP, cihaz reklam kimliği, ekran görüntüsü, mesaj metni, şifre, arama metni, token veya keyfi özellik eklemeyin. URL query/hash göndermeyin; özel konuşma/profil kimliklerini göndermeyin. `path` yalnız sitenin karşılık gelen izinli ekran yolu olmalıdır. Bu bir native route adı serbest-metin alanı değildir.

`referralCategory`: `google`, `search`, `social`, `internal`, `direct-or-unknown`, `other-referral`. Kaynağı gerçekten bilmiyorsanız `direct-or-unknown`; kaynak beyanı kanıtlanmış attribution değildir. Harici URL veya arama terimi göndermeyin. Gönderim hata verirse kullanıcıya hata göstermeyin, tekrar denemeyin ve giriş/oynatma/favori işlemini bekletmeyin. En fazla rota değişiminde bir gönderim; yeniden çizim, polling ve ses zamanlayıcısına bağlamayın. Telemetry devre dışıysa, ekran arka plandaysa veya cihaz çevrimdışıysa göndermeyin. İstekleri kısa timeout ile sınırlandırın.

Admin kayıtları IP bazında birleşir ve yedi gün örneklenen hareket tutar; bu kullanıcı hesabına veya cihaz başına kesin oturum geçmişi değildir. Ekran açma bildirimi istemci beyanıdır; doğrulanmış insan, gerçek dinleme veya kişinin niyeti sayılmaz. Eski sürümler bu endpoint'i kullanmadan çalışmaya devam eder. Bu depoda native kaynak bulunmadığından uygulamalara otomatik eklenmiş değildir.

### Swift / Kotlin: API'ye özel platform başlığı

Bu örnekler mevcut HTTP client'a uyarlanacak entegrasyon parçalarıdır; native repo burada bulunmadığından Xcode/Gradle cihaz derlemesi yapılmamıştır. API client'ını bir kez oluşturup tekrar kullanın. Header'ı eklemek için yeni istek/timer üretmeyin. Token'ı iOS Keychain'den veya Android'de Keystore ile korunan özel depodan sağlayın; kaynak kod, UserDefaults/düz preferences, URL, log veya crash raporuna koymayın.

**Swift (iOS 15+, Foundation):** `URLRequest` başlığı; task delegate tüm otomatik redirect'leri reddeder. Böylece token/platform başka hosta veya HTTPS→HTTP yönlendirmesine taşınmaz. Bu politika yalnızca JSON API client'ına aittir; stream player için ayrı, tokensız client kullanılır.

```swift
import Foundation

final class DenyAPIRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

final class MegaRadioAPI {
    private let redirectPolicy = DenyAPIRedirects()
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 30
        session = URLSession(configuration: config)
    }

    func get(_ url: URL, token: String? = nil) async throws -> (Data, HTTPURLResponse) {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased() == "api.themegaradio.com",
              url.port == nil || url.port == 443,
              url.user == nil, url.password == nil,
              url.path.hasPrefix("/api/") else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("ios", forHTTPHeaderField: "X-MegaRadio-Platform")
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request, delegate: redirectPolicy)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http) // Çağıran HTTP status + endpoint JSON şemasını kontrol eder.
    }
}

// Örnek anonim katalog isteği; URL sabit ve uygulamaya aittir.
// let api = MegaRadioAPI() // Repository yaşam döngüsünde tek örnek.
// let (data, response) = try await api.get(URL(string:
//   "https://api.themegaradio.com/api/stations?page=1&limit=20&slim=1")!)
```

**Kotlin (OkHttp):** API'ye özel interceptor token ve platform başlığının tek sahibidir. Provider her istekte mevcut hesabın güvenli token'ını döndürür; anonimde `null`. Mevcut projenin OkHttp sürümünü koruyun; aşağıdaki örnek yeni sürüm/bağımlılık yüklemez.

```kotlin
import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.CookieJar
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

class MegaRadioApiHeaders(private val tokenProvider: () -> String?) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val url = original.url
        if (url.scheme != "https" || url.host != "api.themegaradio.com" ||
            url.port != 443 || url.username.isNotEmpty() || url.password.isNotEmpty() ||
            !url.encodedPath.startsWith("/api/")) {
            throw IOException("Request outside the Mega Radio API origin")
        }
        val request = original.newBuilder()
            .removeHeader("Authorization").removeHeader("Cookie")
            .header("Accept", "application/json")
            .header("X-MegaRadio-Platform", "android")
        tokenProvider()?.takeIf { it.isNotBlank() }?.let {
            request.header("Authorization", "Bearer $it")
        }
        return chain.proceed(request.build())
    }
}

fun createMegaRadioApi(tokenProvider: () -> String?): OkHttpClient = OkHttpClient.Builder()
    .addInterceptor(MegaRadioApiHeaders(tokenProvider))
    .cookieJar(CookieJar.NO_COOKIES)
    .followRedirects(false).followSslRedirects(false)
    .retryOnConnectionFailure(false) // Mutation'ı otomatik tekrar gönderme.
    .callTimeout(30, TimeUnit.SECONDS)
    .build()

val catalogRequest: Request = Request.Builder()
    .url("https://api.themegaradio.com/api/stations?page=1&limit=20&slim=1")
    .get().build()
// createMegaRadioApi { null }: anonim; korunan isteklerde güvenli token provider kullanın.
// İsteği UI thread'inde execute etmeyin; enqueue/uygulamanın coroutine adaptörünü kullanın.
// Response/body'yi kapatın; iptal edilen ekran isteğinin Call'unu da iptal edin.
```

İki örnekte de 3xx JSON başarısı değildir: otomatik yeniden gönderim yok; sözleşme/origin hatasını ele alın. Gerekirse yeni hedefi ayrıca doğrulayıp ayrı bir isteği açıkça oluşturun; `Location` URL'sine token'ı körlemesine kopyalamayın. Public görsel/stream için bu client'ı kullanmayın veya onun Authorization interceptor'ını miras almayın. Login/hesap değişiminde eski istekleri ve özel cache'i iptal/temizleyin. HTTP 200 tek başına giriş/premium başarısı değildir; ilgili endpoint'in alanlarını doğrulayın. Log interceptor eklemeyin; zorunlu debug loglarında Authorization, Cookie, parola, receipt ve mesaj gövdeleri tamamen çıkarılmalıdır.

Kaynak kontrolü: [Apple URLRequest başlıkları](https://developer.apple.com/documentation/foundation/urlrequest/setvalue(_:forhttpheaderfield:)), [Apple async URLSession](https://developer.apple.com/documentation/foundation/urlsession/data(for:delegate:)), [Apple redirect delegate](https://developer.apple.com/documentation/foundation/urlsessiontaskdelegate/urlsession(_:task:willperformhttpredirection:newrequest:completionhandler:)), [OkHttp interceptor dokümanı](https://github.com/square/okhttp/blob/master/docs/features/interceptors.md), [OkHttp client redirect seçenekleri](https://github.com/square/okhttp/blob/master/okhttp/src/commonJvmAndroid/kotlin/okhttp3/OkHttpClient.kt).

### Ortak HTTP kuralları

- JSON origin: `https://api.themegaradio.com`; örneğin tam yol `https://api.themegaradio.com/api/stations`.
- JSON body: `Content-Type: application/json`; dosya upload'ında multipart boundary'yi HTTP kütüphanesi oluştursun.
- **A** = `Authorization: Bearer <mrt_token>` gereken kullanıcı oturumu; **O** = opsiyonel; **—** = kullanıcı oturumu gerektirmez.
- Kullanıcı token'ı developer API key değildir. Public katalog için mobil uygulamaya ortak bir secret/API key gömmeyin. Admin yollarını tüketici uygulamasına bağlamayın.
- Genel limiter kaynak kodda IP başına 100 istek/dakika; auth limiter 15 dakikada 10 başarısız deneme odaklıdır (başarılı istekler sayımdan düşülür). Endpoint'e özel limitler de vardır. Paylaşılan ağlarda IP limiti ortak olabilir; 429 ve rate-limit başlıklarına uyun.
- Yanıtlar ortak bir `{data:...}` zarfı kullanmaz. `200 []`, `204`, `{success:false}` ve `{error,code,message}` farklılıklarını endpoint bazında ele alın.
- Normal istek socket deadline'ı 30 saniyedir; oynatma, upload ve metadata süreleri ayrı ele alınmalı. Tek bir global sonsuz timeout kullanmayın.

| HTTP | İstemci davranışı |
| --- | --- |
| 200/201 | Yanıt şemasını ve varsa `authenticated` / `success` / `valid` alanını kontrol et |
| 204 | Body yok; JSON decode etme |
| 400/422 | Girdi/sözleşme hatası; aynı payload'ı tekrar tekrar gönderme |
| 401 | Oturumu yeniden doğrula; refresh endpoint'i varmış gibi davranma |
| 403 | Hesap/ilişki/yetki engeli; kullanıcıya açıklama göster |
| 404 | Kayıt yok, özel profil veya endpoint uyuşmazlığı olabilir |
| 409 | Email/username, abonelik veya receipt çatışmasını ilgili ekranda çöz |
| 429 | Retry-After/rate-limit başlıklarına uy; polling'i azalt |
| 503 | Servis/veri deposu hazır değil; başarılı boş katalog diye kaydetme |

### Veri modelleri ve kimlikler

İstasyonun kalıcı uygulama anahtarı **`_id`**, upstream anahtarı **`stationuuid`**, paylaşım kimliği **`slug`**. PostgreSQL kullanılması tüm ID'lerin UUID formatında olduğu anlamına gelmez; kullanıcı/mesaj yollarının bazıları hâlâ 24 karakter hex ID ister. ID'leri opaque string saklayın.

Detay lookup sıradan slug kabul eder; mutation ve batch resolver'ları internal ID/provider UUID/merge alias bekler, sıradan slug kabul etmez. Detaydan dönen `_id` ile favori/puan/geçmiş/batch işlemi yapın.

```ts
// Uygulamanın normalize edeceği örnek model; tüm API yanıtlarının birebir şeması değil.
type Station = {
  id: string;                     // API _id
  providerId?: string;            // stationuuid
  name: string;
  slug?: string;
  streamUrl?: string;             // urlResolved || url
  country?: string;
  countryCode?: string;
  tags: string[];                 // gelen legacy string/diziyi adaptörde normalize edin
  logoUrl?: string;
  isListVisible?: boolean;
  availabilityStatus?: 'working' | 'unverified' | 'unavailable';
  descriptions?: Record<string, { full?: string; meta?: string }>;
};
```

Full station ayrıca `homepage`, `favicon`, `state`, `language`, `languageCodes`, `codec`, `bitrate`, `hls`, `votes`, `clickCount`, rating alanları ve `logoAssets` taşıyabilir. `slim=1` yanıtında açıklamalar/diğer ağır alanlar bulunmayabilir. Tarih string'lerini parse edin; Unix milliseconds alanlarını ISO string sanmayın.

`isListVisible=false` liste baskılamasıdır; `availabilityStatus` yerel sağlık kanıtını ifade eder. `working` sonsuz garanti değildir. `lastCheckOk` sağlayıcının geçmiş kontrolü, `noIndex` SEO kararıdır; bunları oynatma izni gibi kullanmayın. Doğrudan detay URL'si, istasyon listelerde gizliyken de açık kalabilir.

## 2. Katalog, arama ve keşif

Bütün bu yollar public'tir. Önerilen mobil ilk sayfa: 20–30 kayıt, `slim=1`; API'nin izin verdiği 500 kayıt sınırını normal ekran boyutu olarak kullanmayın.

| Method / yol | Query/body | Yanıt / önemli not |
| --- | --- | --- |
| GET `/api/stations` | `page=1&limit=25&slim=1`; `country,state,genre,tags,language,search,sort,minVotes,excludeStationIds,timePeriod` | `{stations,totalCount,count,pagination:{page,limit,total,pages}}`; limit≤500 |
| GET `/api/stations/precomputed` | `page,limit,slim,countryName,countryCode,genre,language,search,hasLogo,codec,bitrate,sort` | `{success,data,stations,total,count,page,totalPages,cached:false,pagination}`; `data`/`stations` alternatif alanlar, iki listeyi birleştirmeyin |
| GET `/api/station/:identifier` | `_id`, provider UUID, slug veya alias | Tek full station; `slug` ve varsa `redirectToSlug` ile canonical kimliği güncelleyin; JSON yanıtı otomatik HTTP redirect değildir |
| POST `/api/stations/batch` | `{stationIds:["<id>"],slim:true}` | 1–50 ID; istenen ID'ye göre anahtarlı nesne; bulunmayan/görünmez kayıtlar atlanabilir |
| GET `/api/stations/popular` | `country,state,limit=12` | Station dizisi |
| GET `/api/stations/nearby` | `lat,lng,radius=100,limit=12,country,userCountry,slim=1` | Station dizisi + km cinsinden `distance`; radius 1–150, limit≤50; country fallback'inde distance null |
| GET `/api/stations/similar/:id` | `limit=6` (≤20) | Station dizisi; kaynak istasyon yoksa404 |
| GET `/api/stations/:stationId/linked` | ID | `{stations:[...]}`; en fazla12 |
| GET `/api/stations/country-random` | zorunlu `country` | Tek station; yoksa404 |
| GET `/api/stations/with-geo` | `limit=1000` (≤5000) | Koordinatlı station dizisi; normal açılışta topluca çağırmayın |

Desteklenen sort değerleri `votes`, `az`, `za`, `newest`, `oldest`. Ana listedeki `order` parametresi şu an okunuyor ancak uygulanmıyor. `timePeriod`: `all`, `24h`, `7d`, `30d`. `excludeStationIds` virgülle ayrılmış ID'lerdir. Public listeler `excludeBroken=false` verilse bile gizlenmiş istasyonları filtreler.

Arama en az **iki karakterle** başlatılmalı: tek karakter filtre eklemiyor; iki karakter isim prefix'i, üç ve üstü isim/ülke/tür kelime araması kullanıyor. Sorgu en fazla100 karakter. `language` yayın dili filtresidir, UI locale değildir.

`GET /api/stations/stats` içindeki working/broken sayıları legacy sağlayıcı sağlık değerleridir; native availability sayacı gibi sunmayın. Endpoint adında `precomputed` bulunması yanıtın her durumda hazır bir disk cache'den geldiği garantisi değildir.

### Ülke / tür / dil

| Method / yol | Parametreler | Yanıt |
| --- | --- | --- |
| GET `/api/countries` | yok / `format=rich` | string[] / `[{name,nativeName,code,flag,flagUrl,stationCount}]` |
| GET `/api/genres` | `page=1,limit=9,country,countryCode,search,sortColumn,sortBy` | `{success,genres,data,total,count,page,currentPage,limit,perPage,totalPages}` |
| GET `/api/genres/precomputed` | `countryName,page=1,limit=27,search` | Benzer zarf + `computedAt` milliseconds ve `countryName`; limit≤200 |
| GET `/api/genres/discoverable` | `country,limit=13` (≤50) | Genre dizisi; bazı hata durumları200[] |
| GET `/api/genres/slug/:slug` | Dönen canonical slug | `{name,slug,stationCount,description?,icon?}` |
| GET `/api/genres/:slug/stations` | `page=1,limit=20,country` | `{genre,stations,total,page,pages}`; limit≤100 |
| GET `/api/filters/countries` | — | Ülke adı dizisi |
| GET `/api/filters/languages` | — | Yayın dili adı dizisi |
| GET `/api/languages` | — | `[{_id,name,code,stationCount}]`; code her zaman ISO UI locale değildir |
| GET `/api/codecs` | — | `[{_id,name,stationCount}]` |
| GET `/api/translations/:lang` | Desteklenen UI locale | Düz `{key:"translated string"}` sözlüğü |
| GET `/api/translations/:lang/critical` | UI locale | Küçük başlangıç sözlüğü |

Genre sort: `sortColumn=name|stationCount`, `sortBy=asc|desc`. Görünen/çevrilmiş başlıktan slug üretmeyin. Çeviri sözlüğü eksik anahtarlarda default metne düşebilir; bu, istasyonun 14 açıklamasının hazır olduğu anlamına gelmez. Full station metni `descriptions[locale].full`, kısa metni `.meta` içindedir.

### For You / öneriler

| Method / yol | Girdi | Yanıt |
| --- | --- | --- |
| GET `/api/recommendations/pool` | `country`, `genres=jazz,pop` (en fazla8 farklı tür) | `{stations,total}`, en fazla100 kompakt aday; mobilde çeşitlendirmek için önerilen başlangıç |
| GET `/api/recommendations/dedicated` | `country,genre,limit=10` (≤100) | Station dizisi; hata200[] olabilir |
| GET `/api/recommendations/diverse` | `country,limit=20` (≤50) | `{stations,total}`; eski cache/boş fallback olabilir |
| GET `/api/ml/recommendations/:sessionId` | `limit=20` | Station dizisi + `_recommendation:{score,reasons,confidence,type}`; yeni oturumda popüler fallback |
| GET `/api/ml/user-profile/:sessionId` | Pseudonymous session ID | Tercih edilen tür/ülke, dinleme ve profil gücü alanları |

Ülke/tür/session değişince query key de değişsin. İstemcide aynı filtreli havuzdan tekrarsız rotasyon yapılabilir; bütün dünyadaki kataloğu indirmek gerekmez. ML session ID'ye email/telefon/token koymayın.

## 3. Oturum ve profil

| Method / yol | Auth | Body / yanıt |
| --- | --- | --- |
| POST `/api/auth/mobile/login` | — | `{email,password,deviceType:"mobile",deviceName?}` → `{success,token,expiresIn:"90 days",user}` |
| POST `/api/auth/google` | — | `{idToken,name?,platform?}` → aynı token zarfı; kimlik Google token'ından doğrulanır |
| POST `/api/auth/apple` | — | `{identityToken,fullName?:{givenName,familyName},platform?}` → aynı token zarfı |
| POST `/api/auth/signup` | — | `{fullName,username,email,password}` →201 `{message,user,emailVerificationRequired:true}`; token/session yok |
| GET `/api/auth/mobile/me` | Bearer | `{authenticated,user,token?:{expiresAt,deviceType}}`; geçersiz token200+false |
| GET `/api/auth/me` | O | Daha kapsamlı kullanıcı/ayarlar; durum kısıtları uygulanır |
| POST `/api/auth/mobile/logout` | O | Verilen Bearer iptal; `{success,message}` |
| POST `/api/auth/mobile/logout-all` | A | Bütün kullanıcı token'larını iptal; `revokedCount`; tüm web session'larını silmez |
| POST `/api/auth/forgot-password` | — | `{email}` → her zaman genel mesaj; maildeki reset token süresi1 saat |
| POST `/api/auth/reset-password` | — | `{token,newPassword}`; geçersiz/expired400 |
| PUT `/api/auth/profile` | A | Kısmi `{fullName,email,password,location,isPublicProfile,preferences}` → `{message,user}` |
| PUT `/api/users/:userId` | A/owner | Ek olarak `username,avatar,bio` destekler → bare updated user |
| POST `/api/user/avatar` | A | multipart `avatar`, JPEG/PNG/WebP≤5MB, en az100×100 → `{success,avatar}`;400×400 WebP oluşturulur |
| DELETE `/api/user/avatar` | A | Avatar kaldırma |
| DELETE `/api/user/delete-account` | A | Hesap silme; Apple/Google aboneliğini iptal etmez; açık kullanıcı onayıyla çağırın |

Username 3–30 karakter `[A-Za-z0-9_.-]`; signup parola en az8 karakter. Profil/reset parolası ayrıca en fazla72 UTF-8 byte. Email/username çakışması409. Profilde boş parola değiştirilmez. `/api/auth/profile` username/avatar/bio güncellemez; yanlış alanı sessizce işlenmiş sanmayın.

`preferences` örneği:

```json
{
  "preferences": {
    "language": "de",
    "autoplay": false,
    "playAtLogin": "LAST_PLAYED"
  }
}
```

`playAtLogin`: `LAST_PLAYED|RANDOM|FAVORITE`. Preferences toplam boyutu≤4096. Native ilk açılışta kullanıcı istemeden ses başlatma davranışını ayrıca ürün/platform politikasıyla değerlendirin.

Güvenlik farkı: `/mobile/me` standart middleware'in inactive hesap kontrolünü uygulamıyor ve preferences/subscription döndürmüyor; tek başına hesap yetki otoritesi saymayın. Gereken kullanıcı alanlarını `/auth/me` (`{authenticated,user}`), premium durumunu `/user/subscription` üzerinden alın; korunan işlemlerin403 yanıtını uygulayın. Middleware session'ı Bearer'dan önce değerlendirebildiği için native client cookie jar'ını hesap değişiminde temizleyin veya Bearer client'ında cookie persistence kullanmayın.

Native için browser `/auth/login` yerine `/mobile/login` tercih edilir. Browser login token'ı yalnızca mobile/tv deviceType verilince ekler ve expiry alanının adı farklıdır. Browser OAuth redirect/token-session akışı native custom-scheme login akışı değildir. Native Facebook POST veya refresh-token endpoint'i bulunmadı.

**23 Eylül 2026 native sosyal giriş notu (`3085b609a`):** [mobile-social-verification.ts](../../artifacts/api-server/src/auth/mobile-social-verification.ts) Google ID token'ını `GOOGLE_CLIENT_ID` ile birlikte kodda açıkça izin verilen mevcut native/Firebase client ID'lerine karşı doğrular. iOS SDK ile başlayan Google girişinde `aud` mevcut Firebase web/server client ID'si olabilir; sırf cihaz iOS diye başka audience uydurmayın. Apple doğrulaması `issuer=https://appleid.apple.com`, native `com.visiongo.megaradio` audience'ı ve tanımlı `APPLE_CLIENT_ID`/`APPLE_SERVICE_ID` değerlerini korur. Web Services ID native bundle audience'ının yerine geçmez. Public OAuth client ID secret değildir; mevcut SDK/Firebase/Apple uygulama ayarlarıyla eşleştirin. Google client secret, Apple private key veya service-account JSON'u uygulamaya koymayın; yeni client ID gerekiyorsa backend allowlist'i ayrı kontrollü değişiklikle güncellenir. Bu not mağaza imzasını, gerçek native login testini veya yeni bir secret oluşturulduğunu iddia etmez.

### Bildirim tercihleri

`GET /api/user/notification-settings`, `PATCH` veya `PUT` aynı yol; **A**. Yanıt `{notificationSettings:{favorites,nowPlaying,newStations,recommendations}}`.

PATCH gövdesi iç içe değil düzdür: `{"nowPlaying":false,"recommendations":true}`. Yalnızca boolean alanlar; bilinmeyen alan reddedilir. Varsayılanlar sırasıyla true/true/false/false.

## 4. Favori, geçmiş, puan ve dinleme

| Method / yol | Auth | Girdi → yanıt |
| --- | --- | --- |
| GET `/api/user/favorites` | A | `sort=newest|oldest|name|country`; **hem** page hem limit verilirse `{stations,pagination:{page,limit,total,totalPages}}`, aksi durumda station[]; limit≤100 |
| POST `/api/user/favorites` | A | `{stationId:"<internal-id>"}` → `{success,message}` |
| DELETE `/api/user/favorites/:stationId` | A | → `{success,message}` |
| GET `/api/user/favorites/check/:stationId` | A | → `{isFavorited}` |
| GET `/api/recently-played` | O | En fazla12 station + `playedAt`; anonim200[] |
| POST `/api/recently-played` | O | `{stationId}` → loginli `{success:true}`, anonim204 body yok |
| POST `/api/listening/record` | A | `{stationId,listenDuration,stationName?,country?,genre?}` → `{success:true,totalTime}`; süre pozitif **saniye** |
| POST `/api/stations/:id/click` | — | → `{success:true}` |
| POST `/api/stations/:id/rate` | O | `{rating:1..5,comment?,sessionId?}` → `{success,message,rating,stats}` |
| GET `/api/stations/:id/ratings` | — | `page=1,limit=10` (≤100) → `{ratings,pagination,stats}` |
| GET `/api/stations/:id/user-rating` | O | Anonim kimlik için `sessionId` query → `{rating:record|null}` |
| POST `/api/stations/:id/vote` | — | → `{success:true,votes}` |

Puan `stats`: `{averageRating,totalRatings,ratingBreakdown:{stars1,stars2,stars3,stars4,stars5}}`; POST `/rate` yanıtı ayrıca `votes` içerir, GET `/ratings` stats'ında bu alan yoktur. Aynı kimliğin puanı güncellenir; yeni rating zaten vote sayısını da artırabilir. Tek aksiyon için hem rate hem vote çağırmayın. Favorite kalbi, sağlayıcı oy sayısı ve yıldız puanı üç ayrı kavramdır.

Native geçmiş için cookie-only `/api/user/last-played` kullanmayın. `/listening/record` geçmişi otomatik güncellemez; `/recently-played` ayrı işlemdir. Dinleme/click/vote yazmaları idempotent değildir; timeout sonrası kör retry sayaçları şişirebilir.

ML olay endpoint'i: `POST /api/ml/track-interaction` (**—**), `{sessionId,stationId,listenDuration,interactionType,deviceType?,location?,skipReason?}`. Türler `play|skip|favorite|share|seek|volume_change`. Eski web API örneğindeki `duration` değil **`listenDuration`** kullanılır. Kullanıcı verisini minimize edin; her saniye olay göndermeyin.

Hata raporu: `POST /api/stations/report-error` (**—**) `{stationId,stationName,stationUrl,errorType,errorMessage,errorDetails?,stationMeta?,browserInfo?,streamInfo?}` → `{success,message,errorId,totalOccurrences?}`. Tek cihazın geçici hatasında sürekli rapor üretmeyin; özel token içeren URL/log alanlarını temizleyin.

Legacy `/api/user-engagement/stations/:stationId/rate` ayrı sözleşmedir: auth gerekir, `review` alanını kullanır. Bu kılavuzun `comment` kullanan public station rating ailesiyle karıştırmayın.

## 5. Topluluk ve takip

| Method / yol | Auth | Parametre / yanıt |
| --- | --- | --- |
| GET `/api/users/search` | — | `q,page=1,limit=20,sortBy=recent_favorites`; `{users,pagination:{page,limit,total,pages,hasMore}}`; limit≤50 |
| GET `/api/user-engagement/profile/:slug` | — | Public profil; slug/username/ID kabul eder; private/inactive/yok404 |
| GET `/api/user-engagement/profile/:slug/full` | — | `favLimit=20,recentLimit=20` → `{profile,favorites,total,recentlyPlayed}` |
| GET `/api/user-engagement/profile/:slug/favorites` | — | `page=1,limit=20` → `{favorites,total,page,limit}` |
| POST `/api/user/follow/:userId` | A | `{success,message}`; ID24hex; kendini/tekrar takip400 |
| DELETE `/api/user/unfollow/:userId` | A | `{success,message}`; zaten takip edilmiyorsa400 |
| GET `/api/user/is-following/:userId` | A | `{isFollowing}` |
| GET `/api/user/followers/:userId` | — | `page,limit` → `{followers:[{user,followedAt}],pagination}` |
| GET `/api/user/following/:userId` | — | `page,limit` → `{following:[{user,followedAt}],pagination}` |

Directory sort değerleri `newest|oldest|most_radios|least_radios|recent_favorites`. Ad için `fullName`, profil yönlendirmesi için dönen slug/username kullanılmalı; user ID'yi görünen ad yapmayın. Eksik/bozuk avatar fallback'e düşmeli. Null istatistiği sıfırmış gibi göstermeyin.

Eski `/api/users/:userId/follow-OLD` ve DELETE `/api/users/:userId/follow`410 döner. Alternatif user-engagement unfollow yolu POST kullanır; yukarıdaki DELETE ile karıştırmayın.

## 6. Mesajlaşma ve bildirimler

Tüm `/api/messages/*` yolları **A** gerektirir.

| Method / yol | Girdi | Yanıt / yan etki |
| --- | --- | --- |
| GET `/api/messages/contacts` | — | `{contacts}`, en fazla100 |
| GET `/api/messages/conversations` | — | `{conversations}`, son50; dışarı açık pagination yok |
| GET `/api/messages/unread-count` | — | `{count}` |
| GET `/api/messages/conversation/:partnerId` | `limit=50` (≤100), `before=<oldest-message-id>` | `{messages,partner,hasMore}`; sayfa kendi içinde kronolojik; **gelen mesajları/ilişkili bildirimleri okundu yapar** |
| POST `/api/messages/send` | `{toUserId,content,messageType?,imageUrl?}` | `{success:true,message}`;20/dk/kullanıcı |
| POST `/api/messages/upload-image` | multipart `image` | `{imageUrl:"/uploads/chat/..."}`;JPEG/PNG/GIF/WebP≤5MB;10 upload/5dk |
| GET `/api/messages/search-users` | `q` en az2 karakter | Kişiler içinde arama, en fazla10 sonuç |
| GET `/api/messages/online-status` | `userIds=id,id` (≤100) | `{status:{id:boolean}}`; yalnızca kişiler |
| GET `/api/messages/ws-ticket` | — | `{ticket}`; tek kullanımlık60sn; yeni ticket eskisini geçersiz kılar |

`partnerId`, `toUserId` ve cursor gerçek 24hex ID olmalı. Gönderim için iki kullanıcıdan en az biri diğerini takip etmeli; aksi403. Eski konuşma unfollow sonrası okunabilir. `messageType=text|image|emoji`, `content` trim sonrası1–2000 karakter; resimde de content zorunlu. Image mesajında yalnızca upload'ın döndürdüğü `/uploads/chat/...` yolu kabul edilir; istemcinin herhangi bir dış URL'sini gönderemezsiniz.

Resmi gösterirken relative upload yolunu doğru API/upload origin'iyle çözün; gönderen POST'a relative yolu koruyarak koyun. Konuşma GET'inin okundu yan etkisi nedeniyle bütün konuşmaları arka planda preload etmeyin. Mesajı ID ile birleştirin; history sayfası ve realtime aynı mesajı getirince duplicate oluşturmayın.

### Chat WebSocket

Önce Bearer ile ticket alın; sonra `wss://api.themegaradio.com/ws/chat?ticket=<url-encoded-ticket>` bağlantısını açın. Uzun ömürlü Bearer'ı WebSocket query'sine koymayın, tek kullanımlık ticket'ı da loglamayın.

Chat JSON zarfında `type` ve payload alanları **aynı seviyededir** (metadata socket'inin `action` zarfıyla karıştırmayın):

```json
{"type":"chat:typing","toUserId":"<partner-id>"}
```

İstemciden giden diğer olaylar: `chat:read` + `fromUserId,messageIds?`; `chat:active` + `withUserId` (ID veya null); `chat:ping`. Sunucudan gelenler:

| type | Ek alanlar |
| --- | --- |
| `chat:connected` | `userId,onlineUsers` |
| `chat:message` | `message,sender,echo?` |
| `chat:typing` | `fromUserId` |
| `chat:read` | `byUserId` |
| `chat:online_status` | `userId,online` |
| `notification:new_message` | `fromUser,preview` |
| `chat:pong` | — |
| `error` | `message` |

Gerçek mesaj gönderimi HTTP `/send` ile yapılır. Ticket durumu process-local; reconnect için yeni ticket alın, deployment sonrası eski ticket'a güvenmeyin. Eksik/geçersiz ticket4001/4002 kapatma kodlarına neden olabilir. Logout/hesap silmede client socket'ini kapatın. Hesap silme DB token/session kayıtlarını temizlese de mevcut socket/pending WS ticket için açık bir anlık iptal yolu bulunmadı; native istemci bu bağlantıyı açık bırakmamalıdır. Kaynak: [messages-routes.ts](../../artifacts/api-server/src/routes/messages-routes.ts).

### Uygulama içi bildirim

- GET `/api/user/notifications` (**A**): `page=1&limit=10&category=all`; category `all|social|stations|system`, limit≤100. Yanıt `{notifications,pagination,categoryCounts,unreadCount}`; unreadCount bütün kategorilerin toplamıdır, yalnızca mevcut sayfanın değil.
- PATCH `/api/user/notifications/:id/read` (**A**) → `{success,notification}`.
- PATCH `/api/user/notifications/read-all` (**A**) → `{success,markedCount}`; bütün kategorileri kapsar.

### Native push

- POST `/api/user/push-token` (**O**): `{token,platform:"ios"|"android",tokenType?,deviceName?,country?,language?}` → `{success,message}`.
- DELETE `/api/user/push-token` (**O**): JSON `{token}`; logout'tan ayrı çağrı.
- `tokenType` sağlayıcıya uygun `apns`, `fcm` veya `expo` olmalı; otomatik algılama Expo prefix'i, sonra platforma bakar.
- Geçersiz Bearer bazı kayıt durumlarında anonim token kaydına düşer; başarılı kayıt doğru hesaba bağlandığını tek başına kanıtlamaz. Login ve token rotation sonrasında eşleştirmeyi güncelleyin.
- `/api/user/push-subscription`, `/api/push/vapid-public-key` browser Web Push içindir; native APNs/FCM yerine kullanılmaz.
- **Teslimat açığı:** görünür sosyal/mesaj bildirimi için [PushNotificationService](../../artifacts/api-server/src/services/pushNotificationService.ts) yalnızca Expo-prefixed token'ları gönderime alıyor. Ayrı [SilentPushService](../../artifacts/api-server/src/services/silentPushService.ts) APNs/FCM/Expo arka plan bildirim koduna sahip. APNs/FCM kaydının başarılı olması görünür mesaj bildiriminin teslim edileceğini göstermez; native release öncesi ilgili hattı tamamlayıp test edin.

## 7. Premium / IAP

Native tercih edilen yol: **A** ile `POST /api/user/subscription`.

```json
{
  "platform": "ios",
  "productId": "megaradio_premium_yearly",
  "receipt": "<real-apple-base64-receipt>"
}
```

```json
{
  "platform": "android",
  "productId": "megaradio_premium_yearly",
  "purchaseToken": "<real-google-play-purchase-token>"
}
```

Başarı: `{success:true,plan,expiryDate:<ISO|null>,isActive:true,features,environment?}`. Mevcut bu handler'da doğrulama hataları400 `{error,code}`; başka hesaba ait receipt409 `receipt_replay`. Kod bazlı UI uygulayın; eski hotfix notlarındaki bütün HTTP statülerinin hâlâ aynı olduğunu varsaymayın.

| Backend product ID | Plan |
| --- | --- |
| `megaradio_remove_ads_yearly1` | `remove_ads` |
| `megaradio_premium_monthly1` | `premium_monthly` |
| `megaradio_premium_yearly` | `premium_yearly` |
| `megaradio_premium_lifetime` | `premium_lifetime` |

Bu tablo kodda kabul edilen ürünlerdir; mağazada satışa açık olduklarının teyidi değildir. Fiyatı ve localized başlığı StoreKit/Play Billing'den alın.

- GET `/api/user/subscription` (**A**) → `{plan,expiryDate,isActive,features,expired?}`. Yetki kaynağı bu sunucu durumudur.
- Restore için ayrı endpoint bulunmuyor: store'un geri verdiği receipt/token tekrar doğrulanır ve hesapla eşleştirilir.
- Apple verifier şu an legacy base64 receipt-data / verifyReceipt kullanır; StoreKit2 signed transaction JWS kabul eden bir sözleşme yoktur. Native ekip çıktı uyumluluğunu sağlamalı veya backend sözleşmesini kontrollü genişletmelidir.
- Android verifier içinde acknowledge/consume çağrısı bulunmadı. SDK/backend arasında satın alma acknowledgement sorumluluğu release öncesi netleştirilmeli; receipt doğrulaması tek başına tamamlanmış ödeme yaşam döngüsü değildir.
- POST `/api/user/subscription/cancel` (**A**) store recurring planlarda409 `{code:"manage_in_store",actionRequired:"open_store_subscriptions",platform,manageUrl}` döndürür. Mağaza yönetim ekranına yönlendirin.
- Bu local-cancel yolunu Paddle/Stripe iptali sanmayın. Web aboneliği için POST `/api/subscription/portal` (**A**) → `{success,portalUrl}` kullanılır; kayıt yok404, sağlayıcı hazır değil503.

Alternatif POST `/api/iap/validate`: `{platform,productId,receipt}`; **Android purchase token da burada `receipt` alanına konur**. Auth opsiyoneldir. Yanıt `{valid,expiresAt:<epoch-ms|null>,originalTransactionId,isLifetime,productId,plan,features,attachedToUser,environment?}`. Anonim doğrulama hesaba bağlamaz. `valid:true` ile503 `persist_error` birlikte gelebilir; bu durumda kalıcı premium açmayın. Native hesap senaryosunda üstteki authenticated subscription yolunu tercih edin.

`GET /api/subscription/status` farklı web/TV zarfı (`tier,status,adFree,...`), `/api/subscription/plans` web fiyatları, POST `/api/subscription/checkout` ise web/Paddle checkout akışıdır. Bunları native mağaza fiyatı/satın alma endpoint'i gibi kullanmayın.

## 8. Akış, now-playing ve resimler

### Ses — ayrı origin

Önce station detayındaki `urlResolved || url` değerlendirilir. Native desteklenen HTTPS yayına doğrudan bağlanabilir; proxy gerektiğinde origin `https://stream.themegaradio.com` kullanılır.

| Yol | Girdi / çıktı |
| --- | --- |
| GET `/api/stream/resolve?url=<percent-encoded-url>` | `{originalUrl,playlistType:"direct|pls|m3u|hls",candidates:string[],resolvedAt:<ms>}` |
| GET `/api/stream/<base64url-of-utf8-url>` | JSON değil ses byte akışı |

Resolver PLS/M3U içinden aday çıkarır, HLS URL'sini korur; orijinal URL fallback olarak bulunabilir. Aday listesi yayınların çalıştığına dair garanti değildir. Proxy transcoding yapmaz, HLS'yi MP3'e dönüştürmez. Private/local hedefler engellenir. IP başına5 eşzamanlı stream üzerinde429, kapasitede503; bağlantı timeout30sn, idle60sn, ayrıca kaynak/lifetime sınırları olabilir. İstasyon değişiminde eski bağlantıyı kapatın, her kart için stream açmayın.

Production API-only serviste embedded proxy varsayılan değildir; API hostunda `/api/stream` varmış gibi yazmayın. Ana web hostundaki `/api/stream` ve `/api/image` ayrı proxy'ye yönlendirilir.

### Metadata — ürün API'si

GET `/api/now-playing/:id` → `{title,artist,station,genre?}`. Metadata olmayınca boş alan veya station adı gelebilir;8sn bekleyebilir. Metadata timeout'u sesi durdurmamalıdır.

Opsiyonel `wss://api.themegaradio.com/ws/metadata`:

```json
{"action":"trackStream","streamUrl":"<public-stream-url>"}
```

Durdurma: `{"action":"stopTracking"}`. Sunucu `connected` ve `{"action":"setTitle","data":{"title":"...","artist":"...","station":"...","genre":"...","raw":{"title":"..."}}}` olaylarını kullanır. `raw` string değil, opsiyonel title/artist/station/genre alanları olan metadata nesnesidir. Değişimler3sn aralıkla kontrol edilir; kapasite/yavaş tüketicide1013 kapanabilir. Tek aktif istasyonu takip edin; HTTP polling ile aynı anda gereksiz çift mekanizma çalıştırmayın.

### Görseller

Öncelik: boyuta uygun `logoAssets.webp48|webp96|webp256`, sonra `original`; legacy dosya kayıtlarında `/station-logos/{folder}/{filename}`; sonra `localImagePath`, `favicon`, son olarak native fallback. Gerçek absolute URL'leri değiştirmeyin. Logo job status'unun completed olması dosyanın hâlen erişilebilir olduğunu kanıtlamaz.

Ana web origin'inde `GET /api/image/<base64url(UTF8-source-url)>?size=96` veya `w,h`: default180px, max512; başarı JSON değil optimize görseldir (Accept'e göre WebP/AVIF). Hatalı/engelli URL400; upstream hatalarında non2xx. URL query string'ini encode ederken token sızdırmayın. S3 upload veya yönetim anahtarları mobil tarafta bulunmaz.

## 9. Yardımcı / ileri özellikler

- GET `/api/app/pages`: mobil yasal/içerik sayfaları için kaynak; GET `/api/app/info`: `{success,app}`. Info içindeki statik `version:"1.0.0"` ve boş store linklerini minimum-version/force-upgrade sistemi saymayın.
- GET `/api/tv/init?country=...&limit=20&genreLimit=20`: `{popularStations,trendingStations,genres,countries,meta}`; iki limit≤50. TV odaklı başlangıç paketi, kullanıcı token'ının alternatifi değil.
- TV pairing: POST `/api/auth/tv/code`, GET `/api/auth/tv/code/:code/status`, POST `/api/auth/tv/activate`, POST `/api/auth/tv/logout`, GET `/api/auth/tv/verify`.
- Authenticated cihaz yönetimi: GET `/api/user/devices`, DELETE `/api/user/devices/:deviceId`.
- Cast için iki route ailesi var: `mobile-tv-routes.ts` ve `cast-routes.ts`. `/api/cast/command` adı örtüşebilir; mevcut client/handler akışını seçmeden tek bir sözleşme gibi implement etmeyin. İlk consumer sürüm için opsiyonel ayrı entegrasyon paketi yapın.

## 10. Salt okunur başlangıç örnekleri

macOS/Linux terminalinde; gerçek test kullanıcısı ve token güvenli geliştirme ortamından sağlanmalıdır:

```sh
curl --fail-with-body 'https://api.themegaradio.com/api/stations?page=1&limit=20&slim=1&sort=votes'
curl --fail-with-body 'https://api.themegaradio.com/api/countries?format=rich'
curl --fail-with-body 'https://api.themegaradio.com/api/translations/de/critical'
```

PowerShell'de aynı çağrılar için `curl.exe` kullanın. Auth örneği (shell'de önceden güvenli tanımlanmış test token'ıyla):

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $MEGARADIO_TEST_TOKEN" \
  'https://api.themegaradio.com/api/auth/mobile/me'
```

Katalog yanıtından gerçek `_id` alın → detayını çağırın → kaynak URL'yi player ile deneyin. Bu örnekler mass-crawl, load test veya production'a yazma izni değildir. Debug logunda request header'ını redakte edin.

## 11. Kaynaklar ve sözleşme değişiklikleri

| Alan | Gerçek uygulama |
| --- | --- |
| Katalog | [station-public-routes.ts](../../artifacts/api-server/src/routes/station-public-routes.ts), [station-read-store.ts](../../artifacts/api-server/src/data/station-read-store.ts) |
| Kimlik / görünürlük | [station-identity-store.ts](../../artifacts/api-server/src/data/station-identity-store.ts), [station-visibility.ts](../../artifacts/api-server/src/utils/station-visibility.ts) |
| Tür / ülke / ML | [genres-countries-routes.ts](../../artifacts/api-server/src/routes/genres-countries-routes.ts), [regions-recommendations-routes.ts](../../artifacts/api-server/src/routes/regions-recommendations-routes.ts) |
| Login / profil / takip | [user-auth-routes.ts](../../artifacts/api-server/src/routes/user-auth-routes.ts), [auth.ts](../../artifacts/api-server/src/middleware/auth.ts), [user-profile.ts](../../lib/api-zod/src/user-profile.ts) |
| Favori / puan / bildirim | [translation-admin-routes.ts](../../artifacts/api-server/src/routes/translation-admin-routes.ts), [user-engagement.ts](../../artifacts/api-server/src/routes/user-engagement.ts) |
| Mesaj | [messages-routes.ts](../../artifacts/api-server/src/routes/messages-routes.ts), [postgres-message-store.ts](../../artifacts/api-server/src/data/postgres-message-store.ts) |
| Mobil / TV / push | [mobile-tv-routes.ts](../../artifacts/api-server/src/routes/mobile-tv-routes.ts), [cast-routes.ts](../../artifacts/api-server/src/routes/cast-routes.ts) |
| IAP / ödeme | [misc-routes.ts](../../artifacts/api-server/src/routes/misc-routes.ts), [iap-validation-routes.ts](../../artifacts/api-server/src/routes/iap-validation-routes.ts), [iap-verify.ts](../../artifacts/api-server/src/services/iap-verify.ts), [stripe-subscription-routes.ts](../../artifacts/api-server/src/routes/stripe-subscription-routes.ts) |
| Stream / metadata | [stream-proxy-routes.ts](../../artifacts/api-server/src/routes/stream-proxy-routes.ts), [realtime-metadata.ts](../../artifacts/api-server/src/services/realtime-metadata.ts) |

Yeni endpoint veya alan eklenince bu belge, native DTO ve sözleşme testini birlikte güncelleyin. Özellikle zarf/pagination, ID, locale, null ve hata kodu değişikliklerini geriye uyumluluk olmadan yayınlamayın.

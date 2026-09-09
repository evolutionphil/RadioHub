# Radyo yayın sağlığı ve görünürlük

## Karar

Çalışmadığı bilinen radyolar katalog, arama, öneriler ve benzeri radyo listelerinden çıkarılır. Veritabanındaki istasyon, çeviriler, logolar, puanlar, favori ilişkileri ve dinleme geçmişi silinmez. Yeni başarılı sağlık bilgisi geldiğinde istasyon yeniden listelenebilir.

Doğrudan radyo URL'si bir liste değildir. Mevcut 14 dildeki bilgi sayfası, açıklamalar, canonical ve hreflang korunur. Yayın kapalıysa hem ziyaretçi hem Google aynı geçici yayın uyarısını ve çalışan alternatifleri görür; oynatma başlatılmaz. Sadece yayının kesilmesi sayfayı 404/503 yapmaz, sitemap kaydını kaldırmaz veya yeni noindex sebebi oluşturmaz. Bu yaklaşım, bilgi sayfasını açık tutup kullanılamayan işlevi kısıtlama prensibinin radyo sitesine uygulanmasıdır; sıralama veya indeks garantisi değildir. [1][2]

## Mevcut sistemde bulunan açıklar

Ortak PostgreSQL liste okuyucusunda sağlık filtresi isteğe bağlıydı; `excludeBroken=false` isteyen istemci başarısız radyoları görebiliyordu. Coğrafi, rastgele, tür, favori, geçmiş ve bazı TV listeleri ayrı sorgular kullandığından tek bir frontend filtresi yeterli değildi. Yayın öncesi Avusturya sorgusu 355 kayıt bildiriyor ve Energy NRJ Wien, Kronehit Disco, NOSTALGIE Österreich gibi `lastCheckOk=false` kayıtları döndürebiliyordu.

Bazı sunucu önbellekleri günlerce saklanıyor, Redis'ten alınan kısa ömürlü kayıtlar daha uzun yerel süreyle tutulabiliyordu. Tarayıcıda son dinlenenler bölümü ise batch yanıtında bulunamayan istasyonu eski localStorage kaydından yeniden gösteriyordu. Yalnız sorguyu değiştirmek bu eski kopyaları ortadan kaldırmıyordu.

Mevcut SEO kalite politikası, uzun yayın kesintisini `stream-dead-30d` gerekçesiyle noindex sebebi sayıyordu. Yeni kararda yayın kullanılabilirliği içerik sayfasının indekslenebilirliğinden ayrılır. Başka kalite kuralları, yönlendirmeler, yönetici kısıtlamaları ve sahipliği kanıtlanamayan eski noindex işaretleri topluca kaldırılmaz. Örneğin mevcut Energy NRJ Wien kaydında noindex bulunuyor fakat otomatik sağlık gerekçesinin sahiplik kaydı yok; bu işaretin manuel olmadığı varsayılamaz.

## Kaynak araştırması

Projede kullanılan canlı katalog sağlayıcısı RadioBrowser'dır. Mevcut gece eşitlemesi tüm kayıtları, bozuk olanlar dahil, sayfalar halinde alır. Bu akış korunur; yalnız çalışanları içeri alan bir kaynak filtresi, bozuk kayıtların daha sonra düzelmesini izlemeyi zorlaştırır.

RadioBrowser `lastcheckok` alanını farklı kontrol noktalarının çoğunluk sonucu olarak tanımlar. `lastchecktime` herhangi bir sunucunun son kontrolünü, `lastlocalchecktime` ise yanıt veren RadioBrowser sunucusunun kendi kontrolünü anlatır; uygulamamızın kontrol zamanı değildir. Belgelerde en az günlük kontrol belirtilir, ancak çalışma garantisi verilmez. ISO tarih alanları tercih edilir; eski saat dilimsiz tarih UTC kabul edilir. [3]

Alternatif olarak checks akışıyla değişen UUID'ler bulunup byuuid toplu sorgusuyla son istasyon sonucu alınabilir. Ham bir `check.ok` sonucunu çoğunluk sonucu yerine kullanmak doğru değildir. Bu sürümde mevcut gece eşitlemesine ikinci bir kapsamlı kaynak taraması eklenmez; ilave maliyet ve karmaşıklığı sınırlamak için bağımsız küçük yayın örnekleri kullanılır. Yeni ücretli sağlayıcı, AI çağrısı veya ayrı Railway servisi gerekmez. Sağlayıcı erişiminde tanımlayıcı User-Agent ve sunucu keşfi/fallback önerisi geçerlidir. [3][4]

## Otomatik kontrolün sınırları

| Özellik | Uygulanan sınır |
|---|---|
| Görev sıklığı | İki dakikada bir, API arka plan görevi |
| Ortak işlem bütçesi | Tüm replikalar için en fazla 12 istasyon / iki dakika |
| Eşzamanlı bağlantı | En fazla iki istasyon kontrolü |
| Tek kontrol süresi | DNS, yönlendirme ve playlist dahil toplam en fazla 8 saniye |
| HTTP istekleri | Bir kontrol zincirinde en fazla dört |
| Örnek veri | Normal ses yanıtında yaklaşık 1 KiB; toplam uygulama örneği tavanı 64 KiB |
| Sağlıklı yerel sonuç | Sonraki yerel kontrol yedi gün sonra; kaynak eşitlemesi ayrıca devam eder |
| İlk kesin yerel hata | Henüz çalışan istasyonu gizlemez; 15 dakika sonra yeniden kontrol |
| Doğrulanmış yerel arıza | Aynı URL'de en az 10 dakika aralıklı iki kesin olumsuz gözlem; yeniden kontrol 12 saat sonra |
| Belirsiz sonuç | Önceki doğrulanmış durumu korur; tekrar kontrol altı saat sonra |
| Yaygın belirsizlik | En az altı sonuçta yüzde 80 belirsizlik varsa 15 dakika geri çekilme |

Kesin yerel olumsuz gözlem, örneğin bağlantının reddedilmesi veya uygun yayın URL'sinde 404/410 yanıtıdır. Timeout, DNS belirsizliği, 403/429/451, şifreli veya desteklenmeyen playlist gibi durumlar tek başına radyonun herkes için çalışmadığını kanıtlamaz. HLS canlı segmentinin değişmesiyle oluşan 404 de kesin arıza sayılmaz. Bu nedenle sistem bölgesel veya geçici hatalarda toplu gizlemeye gitmez.

İlk turdaki katalog büyüklüğü, belirsiz sonuçlar, arızalı radyo oranı ve sistem yoğunluğu nedeniyle tüm istasyonların aynı gün yerel olarak ölçülmesi garanti değildir. 40 bin istasyonluk dengeli bir katalogda haftalık yerel örnekleme hedeflenir; mevcut kaynak kontrolü daha sık bilgi sağlayabilir. Kontrol ile gerçek kullanıcının dinleme anı arasında yayın bozulabileceğinden hiç arıza görülmeyeceği garanti edilemez.

## Veri güvenliği ve yarış koşulları

Kuyruk ve ortak kota PostgreSQL'de tutulur. Yeniden başlatma bütün kataloğu baştan okutmaz; süreli iş kiraları kaybolan çalışanlardan sonra geri alınabilir. Birden fazla API kopyası aynı anda sınırsız tarama yapamaz. Yeni kayıtlar kuyruğa en fazla 500'lük gruplarla eklenir.

Yayın soketi açıkken veritabanı bağlantısı veya satır kilidi tutulmaz. Sonuç yazılırken iş kirası, URL, önceki sağlık zamanı/durumu ve manuel koruma tekrar karşılaştırılır. Arada URL veya sağlık bilgisi değişmişse eski örnek uygulanmaz. Sağlık güncellemesi açıklamaları, oyları veya sitemap içerik tarihini yeniden yazmaz. Daha eski kaynak kontrolünün yeni yerel/yönetici sonucunu geri alması da engellenir; daha yeni kaynak sonucu iyileşmeyi gösterebilir.

Her bağlantı ve yönlendirmede dış URL güvenlik kontrolü ve DNS sabitlemesi uygulanır. Özel ağ, metadata, dahili servis portu ve kimlik bilgisi içeren URL'ler denenmez. Çerez veya yetkilendirme bilgisi gönderilmez. Hata günlükleri yayın URL'si veya gizli değer içermez. HTTP HEAD başarısı tek başına yeterli sayılmaz; sınırlı ses veya gerçek HLS medya örneği aranır.

## Performans ve maliyet

Ziyaretçinin sayfa veya oynatma isteği bir stream kontrolünü beklemez. Liste görünürlüğü mevcut `last_check_ok` sütunu üzerinden, sayfalama ve toplam hesabından önce uygulanır. Sunucu önbellekleri sağlık içeren yanıtlar için mutlak son kullanma zamanıyla sınırlandırılır; eski gün/hafta ad alanları yeniden kullanılmaz. Tarayıcıdaki ortak sorgular kısa tazelik süresi, odak ve bağlantı geri dönüşü ile yenilenir; kart başına sürekli ağ kontrolü yapılmaz.

Veritabanı havuzunda bekleyen kullanıcı sorgusu veya yüksek event-loop kullanımı varsa yerel kontrol ertelenir. Yine de sıfır CPU, bellek, veritabanı veya ağ tüketimi iddia edilmez. Sabit bütçe teorik olarak en fazla 8.640 kontrol/gündür. Her kontrolün yalnız 1 KiB örnekle bitmesi yaklaşık 8,4 MiB/gün uygulama yükü; her birinin 64 KiB tavanına ulaşması yaklaşık 540 MiB/gün üst sınır senaryosudur. Bunlar fatura hesabı değildir: DNS/TLS/HTTP başlıkları, TCP tamponları, sağlayıcı yanıtları ve altyapı ücretlendirmesi ayrıca değerlendirilir. Normal ses örnekleri tavan senaryosundan çok daha küçüktür.

Mevcut altyapı kullanılır. `STREAM_HEALTH_ENABLED=false` yerel örnekleyiciyi durdurabilir; genel `BACKGROUND_JOBS_ENABLED=false` de zamanlayıcıyı devre dışı bırakır. Normal yapılandırmada yeni değişken zorunlu değildir. Yetkili `GET /api/admin/stream-health/status` kuyruk, son tur, gizli kayıt sayısı ve sabit bütçeyi gösterir; yayınları test etmek için kullanılmaz.

## Doğrulama

Yayın öncesi son kontroller:

- Ön yüz: 75 dosyada 1.145 test geçti; TypeScript kontrolü geçti.
- API: son kapsamlı turda 1.817 test geçti. Node test çalıştırıcısında bir dosya `Unable to deserialize cloned data` altyapı hatasıyla kesildi; bu sitemap dosyası ayrı çalıştırmada 22/22 geçti. İki eski MongoDB aktarım entegrasyonu bu PostgreSQL sağlık çalışmasında çalıştırılmadı. Uygulama assertion hatası açık bırakılmadı; bu sonuç kesintisiz tek bir yeşil test turu olarak sunulmaz.
- API TypeScript kontrolü ve API/web/ön yüz üretim derlemeleri geçti. Üretim bağımlılık sınırı kontrolünde MongoDB bağımlılığı bulunmadı.
- Gerçek yerel PostgreSQL testleri iki olumsuz gözlem, iyileşme, replika kotası, yeniden başlatma kiraları, eşzamanlı URL/manuel değişiklik koruması, favori/geçmiş ilişkileri ve tarih önceliğini doğruladı. Probe testleri ücretli veya gerçek yayın taraması yerine yalıtılmış örnekler kullandı.
- 40 bin kayıtlı yerel PostgreSQL ölçümü, 20 ardışık liste sorgusunda p50/p95 sürelerini filtresiz 10,16/10,62 ms; sağlık filtreli 10,69/11,06 ms buldu. Beklenen ülke toplamı 10.000'den 8.000 çalışan kayda indi. Doğrudan kayıt sorgusu p95 0,86 ms ölçüldü. Bu rakamlar üretim yük testi veya performans garantisi değildir.
- 14 dilde SSR metni, canonical/hreflang korunması, çevrimdışı uyarısı, sitemap'te yayın arızalı ama içerik olarak uygun URL'nin tutulması ve manuel/kalite dışlamalarının korunması test edildi.

Üretim kontrolü bu commit'in hem web hem API servisine başarıyla dağıtılmasından sonra yapılır. Canlı örnekler tüm kataloğun gerçek sesini dinlediğimiz anlamına gelmez. Üretimde kayıt silme, yapay oy/tıklama, reklam gösterimi veya gerçek kullanıcı hesabı üzerinden test yapılmaz. Sahipliği bilinmeyen eski noindex kaydı otomatik silinmez; uygun çevrimdışı bilgi sayfası 200 yanıtıyla açılırken mevcut noindex korunur.

## Kaynaklar

1. Google Search Central. [Temporarily pause or disable a website](https://developers.google.com/search/docs/crawling-indexing/pause-online-business). Erişim: 9 Eylül 2026. İşlevi kısıtlarken yararlı bilgi sayfalarını açık tutma prensibi.
2. Google Search Central. [HTTP status codes and network/DNS errors](https://developers.google.com/crawling/docs/troubleshooting/http-status-codes). Erişim: 9 Eylül 2026. Uzayan 5xx hatalarının tarama ve indeks üzerindeki etkisi.
3. RadioBrowser. [API reference](https://docs.radio-browser.info/). Erişim: 9 Eylül 2026. İstasyon/check alanları, günlük kontrol açıklaması, UUID toplu arama ve checks uçları.
4. RadioBrowser. [Using the API / server discovery](https://api.radio-browser.info/). Erişim: 9 Eylül 2026. Sunucu keşfi, tanımlayıcı User-Agent ve fallback.

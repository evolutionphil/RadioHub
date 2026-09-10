# Radyo yayın sağlığı etiketlerinin güvenilirliği

## Sonuç

Veritabanındaki 9.721 olumsuz sağlık etiketi, 9.721 radyonun kesinlikle dinlenemediğini kanıtlamıyor. Dört ülkenin popüler kayıtları arasından seçilen, tamamı `lastCheckOk=false` olan 20 istasyonun beşinden kayıtlı yayın adresi kullanılarak ses verisi alındı. İkinci bağımsız kontrolde aynı beş adres HTTP 200 döndürdü; alınan örneklerde art arda geçerli MP3 veya AAC çerçeveleri bulundu. Bu kayıtlar için mevcut olumsuz etiket ile gerçek erişilebilir ses verisi çelişiyor.

Örneklem rastgele seçilmediği için beş/yirmi oranı tüm kataloğa uygulanamaz. 9.721 kayıttan kaçının gerçekten arızalı olduğunu bu sınırlı inceleme belirlemiyor. Ayrıca ses çerçevelerinin alınması, yayının her ülkede, her cihazda, reklam/premium kısıtı olmadan veya kesintisiz saatlerce dinlenebileceği anlamına gelmez.

## Sayılar ve kapsam

Canlı `/api/stations/stats` yanıtının zamanı 10 Eylül 2026 17:53:23 UTC; inceleme ve doğrulama yaklaşık 17:55–18:00 UTC aralığında yapıldı. Yanıt toplam 61.610, olumlu 51.889 ve olumsuz 9.721 kayıt bildiriyor. Bunlar kayıtlı sağlık değerleri; bu yanıtın oluşturulma zamanı bütün yayınların o anda kontrol edildiği anlamına gelmiyor. [1]

Avusturya, Almanya, Türkiye ve ABD için oy sırasındaki ilk 100 kayıttan ülke başına en fazla altı olumsuz kayıt seçildi. Avusturya'dan altı, Almanya'dan iki, Türkiye'den altı, ABD'den altı istasyon incelendi. İlk örnekleme aynı anda en fazla iki bağlantı, adres başına sekiz saniye ve sınırlı örnek veri kullandı. Asıl ve çözümlenmiş adres farklıysa ikisi de ayrı değerlendirildi. Kontroller mevcut yerel bilgisayarın bağlantısından yapıldı; Railway veya telefon bağlantısı üzerinden ölçüm değildir.

| İncelenen 20 olumsuz kayıt | Sonuç |
|---|---:|
| En az bir kayıtlı adresten ses örneği dönen | 5 |
| Denenen adresleri yalnız 404 gibi kesin HTTP hatası döndüren | 5 |
| Başarılı ses kanıtı olmayan fakat timeout/403/DNS gibi belirsizlik içeren | 10 |
| Kayıtlı kontrolü 30 günden eski olan | 13 |

Beş olumsuz örnek için de “radyo kuruluşu tamamen kapandı” sonucu çıkarılamaz: denenen adres yerine başka bir yayın adresi çalışıyor olabilir. Belirsiz on kayıt ise kesin kapalı sayılmamalıdır.

İlk örneklemede toplam 5.422 bayt uygulama gövdesi okundu. İkinci doğrulamada beş yayından ayrı ayrı 8.192 bayt okundu. Bu rakamlar TLS/DNS/başlıklar ve işletim sistemi tamponları dahil faturalandırılan toplam ağ trafiği değildir. Katalog ve sağlayıcı JSON okumaları ayrıca gerçekleşti. Herhangi bir ses dosyası kaydedilmedi; üretimde kayıt, sağlık etiketi, oy veya dinleme geçmişi değiştirilmedi.

## Doğrulanmış karşı örnekler

| Radyo | Veritabanındaki son kontrol | İkinci ses kontrolü | Adres karşılaştırması |
|---|---|---|---|
| Energy NRJ Wien | 24 Kasım 2025 | 200, `audio/mpeg`, art arda MP3 çerçeveleri | Çözümlenmiş adres çalışıyor; asıl adres 404 |
| NOSTALGIE Österreich | 24 Kasım 2025 | 200, `audio/mpeg`, art arda MP3 çerçeveleri | Çözümlenmiş adres çalışıyor; asıl adreste süre doldu |
| Energy NRJ Österreich Pop | 24 Kasım 2025 | 200, `audio/aacp`, art arda AAC çerçeveleri | Çözümlenmiş adres çalışıyor; asıl adres 404 |
| Radio 5 Turkey | 6 Eylül 2026 | 200, `audio/aacp`, art arda AAC çerçeveleri | Çözümlenmiş adres çalışıyor; asıl adreste yeterli örnek yok |
| dinamo.fm discotheque | 6 Eylül 2026 | 200, `audio/mpeg`, art arda MP3 çerçeveleri | Kayıtlı ortak yayın adresi çalışıyor |

Bu beş kaydın `lastCheckOk` değeri ikinci kontrol öncesinde de false olarak kaldı. Dolayısıyla yalnız eski liste önbelleğinden kaynaklanan bir görüntü farkı değil, güncel API kaydı ile yayın erişimi arasında ölçülmüş bir uyuşmazlık var. Ayrıntılı zamanlar, istasyon kimlikleri ve sonuçlar özel yerel kanıt dosyalarında bulunuyor. [2][3]

## Kaynak sistemle karşılaştırma

RadioBrowser'ın `lastcheckok` alanı birden fazla ölçüm noktasının çoğunluk sonucudur. `url` başlangıç adresi, `url_resolved` ise yönlendirme ve playlist çözümlemesiyle elde edilen adrestir. Belgeler günlük kontrol hedefini açıklasa da servis garantisi vermez. Bu alanlar belirli bir telefonun o andaki dinleme sonucu değildir. [4]

20 istasyonun UUID'leri iki RadioBrowser aynasında (`de2` ve `de1`) toplu olarak arandı. İki yanıt da yalnız yedi kaydı içerdi; diğer 13 UUID için sonuç gelmedi. Energy NRJ Wien'in eski UUID'si ayrıca tekil sorguda da boş döndü. Bu, adları aynı radyoların tüm sağlayıcı kataloğundan tamamen silindiğini kanıtlamaz; yeni UUID veya başka kayıt olasılığı araştırılmadan birleştirme yapılamaz.

Önemli karşılaştırma: Radio 5 Turkey ve dinamo.fm discotheque iki sağlayıcı yanıtında da `lastcheckok=0` ve 6 Eylül tarihli kontrolle yer alıyordu. Buna rağmen aynı kayıtlı yayın adreslerinden yerel bağlantıda ses çerçeveleri alındı. Bu iki örnekte yalnız bizim veritabanımızı sağlayıcıyla yeniden eşitlemek, yanlış olumsuz görünürlüğü çözmeye yeterli değildir. İki aynanın aynı sonucu döndürmesi iki yeni bağımsız dinleme testi sayılmaz; bunlar ortak/çoğaltılmış katalog verisi olabilir.

Kaynakta artık eşleşmeyen eski UUID'ler için yalnız UUID üzerinden eşitleme iyileşme bilgisini getiremeyebilir. Kodda UUID değişimindeki benzer kayıtları atlayıp eski kimliği koruyan bir dal da bulunuyor. Ancak bu incelemede yeni kimlikli karşı kayıt doğrulanmadığından tek tek örneklerin neden kaybolduğu kesinleştirilmedi.

## Kod bulguları

İnceleme anında Railway web ve API servisleri `c1553a258681b4f2a3ca263846ac71d4ffd11260` sürümünde başarılı durumdaydı. Yerelde hazırlanan `1427793c749bff0bb73e01d661712f6f05661461` commit'i GitHub main'e gönderilmemişti. Yeni yerel yayın kontrolü mevcut 9.721 etiketin kaynağı olarak gösterilemez.

### 1. Sağlayıcı etiketi ile kesin görünürlük kararı birleşmiş

Mevcut canlı eşitleme sağlayıcının `lastcheckok` sonucunu uygulama bayrağına kopyalıyor. Canlı eski sürümde yalnız `=== 1` olumlu; eksik veya beklenmedik tip de false'a dönüşebilir. Bu bir kod riski; incelenen kayıtların her biri için asıl neden olduğuna dair yazma geçmişi yok.

Yayımlanmamış sürüm tarih ve tip kontrolünü iyileştiriyor. Ancak yeni tarihli sağlayıcı false sonucu hâlâ doğrudan görünürlük bayrağını kapatabiliyor. İki ayrı olumsuz ölçüm şartı yalnız yerel örnekleyicide uygulanıyor; sağlayıcı eşitlemesi bu şartı kullanmıyor. Böylece yerelde çalışan yayın, sonraki sağlayıcı false sonucu ile yeniden gizlenebilir.

Kanıt: [sync.ts](C:/Users/mumiix/Documents/GitHub/RadioHub/artifacts/api-server/src/services/sync.ts:658), [sağlık yazma koruması](C:/Users/mumiix/Documents/GitHub/RadioHub/artifacts/api-server/src/data/postgres-catalog-store.ts:341), [yerel iki ölçüm kuralı](C:/Users/mumiix/Documents/GitHub/RadioHub/artifacts/api-server/src/data/postgres-stream-health-store.ts:84).

### 2. Kontrol ile oynatıcı aynı alternatifleri denemiyor

Hazırlanan işçi yalnız `urlResolved || url` adresini kontrol ediyor. Oynatıcı ise çözümlenmiş adres, playlist adayları ve gerektiğinde asıl adres/proxy arasında geçiş yapabiliyor. Bir adayın başarısız olması, bütün desteklenen oynatma yollarının başarısız olduğunu kanıtlamıyor.

Yönetici düzenlemesinde asıl `url` değiştirilebilirken eski `urlResolved` kalabiliyor. Bu da elle düzeltilmiş asıl adres ile sağlığı ölçülen eski adresi birbirinden ayırabilir. Canlı örneklerde bunun ters yönü de görüldü: asıl adres 404 olsa bile kayıtlı çözümlenmiş adres hâlâ ses döndürebiliyor. Hangisinin her zaman daha doğru olduğunu varsaymak yerine desteklenen adaylar birlikte değerlendirilmelidir.

Kanıt: [işçi adres seçimi](C:/Users/mumiix/Documents/GitHub/RadioHub/artifacts/api-server/src/data/postgres-stream-health-store.ts:41), [oynatıcı asıl adres yedeği](C:/Users/mumiix/Documents/GitHub/RadioHub/artifacts/megaradio/src/hooks/useGlobalPlayer.tsx:599), [yönetici düzenleme alanları](C:/Users/mumiix/Documents/GitHub/RadioHub/artifacts/api-server/src/routes/admin-station-routes.ts:482).

### 3. Playlist ve DNS alternatifleri eksik

Hazırlanan örnekleyici playlist'te yalnız ilk uygun adayı seçiyor. İkinci aday çalışsa bile ilk adayın 404 sonucu kesin olumsuz sayılabiliyor. DNS güvenlik kontrolü de ilk doğrulanmış adresi sabitliyor; o adresin bağlantıyı reddetmesi başka bir IPv4/IPv6 adresinin çalışmadığını kanıtlamıyor. Bu mekanizmaların kodda bulunduğu doğrulandı; katalog genelindeki görülme sıklığı ölçülmedi.

Güvenlik kontrolleri kaldırılmamalı. Alternatifler yine doğrulanmış dış adreslerle, ortak süre/bağlantı/veri bütçesi içinde denenmeli. Bütçe bütün makul adaylara yetmezse sonuç kesin kapalı yerine belirsiz olmalı.

Kanıt: [playlist seçimi](C:/Users/mumiix/Documents/GitHub/RadioHub/artifacts/api-server/src/utils/station-stream-probe.ts:41), [DNS seçimi](C:/Users/mumiix/Documents/GitHub/RadioHub/artifacts/api-server/src/utils/safe-fetch.ts:187).

### 4. Belirsizlik eski false değerini iyileştirmiyor

Yeni örnekleyici timeout, 403, TLS/DNS sorunu ve çoğu sunucu hatasında doğru biçimde belirsiz sonuç üretiyor. Fakat önceki değer zaten false ise bu değer korunuyor. Bu nedenle eski ve hiç yerel olarak doğrulanmamış olumsuz kayıtlar yine gizlenmiş kalabilir. Hazırlanan oynatıcıda false değeri oynatmayı başlamadan engellediğinden bu yanlış sınıflamanın kullanıcı etkisi daha da büyür.

## Doğrudan link ile uygulamada dinleme arasındaki fark

Bir yayın adresinin yeni sekmede açılmasıyla bir web uygulamasının onu fetch, HLS veya proxy üzerinden kullanması aynı işlem değildir. Fetch tabanlı çapraz alan istekleri CORS kurallarına tabidir. HTTPS sayfaya HTTP kaynak eklemek de kaynağın türüne göre otomatik yükseltme veya engelleme doğurabilir. Bu genel tarayıcı mekanizmaları doğrudan açılan bir adresin uygulama içinde neden sorun çıkarabileceğini açıklar; bu 20 kayıtta CORS ya da mixed content hatası tek tek doğrulanmadı. [5][6]

Dolayısıyla iki ayrı soru tutulmalıdır: “Bu yayın adresinden ses alınabiliyor mu?” ve “Bizim uygulamamız bu cihaz/bağlantıda bu yayını oynatabiliyor mu?” İkinci sorudaki bir istemci hatası, bütün dünyaya geçerli bir radyo kapalı etiketi üretmemelidir.

## Önerilen karar modeli

Üç bilgi birbirinden ayrılmalı: sağlayıcının bildirimi, zaman/adres içeren yerel ölçüm kanıtı ve kullanıcıya uygulanacak görünürlük kararı.

| Kanıt | Önerilen işlem |
|---|---|
| Kaynak false fakat taze yerel doğrulama yok | Şüpheli işaretle, sınırlı arka plan kontrolüne al; otomatik kesin kapalı sayma |
| Kaynak kontrolü çok eski veya UUID bulunamıyor | Yeniden doğrulama gerekli; ne topluca sil ne topluca çalışıyor yap |
| Desteklenen adaylardan biri gerçek ses döndürüyor | Çalışabilir aday bilgisini sakla, görünürlüğü geri kazanması için güvenli olumlu kanıt kullan |
| Yeterli aralıkla tekrarlanan, desteklenen adayları kapsayan kesin olumsuz sonuçlar | Listelerden geçici gizleme; doğrudan bilgi URL'sini koruma |
| 403, bölgesel erişim, timeout, DNS/TLS veya aday bütçesinin dolması | Belirsiz/kısıtlı durumu; bütün dünyada kapalı iddiası yok |
| Güncel kaynak false, daha önce olumlu yerel ölçüm var | Kaynak sinyalini ayrı sakla ve yeniden kontrol iste; görünürlüğü tek adımda kapatma |

Her sonuç zaman damgası ve test edilen adresin kimliğiyle saklanmalı. URL değişince eski olumsuz kanıt yeni adrese uygulanmamalı. Manuel korumalar, kilit/kira kontrolleri, düşük bağlantı kotası ve istek yolunda test yapmama koşulu korunmalı. Dış sağlayıcı kaynaklı olumsuzluk, yerel doğrulanmış olumsuzluk ve belirsiz/eski kayıt sayıları yönetim panelinde ayrı gösterilmeli.

Öncelik, sık ziyaret edilen eski olumsuz kayıtların sınırlı gruplarla doğrulanmasıdır. 9.721 kaydı tek seferde yoğun taramak ya da tüm false değerlerini topluca true yapmak önerilmez. Yeni karar modeli ve yedek adres testleri tamamlanmadan hazırlanan katı gizleme/oynatmayı engelleme davranışını mevcut haliyle yayımlamak uygun değildir.

## Sınırlar

Bu çalışma teşhis niteliğindedir. Üretim verisi ve uygulama kaynak kodu değiştirilmedi; push/deploy yapılmadı. Kısa ses örnekleri içerik kimliğini, işitilebilirliği, uzun süreli kesintisizliği veya tüm cihazları doğrulamaz. Hata oranı kataloğun tamamına genellenmez. Sınırlı Railway günlük aramasında gece eşitleme satırı bulunamaması, görevin hiç çalışmadığını tek başına kanıtlamaz. Geçmiş bayrağın ilk yazıldığı andaki ağ koşulları ve kesin yazma nedeni bütün kayıtlar için mevcut değildir.

## Kaynaklar ve kanıtlar

1. MegaRadio. [Canlı istasyon istatistiği](https://themegaradio.com/api/stations/stats), yanıt zamanı 10 Eylül 2026 17:53:23 UTC. Dört ülkenin public `/api/stations` ve beş public `/api/station/{slug}` yanıtı; özel hesap/erişim anahtarı kullanılmadı.
2. [Sınırlı örnekleme sonuçları](C:/Users/mumiix/AppData/Local/Temp/radio-health-label-audit-20260910-175530/results.json). Yerel özel kanıt; istasyon kimliği, kayıtlı sağlık zamanı, adres özeti/hash'i, probe sonucu ve iki sağlayıcı karşılaştırması. Sağlayıcıda `found=false` olan satırların adres farkı alanları anlamlı karşılaştırma değildir; bu raporda adres değişimi kanıtı olarak kullanılmadı.
3. [Bağımsız ses çerçevesi kontrolü](C:/Users/mumiix/AppData/Local/Temp/radio-health-label-audit-20260910-175530/independent-audio-check.json). 10 Eylül 2026 17:59–18:00 UTC; ses gövdesi saklanmadı.
4. RadioBrowser. [API Reference: station and station-check fields](https://docs.radio-browser.info/). Erişim: 10 Eylül 2026. Aynı tarihte `de2.api.radio-browser.info` ve `de1.api.radio-browser.info` public UUID sorguları.
5. MDN. [Cross-Origin Resource Sharing](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS). Erişim: 10 Eylül 2026. Genel fetch/CORS mekanizması.
6. MDN. [Mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content). Erişim: 10 Eylül 2026. Genel HTTPS/HTTP kaynak davranışı.

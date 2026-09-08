# MegaRadio reklam senaryosu — 8 Eylül 2026

## Amaç ve inceleme yöntemi

Gelir elde etmeyi sürdürürken dinleme, gezinme ve özel hesap işlemlerini reklamla bölmemek. audit-website kontrol listesi yerleşim, mobil kullanım, performans ve gizlilik açısından uygulandı; squirrel CLI kurulu olmadığından sayısal bir tarama skoru üretilmedi. Canlı AdSense paneli, kaynak kod, Google'ın kuralları ve regresyon testleri kullanıldı. Reklamlara tıklanmadı; otomatik tarayıcı testleri gerçek reklam isteği/gösterimi üretmeden SDK taklidi kullanır.

## Bulunan nedenler

- AdSense: Auto Ads ve Auto Optimize AÇIK; intent-driven 1/1, overlay 3/3, in-page 2/2. Anchor, side-rail ve vignette birlikte açıktı. Otomatik deney trafiği %50, kazananı otomatik uygulama açıktı. Yalnız bir sayfa dışlaması vardı.
- Kod: ortak footer sadece admin ve premium/success dışında her rotada reklam başlatabiliyordu; profil, favoriler, mesajlaşma ve ödeme ekranları korunmuyordu.
- Mobil radyo sayfasında orta reklam ve mobil alt reklam birlikte görünüyordu; footer da üçüncü manuel alanı ekliyordu. Auto Ads bunların üstüne yeni alanlar yerleştirebiliyordu.
- Görünmeyen footer/duyarlı alanlar da SDK'yı başlangıçta yükleyebiliyordu. Doğrudan sponsor carousel'i 8 saniyede bir, arka planda da dönüyordu.

## Yeni gösterim matrisi

| Sayfa/ziyaretçi | Mobil | Masaüstü |
|---|---:|---:|
| Ana sayfa, genel radyo/tür/bölge katalogları | İçerik sonunda en fazla 1 | İçerik sonunda en fazla 1 |
| Radyo detayı | Benzer radyolardan sonra 1 | Yan alanda 1 + içerikte 1; toplam en fazla 2 |
| Profil, ayarlar, favoriler, discover/öneriler, geçmiş, kullanıcı profilleri | 0 | 0 |
| Mesajlar ve bildirimler | 0 | 0 |
| Giriş, kayıt, şifre, Premium, ödeme sonucu, TV aktivasyonu | 0 | 0 |
| Admin, iletişim, yardım/işlem, hukuk ve tanınmayan rota türleri | 0 | 0 |
| Aktif Premium/Remove Ads | 0 | 0 |
| Hesap durumu yükleniyor veya doğrulanamıyor | Reklam isteği yok | Reklam isteği yok |

Bunlar Google'ın sayısal üst sınırları değil; bu ürün için seçilen düşük yoğunluk bütçeleridir. Mevcut site tasarımı ve oynatıcı davranışı korunur. Reklamlar sabit/overlay değildir; oynatma/favori/menü düğmesinin içine eklenmez. Uzun sayfalara sonsuz akış reklamları veya zamanlayıcılı AdSense yenilemesi eklenmez.

## AdSense panelinde yapılanlar

- themegaradio.com için Auto Ads KAPALI ve Auto Optimize KAPALI olarak hemen uygulandı; tablo üzerinden kaydedildiği doğrulandı. Böylece otomatik anchor/vignette/side-rail/ad-intent/in-page yerleştirmesi kullanılmaz.
- Mevcut 3609188113 birimi **MegaRadio - Station Sidebar - Desktop** olarak adlandırıldı.
- Mevcut 9151849981 birimi **MegaRadio - Catalog Footer - Responsive** olarak adlandırıldı.
- **MegaRadio - Station Content - Responsive** adlı yeni duyarlı görüntülü birim oluşturuldu: **3667990641**. Masaüstü içerik alanı ve onunla aynı anda gösterilmeyen mobil alan bu birimi kullanır.
- Diğer eski reklam birimi, eski raporlar, CMP/gizlilik mesajı, ödeme ve hesap ayarları silinmedi/değiştirilmedi. Sponsor görselleri ve veritabanı kampanyaları korunur; uygun alanda AdSense ile aynı anda üst üste değil, öncelikli alternatif olarak gösterilir.
- Politika merkezi 8 Eylül kontrolünde **Politika ihlali sorunu yok** ve reklam sunumunu durduran/sınırlayan bir sorun bulunmadığını gösterdi. Bu, gelecekteki tüm gösterimler için koşulsuz politika onayı anlamına gelmez.

Google paneli, ayarların ve yeni birimin yayılmasının yaklaşık bir saati bulabileceğini bildiriyor. Kaydedilmiş ayar ile tüm eski açık sekmelerde/Google kenar sunucularında anlık sonuç aynı şey değildir; eski sekmede yenileme gerekebilir. Doluluk, gelir ve her ziyarette bir reklam gösterimi garanti edilmez.

## Kodda uygulanan korumalar

- Varsayılan ret yaklaşımı: yalnız bilinen kamuya açık radyo/katalog rota aileleri reklam alabilir. 14 aktif dil, çevrilmiş rota parçaları ve yönetici rota eşlemeleri dikkate alınır. Kişisel `tab`/`view` seçenekleri de engellenir.
- SPA konum ve sorgu değişimleri bağımsız takip edilir. Eski sayfa lazy geçişte mounted kalsa bile gerçek özel URL'ye girilince uygulamanın reklam alanı kaldırılır; geç SDK cevabı yeni özel alanda reklam açamaz.
- SDK yalnız görünür, pozitif genişlikli ve ön plandaki uygun bir alan için yüklenir. Tek SDK, slot başına tek istek; no-fill, kaydırma veya istasyon şarkı değişimi reklam yenilemez.
- Radyo sayfasında footer reklamı yoktur. Mobil orta/alt reklam tekrarı giderilir; responsive karşı alan gizliyken istek başlatmaz.
- Sponsor carousel'i 30 saniyelik sakin aralıkla, yalnız görünür ve ön plandayken döner; azaltılmış hareket tercihi, odak/hover ve manuel gezinme korunur. Google fallback reklamı carousel zamanlayıcısıyla yenilenmez.
- Alanlar 14 dilde nötr reklam etiketiyle içerikten ayrılır. CMP ve onay/ret mekanizması atlatılmaz, Google'a ait çalışan iframe veya reklam kodu gizlenerek/değiştirilerek müdahale edilmez.

## Karşılaştırma ve gelir modeli

Rakiplerin kendi yardım belgeleri platform reklamları ile istasyonun kendi sesli reklamlarını ayırıyor: [radio.net Prime](https://radio.zendesk.com/hc/en-us/articles/360020924139-What-is-the-benefit-of-radio-net-Prime), [TuneIn Premium](https://help.tunein.com/en/support/solutions/articles/151000172609-commercials-still-playing-on-stations-premium-user-), [myTuner FAQ](https://mytuner-radio.com/mytuner-faq/).

Bu belgeler rakiplerin sayfa başına kesin reklam sayısını kanıtlamaz. Onlara ait bir reklam sayısı ortalaması uydurulmadı. MegaRadio için önerilen ayrım: ücretsiz radyo + sınırlı platform reklamı; ücretli planda platform reklamlarının kaldırılması. İstasyon yayınındaki reklamları kaldırma vaadi yoktur.

Yeni birimler yerleşim bazında ayrı ölçülebilir. Değerlendirme, gerçek trafikte 7–14 günlük sayfa RPM, görüntülenebilirlik, kullanıcı başına dinleme süresi, çıkış oranı ve mobil CLS/INP/LCP ile yapılmalı. Daha az gösterim kısa vadede geliri azaltabilir; kullanıcı sadakati veya gelir artışı önceden garanti edilemez. Otomatik yeni format açma/deney uygulama yoktur. Bir sonraki değişiklik tek yerleşim üzerinden, veriye dayanarak yapılmalıdır.

## Birincil kurallar

- [Google reklam yerleşim politikası](https://support.google.com/adsense/answer/1346295?hl=en): özel iletişimin ana içerik olduğu ekranlarda reklam yasaktır; oynatıcı/menü yakınlığı yanlış tıklama riski taşır; yanıltıcı etiket ve otomatik reklam yenilemesi yasaktır.
- [Auto Ads ayarları](https://support.google.com/adsense/answer/9305577?hl=en) ve [Auto Ads açıklaması](https://support.google.com/adsense/answer/9261805?hl=en).
- [Sayfa dışlama kapsamı](https://support.google.com/adsense/answer/9262311?hl=en): Auto Ads dışlaması manuel reklam kodunu engellemez. Bu nedenle kod koruması ayrıca gereklidir.
- [Google CMP gereklilikleri](https://support.google.com/adsense/answer/13554116?hl=en): otomatik yerleşimi kapatmak rıza yönetimini kaldırmaz.

## Doğrulama

- Frontend tam regresyon: **71 test dosyası, 1.053 test başarılı**; TypeScript `--noEmit` başarılı.
- API, web ve frontend üretim derlemeleri başarılı; üretim veritabanına bağlanmadan ayrı geçici çıktı dizininde oluşturuldu.
- 14 dilde kamu/özel rota matrisi, ödeme ve Premium korumaları, mobil/masaüstü alan ayrımı, gecikmiş SDK cevabı, scroll/no-fill tekrarları, sponsor geçişleri ve observer bulunmayan eski tarayıcı fallback'i test edildi.
- Son üretim paketiyle izole tarayıcı testi **8/8 başarılı**: TR mobil radyo 1; DE masaüstü radyo 2; EN ana sayfa ve DE katalog 1; DE profil/favoriler, TR mesajlar ve EN discover 0. Başlangıçta ekran dışındaki footer için SDK/istek 0, kaydırma sonrası görünür alan başına yalnız bir istek, tekrar kaydırmada yenileme yok. Uygulama çalışma zamanı hatası 0.
- Tarayıcı testi gerçek kamu API verilerini, sentetik ücretsiz kullanıcı/anonim hesap cevaplarını ve boş sponsor envanterini kullanır. AdSense SDK ve reklam/analitik ağları taklit edilir; bu sonuç gerçek reklam doluluğu veya canlı kullanıcı oturumundaki her reklamın kontrol edildiği anlamına gelmez.

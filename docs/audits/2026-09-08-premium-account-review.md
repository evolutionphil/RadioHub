# Premium ve kullanıcı hesabı incelemesi — 8 Eylül 2026

## Sonuç ve ticari öneri

Ödeme altyapısındaki güvenlik, oturum, mesajlaşma ve profil hataları için kaynak düzeltmeleri ve izole testler hazırlandı. Gerçek kullanıcı hesabından satın alma, iptal, iade veya mesaj gönderilmedi.

Üretimin Paddle ayarı sandbox. Dört fiyatın salt okunur Paddle sorgusu `403 forbidden` verdi. Geçerli gerçek fiyatlar ve canlı ödeme bu nedenle doğrulanamadı. Ortam, anahtar, ürün fiyatları ve ödeme sağlayıcısındaki webhook abonelikleri değiştirilmedi. Bu engel çözülmeden sistem gerçek ödeme kabul etmeye hazır olarak sunulmamalı.

Önerilen sade ürün senaryosu:

1. Ücretsiz: radyo, arama, favoriler ve temel profil/iletişim özellikleri.
2. Premium aylık ve yıllık: gerçekten uygulanmış avantajlarla tek anlaşılır paket; yıllık indirim yalnız gerçek fiyatlardan hesaplanmalı.
3. Remove Ads korunacaksa Premium'dan farkı açık olmalı. Web sitesindeki reklamları kaldırmak, istasyon yayınındaki reklamları kaldırmak anlamına gelmez.
4. Lifetime yeni satışları, devamlı barındırma/stream maliyetine göre ayrıca değerlendirilmelidir. Bu incelemede plan silinmedi, fiyat değiştirilmedi veya mevcut müşteri hakkı topluca geri alınmadı.
5. Aktif abonede ikinci checkout yerine mevcut aboneliği yönetme akışı. Cihazlar aynı hesapla bağlanmalı; TV'de yeniden ödeme istenmemeli. Tamamen ayrı cihaz bağlama ürün akışı bu çalışmada icat edilmedi.

Web kaynaklarında doğrulanmayan HD kilidi, kayıt, sıfır buffering ve bütün gelecek özellikler gibi satış vaatleri daraltıldı. Kaynak ses kalitesi radyo istasyonuna bağlıdır. Native uygulamaların tamamına ilişkin özellik/eşitlik garantisi verilmedi.

## Frontend düzeltmeleri

- Provider verisi yokken €3.99/€4.99/€29.99/€59.99 fiyatlarını üretme ve sabit %37 indirim kaldırıldı. Gerçek sağlayıcı fiyatı/ödeme dönemi kullanılıyor; erişilemeyen planlar satın alınamıyor.
- Paddle tek sefer başlatılır; tekrar açılış, eşzamanlı tıklama, script yükleme hatası/zaman aşımı, hesap değişimi ve unmount ele alınır. Her girişim ayrı sahiplik kimliği kullanır.
- Sunucu imzalı checkout verisi korunur. Harici dönüş adresleri reddedilir. TV kodu ve dil ödeme/giriş dönüşünde kaybolmaz.
- Başarı sayfaları tarayıcı yönlendirmesini ödeme kanıtı saymaz. Sunucuda doğrulanmış abonelik/aktivasyon beklenir; süre aşımında tekrar ödeme yapmama uyarısı gösterilir. Polling sınırlı ve sayfa kapanışında durur.
- Kritik ödeme durumları 14 ana dilde yerel fallback içerir. Paddle'ın desteklemediği checkout dilleri sağlayıcı arayüzünde İngilizceye düşer; sitenin dönüş dili korunur. Bütün tarihî arayüz metinlerinin 14 dilde çevrildiği iddia edilmez.
- OAuth bearer fallback güvenilir API yazılarına da eklenir, üçüncü taraf URL'lere sızdırılmaz. Varsayılan otomatik mutation retry kapalıdır.
- Çıkış önce sunucu oturumunu iptal eder; ardından OAuth fallback, premium ipucu ve özel sorgu cache'i temizlenir. İptal başarısızsa kullanıcıya sahte çıkış başarısı gösterilmez.
- Reklamsız durum bilinen plan ve geçerli son kullanma tarihinden türetilir. Tarayıcı ödeme olayı/localStorage premium yetkisi vermez.

## Kanıt ve sınırlar

Frontend regresyonları gerçek React bileşenlerinde; API regresyonları gerçek HTTP route fixture'larında; işlem/sıralama/gizlilik testleri yerel PostgreSQL'de tek kullanımlık şemalarda çalıştırıldı. Testler canlı kullanıcı veya ödeme verisine yazmadı. API/web üretim build'lerinde MongoDB bağımlılığı sıfır olarak doğrulandı.

Birleşik frontend koşusu: **66 dosya / 774 test başarılı**. Birleşik Paddle/profil/mesaj HTTP ve karar koşusu: **44 test başarılı**, sıfır skip. Ayrı gerçek PostgreSQL koşuları: billing16 + messages4 + profile7 başarılı. İlave profil veri doğruluğu kontrolleri ilgili profil raporunda. Üretim API, web ve frontend build'leri başarılı; üretilen dosyalar yalnız görev geçici dizinine yazıldı.

Canlı tarayıcı başlangıç incelemesi Almanca premium sayfasında uydurma fiyatları, sabit indirim ve İngilizce satış vaatlerini doğruladı. Canlı oturum anonim olduğundan gerçek giriş yapılmış hesabın uçtan uca değişiklik testi gerçekleştirilmedi; özel hesap işlemleri fixture'larla doğrulandı.

İlk yayın sonrası canlı Almanca profil giriş korumasında ek hata bulundu: genel `/login` yönlendirmesi dili ve dönüş adresini kaybediyordu. Koruma artık 14 ana dilde güvenli dönüş URL'sini korur; geçici auth503/network hatası çıkışmış kullanıcı gibi ele alınmaz. Bu ek için 15 regresyon testi eklendi.

Canlı Türkçe ödeme dönüşünde ikinci yönlendirme hatası bulundu: dış router'ın `/:countryCode/:rest*` deseni kurulu Wouter sürümünde yalnız tek alt segment eşliyordu. Çok segmentli dil ekli premium/TV sonuç sayfaları 200 shell sonrasında istemcide 404'e düşüyordu. Desteklenen `/:countryCode/*` deseniyle onarıldı; gerçek kaynak route desenleri ve kurulu router kullanılarak bütün etkin dil tanımlarında ödeme/TV/mesaj yolları ve bilinmeyen sayfa davranışı için 172 regresyon testi geçti.

Ayrı anonim canlı tarayıcı testi ayrıca lazy giriş sayfası yüklenirken önceki korumalı bileşenin geçici olarak mounted kaldığını ve yönlendirmeyi tekrar ederek iç içe `returnTo` ürettiğini gösterdi. Giriş korumasına toast ve yönlendirme öncesi tek-seferlik geçiş kilidi eklendi; StrictMode ve URL değişiminden sonra tekrarlı render regresyonuyla doğrulandı.

Eski, süresiz işaretlenmiş abonelikler için sağlayıcıdan güvenilir reconciliation gerekir. Sandbox catalog erişimi engelliyken bunları topluca değiştirmek güvenli değildir. Ayrıca özel mesaj görsellerinin erişim mimarisi, çoklu sekme presence ayrıntıları ve gerçek push teslimatı için kalan sınırlar mesajlaşma raporundadır.

## İlgili raporlar ve kaynaklar

- [Backend Paddle incelemesi](../PADDLE_BILLING_AUDIT_2026-09-08.md)
- [Mesajlaşma ve bildirimler](2026-09-08-user-messaging-audit.md)
- [Paddle Initialize: sayfa başına tek başlangıç](https://developer.paddle.com/paddle-js/methods/paddle-initialize/)
- [Paddle checkout seçenekleri ve desteklenen diller](https://developer.paddle.com/paddle-js/methods/paddle-checkout-open/)
- [Paddle sunucu olaylarıyla erişim yönetimi](https://developer.paddle.com/build/subscriptions/provision-access-webhooks/)

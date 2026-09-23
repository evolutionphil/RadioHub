# Mega Radio — web özellik envanteri ve mobil karşılıkları

[Geliştirme rehberi](README.md) · [API listesi](API.md)

21 Eylül 2026 / `da23ccda1`. Bu envanter mevcut web/backend kaynaklarını anlatır; her satırın iOS/Android'de yapılmış olduğu veya production cihaz testini geçtiği anlamına gelmez. **P0** temel sürüm, **P1** web-parity sürümü, **P2** ayrı planlanabilecek entegrasyon. Öncelikler öneridir; ticari sürümde premium/reklam/push sunulacaksa ilgili testler o sürümün zorunlu kapısı olur.

23 Eylül 2026 eki (`3085b609a` + ziyaretçi detay özelliği): native platform başlığı ve tekil-IP ölçüm sınırları [API örneklerine](API.md#native-platform-header) eklenmiştir; ilk web özellik envanteri korunmuştur.

## 1. Dinleme ve keşif

| Web özelliği | Mobil karşılık / kabul noktası | Öncelik |
| --- | --- | --- |
| Ana sayfa: popüler, türler, ülkeye göre katalog | Sayfalı/slim veriler; her kart için ayrı detay isteği yok | P0 |
| Ülke seçimi | Dil tercihinden bağımsız; query key ve öneriler ülke değişimine tepki verir | P0 |
| Arama ve filtreleme | İsim/ülke/tür, debounce, iptal edilebilir istek, temiz boş durum | P0 |
| Genre listesi ve genre detay | Backend canonical slug'ı; ülkeye göre filtre | P0 |
| Tüm radyolar ve A–Z web dizini | Mobil filtre/sıralama ile aynı katalog erişimi | P0 |
| Bölge, ülke, şehir sayfaları | Coğrafi keşif; web route'larını native ekrana eşleştirme | P1 |
| Yakındaki radyolar | Konum izni opsiyonel; reddedilince ülke fallback; null mesafe gizli | P1 |
| Trending / For You | Ülke+tür havuzu, tekrarsız çeşitlilik; yeni kullanıcıda fallback | P1 |
| Son dinlenenler | Loginli geçmiş API'si; anonim yerel geçmiş uygulanacaksa ayrı saklama politikası | P0 |
| İstasyon detay | İsim, logo, ülke/şehir, genre, codec/bitrate, açıklama, aksiyonlar | P0 |
| Çok dilli istasyon açıklaması | `descriptions[locale]`; slim karttan açıklama beklenmez | P0 |
| Benzer / bağlı istasyonlar | Mevcut detaydan öneri; yanlış eski request sonucu görünmez | P1 |
| Çalışmayan radyoyu listede gizleme | Public liste filtresine uy; backend kaydını silme | P0 |
| Doğrudan istasyon linki | Listede gizli istasyonun detayına erişim korunabilir; dürüst availability durumu | P0 |
| Liste/grid kartları | Responsive native liste/grid, resim boyutu/fallback tutarlı | P1 |

Kaynaklar: [radio-frontend.tsx](../../artifacts/megaradio/src/pages/radio-frontend.tsx), [App.tsx](../../artifacts/megaradio/src/App.tsx), [public station routes](../../artifacts/api-server/src/routes/station-public-routes.ts), [recommendations](../../artifacts/api-server/src/routes/regions-recommendations-routes.ts).

## 2. Player

| Web özelliği | Mobil karşılık / kabul noktası | Öncelik |
| --- | --- | --- |
| Kalıcı global mini / geniş player | Ekran değişince player yeniden yaratılmaz | P0 |
| Play / pause ve istasyon değiştirme | Tek audio session; geç gelen eski retry sesi geri açmaz | P0 |
| Önceki / sonraki istasyon | Aktif kuyruk/listedeki seçim; sıradaki şarkıyı atlama değildir | P0 |
| Ses seviyesi / mute | Native OS davranışı ve ürün UI'sı ile uyum | P0 |
| Now playing başlık / sanatçı | HTTP veya metadata WS; metadata hatası ses hatası değil | P0 |
| Favori / oy / paylaşım aksiyonları | Birbirinden ayrı mutation/state; localized web linki | P0 |
| Web Media Session / klavye Space | Mobilde kilit ekranı, Bluetooth, kulaklık kumandaları | P0 |
| Stream çözümleme / proxy fallback | PLS/M3U/HLS/HTTP farkları; native codec desteği test edilir | P0 |
| Görsel equalizer animasyonu | Sadece görsel aktivite göstergesi; ses DSP equalizer değildir | P1 |
| AirPlay / Cast / TV ile ilişkili kod | Native SDK ve eşleştirme akışı ayrı doğrulanır; her web görünümünde aktif varsayılmaz | P2 |

Kaynaklar: [global-player.tsx](../../artifacts/megaradio/src/components/global-player.tsx), [useGlobalPlayer.tsx](../../artifacts/megaradio/src/hooks/useGlobalPlayer.tsx), [LazyGlobalPlayerProvider.tsx](../../artifacts/megaradio/src/hooks/LazyGlobalPlayerProvider.tsx).

## 3. Hesap, profil ve topluluk

| Web özelliği | Mobil karşılık / kabul noktası | Öncelik |
| --- | --- | --- |
| Email/parola kayıt ve giriş | Signup ardından ayrı native login; secure token store | P0 |
| Sosyal giriş | Backend Google/Apple native token endpoint'leri; OAuth audience doğrulaması | P1 |
| Şifremi unuttum / reset / parola değişikliği | Hata/başarı ve geçersiz token durumları; güvenli input/log | P0 |
| Hesap ayarları | Ad, email, ülke/konum, dil; endpoint'e göre izinli alanlar | P0 |
| Autoplay tercihleri | LAST_PLAYED / RANDOM / FAVORITE; platform açılış davranışı ayrıca kontrol | P1 |
| Avatar yükleme / kaldırma / fallback | Dosya limitleri; bozuk dış görselde ortak fallback | P0 |
| Public profil ve gizlilik | Public/private; ad, avatar, favoriler, mevcut istatistikler | P1 |
| Topluluk kullanıcı listesi | Arama, sort, recent_favorites; uydurma aktivite/isim/fotoğraf yok | P1 |
| Kullanıcı takip / unfollow | Gerçek user ID; follower/following sayaçlarını yenile | P1 |
| Favoriler / profil discover | Kişisel koleksiyon; optimistic update başarısızsa rollback | P0/P1 |
| Signup hatırlatıcısı | Native'e taşınacaksa mevcut erteleme tercihini koru; istasyon değiştikçe tekrar açma | P1 |
| Çıkış / cihaz oturumları / hesap silme | Özel cache temizliği; hesap silme store aboneliğini iptal sayılmaz | P0 |

Kaynaklar: [profil ayarları](../../artifacts/megaradio/src/pages/profile-settings.tsx), [profil discover](../../artifacts/megaradio/src/pages/profile-discover.tsx), [community helpers](../../artifacts/megaradio/src/lib/community-profile.ts), [auth routes](../../artifacts/api-server/src/routes/user-auth-routes.ts).

## 4. Mesaj ve bildirim

| Web özelliği | Mobil karşılık / kabul noktası | Öncelik |
| --- | --- | --- |
| Konuşma listesi / okunmamış sayısı | Server sınırlı liste; boş/hata durumları | P1 |
| Birebir mesaj | Takip ilişkisi koşulu; yanlış kişiye stale draft/mesaj gitmez | P1 |
| Metin, emoji, resim | Metin sınırı, multipart upload, güvenli attachment URL | P1 |
| Konuşma geçmişi | Before cursor ile eski mesajlar; scroll konumu korunur | P1 |
| Okundu, online, typing / realtime | Ticket tabanlı WS; actual send HTTP; duplicate mesaj yok | P1 |
| Mobil chat yerleşimi | Klavye açılınca composer görünür; safe-area/player overlap yok | P1 |
| Uygulama içi bildirim merkezi | Kategori, global unread count, tekini/tümünü okundu | P1 |
| Bildirim tercihleri | Favorites / nowPlaying / newStations / recommendations | P1 |
| Web Push ve native token kayıt altyapısı | Native APNs/FCM/Expo teslimat hattı ayrıca doğrulanır | P1 |

Mesaj okuma endpoint'i gelen mesajları okundu işaretler. Görünmeyen konuşmaları eager-fetch ederek kullanıcı okumadan okundu yapmayın. Mevcut görünür sosyal/mesaj push yolu yalnızca Expo token'larını gönderime alır; APNs/FCM kayıt ve ayrı silent-push kodunun varlığı native görünür push'un hazır olduğunu göstermez. Kaynak: [messages-routes.ts](../../artifacts/api-server/src/routes/messages-routes.ts), [mobile-tv-routes.ts](../../artifacts/api-server/src/routes/mobile-tv-routes.ts), [pushNotificationService.ts](../../artifacts/api-server/src/services/pushNotificationService.ts).

## 5. Premium, reklam ve cihazlar

| Mevcut altyapı | Mobil uygulamada dikkat edilecek | Öncelik |
| --- | --- | --- |
| Web premium / Paddle checkout | Native mağaza satın almasıyla aynı değil; platforma uygun satış yöntemi | P1 |
| Remove ads / monthly / yearly / lifetime ürün eşlemesi | Gerçek store ürünleri ve localized fiyat; backend entitlement | P1 |
| IAP receipt doğrulama | Apple receipt formatı, Android acknowledgement, restore/replay testleri | P1 |
| Abonelik yönetimi | Store yönetimi ile web portalını ayır; hesap silerken açıklama yap | P1 |
| Web AdSense / placement / premium reklam filtresi | Native reklam SDK'sı ayrı iş; kişisel/chat/form alanlarını kapatma | P1 |
| TV aktivasyon kodu ve cihazlar | İsteğe bağlı native remote/pairing ekranı; süre ve yetki senaryoları | P2 |
| Cast session / command altyapısı | İki farklı route ailesi incelenerek bir sözleşme seçilir | P2 |

Premium, yayıncının kendi ses reklamını kaldıramaz. Kaynaklar: [IAP verifier](../../artifacts/api-server/src/services/iap-verify.ts), [web billing](../../artifacts/api-server/src/routes/stripe-subscription-routes.ts), [ad components](../../artifacts/megaradio/src/components/ads/).

## 6. Ortak ürün kuralları ve web'e özgü alanlar

| Özellik | Mobilde karşılık |
| --- | --- |
| 14 dil, çeviri sözlükleri, açıklamalar | Ekran/metin tarih/sayı locale'i; RTL; cihaz dilini ilk açılışta kullan |
| Canonical/hreflang/schema/sitemap | Web/backend sorumluluğu; native her dili yeniden sitemap'e yazmaz |
| Localized paylaşım URL'leri | Universal Links / App Links route matrisiyle eşleştir |
| Header/footer, legal, FAQ, contact, feedback | Native bilgi/ayarlar ekranları; güvenli içerik gösterimi |
| Add your station / station request | Ürün ihtiyacına göre uygun form/web ekranı; admin create endpoint'ini açma |
| Profil avatar / istasyon logo fallback | Bütün kart/detay/player ekranlarında ortak bileşen |
| Responsive dark/pink görsel dil | Safe area, erişilebilirlik, keyboard ve tablet uyarlaması; web CSS kopyası değil |
| API docs / developer key paneli | Genel tüketici app'i için zorunlu değil; sırları mobil bundle'a koyma |
| Web service worker / SEO renderer / PageSpeed | Native'e kopyalanmaz; native performans ve cache politikası ayrı ölçülür |
| Dashboard platform / ülke / cihaz dağılımı | Normal API isteğinde `X-MegaRadio-Platform`; ek polling yok, son örneklenen istemci/tekil-IP ölçümü; admin detay endpoint'i consumer app'e bağlanmaz |

## 7. Admin / operasyon özellikleri — tüketici uygulamasının dışında

Backend/web admin tarafında istasyon yönetimi, gelişmiş filtreler, availability, duplicate merge, logo yönetimi, AI açıklama/çeviri işleri, dil/URL çevirileri, sitemap/SEO/GSC araçları, kullanıcı/abonelik/reklam yönetimi, dashboard, log ve bakım sayfaları bulunur. Bunlar mobil consumer feature değildir. Ekran dosyasının varlığı tüm dış servis credentials'ının veya her admin işlevinin canlı onaylandığını göstermez.

Mobil geliştirici bu işleri cihaz üzerinde çalıştırmamalı; normal API'de eksik alan görürse backend ile veri/sözleşme sorununu çözmeli. PostgreSQL'e doğrudan erişim, MongoDB sync, AI anahtarı, GSC servis hesabı ve admin yetkisi mobil uygulamada yer almaz.

## 8. Var kabul edilmemesi gereken özellikler

- Offline radyo indirme/kayıt, yayın içinde geriye sarma/DVR.
- Gerçek DSP equalizer veya sleep timer/alarm: bu incelemede tamamlanmış ürün sözleşmesi olarak doğrulanmadı.
- Native CarPlay/Android Auto/widget/Wear OS projeleri.
- Native store signing, ürün aktivasyonu, purchase acknowledgement veya push teslimatının uçtan uca hazır olması.
- Tam kapsamlı OpenAPI / otomatik üretilebilen tüm mobil API client'ı.
- Her eski radyo kaydında eksiksiz14 açıklama, her logonun erişilebilirliği veya her stream'in her ülkede çalışması.
- Google indeksleme, mağaza onayı veya ölçülmemiş performans garantisi.

Web-parity teslimi için yalnızca ekran sayısını değil [README kabul matrisini](README.md#10-geliştirme-sırası-ve-teslim-kriterleri) takip edin. Her özellikte loading/empty/error, yetki, locale, erişilebilirlik ve ağ kesintisi senaryosu birlikte bitmiş olmalıdır.

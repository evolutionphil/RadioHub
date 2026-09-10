# Yönetim paneli ve yayın sağlığı düzeltmeleri

Tarih: 10 Eylül 2026. Kapsam: Stations yönetimi, yanlış offline kararları ve yönetim ekranlarında bulunan somut hatalar. Bu belge parola, oturum bilgisi veya kullanıcı mesajı içermez.

## Canlı gözlemler

- Verilen yönetici hesabıyla `api.themegaradio.com/admin/stations` üzerinde oturum açıldı. Canlı katalog 61.610 kayıt gösteriyordu.
- `Energy NRJ Wien` yönetimde bulundu: eski kaynak kontrolüne dayanarak Offline gösteriliyor. Önceki bağımsız örneklemde bu istasyonun alternatif adresinden ses doğrulanmıştı. Kaynak bayrağı, bütün adreslerin kesinlikle çalışmadığının kanıtı değildir.
- Stations ekranındaki işlem düğmeleri ve geniş tablo yatay taşıyordu; sağlık filtresi yoktu. Yönetim başlığı “Last sync: Never” derken dashboard tamamlanan senkronizasyonu gösteriyordu.
- Menüdeki 39 yönetim adresi açılış düzeyinde tarandı. Bu, her sayfadaki bütün yazma işlemlerinin uçtan uca doğrulandığı anlamına gelmez. Bazı sayfalarda veri sorguları henüz yükleniyordu.
- iOS/CarPlay Logs ekranının tamamen boş kalması canlı tarayıcıda doğrulandı. Konsol hatası: boş değerli Radix Select.Item. Aynı kusur Error Logs ve API Explorer filtrelerinde de bulundu.
- Canlı ortamda kayıt silinmedi, toplu senkronizasyon/çeviri başlatılmadı, ödeme/reklam ayarı değiştirilmedi. Yönetici parolası dosyalara kaydedilmedi.

## Uygulanan düzeltmeler

### Sağlık ve görünürlük

- Sağlayıcı/aktarılmış `lastCheckOk` geçmişi ile yerel kontrol sonucu ayrıldı. Eski false kayıtlar topluca sahte true yapılmıyor.
- Yeni `isListVisible` ve `availabilityStatus` alanları; kaynak uyarısı tek başına listeden kaldırmıyor.
- Ham ve çözümlenmiş URL, PLS/M3U/HLS alternatifleri tek ortak bütçeyle deneniyor. Bir olumlu ses örneği yeterli; denenmemiş, erişim kısıtlı veya belirsiz alternatif varken kesin offline sonucu üretilmiyor.
- İki aralıklı, kesin olumsuz yerel kontrol gerekir. Otomatik gizleme en geç 24 saatte sona erer; bu süre sonu işçi çalışmasa da SQL okumasında uygulanır.
- URL düzeltmesi ve daha yeni olumlu kanıt korunur. Yönetici doğrulaması sırasında tamamlanan eski işçinin sonucu yeni kanıtı ezemez.
- Tek IP adresinin bağlantıyı reddetmesi, timeout, 403/429 gibi durumlar kesin kesinti sayılmaz. SSRF, DNS sabitleme ve TLS güvenliği korunur.
- Kota: tüm kopyalar arasında 2 dakikada en fazla 12 istasyon, eşzamanlılık 2; istasyon başına toplam 8 saniye, 4 istek, 64 KiB. Kullanıcı isteği içinde yayın yoklaması yoktur. Sıfır kaynak maliyeti garantisi verilmez.
- Doğrudan istasyon sayfası ve manuel oynatma denemesi açık kalır. 14 dilde açıklama/SEO sayfası, favori/geçmiş kimlikleri korunur; sırf yayın arızası nedeniyle sayfa silinmez.

### Yönetim

- 12 yerine 7 ana sütun; teknik ayrıntılar açılabilir. Mobilde kartlar, aranabilir ülke/dil/tür/codec seçenekleri, ayrı sağlık filtresi ve sıralama.
- Bakım ve ücretli AI araçları kapalı bir bölümde; açık kapsam/dil seçimi ve başlatma onayı. İlk 50 tür sınırı kaldırıldı.
- Sayfalama, sayfalar arası seçim, filtre sıfırlama, hata/yeniden deneme ve silme/birleştirme onayları düzeltildi.
- İki bağımsız oynatıcı yerine tek global player; S3/optimize logo bileşeni kullanılıyor.
- Sağlık seçenekleri: doğrulanmış offline, kaynak offline bayrağı, doğrulanmamış ve yakın zamanda olumlu yerel kontrol. Kontroller küresel erişilebilirlik garantisi değildir.
- Formdaki geç gelen analiz/yükleme/AI yanıtlarının başka istasyon taslağını değiştirmesi engellendi. Kirli alanlar sorgu yenilemesinde korunuyor; çözümlenmiş URL düzenlenebiliyor.
- Sunucuda sessizce yok sayılan state/featured/global-popular alanları, URL/boolean/bitrate doğrulaması ve kayıt sonrası önbellek davranışı düzeltildi.
- Eksik `POST /api/stations` eklendi. Yeni istasyon oluşturma, sunucu kimliği/benzersiz URL slug'ı, mükerrer kontrolü ve yetki/doğrulama testleriyle çalışıyor; ilk sağlık durumu doğrulanmamış, yerel olumlu sonuç uydurulmuyor.
- Radix boş seçenek kaynaklı sayfa çökmesi giderildi. Sayfa hata sınırı, bir admin sayfasının çökmesinin menüyü de kaldırmasını önler. Aktif menü grubu artık kullanıcı tarafından kapatılabilir.

## Doğrulama ve sınırlar

- Sağlık/native PostgreSQL/public API/SSR geniş test grubu: 599 geçti, 0 başarısız, 2 mevcut opt-in MongoDB aktarım testi atlandı.
- Son arayüz testleri: 79 dosyada 1.180 test geçti. Son admin PostgreSQL HTTP/sağlık rotası testleri: 26 geçti; yeni kayıt, düzenleme, yetki, geçersiz/fractional bitrate ve önbellek hatası senaryoları dahil.
- Masaüstü 1280 px ve mobil 390 px görünümü, gerçek bileşenler ve sentetik kayıtlarla tarayıcıda incelendi. Yatay sayfa taşması yok; doğrulanmış offline filtresi ve manuel önizleme kontrolü çalışıyor. Test sunucusu gerçek ses, üretim API erişimi ve yazma işlemlerini engelliyor.
- 40.000 sentetik kayıtta yeni ülke listesi p95 13,42 ms, global liste 37,28 ms; globalde yaklaşık 4 ms ek yük gözlendi. Bu yerel ölçüm üretim gecikmesi garantisi değildir.
- Son değişikliklerle API ve arayüz TypeScript kontrolleri, üretim API/web/frontend derlemeleri geçti; derleme bağımlılık taramasında MongoDB bağımlılığı 0. PostgreSQL migration: `0029_station_visibility_evidence.sql`.
- Gerçek yayınların tamamının her ülkede/cihazda çalıştığı veya bütün yönetim yazma senaryolarının üretimde denenmiş olduğu iddia edilmez. Ücretli ve yıkıcı senaryolar canlı veride test amacıyla çalıştırılmadı.

## Yayın durumu

Bu inceleme sırasında GitHub kimlik yöneticisinde yalnızca `Mooxergames` bağlıydı; `evolutionphil/RadioHub` deposuna push yetkisi yoktu. Bu nedenle değişikliklerin canlıda olduğu söylenemez. Yetkili hesap bağlandıktan sonra main push, iki Railway dağıtımının commit doğrulaması, migration/işçi durumu ve canlı filtre/form kontrolleri gereklidir. Aktarım servisi yeniden başlatılmamalıdır.

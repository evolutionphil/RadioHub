# Tekil IP ziyaret hareketleri

## Amaç ve sınırlar

Dashboard'daki tekil IP satırından, o IP için **bundan sonra ölçülen** sayfa ve işlem geçmişi açılır. Önceden toplanmayan geçmiş doldurulmaz. Aynı IP'yi kullanan farklı kişiler, cihazlar ve sekmeler ayrıştırılamaz; bu bir kullanıcı hesabı geçmişi veya kesin oturum kaydı değildir.

- Sayfalar: güvenli, izinli yol; query/hash kaydedilmez. Özel profil/mesaj kimlikleri maskelenir. Bilinmeyen veya hassas yollar kayda alınmaz.
- İşlemler: yalnız tanımlanmış olaylar. Başarılı favori isteği ile sayfanın açılması aynı şey değildir. Bir oynatma bildirimi, sesin gerçekten duyulduğunun veya dinleme süresinin kanıtı değildir.
- Geliş kaynağı: Google, diğer arama motoru, sosyal, site içi, diğer yönlendirme veya doğrudan/bilinmiyor kategorisi. Ham referer URL'si, arama terimi veya kampanya parametresi tutulmaz. Referrer engellenebilir veya istemci tarafından taklit edilebilir; **kişinin neden geldiği bilinemez**.
- Trafik tipi: tarayıcı benzeri, otomasyon işareti veya bilinmiyor. Tarayıcı benzeri = doğrulanmış insan değildir. Bot User-Agent bilgisi taklit edilebilir; Googlebot kimliği doğrulanmış sayılmaz. Bilinen otomasyon trafiği ayrı listelenir ve normal tekil ziyaretçi sayaçlarına eklenmez.

## Performans ve mahremiyet

Zaman çizelgesi yedi günlük, sınırlı ve en iyi çaba esaslı ölçümdür; eksiksiz adli günlük değildir. Saklama süresi sona eren olaylar temizlenir. Ham IP/UA, kullanıcı hesabı, şifre, token, mesaj içeriği, arama metni, parmak izi veya ayrıntılı harici URL admin yanıtına taşınmaz. Sunucu mevcut tekil-IP eşlemesini kullanır; admin yalnız maskelenmiş ağ ve rastgele kayıt kimliği görür.

Yeni web ölçümü yalnız gerçek rota değişimlerinde, sayfa oluşturulduktan sonra ertelenmiş küçük bir istektir. Periyodik heartbeat, SDK, üçüncü taraf servisi, yeni cookie veya localStorage kimliği yoktur. Başarısız gönderim tekrar denenmez ve kullanıcı işlemini engellemez. DNT/GPC tercihleri, görünmeyen sayfa ve çevrimdışı durum dikkate alınır. Engelleyiciler, hızlı gezinme, sunucu kapasite sınırları ve cache ölçüm eksikliği yaratabilir. Geçmiş/sayaç ve olay toplamı bu nedenle birebir eşit olmak zorunda değildir.

Bu teknik veri minimizasyonu, tek başına hukuki uyumluluk sertifikası değildir. Site sahibi ölçümün amacı, erişim yetkileri ve saklama süresini kendi gizlilik açıklaması/izin süreçleriyle uyumlu tutmalıdır.

## Entegrasyon

Native ekran geçişleri otomatik çıkarılamaz; mevcut başarılı API isteklerinden gözlenen eylemler görünür. Tam ekran geçişi örneklemesi için isteğe bağlı mobil sözleşme [API rehberinde](../mobile/API.md#visitor-page-activity) yer alır. Uygulama güncellenmediyse bütün iOS/Android ekran geçmişinin toplandığı söylenemez.

## Doğrulama

- Backend: 74 test başarılı, hata/atlanmış test yok; gerçek PGlite üzerinde migration, IP izolasyonu, cursor sayfalama ve saklama sınırları doğrulandı.
- Frontend: 130 dosyada 1.822 test başarılı. Ortak paket, API ve frontend TypeScript kontrolleri geçti.
- Production frontend, API ve web sunucu derlemeleri başarılı. Mevcut büyük-chunk/sourcemap uyarıları bu özelliğin başarısız derlenmesi değildir.
- Gerçek admin bileşenleri masaüstü, 390px ve 320px genişliklerde incelendi; yatay taşma, geçmişin IP'ler arasında karışması ve bot geçmişi ayrımı kontrol edildi. Yerel örnek kayıtlar production'a gönderilmedi.
- Yayın öncesi Railway'deki 37 AI işi incelendi: çalışan iş yok. Ana çeviri işinin ve sitemap yayın adımının durumu completed; geçmişteki 40 başarısız çeviri bu özellik tarafından değiştirilmedi.
- Canlı yayın ve erişim sonucu deployment sonrasında ayrıca doğrulanacak. Yeni geçmiş, deployment sonrası gelen uygun ziyaretlerle oluşur.

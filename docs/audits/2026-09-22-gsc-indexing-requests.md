# Search Console URL dizine ekleme istekleri — 22 Eylül 2026

Mülk: `sc-domain:themegaradio.com`. İşlem bağlı Search Console tarayıcı oturumundan URL Denetimi aracılığıyla yapıldı. Tarih/saat bağlamı Europe/Berlin.

## Sonuç

**7 farklı URL için Google'ın “Dizine eklenmesi istendi” onayı görüldü.** Sonraki `/de/regionen` isteğinde “Kota Aşıldı” uyarısı alındı; gönderimler durduruldu. Bu, genel günlük limitin7 olduğu anlamına gelmez; bu çalışma içinde kabul edilen sayı7'dir.

Kabul, URL'nin öncelikli tarama kuyruğuna alındığını gösterir; indekslendiği veya indeksleneceği garantisi değildir. Kota nedeniyle başka hesap/mülk/API ile sınır aşılmaya çalışılmadı. Otomatik günlük gönderim veya yeni takip oluşturulmadı.

## Kabul edilenler

Her satır için ayrı başarı iletişim kutusu görüldü.

| Sayfa | URL | İstek öncesi GSC durumu |
| --- | --- | --- |
| Almanca ana sayfa | https://themegaradio.com/de | Tarandı — şu anda dizine eklenmiş değil |
| Türkçe ana sayfa | https://themegaradio.com/tr | Tarandı — şu anda dizine eklenmiş değil |
| KRAL FM | https://themegaradio.com/tr/istasyon/kral-fm | URL Google tarafından bilinmiyor |
| Kronehit | https://themegaradio.com/de/sender/kronehit | URL Google tarafından bilinmiyor |
| ORF Hitradio Ö3 HQ | https://themegaradio.com/de/sender/orf-hitradio-o3-hq | URL Google tarafından bilinmiyor |
| BBC World Service | https://themegaradio.com/en/station/bbc-world-service | URL Google tarafından bilinmiyor |
| İngilizce türler dizini | https://themegaradio.com/en/genres | URL Google tarafından bilinmiyor |

İngilizce ana sayfa `https://themegaradio.com/en` URL Denetimi'nde **“URL Google'da mevcut / Sayfa dizine eklendi”** gösterdi. Aynı sayfayı yeniden göndermek yerine kota diğer sayfalara ayrıldı.

## Kota nedeniyle kabul edilmeyen istek

`https://themegaradio.com/de/regionen`

GSC: “Maalesef günlük kotanızı aştığınız için bu isteği işleyemedik. Lütfen bunu yarın tekrar göndermeyi deneyin.” Bu URL başarılı gönderim sayısına dahil değildir.

## Sonraki uygun oturum için öncelik kuyruğu

Bu URL'lere bu çalışma sırasında başarılı dizine ekleme isteği gönderilmedi. Yeni oturumda canlı uygunluk ve mevcut GSC durumu yeniden kontrol edilmeli; zaten indekslenen/istek kabul edilmiş olanlar gereksiz tekrar gönderilmemeli.

1. https://themegaradio.com/de/regionen
2. https://themegaradio.com/tr/istasyon/arabesk-fm
3. https://themegaradio.com/tr/istasyon/virgin-radio-turkiye
4. https://themegaradio.com/de/sender/orf-radio-wien
5. https://themegaradio.com/de/sender/fm4-orf
6. https://themegaradio.com/de/sender/mangoradio
7. https://themegaradio.com/de/sender/1live
8. https://themegaradio.com/de/sender/rock-antenne
9. https://themegaradio.com/tr/istasyon/metro-fm
10. https://themegaradio.com/tr/istasyon/ntv-radyo
11. https://themegaradio.com/tr/turler
12. https://themegaradio.com/tr/bolgeler

## Ön kontrol ve sınırlar

- Toplam20 aday public HTTP üzerinden incelendi: redirect olmadan200, self-canonical, beklenen HTML dili, meta/header index izinleri; robots.txt bu yolları engellemiyor. Ana sayfa dışındaki kontrol edilen adaylarda self-hreflang ve15 alternate bulundu. Bunlar bütün sitenin veya14 dilde bütün istasyonların kapsamlı audit sonucu değildir.
- URL'ler gerçek API slug'ları ve mevcut sayfa bağlantılarından seçildi; tahmini slug gönderilmedi.
- API'de `noIndex` işaretli görülen Best FM-2, Radyo7-1, Energy NRJ Wien, Superfly FM ve80s80s-1 adayları bu gönderim grubuna alınmadı. Bu kayıtların işaretleri bu işlemde değiştirilmedi.
- Google her request sırasında kendi canlı uygunluk kontrolünü çalıştırdı. Başarı olarak yalnızca sonuç iletişim kutusu görülenler kaydedildi.
- Sayfa kodu, canonical, robots, veri veya production yapılandırması değiştirilmedi; push/deploy yapılmadı.

## Sitemap hakkında ek gözlem

Açılışta mevcut Search Console sitemap-index drilldown ekranı, 20 Eylül son okuma tarihiyle başarılı işleme ancak0 alt sitemap/URL gösteriyordu. Bu ekran güncel XML'nin boş olduğunu kanıtlamaz.

22 Eylül01:57 Berlin'de yapılan iki salt okunur kontrol:

- `https://themegaradio.com/sitemap-index.xml`:200, `application/xml; charset=utf-8`, `sitemapindex`, **112 alt sitemap**,15.549 byte.
- İndeksin gerçekten referans verdiği `https://themegaradio.com/sitemap-main-pt.xml`:200, aynı XML content type, `urlset`, **73 URL**.
- İkisinde de Last-Modified:21 Eylül2026 13:38:05 GMT.

Mevcut sitemap boş değildir. Google'ın bu son sürümü yeniden okuduğu bu işlemde doğrulanmadı. Sitemap yeniden gönderilmedi; kullanıcının istediği bireysel URL başvuruları yapıldı.

Google'ın açıklaması: bireysel URL başvuruları kotaya tabidir; aynı URL'yi tekrar göndermek hızlandırmaz. Büyük URL kümelerinde sitemap önerilir. [Google Search Central](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl), [URL Denetimi yardım sayfası](https://support.google.com/webmasters/answer/9012289?hl=en).

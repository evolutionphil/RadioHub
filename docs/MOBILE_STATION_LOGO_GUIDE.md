# MegaRadio Mobile - Station Logo/Favicon Kullanim Rehberi

## Sorun

iOS uygulamasinda bazi istasyonlarin logosu gorunuyor, bazi sayfada gorunmuyor.
Bu sorunun nedeni: **Logo verileri 3 farkli kaynaktan gelebilir** ve mobil uygulamanin hepsini dogru oncelik sirasinda denemesi gerekiyor.

---

## Logo Veri Yapisi

API'den gelen her station objesinde su alanlar bulunabilir:

```json
{
  "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
  "name": "MANGORADIO",
  "slug": "mangoradio",

  "logoAssets": {
    "folder": "mangoradio_11ab228c",
    "webp256": "https://megaradio-station-logos.s3.eu-north-1.amazonaws.com/station-logos/mangoradio_11ab228c/logo-256.webp",
    "webp96": null,
    "webp48": null,
    "original": "https://megaradio-station-logos.s3.eu-north-1.amazonaws.com/station-logos/mangoradio_11ab228c/original.webp",
    "status": "completed",
    "processedAt": "2025-11-15T10:30:00.000Z"
  },

  "favicon": "https://mangoradio.de/wp-content/uploads/cropped-Logo-192x192.webp",

  "localImagePath": null
}
```

### 3 Logo Kaynagi (Oncelik Sirasina Gore)

| Oncelik | Alan | Aciklama | URL Formati |
|---------|------|----------|-------------|
| 1 (EN IYI) | `logoAssets.webp256` | S3'te optimize edilmis 256px WebP | `https://megaradio-station-logos.s3.eu-north-1.amazonaws.com/station-logos/{folder}/logo-256.webp` |
| 2 | `localImagePath` | Eski sistem, sunucuda lokal dosya | `/station-images/{path}` |
| 3 | `favicon` | Harici URL (istasyonun kendi sunucusu) | `https://example.com/logo.png` veya `http://example.com/logo.png` |

---

## KRITIK: Dogru Logo Secim Algoritmasi

Mobil uygulamada **TAM OLARAK** su siralamayla logo secilmeli:

```typescript
function getStationLogoUrl(station: any): string | null {
  // 1. EN IYI: S3'teki optimize logo (WebP, hizli, guvenilir)
  if (station.logoAssets?.status === 'completed' && station.logoAssets?.folder) {
    const webpUrl = station.logoAssets.webp256 
      || station.logoAssets.webp96 
      || station.logoAssets.webp48;
    
    if (webpUrl) {
      // Yeni veriler: tam URL olarak gelir (https://megaradio-station-logos.s3...)
      if (webpUrl.startsWith('https://') || webpUrl.startsWith('http://')) {
        return webpUrl;
      }
      // Eski veriler: sadece dosya adi gelir (logo-256.webp)
      return `https://themegaradio.com/station-logos/${station.logoAssets.folder}/${webpUrl}`;
    }
  }

  // 2. Eski lokal dosya (sunucuda kayitli)
  if (station.localImagePath) {
    return `https://themegaradio.com/station-images/${station.localImagePath}`;
  }

  // 3. Harici favicon URL (en son, guvenilirlik dusuk)
  if (station.favicon && station.favicon.trim() !== '' 
      && station.favicon !== 'null' && station.favicon !== 'undefined') {
    let url = station.favicon;
    
    // Protocol-relative URL duzelt
    if (url.startsWith('//')) {
      url = 'https:' + url;
    }
    // Protocol eksikse ekle
    if (!url.startsWith('http') && !url.startsWith('data:') && !url.startsWith('/')) {
      url = 'https://' + url;
    }
    
    // ONEMLI: HTTP URL'leri proxy uzerinden yukle (mixed content sorunu)
    if (url.startsWith('http://')) {
      // Base64 encode ile proxy
      const encoded = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return `https://themegaradio.com/api/image/${encoded}`;
    }
    
    return url;
  }

  // 4. Logo yok
  return null;
}
```

---

## iOS Uygulamasi Icin Ornek (Swift)

```swift
import Foundation

struct StationLogoResolver {
    
    static func getLogoURL(for station: [String: Any]) -> URL? {
        // 1. S3 optimize logo (en iyi kalite, en hizli)
        if let logoAssets = station["logoAssets"] as? [String: Any],
           let status = logoAssets["status"] as? String,
           status == "completed",
           let folder = logoAssets["folder"] as? String {
            
            let webpUrl = (logoAssets["webp256"] as? String)
                ?? (logoAssets["webp96"] as? String)
                ?? (logoAssets["webp48"] as? String)
            
            if let urlStr = webpUrl, !urlStr.isEmpty {
                if urlStr.hasPrefix("https://") || urlStr.hasPrefix("http://") {
                    return URL(string: urlStr)
                }
                return URL(string: "https://themegaradio.com/station-logos/\(folder)/\(urlStr)")
            }
        }
        
        // 2. Eski lokal dosya (sunucuda kayitli)
        if let localPath = station["localImagePath"] as? String, !localPath.isEmpty {
            return URL(string: "https://themegaradio.com/station-images/\(localPath)")
        }
        
        // 3. Harici favicon URL (en son - guvenilirlik dusuk)
        if let favicon = station["favicon"] as? String,
           !favicon.isEmpty,
           favicon != "null",
           favicon != "undefined" {
            
            var urlStr = favicon
            
            if urlStr.hasPrefix("//") {
                urlStr = "https:" + urlStr
            }
            if !urlStr.hasPrefix("http") && !urlStr.hasPrefix("data:") && !urlStr.hasPrefix("/") {
                urlStr = "https://" + urlStr
            }
            
            // HTTP -> proxy (iOS ATS engellemesi)
            if urlStr.hasPrefix("http://") {
                if let data = urlStr.data(using: .utf8) {
                    let encoded = data.base64EncodedString()
                        .replacingOccurrences(of: "+", with: "-")
                        .replacingOccurrences(of: "/", with: "_")
                        .replacingOccurrences(of: "=", with: "")
                    return URL(string: "https://themegaradio.com/api/image/\(encoded)")
                }
            }
            
            return URL(string: urlStr)
        }
        
        return nil
    }
}

// Kullanim:
// if let logoURL = StationLogoResolver.getLogoURL(for: stationDict) {
//     imageView.sd_setImage(with: logoURL, placeholderImage: UIImage(named: "no-image"))
// }
```

---

## Android/React Native Icin Ornek

```typescript
// React Native ile kullanim
import { Image } from 'react-native';

function StationLogo({ station, size = 96 }: { station: any; size?: number }) {
  const logoUrl = getStationLogoUrl(station);
  
  if (!logoUrl) {
    return <Image source={require('./assets/no-image.png')} style={{ width: size, height: size }} />;
  }
  
  return (
    <Image 
      source={{ uri: logoUrl }}
      style={{ width: size, height: size, borderRadius: 8 }}
      defaultSource={require('./assets/no-image.png')}
      onError={() => {
        // Favicon URL bozuksa, logoAssets olmadan dene
        // veya placeholder goster
      }}
    />
  );
}
```

---

## Gercek API Ciktilari

### Durum 1: S3 logosu olan istasyon (EN YAYGIN - ~%65)
```json
{
  "name": "MANGORADIO",
  "favicon": "https://mangoradio.de/wp-content/uploads/cropped-Logo-192x192.webp",
  "logoAssets": {
    "folder": "mangoradio_11ab228c",
    "webp256": "https://megaradio-station-logos.s3.eu-north-1.amazonaws.com/station-logos/mangoradio_11ab228c/logo-256.webp",
    "status": "completed"
  }
}
```
**Kullanilacak URL:** `logoAssets.webp256` (S3 URL'si - hizli, guvenilir, WebP)

### Durum 2: Sadece favicon olan istasyon
```json
{
  "name": "Radio XYZ",
  "favicon": "https://radiostation.com/logo.png",
  "logoAssets": null
}
```
**Kullanilacak URL:** `favicon` (HTTPS ise direkt, HTTP ise proxy uzerinden)

### Durum 3: HTTP favicon (proxy gerekli)
```json
{
  "name": "Old Radio",
  "favicon": "http://oldstation.fm/logo.jpg",
  "logoAssets": null
}
```
**Kullanilacak URL:** `https://themegaradio.com/api/image/{base64_encoded_url}`
(iOS App Transport Security ve mixed content icin zorunlu)

### Durum 4: Logo isleme basarisiz
```json
{
  "name": "Problem Radio",
  "favicon": "https://deadlink.com/logo.png",
  "logoAssets": {
    "folder": "problem-radio_12345678",
    "status": "failed",
    "error": "HTTP 404"
  }
}
```
**Kullanilacak URL:** `favicon` URL'sini dene, calismiyorsa placeholder goster

### Durum 5: Hic logo yok
```json
{
  "name": "No Logo Radio",
  "favicon": null,
  "logoAssets": null
}
```
**Kullanilacak URL:** Placeholder goster

---

## iOS'ta Logo Gorunmuyor - Sik Yapilan Hatalar

### Hata 1: Sadece `favicon` kullanmak
```swift
// YANLIS - S3 logosunu atliyor
let url = station.favicon
```
```swift
// DOGRU - Once logoAssets kontrol et
let url = StationLogoResolver.getLogoURL(for: station)
```

### Hata 2: HTTP URL'leri handle etmemek
iOS, App Transport Security (ATS) nedeniyle varsayilan olarak HTTP baglantilari engeller.
```swift
// YANLIS - HTTP URL direkt kullanilirsa iOS yuklemez
let url = URL(string: "http://oldstation.fm/logo.jpg")

// DOGRU - Proxy uzerinden
let url = URL(string: "https://themegaradio.com/api/image/aHR0cDovL29sZHN0YXRpb24uZm0vbG9nby5qcGc")
```

### Hata 3: `logoAssets.status` kontrolu yapmamak
```swift
// YANLIS - status "failed" olsa bile URL kullanmaya calisiyor
if let webp = station.logoAssets?.webp256 {
    // Bu nil olmayabilir ama resim yoktur
}

// DOGRU - status "completed" kontrolu sart
if station.logoAssets?.status == "completed",
   let webp = station.logoAssets?.webp256 { ... }
```

### Hata 4: webp256 alaninin 2 farkli formati oldugunu bilmemek
```swift
// Eski veriler: "logo-256.webp" (sadece dosya adi)
// Yeni veriler: "https://megaradio-station-logos.s3.eu-north-1.amazonaws.com/..." (tam URL)

// DOGRU kontrol:
if urlStr.hasPrefix("https://") {
    return URL(string: urlStr)  // Tam URL
} else {
    return URL(string: "https://themegaradio.com/station-logos/\(folder)/\(urlStr)")  // Lokal
}
```

### Hata 5: Bazi API endpoint'leri `logoAssets` dondurmuyor
Asagidaki endpoint'ler `logoAssets` iceriyor:
- `GET /api/stations` (liste)
- `GET /api/stations/:idOrSlug` (detay)
- `GET /api/tv/init` (TV/Mobile baslangic)
- `GET /api/genres/:slug/stations` (tur istasyonlari)

Tum station endpoint'leri `logoAssets` dondurur.
Eger bir endpoint'te logo gorunmuyorsa `favicon` ile fallback yapin.

---

## Image Proxy Endpoint

HTTP favicon URL'lerini guvenli yuklemek icin proxy:

```
GET https://themegaradio.com/api/image/{base64_encoded_url}
```

### Base64 Encoding (URL-safe)
```typescript
function encodeForProxy(httpUrl: string): string {
  const base64 = btoa(httpUrl);
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Ornek:
// "http://oldstation.fm/logo.jpg"
// -> "aHR0cDovL29sZHN0YXRpb24uZm0vbG9nby5qcGc"
// -> "https://themegaradio.com/api/image/aHR0cDovL29sZHN0YXRpb24uZm0vbG9nby5qcGc"
```

### Proxy Ozellikleri
- Maks dosya boyutu: 2MB
- Maks boyut: 512x512 px
- Otomatik WebP donusumu
- HTTPS URL'leri proxy'ye gerek yok (direkt kullanilir)
- Sadece `image/*` content-type kabul eder

---

## Ozet: Mobil Uygulama Icin Kontrol Listesi

- [ ] `logoAssets.status === "completed"` ise `webp256` URL'sini kullan
- [ ] `webp256` tam URL mi yoksa dosya adi mi kontrol et
- [ ] `logoAssets` yoksa `localImagePath` dene (prepend `/station-images/`)
- [ ] `localImagePath` de yoksa `favicon` kullan
- [ ] `favicon` HTTP ise proxy uzerinden yukle
- [ ] Hicbiri yoksa placeholder goster
- [ ] Resim yukleme hatasinda (onError) bir sonraki kaynagi dene
- [ ] Cache kullan (SDWebImage / Glide / react-native-fast-image)

---

**Son Guncelleme:** Mart 2026
**S3 Bucket:** `megaradio-station-logos.s3.eu-north-1.amazonaws.com`
**Logo Format:** WebP, 256px (sadece bu boyut uretiliyor)

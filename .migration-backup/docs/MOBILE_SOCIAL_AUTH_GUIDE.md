# MegaRadio Mobile - Google & Apple Sign-In Entegrasyon Rehberi

## Genel Bakis

Backend artik mobil uygulamalar icin **POST** tabanli Google ve Apple giris endpoint'lerini destekliyor. Eski OAuth web redirect flow'u (GET) da ayni path'te calismaya devam ediyor.

| Platform | Endpoint | Method | Durum |
|----------|----------|--------|-------|
| Mobil Google | `/api/auth/google` | POST | **AKTIF** |
| Mobil Apple | `/api/auth/apple` | POST | **AKTIF** |
| Web Google | `/api/auth/google` | GET | Mevcut (redirect flow) |

---

## 1. Google Sign-In (Mobil)

### Endpoint
```
POST https://themegaradio.com/api/auth/google
```

### Headers
```
Content-Type: application/json
X-Device-Type: mobile
```

### Request Body
```json
{
  "idToken": "GOOGLE_ID_TOKEN_FROM_SDK",
  "email": "user@gmail.com",
  "name": "Kullanici Adi",
  "googleId": "google_numeric_id",
  "platform": "mobile"
}
```

**Zorunlu alanlar:**
- `idToken` (string) — Google Sign-In SDK'dan alinan ID token. **Bu olmadan istek reddedilir.**

**Opsiyonel alanlar:**
- `email` — Kullanilmaz (guvenlik icin sadece token'dan alinir), ama gonderilebilir
- `name` — Token'da isim yoksa fallback olarak kullanilir
- `googleId` — Kullanilmaz (token'dan dogrulanir)
- `platform` — `"mobile"` (varsayilan) veya `"tv"`

### Basarili Yanit (200)
```json
{
  "success": true,
  "token": "mrt_a1b2c3d4e5f6...",
  "expiresIn": "90 days",
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "fullName": "Sahin Yilmaz",
    "username": "user_1702234567890_abc123def",
    "email": "sahin@gmail.com",
    "role": "user",
    "avatar": "https://lh3.googleusercontent.com/..."
  }
}
```

### Hata Yanitlari
```json
// 400 - idToken eksik
{ "success": false, "error": "idToken is required" }

// 400 - Google hesabinda email yok
{ "success": false, "error": "Google account does not have a verified email" }

// 401 - Gecersiz veya suresi dolmus token
{ "success": false, "error": "Invalid or expired Google token" }

// 403 - Hesap askiya alinmis
{ "success": false, "error": "Account is suspended or inactive" }

// 500 - Sunucu hatasi
{ "success": false, "error": "Authentication failed" }
```

### React Native / Expo Implementasyonu

```typescript
import { GoogleSignin } from '@react-native-google-signin/google-signin';

// Uygulama baslarken yapilandirma
GoogleSignin.configure({
  // ONEMLI: Bu webClientId, Google Cloud Console'daki
  // "Web application" tipindeki OAuth Client ID olmali
  // Android/iOS native Client ID DEGIL!
  webClientId: 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com',
  
  // iOS icin ek ayar (opsiyonel)
  iosClientId: 'YOUR_IOS_CLIENT_ID.apps.googleusercontent.com',
  
  offlineAccess: false,
});

async function signInWithGoogle() {
  try {
    await GoogleSignin.hasPlayServices();
    const userInfo = await GoogleSignin.signIn();
    
    // idToken'i backend'e gonder
    const response = await fetch('https://themegaradio.com/api/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Type': 'mobile',
      },
      body: JSON.stringify({
        idToken: userInfo.idToken,  // ZORUNLU
        email: userInfo.user.email,
        name: userInfo.user.name,
        googleId: userInfo.user.id,
        platform: 'mobile',
      }),
    });

    const data = await response.json();
    
    if (data.success) {
      // Token'i guvenli bir yerde sakla (AsyncStorage, SecureStore, vb.)
      await SecureStore.setItemAsync('authToken', data.token);
      await SecureStore.setItemAsync('user', JSON.stringify(data.user));
      
      // Bundan sonra tum API isteklerinde bu token'i kullan:
      // Authorization: Bearer mrt_a1b2c3d4e5f6...
    } else {
      console.error('Google login basarisiz:', data.error);
    }
  } catch (error) {
    console.error('Google sign-in hatasi:', error);
  }
}
```

### Google Cloud Console Ayarlari

**Backend icin gerekli env degiskenleri:**
```
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
```

**Google Cloud Console'da yapilmasi gerekenler:**
1. https://console.cloud.google.com/ → APIs & Services → Credentials
2. **Web application** tipinde OAuth 2.0 Client ID olustur
3. Authorized redirect URIs'e ekle: `https://themegaradio.com/api/auth/google/callback`
4. **Android** tipinde OAuth 2.0 Client ID olustur (SHA-1 fingerprint ile)
5. **iOS** tipinde OAuth 2.0 Client ID olustur (Bundle ID: `com.visiongo.megaradio`)

**KRITIK:** Mobil SDK'da `webClientId` olarak **Web application** Client ID kullaniniz. Android/iOS Client ID degil!

---

## 2. Apple Sign-In (Mobil)

### Endpoint
```
POST https://themegaradio.com/api/auth/apple
```

### Headers
```
Content-Type: application/json
X-Device-Type: mobile
```

### Request Body
```json
{
  "identityToken": "APPLE_IDENTITY_TOKEN",
  "authorizationCode": "APPLE_AUTH_CODE",
  "fullName": {
    "givenName": "Sahin",
    "familyName": "Yilmaz"
  },
  "email": "sahin@icloud.com",
  "user": "apple_user_id_string",
  "platform": "mobile"
}
```

**Zorunlu alanlar:**
- `identityToken` (string) — Apple Sign-In SDK'dan alinan JWT token. **Bu olmadan istek reddedilir.**

**Opsiyonel alanlar:**
- `authorizationCode` — Simdilik kullanilmiyor ama ileride gerekebilir, gonderin
- `fullName` — Apple sadece **ilk giris**te verir, sonraki girislerde `null` gelir
- `email` — Kullanilmaz (guvenlik icin sadece token'dan alinir)
- `user` — Apple'in verdigi kullanici ID'si (backend token'dan dogrular)
- `platform` — `"mobile"` (varsayilan) veya `"tv"`

### Basarili Yanit (200)
```json
{
  "success": true,
  "token": "mrt_a1b2c3d4e5f6...",
  "expiresIn": "90 days",
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "fullName": "Sahin Yilmaz",
    "username": "user_1702234567890_abc123def",
    "email": "sahin@icloud.com",
    "role": "user",
    "avatar": null
  }
}
```

> **Not:** Apple profil fotosu saglamaz, bu nedenle `avatar` her zaman `null` olacak.

### Hata Yanitlari
```json
// 400 - identityToken eksik
{ "success": false, "error": "identityToken is required" }

// 401 - Gecersiz veya suresi dolmus token
{ "success": false, "error": "Invalid or expired Apple token" }

// 403 - Hesap askiya alinmis
{ "success": false, "error": "Account is suspended or inactive" }

// 500 - Sunucu hatasi
{ "success": false, "error": "Authentication failed" }
```

### React Native / Expo Implementasyonu

```typescript
import * as AppleAuthentication from 'expo-apple-authentication';

async function signInWithApple() {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    // identityToken'i backend'e gonder
    const response = await fetch('https://themegaradio.com/api/auth/apple', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Type': 'mobile',
      },
      body: JSON.stringify({
        identityToken: credential.identityToken,  // ZORUNLU
        authorizationCode: credential.authorizationCode,
        fullName: credential.fullName,  // Sadece ilk giriste gelir!
        email: credential.email,
        user: credential.user,
        platform: 'mobile',
      }),
    });

    const data = await response.json();
    
    if (data.success) {
      await SecureStore.setItemAsync('authToken', data.token);
      await SecureStore.setItemAsync('user', JSON.stringify(data.user));
    } else {
      console.error('Apple login basarisiz:', data.error);
    }
  } catch (error: any) {
    if (error.code === 'ERR_REQUEST_CANCELED') {
      // Kullanici iptal etti, hata gosterme
      return;
    }
    console.error('Apple sign-in hatasi:', error);
  }
}
```

### Apple Developer Console Ayarlari

**Backend icin gerekli env degiskenleri (opsiyonel, varsayilan bundle ID kullanilir):**
```
APPLE_CLIENT_ID=com.visiongo.megaradio
```
> Eger env degiskeni yoksa, backend varsayilan olarak `com.visiongo.megaradio` audience kullanir.

**Apple Developer Console'da yapilmasi gerekenler:**
1. https://developer.apple.com → Certificates, Identifiers & Profiles
2. App ID'nin "Sign in with Apple" capability'si aktif olmali
3. Bundle ID: `com.visiongo.megaradio`
4. Services ID olustur (web icin, mobilde gerekli degil)

**KRITIK Apple Davranisi:**
- Apple `fullName` ve `email`'i **SADECE ILK GIRIS**te verir
- Sonraki girislerde bu alanlar `null` gelir
- Backend bunu biliyor ve ilk giriste kayit, sonraki girislerde `appleId` ile eslestirme yapar
- Eger kullanici "Hide My Email" secerse, Apple relay email verir (xxx@privaterelay.appleid.com)

---

## 3. Token Kullanimi (Giris Sonrasi)

Giris basarili olduktan sonra donen `token` degerini tum API isteklerinde kullanin:

```typescript
// API istegi ornegi
const response = await fetch('https://themegaradio.com/api/auth/mobile/me', {
  headers: {
    'Authorization': `Bearer ${savedToken}`,
    'X-Device-Type': 'mobile',
  },
});
```

### Onemli Endpoint'ler

| Endpoint | Method | Aciklama |
|----------|--------|----------|
| `/api/auth/mobile/me` | GET | Mevcut kullanici bilgilerini al (token ile) |
| `/api/auth/me` | GET | Mevcut kullanici (session - web icin) |
| `/api/user/favorites` | POST | Favori ekle `{ stationId }` |
| `/api/user/favorites/:stationId` | DELETE | Favori kaldir |
| `/api/recently-played` | POST | Son dinlenen ekle `{ stationId }` |
| `/api/recently-played` | GET | Son dinlenenler listesi |
| `/api/user/push-token` | POST | Push token kaydet |

### Token Ozellikleri
- Token formati: `mrt_` prefix + 64 hex karakter
- TV token formati: `mrt_tv_` prefix + 64 hex karakter
- Gecerlilik: **90 gun**
- Revoke edilebilir (admin tarafindan)

---

## 4. Akis Semalari

### Google Sign-In Akisi
```
[Kullanici] → Google Sign-In butonuna tiklar
     ↓
[Google SDK] → Google popup/sheet acar
     ↓
[Google] → Kullanici onaylar → idToken doner
     ↓
[Mobil App] → POST /api/auth/google { idToken, platform: "mobile" }
     ↓
[Backend] → Google'dan token'i dogrular (google-auth-library)
     ↓
         ├── googleId ile kullanici bulundu → Giris yap, token don
         ├── Email ile kullanici bulundu → googleId bagla, giris yap, token don
         └── Kullanici yok → Yeni hesap olustur, token don
     ↓
[Mobil App] → Token'i sakla, kullaniciyi ana sayfaya yonlendir
```

### Apple Sign-In Akisi
```
[Kullanici] → Apple Sign-In butonuna tiklar
     ↓
[Apple SDK] → Apple sheet acar (Face ID/Touch ID ile)
     ↓
[Apple] → Kullanici onaylar → identityToken doner
     ↓
[Mobil App] → POST /api/auth/apple { identityToken, fullName, platform: "mobile" }
     ↓
[Backend] → Apple JWKS ile JWT token'i dogrular (jose library)
     ↓
         ├── appleId ile kullanici bulundu → Giris yap, token don
         ├── Email ile kullanici bulundu → appleId bagla, giris yap, token don
         └── Kullanici yok → Yeni hesap olustur, token don
     ↓
[Mobil App] → Token'i sakla, kullaniciyi ana sayfaya yonlendir
```

---

## 5. Test Etme

### cURL ile Test

```bash
# Google - gecersiz token (401 donmeli)
curl -X POST "https://themegaradio.com/api/auth/google" \
  -H "Content-Type: application/json" \
  -H "X-Device-Type: mobile" \
  -d '{"idToken": "test_invalid"}'
# Beklenen: {"success":false,"error":"Invalid or expired Google token"}

# Apple - gecersiz token (401 donmeli)
curl -X POST "https://themegaradio.com/api/auth/apple" \
  -H "Content-Type: application/json" \
  -H "X-Device-Type: mobile" \
  -d '{"identityToken": "test_invalid"}'
# Beklenen: {"success":false,"error":"Invalid or expired Apple token"}

# Token eksik (400 donmeli)
curl -X POST "https://themegaradio.com/api/auth/google" \
  -H "Content-Type: application/json" \
  -d '{}'
# Beklenen: {"success":false,"error":"idToken is required"}
```

### Gercek Test
1. Google/Apple SDK'dan gercek `idToken`/`identityToken` alin
2. Backend'e POST gonderin
3. Donen `token` ile `/api/auth/mobile/me` endpointini test edin
4. Token ile korunan diger endpoint'leri test edin (favorites, recently-played, vb.)

---

## 6. Guvenlik Notlari

1. **Email guvenli kaynaktan alinir:** Body'den gelen email KULLANILMAZ. Sadece Google/Apple token'inin icindeki dogrulanmis email kullanilir. Bu, account takeover saldirisini onler.

2. **Askiya alinmis hesaplar giris yapamaz:** `status !== 'active'` olan hesaplar 403 ile reddedilir.

3. **Apple email gizleme:** Kullanici "Hide My Email" secerse, Apple relay email verir. Backend bunu normal email olarak kaydeder.

4. **Token guvenligi:** Token'lari `SecureStore` (Expo) veya `Keychain` (iOS) / `EncryptedSharedPreferences` (Android) ile saklayin. AsyncStorage KULLANMAYIN — guvenli degil.

---

## 7. Sorun Giderme

| Sorun | Cozum |
|-------|-------|
| `idToken is required` | Google SDK'dan `idToken` alinmamis, `GoogleSignin.configure()` kontrol edin |
| `Invalid or expired Google token` | `webClientId` yanlis olabilir, Google Cloud Console'daki **Web** Client ID olmali |
| `Invalid or expired Apple token` | Bundle ID uyusmuyor, Apple Developer Console'da kontrol edin |
| `Google account does not have a verified email` | Nadir durum, kullanicinin Google hesabinda email yok |
| `Account is suspended or inactive` | Admin panelinden kullanici durumunu kontrol edin |
| HTML sayfa donuyor (eski sorun) | **COZULDU** - Artik POST endpoint'leri JSON donuyor |

---

**Son Guncelleme:** Mart 2026
**Backend Versiyon:** POST endpoint'leri eklendi (Google idToken + Apple JWT dogrulama)

# MegaRadio — Mobil Favori Sistemi Entegrasyon Dokumani

> Bu dokuman, React Native mobil uygulamadan favori istasyon ekleme/cikarma/listeleme/kontrol islemlerinin backend ile nasil yapilacagini adim adim aciklar.

---

## AUTHENTICATION

Tum favori endpoint'leri login gerektirir. Login sonrasi alinan `token` her istekte gonderilmeli:

```
Authorization: Bearer <token>
```

Token, login response'undan alinir:
```typescript
// POST /api/auth/mobile/login
// Response: { success: true, token: "abc123...", expiresIn: "90 days", user: {...} }
const authToken = loginResponse.token;
```

---

## ENDPOINT 1: Favori Ekle

**`POST /api/user/favorites`**

### Request
```
POST https://themegaradio.com/api/user/favorites
Content-Type: application/json
Authorization: Bearer <token>
```

### Body
```json
{
  "stationId": "6924cc55495dd2a8e2a581ef"
}
```

**ONEMLI:** `stationId` MongoDB ObjectId formatidir (24 karakter hex string). Istasyonun `_id` alani kullanilmalidir.

### Basarili Response (200)
```json
{
  "success": true,
  "message": "Station added to favorites",
  "favorite": {
    "_id": "...",
    "userId": "...",
    "stationId": "6924cc55495dd2a8e2a581ef",
    "createdAt": "2026-04-01T12:00:00.000Z"
  }
}
```

### Hata Durumlari
| Status | Body | Anlami |
|--------|------|--------|
| 400 | `{ "error": "Station ID is required" }` | `stationId` gonderilmedi |
| 400 | `{ "error": "Station already in favorites" }` | Zaten favorilerde var |
| 401 | `{ "error": "Authentication required" }` | Token eksik veya gecersiz |
| 404 | `{ "error": "Station not found" }` | Gecersiz stationId |
| 503 | `{ "error": "Database temporarily unavailable" }` | DB gecici sorun — biraz sonra tekrar dene |

### Ornek Kod
```typescript
const addFavorite = async (stationId: string, authToken: string) => {
  try {
    const response = await fetch('https://themegaradio.com/api/user/favorites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ stationId }),
    });

    if (response.status === 400) {
      const data = await response.json();
      if (data.error === 'Station already in favorites') {
        // Zaten eklenmis — hata gosterme, basarili gibi davran
        return { success: true, alreadyExists: true };
      }
    }

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to add favorite');
    }

    return await response.json();
  } catch (error) {
    console.error('Favori ekleme hatasi:', error);
    throw error;
  }
};
```

---

## ENDPOINT 2: Favori Cikar

**`DELETE /api/user/favorites/:stationId`**

### Request
```
DELETE https://themegaradio.com/api/user/favorites/6924cc55495dd2a8e2a581ef
Authorization: Bearer <token>
```

**NOT:** `stationId` URL path'inde gonderilir, body'de degil!

### Basarili Response (200)
```json
{
  "success": true,
  "message": "Station removed from favorites"
}
```

### Hata Durumlari
| Status | Body | Anlami |
|--------|------|--------|
| 401 | `{ "error": "Authentication required" }` | Token eksik |
| 404 | `{ "error": "Station not in favorites" }` | Bu istasyon favorilerde yok |

### Ornek Kod
```typescript
const removeFavorite = async (stationId: string, authToken: string) => {
  try {
    const response = await fetch(
      `https://themegaradio.com/api/user/favorites/${stationId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      }
    );

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to remove favorite');
    }

    return await response.json();
  } catch (error) {
    console.error('Favori cikarma hatasi:', error);
    throw error;
  }
};
```

---

## ENDPOINT 3: Favori Listesini Getir

**`GET /api/user/favorites`**

### Request (Tum favorileri getir)
```
GET https://themegaradio.com/api/user/favorites
Authorization: Bearer <token>
```

### Request (Sayfalamali — buyuk listeler icin)
```
GET https://themegaradio.com/api/user/favorites?page=1&limit=20&sort=newest
Authorization: Bearer <token>
```

### Request (Sadece belirli alanlar — hafif istek)
```
GET https://themegaradio.com/api/user/favorites?fields=name,favicon,country,url,slug
Authorization: Bearer <token>
```

### Query Parametreleri
| Parametre | Zorunlu | Varsayilan | Aciklama |
|-----------|---------|------------|----------|
| `page` | Hayir | - | Sayfa numarasi (1'den baslar). `limit` ile birlikte kullanilmali |
| `limit` | Hayir | - | Sayfa basina istasyon sayisi (max 100) |
| `sort` | Hayir | `newest` | Siralama: `newest`, `oldest`, `name`, `country` |
| `fields` | Hayir | tum alanlar | Virgullu alan listesi (istasyon verisi hafifletmek icin) |

### Basarili Response — Sayfalama OLMADAN (tum favoriler)
Dizi (array) olarak doner:
```json
[
  {
    "_id": "6924cc55495dd2a8e2a581ef",
    "name": "Power FM",
    "url": "https://stream.powerfm.com.tr/stream",
    "country": "Turkey",
    "genre": "Pop",
    "tags": "pop,turkish",
    "votes": 1250,
    "clickCount": 89000,
    "codec": "MP3",
    "bitrate": 128,
    "favicon": "https://...",
    "slug": "power-fm",
    "favoritedAt": "2026-04-01T12:00:00.000Z"
  },
  {
    "_id": "6924cc55495dd2a8e2a582ab",
    "name": "Virgin Radio",
    ...
  }
]
```

### Basarili Response — Sayfalama ILE
```json
{
  "stations": [
    {
      "_id": "6924cc55495dd2a8e2a581ef",
      "name": "Power FM",
      ...
      "favoritedAt": "2026-04-01T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

**DIKKAT: Response formati `page` ve `limit` parametrelerine gore degisir!**
- Sayfalama YOK → Duz array doner
- Sayfalama VAR → `{ stations: [...], pagination: {...} }` objesi doner

### Ornek Kod
```typescript
// Tum favorileri getir (kucuk listeler icin)
const getAllFavorites = async (authToken: string) => {
  const response = await fetch('https://themegaradio.com/api/user/favorites', {
    headers: { 'Authorization': `Bearer ${authToken}` },
  });
  if (!response.ok) throw new Error('Failed to fetch favorites');
  return await response.json(); // Array doner
};

// Sayfalamali getir (buyuk listeler icin)
const getFavoritesPaginated = async (authToken: string, page: number = 1, limit: number = 20) => {
  const response = await fetch(
    `https://themegaradio.com/api/user/favorites?page=${page}&limit=${limit}&sort=newest`,
    { headers: { 'Authorization': `Bearer ${authToken}` } }
  );
  if (!response.ok) throw new Error('Failed to fetch favorites');
  const data = await response.json();
  // data.stations → istasyon dizisi
  // data.pagination → { page, limit, total, totalPages }
  return data;
};

// Hafif istek (sadece liste gorunum icin gerekli alanlar)
const getFavoritesLight = async (authToken: string) => {
  const response = await fetch(
    'https://themegaradio.com/api/user/favorites?fields=name,favicon,country,url,slug',
    { headers: { 'Authorization': `Bearer ${authToken}` } }
  );
  if (!response.ok) throw new Error('Failed to fetch favorites');
  return await response.json();
};
```

---

## ENDPOINT 4: Favori Kontrol Et

**`GET /api/user/favorites/check/:stationId`**

Belirli bir istasyonun favorilerde olup olmadigini kontrol eder. Kalp ikonu gostermek icin kullanilir.

### Request
```
GET https://themegaradio.com/api/user/favorites/check/6924cc55495dd2a8e2a581ef
Authorization: Bearer <token>
```

### Response
```json
{
  "isFavorited": true
}
```
veya
```json
{
  "isFavorited": false
}
```

### Ornek Kod
```typescript
const checkFavorite = async (stationId: string, authToken: string): Promise<boolean> => {
  try {
    const response = await fetch(
      `https://themegaradio.com/api/user/favorites/check/${stationId}`,
      { headers: { 'Authorization': `Bearer ${authToken}` } }
    );
    if (!response.ok) return false;
    const data = await response.json();
    return data.isFavorited === true;
  } catch {
    return false;
  }
};
```

---

## ENDPOINT 5: Son Dinlenenler (Recently Played)

**Kaydet:** `POST /api/recently-played`
**Getir:** `GET /api/recently-played`

### Kaydet — Kullanici bir istasyonu dinlemeye basladiginda
```
POST https://themegaradio.com/api/recently-played
Content-Type: application/json
Authorization: Bearer <token>
```

Body:
```json
{
  "stationId": "6924cc55495dd2a8e2a581ef"
}
```

Response:
```json
{
  "success": true,
  "message": "Station added to recently played"
}
```

### Getir — Son dinlenen istasyonlar
```
GET https://themegaradio.com/api/recently-played
Authorization: Bearer <token>
```

Response (array):
```json
[
  {
    "_id": "6924cc55495dd2a8e2a581ef",
    "name": "Power FM",
    "slug": "power-fm",
    "country": "Turkey",
    "votes": 1250,
    "url": "https://...",
    "favicon": "https://...",
    "playedAt": "2026-04-01T14:30:00.000Z"
  }
]
```

### Ornek Kod
```typescript
// Istasyon dinlenmeye basladiginda cagir
const reportRecentlyPlayed = async (stationId: string, authToken: string) => {
  try {
    await fetch('https://themegaradio.com/api/recently-played', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ stationId }),
    });
  } catch (error) {
    // Sessizce basarisiz olabilir — dinlemeyi bloklama
    console.warn('Recently played kayit hatasi:', error);
  }
};

// Son dinlenenleri getir
const getRecentlyPlayed = async (authToken: string) => {
  const response = await fetch('https://themegaradio.com/api/recently-played', {
    headers: { 'Authorization': `Bearer ${authToken}` },
  });
  if (!response.ok) return [];
  return await response.json();
};
```

---

## MOBIL UYGULAMA AKISI — OZET

### Istasyon Sayfasinda
```
1. Sayfa acildiginda → GET /api/user/favorites/check/:stationId → Kalp ikonu dolu/bos goster
2. Kullanici kalbe tiklarsa:
   - Eger isFavorited=false → POST /api/user/favorites { stationId } → Kalp dolu yap
   - Eger isFavorited=true  → DELETE /api/user/favorites/:stationId → Kalp bos yap
3. Kullanici dinlemeye basladiginda → POST /api/recently-played { stationId }
```

### Favoriler Sayfasinda
```
1. Sayfa acildiginda → GET /api/user/favorites (veya sayfalamali versiyon)
2. Kullanici bir favoriyi kaldirir → DELETE /api/user/favorites/:stationId → Listeden cikar
3. Pull-to-refresh → GET /api/user/favorites tekrar
```

### Profil / Ana Sayfa
```
1. Son dinlenenler blogu icin → GET /api/recently-played
```

---

## SIK YAPILAN HATALAR

### 1. stationId formati yanlis
**YANLIS:**
```json
{ "stationId": 12345 }
{ "stationId": "power-fm" }
```
**DOGRU:**
```json
{ "stationId": "6924cc55495dd2a8e2a581ef" }
```
`stationId` her zaman istasyonun MongoDB `_id` alani olmalidir (24 karakter hex string).

### 2. DELETE isteginde body gonderme
**YANLIS:**
```typescript
fetch('/api/user/favorites', {
  method: 'DELETE',
  body: JSON.stringify({ stationId: '...' })
});
```
**DOGRU:**
```typescript
fetch(`/api/user/favorites/${stationId}`, {
  method: 'DELETE',
  headers: { 'Authorization': `Bearer ${token}` }
});
```
DELETE isteginde `stationId` **URL path'inde** olmali, body'de degil!

### 3. Token gondermeyi unutmak
Tum favori endpoint'leri `Authorization: Bearer <token>` gerektirir. Token olmadan 401 doner.

### 4. Sayfalamali ve sayfalamali olmayan response farki
- `?page=1&limit=20` kullanilirsa → `{ stations: [...], pagination: {...} }` doner
- Hicbir parametre yoksa → duz array `[...]` doner
Mobil uygulama her iki formati da handle etmeli veya her zaman ayni formati kullanmali.

### 5. "Station already in favorites" hatasini yanlis handle etmek
Bu hata kullaniciya gosterilmemeli. Zaten favorilerde olan bir istasyonu tekrar eklemeye calismak hata degil — sessizce basarili gibi davran.

---

## KONTROL LISTESI

- [ ] `POST /api/user/favorites` ile favori ekleniyor mu? Response'da `success: true` geliyor mu?
- [ ] `DELETE /api/user/favorites/:stationId` ile favori kaldiriliyor mu? stationId URL'de mi?
- [ ] `GET /api/user/favorites` ile favori listesi geliyor mu?
- [ ] `GET /api/user/favorites/check/:stationId` ile kalp durumu kontrol ediliyor mu?
- [ ] Favori eklendikten sonra listeye tekrar istek atilinca yeni istasyon gorunuyor mu?
- [ ] Token suresi doldugunda 401 hatasini yakalayip login ekranina yonlendiriyor mu?
- [ ] 503 hatasi geldiginde "Lutfen tekrar deneyin" mesaji gosteriyor mu?
- [ ] `POST /api/recently-played` dinleme basladiginda cagirilyor mu?
- [ ] Internet yokken favori islemi basarisiz olursa kullaniciya uygun mesaj gosteriyor mu?
- [ ] "Station already in favorites" hatasi kullaniciya gosterilmiyor, sessizce handle ediliyor mu?

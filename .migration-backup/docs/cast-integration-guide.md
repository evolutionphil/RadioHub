# MegaRadio Cast API - TV & Mobile Entegrasyon Kılavuzu

## Genel Bakış

MegaRadio Cast sistemi, mobil uygulamadan (iOS/Android) TV uygulamasına (Samsung Tizen / LG webOS) radyo aktarma imkanı sağlar. Netflix/YouTube tarzı bir cast deneyimi sunar.

**Mimari:**
```
[Mobil App] <---> [Backend WebSocket + REST API] <---> [TV App]
     |                      |                            |
   Cast butonuna          Session ve                  Komutları alır,
   basıldığında          komut yönetimi               radyoyu çalar
```

**Önemli:** Bu sistem internet üzerinden çalışır, aynı WiFi ağında olma şartı yoktur.

---

## Base URL

```
Production: https://themegaradio.com
WebSocket:  wss://themegaradio.com/ws/cast
```

---

## Kimlik Doğrulama

Tüm API istekleri Bearer token gerektirir:
```
Authorization: Bearer mrt_xxxxxxxxxxxxx
```

Token, `/api/auth/mobile/login` endpoint'inden alınır (90 gün geçerli, `mrt_` prefix).

---

## Cast Akışı (Adım Adım)

### Adım 1: Mobil - Cast Session Oluştur

**Mobil uygulama** cast butonuna basıldığında bu endpoint'i çağırır:

```
POST /api/cast/session/create
Authorization: Bearer mrt_xxxxx
Content-Type: application/json

{
  "mobileDeviceId": "iphone-15-user123"  // opsiyonel
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "cast_335779cb46120e5b3767d7279b20b35e",
  "pairingCode": "819805",
  "wsUrl": "/ws/cast?sessionId=cast_xxx&role=mobile&token=YOUR_TOKEN",
  "expiresIn": "24 hours"
}
```

Mobil uygulama kullanıcıya şunu gösterir: **"TV'de bu kodu girin: 819805"**

---

### Adım 2: TV - Pairing Kodu Gir ve Eşleştir

TV uygulamasında kullanıcı 6 haneli kodu girer. TV uygulaması:

```
POST /api/cast/session/pair
Content-Type: application/json

{
  "pairingCode": "819805",
  "deviceId": "samsung-tizen-tv-001",
  "deviceName": "Salon TV",
  "platform": "tizen"          // "tizen" veya "webos"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "cast_335779cb46120e5b3767d7279b20b35e",
  "wsUrl": "/ws/cast?sessionId=cast_xxx&role=tv&token=YOUR_TOKEN&deviceId=samsung-tizen-tv-001",
  "message": "Successfully paired with mobile device"
}
```

---

### Adım 3: TV - WebSocket Bağlantısı Kur

Eşleştirme başarılı olduktan sonra TV uygulaması WebSocket bağlantısı kurar:

```javascript
// Samsung Tizen / LG webOS - Standard WebSocket
const ws = new WebSocket(
  'wss://themegaradio.com/ws/cast' +
  '?sessionId=cast_xxx' +
  '&role=tv' +
  '&token=mrt_xxxxx' +
  '&deviceId=samsung-tizen-tv-001'
);

ws.onopen = function() {
  console.log('Cast WebSocket connected');
};

ws.onmessage = function(event) {
  const msg = JSON.parse(event.data);
  handleCastMessage(msg);
};

ws.onclose = function(event) {
  console.log('Cast WebSocket closed:', event.code, event.reason);
  // Yeniden bağlanma mantığı ekleyin
};
```

**Bağlantı başarılı olduğunda ilk mesaj:**
```json
{
  "type": "cast:connected",
  "clientId": "cast_1234567890_abc123",
  "sessionId": "cast_xxx",
  "role": "tv",
  "status": "paired",
  "currentStation": null,
  "isPlaying": false
}
```

---

### Adım 4: TV - Gelen Komutları İşle

```javascript
function handleCastMessage(msg) {
  switch (msg.type) {
    
    // Radyo çalmaya başla
    case 'cast:play':
    case 'cast:change_station':
      const station = msg.data.station;
      console.log('Playing:', station.name);
      audioPlayer.loadAndPlay(station.streamUrl);
      updateUI({
        stationName: station.name,
        stationSlug: station.slug,
        favicon: station.favicon
      });
      break;

    // Duraklat
    case 'cast:pause':
      audioPlayer.pause();
      break;

    // Devam et
    case 'cast:resume':
      audioPlayer.resume();
      break;

    // Durdur
    case 'cast:stop':
      audioPlayer.stop();
      clearUI();
      break;

    // Ses seviyesi
    case 'cast:volume_up':
      audioPlayer.volumeUp();
      break;

    case 'cast:volume_down':
      audioPlayer.volumeDown();
      break;

    case 'cast:set_volume':
      audioPlayer.setVolume(msg.data.volume); // 0-100
      break;

    // Mobil cihaz bağlandı/ayrıldı
    case 'cast:peer_connected':
      showNotification('Mobil cihaz bağlandı');
      break;

    case 'cast:peer_disconnected':
      showNotification('Mobil cihaz bağlantısı kesildi');
      // İsteğe bağlı: çalmaya devam et veya duraklat
      break;

    // Session sonlandırıldı
    case 'cast:session_ended':
      audioPlayer.stop();
      showPairingScreen();
      break;

    // Komut onayı
    case 'cast:command_ack':
      console.log('Command acknowledged:', msg.command);
      break;

    case 'error':
      console.error('Cast error:', msg.message);
      break;
  }
}
```

---

### Adım 5: TV - Now Playing Bilgisini Mobil'e Gönder

TV uygulaması şu an çalan parça bilgisini mobil'e gönderebilir:

```javascript
// TV'den backend'e now playing bilgisi
function sendNowPlaying(trackInfo) {
  ws.send(JSON.stringify({
    type: 'cast:now_playing',
    data: {
      title: trackInfo.title,
      artist: trackInfo.artist,
      album: trackInfo.album,
      albumArt: trackInfo.albumArt,
      stationName: trackInfo.stationName,
      isPlaying: true
    }
  }));
}
```

**Mobil tarafta bu mesaj şu şekilde gelir:**
```json
{
  "type": "cast:now_playing",
  "sessionId": "cast_xxx",
  "data": {
    "title": "Seni Düşünmek",
    "artist": "Müslüm Gürses",
    "stationName": "Arabesk FM",
    "isPlaying": true
  }
}
```

---

### Adım 6: Heartbeat (Bağlantı Kontrolü)

Her 30 saniyede bir heartbeat gönderin:

```javascript
// TV ve Mobil - her 30 saniyede bir
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'cast:heartbeat' }));
  }
}, 30000);

// Heartbeat yanıtı gelir:
// { "type": "cast:heartbeat_ack", "timestamp": 1708108000000 }
```

---

## REST API Endpoints (Tam Liste)

### 1. Session Oluştur (Mobil)
```
POST /api/cast/session/create
Authorization: Bearer mrt_xxxxx
Body: { "mobileDeviceId": "device-id" }  // opsiyonel
```

### 2. TV Eşleştir
```
POST /api/cast/session/pair
Body: {
  "pairingCode": "123456",
  "deviceId": "tv-device-id",
  "deviceName": "Salon TV",    // opsiyonel
  "platform": "tizen"          // opsiyonel: "tizen" | "webos"
}
```

### 3. Komut Gönder (Mobil → TV)
```
POST /api/cast/command
Authorization: Bearer mrt_xxxxx
Body: {
  "sessionId": "cast_xxx",
  "command": "play",          // play|pause|resume|stop|change_station|volume_up|volume_down|set_volume
  "data": {
    "stationId": "68a8c461bd66579311aadb0b",  // play/change_station için
    "volume": 75                                // set_volume için (0-100)
  }
}
```

### 4. Session Durumu
```
GET /api/cast/session/{sessionId}/status
```
**Response:**
```json
{
  "success": true,
  "sessionId": "cast_xxx",
  "status": "active",
  "isPlaying": true,
  "currentStation": {
    "stationId": "68a8c461bd66579311aadb0b",
    "name": "Arabesk FM",
    "slug": "arabesk-fm",
    "favicon": "/station-logos/arabesk-fm_xxx/logo-256.webp"
  },
  "mobileConnected": true,
  "tvConnected": true,
  "createdAt": "2026-02-16T18:45:49.047Z",
  "pairedAt": "2026-02-16T18:45:49.687Z",
  "expiresAt": "2026-02-17T18:45:49.045Z"
}
```

### 5. Kullanıcı Aktif Sessionları (Mobil)
```
GET /api/cast/sessions
Authorization: Bearer mrt_xxxxx
```

### 6. Session Sonlandır
```
DELETE /api/cast/session/{sessionId}
```

---

## WebSocket Mesaj Tipleri

### Sunucudan Gelen Mesajlar (TV & Mobil alır)

| type | Açıklama | data |
|------|----------|------|
| `cast:connected` | WebSocket bağlantısı kuruldu | `{clientId, sessionId, role, status, currentStation, isPlaying}` |
| `cast:play` | Radyo çal | `{station: {stationId, name, slug, streamUrl, favicon}}` |
| `cast:change_station` | İstasyon değiştir | `{station: {stationId, name, slug, streamUrl, favicon}}` |
| `cast:pause` | Duraklat | - |
| `cast:resume` | Devam et | - |
| `cast:stop` | Durdur | - |
| `cast:volume_up` | Ses aç | - |
| `cast:volume_down` | Ses kıs | - |
| `cast:set_volume` | Ses ayarla | `{volume: 0-100}` |
| `cast:paired` | TV eşleşti (mobil alır) | `{sessionId, tvDeviceId}` |
| `cast:peer_connected` | Karşı cihaz bağlandı | `{sessionId, peerRole}` |
| `cast:peer_disconnected` | Karşı cihaz ayrıldı | `{sessionId, peerRole}` |
| `cast:session_ended` | Session sonlandırıldı | `{sessionId}` |
| `cast:now_playing` | Şu an çalan (mobil alır) | `{title, artist, stationName, ...}` |
| `cast:command_ack` | Komut onayı | `{sessionId, command}` |
| `cast:heartbeat_ack` | Heartbeat yanıtı | `{timestamp}` |
| `error` | Hata | `{message}` |

### İstemciden Gönderilen Mesajlar

| type | Gönderen | data |
|------|----------|------|
| `cast:command` | Mobil/TV | `{command: "play\|pause\|...", data: {...}}` |
| `cast:now_playing` | TV | `{title, artist, stationName, ...}` |
| `cast:heartbeat` | Mobil/TV | - |

---

## Samsung Tizen TV Entegrasyonu

### Pairing Ekranı Örneği

```html
<!-- pairing.html -->
<div id="pairing-screen">
  <h1>Mobil ile Bağlan</h1>
  <div id="pairing-code" style="font-size: 72px; letter-spacing: 20px;">------</div>
  <p>Mobil uygulamanızda Cast butonuna basın ve bu kodu girin</p>
  <input type="text" id="code-input" maxlength="6" />
  <button id="pair-btn" onclick="pairWithCode()">Bağlan</button>
</div>
```

```javascript
// tizen-cast.js
const API_BASE = 'https://themegaradio.com';
let castWs = null;
let tvAuthToken = null; // TV login'den alınan Bearer token

async function pairWithCode() {
  const code = document.getElementById('code-input').value;
  const deviceId = webapis.productinfo.getDuid(); // Samsung Tizen device ID
  
  try {
    const response = await fetch(API_BASE + '/api/cast/session/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: code,
        deviceId: deviceId,
        deviceName: 'Samsung TV',
        platform: 'tizen'
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      connectWebSocket(data.sessionId);
    } else {
      showError('Geçersiz kod veya süresi dolmuş');
    }
  } catch (err) {
    showError('Bağlantı hatası');
  }
}

function connectWebSocket(sessionId) {
  const wsUrl = 'wss://themegaradio.com/ws/cast' +
    '?sessionId=' + sessionId +
    '&role=tv' +
    '&token=' + tvAuthToken +
    '&deviceId=' + webapis.productinfo.getDuid();
  
  castWs = new WebSocket(wsUrl);
  
  castWs.onopen = function() {
    console.log('Cast connected');
    showCastScreen();
  };
  
  castWs.onmessage = function(event) {
    const msg = JSON.parse(event.data);
    handleCastMessage(msg);
  };
  
  castWs.onclose = function() {
    // 5 saniye sonra yeniden bağlan
    setTimeout(() => connectWebSocket(sessionId), 5000);
  };
}

// Samsung Tizen AVPlay ile radyo çalma
function playStation(streamUrl) {
  try {
    webapis.avplay.open(streamUrl);
    webapis.avplay.setListener({
      onbufferingstart: function() { showBuffering(); },
      onbufferingcomplete: function() { hideBuffering(); },
      onstreamcompleted: function() { /* stream bitti */ },
      onerror: function(error) { console.error('AVPlay error:', error); }
    });
    webapis.avplay.prepare();
    webapis.avplay.play();
  } catch (e) {
    // Fallback: HTML5 Audio
    const audio = document.getElementById('audio-player');
    audio.src = streamUrl;
    audio.play();
  }
}

// Heartbeat
setInterval(function() {
  if (castWs && castWs.readyState === WebSocket.OPEN) {
    castWs.send(JSON.stringify({ type: 'cast:heartbeat' }));
  }
}, 30000);
```

---

## LG webOS TV Entegrasyonu

```javascript
// webos-cast.js
const API_BASE = 'https://themegaradio.com';
let castWs = null;

async function pairWithCode() {
  const code = document.getElementById('code-input').value;
  
  // LG webOS device info
  const deviceId = webOS.deviceInfo ? webOS.deviceInfo.serialNumber : 'lg-webos-' + Date.now();
  
  const response = await fetch(API_BASE + '/api/cast/session/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pairingCode: code,
      deviceId: deviceId,
      deviceName: 'LG TV',
      platform: 'webos'
    })
  });
  
  const data = await response.json();
  if (data.success) {
    connectWebSocket(data.sessionId);
  }
}

// LG webOS Audio çalma
function playStation(streamUrl) {
  // webOS Luna API veya HTML5 Audio
  const audio = document.getElementById('audio-player');
  audio.src = streamUrl;
  audio.play();
}
```

---

## Mobil Entegrasyon (iOS & Android)

### iOS (Swift) - Cast Akışı

```swift
// CastManager.swift
class CastManager {
    static let shared = CastManager()
    private var webSocket: URLSessionWebSocketTask?
    private var sessionId: String?
    
    // 1. Session oluştur
    func createSession(completion: @escaping (String, String) -> Void) {
        var request = URLRequest(url: URL(string: "https://themegaradio.com/api/cast/session/create")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(AuthManager.shared.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["mobileDeviceId": UIDevice.current.identifierForVendor?.uuidString ?? ""])
        
        URLSession.shared.dataTask(with: request) { data, _, _ in
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let sessionId = json["sessionId"] as? String,
                  let pairingCode = json["pairingCode"] as? String else { return }
            
            self.sessionId = sessionId
            completion(sessionId, pairingCode)
        }.resume()
    }
    
    // 2. WebSocket bağlan
    func connectWebSocket() {
        guard let sessionId = sessionId else { return }
        let token = AuthManager.shared.token
        let url = URL(string: "wss://themegaradio.com/ws/cast?sessionId=\(sessionId)&role=mobile&token=\(token)")!
        
        webSocket = URLSession.shared.webSocketTask(with: url)
        webSocket?.resume()
        receiveMessage()
    }
    
    // 3. Komut gönder
    func sendCommand(_ command: String, stationId: String? = nil) {
        var body: [String: Any] = [
            "sessionId": sessionId!,
            "command": command
        ]
        if let stationId = stationId {
            body["data"] = ["stationId": stationId]
        }
        
        var request = URLRequest(url: URL(string: "https://themegaradio.com/api/cast/command")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(AuthManager.shared.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        URLSession.shared.dataTask(with: request).resume()
    }
}
```

### Android (Kotlin) - Cast Akışı

```kotlin
// CastManager.kt
class CastManager(private val context: Context) {
    private var webSocket: WebSocket? = null
    private var sessionId: String? = null
    
    // 1. Session oluştur
    suspend fun createSession(): Pair<String, String> {
        val response = apiService.createCastSession(
            "Bearer ${AuthManager.token}",
            mapOf("mobileDeviceId" to Settings.Secure.getString(
                context.contentResolver, Settings.Secure.ANDROID_ID
            ))
        )
        sessionId = response.sessionId
        return Pair(response.sessionId, response.pairingCode)
    }
    
    // 2. WebSocket bağlan
    fun connectWebSocket() {
        val url = "wss://themegaradio.com/ws/cast" +
            "?sessionId=$sessionId" +
            "&role=mobile" +
            "&token=${AuthManager.token}"
        
        val client = OkHttpClient()
        val request = Request.Builder().url(url).build()
        
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(ws: WebSocket, text: String) {
                val msg = JSONObject(text)
                handleMessage(msg)
            }
        })
    }
    
    // 3. Komut gönder
    suspend fun sendCommand(command: String, stationId: String? = null) {
        apiService.sendCastCommand(
            "Bearer ${AuthManager.token}",
            CastCommandRequest(sessionId!!, command, stationId?.let { mapOf("stationId" to it) })
        )
    }
}
```

---

## Cihaz Yönetimi (Device Management)

TV cihazları ilk login/aktivasyon sonrası kalıcı olarak kullanıcı hesabına kaydedilir. Bu sayede tekrar pairing kodu olmadan direkt cast yapılabilir.

### Kayıtlı Cihazları Listele
```
GET /api/user/devices
Authorization: Bearer mrt_xxxxx
```

**Response:**
```json
{
  "success": true,
  "devices": [
    {
      "deviceId": "samsung-tizen-SALON01",
      "deviceName": "Samsung TV",
      "platform": "tizen",
      "lastSeenAt": "2026-02-16T19:21:02.782Z",
      "pairedAt": "2026-02-16T19:21:01.887Z"
    }
  ]
}
```

### Cihaz Kaldır
```
DELETE /api/user/devices/:deviceId
Authorization: Bearer mrt_xxxxx
```
Cihaz kaldırıldığında o cihazın token'ı ve aktif cast sessionları da temizlenir.

**Response:**
```json
{
  "success": true,
  "message": "Cihaz kaldırıldı ve ilişkili tokenlar temizlendi"
}
```

---

## Doğrudan Cast (Direct Cast)

Daha önce eşleştirilmiş bir TV cihazına pairing kodu olmadan doğrudan cast başlatır:

```
POST /api/cast/direct
Authorization: Bearer mrt_xxxxx
Content-Type: application/json

{
  "deviceId": "samsung-tizen-SALON01",
  "stationId": "68a8c461bd66579311aadb0b"  // opsiyonel
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "cast_83839d3ec54353d089b969a37b56c9e4",
  "wsUrl": "/ws/cast?sessionId=cast_xxx&role=mobile&token=YOUR_TOKEN",
  "message": "Direct cast session started"
}
```

**Not:** Direct cast yalnızca daha önce `/api/auth/tv/activate` ile eşleştirilmiş cihazlara çalışır. TV cihazı aktif WebSocket bağlantısıyla dinliyorsa komutu anında alır.

---

### Mobil Uygulama - Direct Cast Kullanımı (Swift)

```swift
func castToSavedDevice(deviceId: String, stationId: String) {
    var request = URLRequest(url: URL(string: "https://themegaradio.com/api/cast/direct")!)
    request.httpMethod = "POST"
    request.setValue("Bearer \(AuthManager.shared.token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: [
        "deviceId": deviceId,
        "stationId": stationId
    ])
    
    URLSession.shared.dataTask(with: request) { data, _, _ in
        guard let data = data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let sessionId = json["sessionId"] as? String else { return }
        self.sessionId = sessionId
        self.connectWebSocket()
    }.resume()
}
```

### Mobil Uygulama - Direct Cast Kullanımı (Kotlin)

```kotlin
suspend fun castToSavedDevice(deviceId: String, stationId: String) {
    val response = apiService.directCast(
        "Bearer ${AuthManager.token}",
        mapOf("deviceId" to deviceId, "stationId" to stationId)
    )
    sessionId = response.sessionId
    connectWebSocket()
}
```

---

## Hata Kodları

| WebSocket Close Code | Açıklama |
|---------------------|----------|
| 4001 | Eksik parametreler (sessionId, role, token) |
| 4002 | Kimlik doğrulama hatası (geçersiz/süresi dolmuş token) |
| 4003 | Session bulunamadı veya süresi dolmuş |
| 4004 | Bu session için yetki yok |

| HTTP Status | Açıklama |
|-------------|----------|
| 401 | Kimlik doğrulama gerekli |
| 400 | Eksik veya geçersiz parametreler |
| 404 | Session bulunamadı / geçersiz pairing kodu |
| 500 | Sunucu hatası |

---

## Güvenlik

1. **Auth zorunluluğu:** Session oluşturma, komut gönderme, durum sorgulama ve session silme işlemleri Bearer token gerektirir.
2. **Ownership kontrolü:** Her kullanıcı yalnızca kendi oluşturduğu session'ları yönetebilir. Başkasının session'ına erişim engellenir.
3. **TV device doğrulaması:** WebSocket bağlantısında TV cihazının `deviceId`'si, pairing sırasında kaydedilen `tvDeviceId` ile eşleşmelidir.
4. **Rate limiting:** Pairing endpoint'i IP başına 15 dakikada en fazla 5 denemeye izin verir. Aşıldığında `429 Too Many Requests` döner.
5. **WebSocket güvenliği:** Hem mobil hem TV WebSocket bağlantıları token doğrulaması gerektirir. TV rolü ayrıca session'ın `paired` veya `active` durumda olmasını kontrol eder.

## Notlar

1. **Session süresi:** 24 saat. Aktif kullanılmasa bile 24 saat sonra otomatik silinir (MongoDB TTL index).
2. **Pairing kodu:** 6 haneli, rastgele üretilir. Yeni session oluşturulduğunda kullanıcının eski aktif sessionları otomatik kapatılır.
3. **Yeniden bağlanma:** WebSocket koptuğunda 5 saniye bekleyip yeniden bağlanın. Session hâlâ aktifse bağlantı devam eder.
4. **TV login:** TV uygulaması da MegaRadio'ya login olmalı ve kendi Bearer token'ını almalıdır. Pairing endpoint'i auth gerektirmez ama WebSocket bağlantısı token gerektirir.
5. **Platform desteği:** Backend tamamen platform-agnostik. Samsung Tizen, LG webOS, iOS, Android hepsi standart WebSocket ile bağlanabilir.

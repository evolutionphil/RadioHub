# Metadata API - iOS & Android Integration Guide

## Overview

MegaRadio provides real-time "Now Playing" metadata (current track info) for radio stations.
Two methods are available:

| Method | Protocol | Best For | Real-time? |
|--------|----------|----------|------------|
| REST API | HTTP GET | Simple integration, on-demand fetch | No (polling) |
| WebSocket | WSS | Continuous live updates | Yes |

---

## 1. REST API (Recommended for Mobile)

### Endpoint

```
GET /api/stations/{stationId}/metadata
```

### Parameters

`stationId` accepts **both** formats:
- **MongoDB ObjectId**: `68a8c47dbd66579311ab228c`
- **Station slug**: `mangoradio`

> Use the slug from the station object you already have (e.g., `station.slug`).

### Authentication

**Not required.** This endpoint is public — no Bearer token or API key needed.

### Example Request

```
GET https://themegaradio.com/api/stations/mangoradio/metadata
```

### Success Response (200)

```json
{
  "station": {
    "id": "68a8c47dbd66579311ab228c",
    "name": "MANGORADIO",
    "url": "https://mangoradio.stream.laut.fm/mangoradio"
  },
  "metadata": {
    "title": "Just My Type",
    "artist": "The Vamps",
    "station": "mangoradio",
    "genre": "Pop"
  }
}
```

### Station Not Found (404)

```json
{
  "error": "Station not found"
}
```

### No Metadata Available (200)

Some stations don't broadcast ICY metadata. The response will have an empty `metadata` object:

```json
{
  "station": {
    "id": "68a8c46dbd66579311aafa1f",
    "name": "Energy NRJ Wien",
    "url": "https://scdn.nrjaudio.fm/adwz1/at/36001/mp3_128.mp3"
  },
  "metadata": {}
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `station.id` | string | MongoDB ObjectId |
| `station.name` | string | Station display name |
| `station.url` | string | Stream URL |
| `metadata.title` | string? | Current track title |
| `metadata.artist` | string? | Current track artist |
| `metadata.station` | string? | Station name from ICY headers |
| `metadata.genre` | string? | Genre from ICY headers |

> All `metadata` fields are optional. Always check if they exist before using them.

---

## 2. Polling Strategy for Mobile Apps

Since REST is not real-time, use **polling** to keep metadata updated:

### Recommended Polling Interval

```
Every 15 seconds while the station is playing.
Stop polling when playback stops.
```

### iOS (Swift) Example

```swift
class MetadataService {
    private var timer: Timer?
    private let baseURL = "https://themegaradio.com"
    
    struct MetadataResponse: Codable {
        let station: StationInfo?
        let metadata: TrackMetadata?
    }
    
    struct StationInfo: Codable {
        let id: String
        let name: String
        let url: String
    }
    
    struct TrackMetadata: Codable {
        let title: String?
        let artist: String?
        let station: String?
        let genre: String?
    }
    
    // Start polling when playback begins
    func startPolling(stationSlug: String, onUpdate: @escaping (TrackMetadata?) -> Void) {
        stopPolling()
        
        // Fetch immediately
        fetchMetadata(stationSlug: stationSlug, onUpdate: onUpdate)
        
        // Then poll every 15 seconds
        timer = Timer.scheduledTimer(withTimeInterval: 15.0, repeats: true) { [weak self] _ in
            self?.fetchMetadata(stationSlug: stationSlug, onUpdate: onUpdate)
        }
    }
    
    // Stop polling when playback stops
    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }
    
    private func fetchMetadata(stationSlug: String, onUpdate: @escaping (TrackMetadata?) -> Void) {
        guard let url = URL(string: "\(baseURL)/api/stations/\(stationSlug)/metadata") else { return }
        
        URLSession.shared.dataTask(with: url) { data, response, error in
            guard let data = data, error == nil else {
                onUpdate(nil)
                return
            }
            
            let decoded = try? JSONDecoder().decode(MetadataResponse.self, from: data)
            
            DispatchQueue.main.async {
                onUpdate(decoded?.metadata)
            }
        }.resume()
    }
}

// Usage in ViewController / SwiftUI View:
let metadataService = MetadataService()

// When user starts playing a station:
metadataService.startPolling(stationSlug: "mangoradio") { metadata in
    if let title = metadata?.title, let artist = metadata?.artist {
        // Update UI: "The Vamps - Just My Type"
        self.nowPlayingLabel.text = "\(artist) - \(title)"
    } else if let title = metadata?.title {
        // Some stations only send title
        self.nowPlayingLabel.text = title
    } else {
        // No metadata available - show station name
        self.nowPlayingLabel.text = station.name
    }
}

// When user stops playing:
metadataService.stopPolling()
```

### Android (Kotlin) Example

```kotlin
class MetadataService {
    private val client = OkHttpClient()
    private val gson = Gson()
    private var pollingJob: Job? = null
    private val baseUrl = "https://themegaradio.com"
    
    data class MetadataResponse(
        val station: StationInfo?,
        val metadata: TrackMetadata?
    )
    
    data class StationInfo(
        val id: String,
        val name: String,
        val url: String
    )
    
    data class TrackMetadata(
        val title: String?,
        val artist: String?,
        val station: String?,
        val genre: String?
    )
    
    // Start polling when playback begins
    fun startPolling(
        stationSlug: String,
        scope: CoroutineScope,
        onUpdate: (TrackMetadata?) -> Unit
    ) {
        stopPolling()
        
        pollingJob = scope.launch(Dispatchers.IO) {
            while (isActive) {
                val metadata = fetchMetadata(stationSlug)
                withContext(Dispatchers.Main) {
                    onUpdate(metadata)
                }
                delay(15_000) // Poll every 15 seconds
            }
        }
    }
    
    // Stop polling when playback stops
    fun stopPolling() {
        pollingJob?.cancel()
        pollingJob = null
    }
    
    private fun fetchMetadata(stationSlug: String): TrackMetadata? {
        return try {
            val request = Request.Builder()
                .url("$baseUrl/api/stations/$stationSlug/metadata")
                .build()
            
            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return null
            
            val result = gson.fromJson(body, MetadataResponse::class.java)
            result.metadata
        } catch (e: Exception) {
            null
        }
    }
}

// Usage in Activity/Fragment:
val metadataService = MetadataService()

// When user starts playing:
metadataService.startPolling("mangoradio", lifecycleScope) { metadata ->
    when {
        metadata?.artist != null && metadata.title != null -> {
            nowPlayingText.text = "${metadata.artist} - ${metadata.title}"
        }
        metadata?.title != null -> {
            nowPlayingText.text = metadata.title
        }
        else -> {
            nowPlayingText.text = station.name // Fallback
        }
    }
}

// When user stops playing:
metadataService.stopPolling()
```

---

## 3. WebSocket (Advanced - Continuous Updates)

For real-time metadata without polling, use the WebSocket endpoint.

### Endpoint

```
wss://themegaradio.com/ws/metadata
```

### Protocol

1. Connect to the WebSocket
2. Receive `connected` message with your client ID
3. Send `trackStream` with the station's stream URL
4. Receive `setTitle` messages whenever the track changes
5. Send `stopTracking` when playback stops

### Message Flow

```
Client → Server:  {"action": "trackStream", "streamUrl": "https://mangoradio.stream.laut.fm/mangoradio"}
Server → Client:  {"action": "connected", "clientId": "client_123_abc"}
Server → Client:  {"action": "setTitle", "data": {"title": "Just My Type", "artist": "The Vamps", "station": "mangoradio", "genre": "Pop"}}
... (auto-updates every ~10 seconds when track changes)
Client → Server:  {"action": "stopTracking"}
```

### Important Notes for WebSocket

- Use the station's **original stream URL** (`station.url` or `station.urlResolved`), NOT the proxy URL
- The server checks for metadata changes every ~10 seconds
- Only sends `setTitle` when metadata actually changes (no duplicate messages)
- Implement reconnection logic (server may restart)

### iOS WebSocket Example

```swift
import Foundation

class MetadataWebSocket: NSObject, URLSessionWebSocketDelegate {
    private var webSocket: URLSessionWebSocketTask?
    private var onMetadataUpdate: ((TrackMetadata) -> Void)?
    
    func connect(streamUrl: String, onUpdate: @escaping (TrackMetadata) -> Void) {
        self.onMetadataUpdate = onUpdate
        
        let url = URL(string: "wss://themegaradio.com/ws/metadata")!
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        webSocket = session.webSocketTask(with: url)
        webSocket?.resume()
        
        // Start tracking after connection
        let message = ["action": "trackStream", "streamUrl": streamUrl]
        if let data = try? JSONSerialization.data(withJSONObject: message) {
            let str = String(data: data, encoding: .utf8)!
            webSocket?.send(.string(str)) { _ in }
        }
        
        receiveMessage()
    }
    
    private func receiveMessage() {
        webSocket?.receive { [weak self] result in
            switch result {
            case .success(let message):
                if case .string(let text) = message,
                   let data = text.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    
                    if json["action"] as? String == "setTitle",
                       let metaData = json["data"] as? [String: Any] {
                        let metadata = TrackMetadata(
                            title: metaData["title"] as? String,
                            artist: metaData["artist"] as? String,
                            station: metaData["station"] as? String,
                            genre: metaData["genre"] as? String
                        )
                        DispatchQueue.main.async {
                            self?.onMetadataUpdate?(metadata)
                        }
                    }
                }
                self?.receiveMessage() // Continue listening
                
            case .failure:
                // Reconnect after 3 seconds
                DispatchQueue.global().asyncAfter(deadline: .now() + 3) {
                    // Implement reconnection here
                }
            }
        }
    }
    
    func disconnect() {
        let message = ["action": "stopTracking"]
        if let data = try? JSONSerialization.data(withJSONObject: message) {
            let str = String(data: data, encoding: .utf8)!
            webSocket?.send(.string(str)) { _ in }
        }
        webSocket?.cancel(with: .normalClosure, reason: nil)
        webSocket = nil
    }
}
```

### Android WebSocket Example

```kotlin
import okhttp3.*

class MetadataWebSocket(
    private val onUpdate: (TrackMetadata) -> Unit
) : WebSocketListener() {
    private val client = OkHttpClient()
    private var webSocket: WebSocket? = null
    
    fun connect(streamUrl: String) {
        val request = Request.Builder()
            .url("wss://themegaradio.com/ws/metadata")
            .build()
        
        webSocket = client.newWebSocket(request, this)
        
        // trackStream will be sent in onOpen
        this.pendingStreamUrl = streamUrl
    }
    
    private var pendingStreamUrl: String? = null
    
    override fun onOpen(ws: WebSocket, response: Response) {
        pendingStreamUrl?.let { url ->
            val msg = """{"action":"trackStream","streamUrl":"$url"}"""
            ws.send(msg)
        }
    }
    
    override fun onMessage(ws: WebSocket, text: String) {
        val json = JSONObject(text)
        if (json.optString("action") == "setTitle") {
            val data = json.getJSONObject("data")
            val metadata = TrackMetadata(
                title = data.optString("title", null),
                artist = data.optString("artist", null),
                station = data.optString("station", null),
                genre = data.optString("genre", null)
            )
            Handler(Looper.getMainLooper()).post {
                onUpdate(metadata)
            }
        }
    }
    
    override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
        // Reconnect after 3 seconds
        Handler(Looper.getMainLooper()).postDelayed({
            pendingStreamUrl?.let { connect(it) }
        }, 3000)
    }
    
    fun disconnect() {
        webSocket?.send("""{"action":"stopTracking"}""")
        webSocket?.close(1000, "User stopped")
        webSocket = null
    }
}
```

---

## 4. Which Method to Use?

| Scenario | Recommended Method |
|----------|-------------------|
| Simple "now playing" display | REST API + 15s polling |
| Lock screen / notification metadata | REST API + 15s polling |
| Live "now playing" animation | WebSocket |
| Battery-sensitive apps | REST API + 30s polling |
| Background playback | REST API + 15s polling |

**For most mobile apps, REST API with 15-second polling is sufficient and simpler to implement.**

---

## 5. Updating Lock Screen / Media Controls

### iOS - MPNowPlayingInfoCenter

```swift
import MediaPlayer

func updateNowPlaying(station: Station, metadata: TrackMetadata?) {
    var nowPlayingInfo = [String: Any]()
    
    nowPlayingInfo[MPMediaItemPropertyTitle] = metadata?.title ?? station.name
    nowPlayingInfo[MPMediaItemPropertyArtist] = metadata?.artist ?? "MegaRadio"
    nowPlayingInfo[MPMediaItemPropertyAlbumTitle] = metadata?.genre ?? "Live Radio"
    
    // Station artwork (if available)
    if let imageUrl = station.favicon, let url = URL(string: imageUrl) {
        // Load image async and set MPMediaItemArtwork
    }
    
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo
}
```

### Android - MediaSession

```kotlin
fun updateMediaSession(station: Station, metadata: TrackMetadata?) {
    val metadataBuilder = MediaMetadataCompat.Builder()
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, metadata?.title ?: station.name)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, metadata?.artist ?: "MegaRadio")
        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, metadata?.genre ?: "Live Radio")
    
    mediaSession.setMetadata(metadataBuilder.build())
}
```

---

## 6. Edge Cases to Handle

| Case | What Happens | What to Show |
|------|-------------|--------------|
| Station has no ICY metadata | `metadata: {}` | Station name |
| Station is offline | Connection timeout → `metadata: {}` | Station name + "Offline" |
| Only `title` field present (no artist) | `metadata: { "title": "Station Jingle" }` | Title only |
| Track format: `"Artist - Title"` already split | Both `artist` and `title` present | `artist` — `title` |
| Station not found | `404: { "error": "Station not found" }` | Error handling |
| Network error | Request fails | Keep showing last known metadata |

---

## 7. Quick Test URLs

```bash
# Station with rich metadata (artist + title):
curl https://themegaradio.com/api/stations/mangoradio/metadata

# Station with title only (no artist):
curl https://themegaradio.com/api/stations/arabesk-fm/metadata

# Station without ICY metadata:
curl https://themegaradio.com/api/stations/energy-nrj-wien/metadata

# Using ObjectId:
curl https://themegaradio.com/api/stations/68a8c47dbd66579311ab228c/metadata

# Invalid station:
curl https://themegaradio.com/api/stations/nonexistent/metadata
```

# React Native - Client-Side ICY Metadata Rehberi

## Neden Client-Side?
Metadata (şarkı bilgisi) doğrudan cihazda çözülür, sunucuya tek bir istek bile gitmez. Bu hem sunucu yükünü sıfırlar hem de anlık şarkı bilgisi sağlar.

## Nasıl Çalışır?

Radyo stream'leri ICY (Icecast/Shoutcast) protokolünü kullanır:

1. HTTP isteğinde `Icy-MetaData: 1` header'ı gönderilir
2. Sunucu yanıtında `icy-metaint` header'ı döner (örn: 16000) — bu, her 16000 byte audio veriden sonra metadata bloğu geldiğini belirtir
3. Metadata bloğu: `StreamTitle='Artist - Song Name';` formatındadır

```
[16000 byte audio] [1 byte uzunluk] [metadata] [16000 byte audio] [1 byte uzunluk] [metadata] ...
```

## React Native Çözümü

### Yöntem 1: react-native-track-player (Önerilen)

`react-native-track-player` ICY metadata'yı otomatik yakalar. Bu en kolay ve en stabil yöntem:

```bash
npm install react-native-track-player
```

```typescript
// services/IcyMetadataService.ts
import TrackPlayer, { Event } from 'react-native-track-player';

interface NowPlayingInfo {
  title: string;
  artist: string;
  station: string;
}

type MetadataCallback = (info: NowPlayingInfo) => void;

class IcyMetadataService {
  private listeners: Map<string, MetadataCallback> = new Map();
  private lastTitle: string = '';

  async initialize() {
    await TrackPlayer.setupPlayer();

    // ICY metadata otomatik olarak bu event'e düşer
    TrackPlayer.addEventListener(Event.PlaybackMetadataReceived, (data) => {
      // data.title genelde "Artist - Song Name" formatında gelir
      const rawTitle = data.title || '';

      // Reklam tespiti (Radiolise'den alınan mantık)
      if (this.isAdvertisement(rawTitle)) {
        return; // Reklamları atla
      }

      // Aynı şarkıyı tekrar gönderme
      if (rawTitle === this.lastTitle) return;
      this.lastTitle = rawTitle;

      const parsed = this.parseTitle(rawTitle);
      this.listeners.forEach(cb => cb(parsed));
    });
  }

  private isAdvertisement(raw: string): boolean {
    // RadioDroid ve Radiolise'den alınan reklam tespiti
    const adKeywords = ['AdCreativeId', 'adw_ad', 'adId=', 'insertionType='];
    return adKeywords.some(keyword => raw.includes(keyword));
  }

  private parseTitle(raw: string): NowPlayingInfo {
    // "Artist - Song Name" formatını ayır
    const parts = raw.split(' - ');
    if (parts.length >= 2) {
      return {
        title: parts.slice(1).join(' - ').trim(),
        artist: parts[0].trim(),
        station: '',
      };
    }
    return { title: raw.trim(), artist: '', station: '' };
  }

  subscribe(id: string, callback: MetadataCallback) {
    this.listeners.set(id, callback);
  }

  unsubscribe(id: string) {
    this.listeners.delete(id);
  }

  async playStation(streamUrl: string, stationName: string) {
    this.lastTitle = '';

    await TrackPlayer.reset();
    await TrackPlayer.add({
      id: 'live-stream',
      url: streamUrl,
      title: stationName,
      artist: 'Live Radio',
      isLiveStream: true,
      // ICY metadata header'ı otomatik gönderilir
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': 'MegaRadio/1.0',
      },
    });
    await TrackPlayer.play();
  }
}

export const icyMetadata = new IcyMetadataService();
```

### Kullanım (React Component):

```tsx
// components/NowPlaying.tsx
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { icyMetadata } from '../services/IcyMetadataService';

export function NowPlaying({ streamUrl, stationName }: { 
  streamUrl: string; 
  stationName: string;
}) {
  const [nowPlaying, setNowPlaying] = useState({ title: stationName, artist: '' });

  useEffect(() => {
    icyMetadata.subscribe('now-playing', (info) => {
      setNowPlaying(info);
    });

    icyMetadata.playStation(streamUrl, stationName);

    return () => {
      icyMetadata.unsubscribe('now-playing');
    };
  }, [streamUrl]);

  return (
    <View>
      <Text style={{ fontWeight: 'bold' }}>{nowPlaying.title}</Text>
      {nowPlaying.artist ? <Text>{nowPlaying.artist}</Text> : null}
    </View>
  );
}
```

---

### Yöntem 2: ExoPlayer ile Manuel ICY Parsing (Sadece Android)

RadioDroid'un kullandığı yöntem. Daha düşük seviye ama tam kontrol sağlar.

React Native'de bu yaklaşım `react-native-video` veya custom native module ile yapılır:

```java
// android/app/src/main/java/com/megaradio/IcyMetadataModule.java

// RadioDroid'un IcyDataSource.java'sından adapte edilmiş
// ExoPlayer'ın IcyInfo event'ini dinler ve React Native'e gönderir

@ReactMethod
public void startListening(String streamUrl) {
    // ExoPlayer setup
    DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(context);

    MediaItem mediaItem = new MediaItem.Builder()
        .setUri(streamUrl)
        .build();

    exoPlayer = new ExoPlayer.Builder(context).build();

    // ICY metadata otomatik yakalanır
    exoPlayer.addListener(new Player.Listener() {
        @Override
        public void onMetadata(Metadata metadata) {
            for (int i = 0; i < metadata.length(); i++) {
                Metadata.Entry entry = metadata.get(i);
                if (entry instanceof IcyInfo) {
                    IcyInfo icyInfo = (IcyInfo) entry;
                    // React Native'e gönder
                    WritableMap params = Arguments.createMap();
                    params.putString("title", icyInfo.title);
                    sendEvent("onIcyMetadata", params);
                }
            }
        }
    });
}
```

---

### Yöntem 3: Fetch API ile Doğrudan ICY Parsing (Platform-bağımsız)

Radiolise'nin sunucu tarafı kodunun React Native'e uyarlanması. Bu yöntem en karmaşık ama her platformda çalışır:

```typescript
// services/DirectIcyParser.ts

interface IcyMetadata {
  title: string;
  artist: string;
  streamTitle: string;
}

type MetadataHandler = (meta: IcyMetadata) => void;

export class DirectIcyParser {
  private controller: AbortController | null = null;
  private handler: MetadataHandler;
  private lastRawTitle: string = '';

  constructor(handler: MetadataHandler) {
    this.handler = handler;
  }

  async connect(streamUrl: string) {
    this.disconnect();
    this.controller = new AbortController();

    try {
      const response = await fetch(streamUrl, {
        headers: {
          'Icy-MetaData': '1',
          'User-Agent': 'MegaRadio/1.0',
        },
        signal: this.controller.signal,
      });

      const metaInt = parseInt(response.headers.get('icy-metaint') || '0', 10);

      if (metaInt === 0) {
        console.log('Stream ICY metadata desteklemiyor');
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      let buffer = new Uint8Array(0);
      let audioRemaining = metaInt;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Mevcut buffer'a ekle
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;

        while (buffer.length > 0) {
          if (audioRemaining > 0) {
            // Audio verisi — atla
            const skip = Math.min(audioRemaining, buffer.length);
            buffer = buffer.slice(skip);
            audioRemaining -= skip;
          } else if (audioRemaining === 0) {
            // Metadata boyut byte'ı
            if (buffer.length < 1) break;
            const metaSize = buffer[0] * 16;
            buffer = buffer.slice(1);

            if (metaSize === 0) {
              // Metadata yok, sonraki audio bloğuna geç
              audioRemaining = metaInt;
              continue;
            }

            if (buffer.length < metaSize) break; // Yeterli veri yok, bekle

            // Metadata'yı oku ve parse et
            const metaBytes = buffer.slice(0, metaSize);
            buffer = buffer.slice(metaSize);
            audioRemaining = metaInt;

            const rawMeta = new TextDecoder().decode(metaBytes).replace(/\0+$/, '');
            this.parseAndEmit(rawMeta);
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('ICY parse hatası:', err);
        // 5 saniye sonra yeniden bağlan
        setTimeout(() => this.connect(streamUrl), 5000);
      }
    }
  }

  private parseAndEmit(raw: string) {
    // "StreamTitle='Artist - Song';StreamUrl='...';" formatını parse et
    const match = raw.match(/StreamTitle='([^']*)'/);
    if (!match) return;

    const streamTitle = match[1];

    // Aynı şarkıyı tekrar gönderme
    if (streamTitle === this.lastRawTitle) return;
    this.lastRawTitle = streamTitle;

    // Reklam tespiti (Radiolise mantığı)
    if (raw.includes('AdCreativeId') || raw.includes('adw_ad')) return;

    // "Artist - Song" ayır
    const parts = streamTitle.split(' - ');
    const meta: IcyMetadata = parts.length >= 2
      ? { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), streamTitle }
      : { artist: '', title: streamTitle.trim(), streamTitle };

    this.handler(meta);
  }

  disconnect() {
    this.controller?.abort();
    this.controller = null;
    this.lastRawTitle = '';
  }
}
```

**Not:** Bu yöntem çalışır ama dikkat: stream verisini indirdiği için pil ve data tüketir. Yöntem 1 (react-native-track-player) zaten stream'i dinlerken metadata'yı yakaladığı için ek maliyet sıfırdır.

---

## Önerilen Yaklaşım

| Yöntem | Zorluk | Platform | Ek Veri Tüketimi | Tavsiye |
|--------|--------|----------|------------------|---------|
| 1. react-native-track-player | Kolay | iOS + Android | Yok (zaten dinliyor) | **Önerilen** |
| 2. ExoPlayer native module | Zor | Sadece Android | Yok | Android-only projeler |
| 3. Fetch + parse | Orta | iOS + Android | Var (ikinci bağlantı) | Yedek/fallback |

**Yöntem 1 en uygun** çünkü:
- Zaten audio stream'i çalmak için player gerekiyor
- Player aynı bağlantıdan metadata'yı otomatik ayıklıyor
- Ek HTTP bağlantısı açmıyor
- Hem iOS hem Android'de çalışıyor
- Reklam filtreleme kolayca eklenebiliyor

## HTTPS vs HTTP Stream Farkı

- **HTTPS streamler**: Doğrudan bağlanır, proxy gerekmez
- **HTTP streamler**: `https://stream.themegaradio.com/api/proxy?url=ENCODED_URL` üzerinden bağlanır

```typescript
function getStreamUrl(originalUrl: string): string {
  if (originalUrl.startsWith('https://')) {
    return originalUrl; // Doğrudan bağlan
  }
  // HTTP streamleri proxy üzerinden yönlendir
  return `https://stream.themegaradio.com/api/proxy?url=${encodeURIComponent(originalUrl)}`;
}
```

## Logo Proxy Değişikliği (ZORUNLU)

```typescript
// ESKİ:
const logoUrl = `https://api.themegaradio.com/api/image/${encodeURIComponent(imageUrl)}`;

// YENİ:
const logoUrl = `https://stream.themegaradio.com/api/image/${encodeURIComponent(imageUrl)}`;
```

## Ek Notlar

- `Icy-MetaData: 1` header'ı gönderilmezse sunucu metadata göndermez
- Tüm stream sunucuları ICY desteklemez — desteklemeyenler için şarkı bilgisi gösterilemez, bu normal
- HLS (m3u8) streamlerde ICY metadata yoktur, bunlar için timed metadata (ID3 tag) kullanılır — react-native-track-player bunu da yakalar
- Metadata genelde UTF-8'dir ama bazı eski sunucular Latin-1 gönderir

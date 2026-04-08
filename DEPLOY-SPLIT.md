# Split Deployment: Backend API + Frontend Web

Monolitik yapıyı iki bağımsız Railway servisine ayırma kılavuzu.

## Mimari

```
                    Kullanıcı Tarayıcısı
                          │
                          ▼
              ┌───────────────────────┐
              │    Cloudflare DNS     │
              │  themegaradio.com     │
              └──────────┬────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
┌─────────────────────┐     ┌──────────────────────┐
│   frontend-web      │     │    backend-api        │
│ themegaradio.com    │     │ api.themegaradio.com  │
│                     │     │                       │
│ React SPA + SSR     │     │ Express API (/api/*)  │
│ SEO Renderer        │────▶│ WebSocket (/ws/*)     │
│ Static Assets       │     │ Session + Passport    │
│ Sitemap / robots    │     │ OAuth (Google)        │
│ Reverse Proxy:      │     │ Admin Panel API       │
│  /api/* → backend   │     │ Rate Limiting         │
│  /ws/*  → backend   │     │ CORS Allowlist        │
│ MongoDB (read-only) │     │ MongoDB (read/write)  │
└─────────────────────┘     └───────────────────────┘
          ▲                             ▲
          │                             │
     Web Browser               Mobil Uygulamalar
     (tüm trafik)             (direkt API erişimi)
```

## Nasıl Çalışır

1. **Web kullanıcıları** `themegaradio.com` adresine bağlanır (frontend-web servisi)
2. Frontend-web, React SPA'yı ve statik dosyaları sunar
3. Tarayıcıdan gelen `/api/*` ve `/ws/*` istekleri frontend-web tarafından backend-api'ye proxy edilir
4. Bu sayede tarayıcı açısından her şey aynı domain'de kalır (CORS sorunu yok)
5. **Mobil uygulamalar** doğrudan `api.themegaradio.com` adresine bağlanır
6. Admin paneli backend-api üzerindedir, frontend-web üzerinden proxy ile erişilir

---

## Servisler

### 1. Backend API (`backend-api`)

| Özellik | Değer |
|---------|-------|
| **Domain** | `api.themegaradio.com` |
| **Entrypoint** | `server/index-api.ts` |
| **Dockerfile** | `Dockerfile.api` |
| **Railway config** | `railway-api.toml` |
| **Varsayılan port** | 5000 |

**İçerik:**
- Tüm `/api/*` route'ları (admin dahil)
- WebSocket sunucuları (`/ws/metadata`, `/ws/cast`, `/ws/chat`)
- Session yönetimi (express-session + connect-mongo)
- Passport.js (Google OAuth, local auth)
- Rate limiting (global + auth)
- CORS allowlist (strict)
- MongoDB bağlantısı (read/write)
- Cache warmup + cron job'ları
- Healthcheck: `/healthz` (basit), `/health` ve `/api/health` (detaylı)

### 2. Frontend Web (`frontend-web`)

| Özellik | Değer |
|---------|-------|
| **Domain** | `themegaradio.com` |
| **Entrypoint** | `server/index-web.ts` |
| **Dockerfile** | `Dockerfile.web` |
| **Railway config** | `railway-web.toml` |
| **Varsayılan port** | 3000 |

**İçerik:**
- Vite ile build edilmiş React SPA
- SEO renderer (bot'lar için server-side HTML)
- html-lang middleware (çok dilli URL desteği)
- Sitemap ve robots.txt
- Statik dosya sunumu (JS, CSS, görseller, fontlar)
- Station logoları ve görselleri
- Cast receiver (Chromecast)
- Reverse proxy: `/api/*` ve `/ws/*` → backend-api
- MongoDB bağlantısı (sadece SEO için okuma)
- Healthcheck: `/healthz` ve `/health`

---

## Environment Variables (Ortam Değişkenleri)

### Backend API — Zorunlu Değişkenler

| Değişken | Zorunlu | Açıklama | Örnek |
|----------|---------|----------|-------|
| `PORT` | Hayır | Sunucu portu (varsayılan: 5000) | `5000` |
| `NODE_ENV` | **Evet** | `production` olmalı | `production` |
| `MONGODB_URI` | **Evet** | MongoDB Atlas bağlantı string'i | `mongodb+srv://user:pass@cluster.mongodb.net/mega?retryWrites=true&w=majority` |
| `SESSION_SECRET` | **Evet** | Session şifreleme anahtarı (64+ karakter rastgele) | `a1b2c3d4e5f6...` (min 64 karakter) |
| `CORS_ALLOWED_ORIGINS` | **Evet** | Virgülle ayrılmış izin verilen origin'ler | `https://themegaradio.com,https://www.themegaradio.com` |
| `FRONTEND_URL` | **Evet** | Frontend URL'si (OAuth yönlendirmeleri için) | `https://themegaradio.com` |

### Backend API — Opsiyonel Değişkenler

| Değişken | Açıklama | Örnek |
|----------|----------|-------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | `246210957471-...apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | `GOCSPX-...` |
| `GOOGLE_CALLBACK_URL` | Google OAuth callback URL (varsayılan: `{FRONTEND_URL}/api/auth/google/callback`) | `https://themegaradio.com/api/auth/google/callback` |
| `HSTS_PHASE` | HSTS katılık seviyesi | `production` |
| `CLICKJACKING_MITIGATION` | X-Frame-Options header | `DENY` |
| `AWS_ACCESS_KEY_ID` | S3 erişim anahtarı (logo/avatar yükleme) | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | S3 gizli anahtar | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `AWS_REGION` | S3 bölgesi | `eu-central-1` |
| `AWS_S3_BUCKET` | S3 bucket adı | `megaradio-logos` |
| `OPENAI_API_KEY` | OpenAI API anahtarı (AI açıklama üretimi) | `sk-...` |
| `VAPID_PUBLIC_KEY` | Web push notification public key | `BEl62iUYg...` |
| `VAPID_PRIVATE_KEY` | Web push notification private key | `UvP-7vxwy...` |

### Frontend Web — Tüm Değişkenler

| Değişken | Zorunlu | Açıklama | Örnek |
|----------|---------|----------|-------|
| `PORT` | Hayır | Sunucu portu (varsayılan: 3000) | `3000` |
| `NODE_ENV` | **Evet** | `production` olmalı | `production` |
| `MONGODB_URI` | **Evet** | MongoDB bağlantı string'i (SEO için okuma işlemleri) | `mongodb+srv://user:pass@cluster.mongodb.net/mega?retryWrites=true&w=majority` |
| `BACKEND_API_URL` | **Evet** | Backend-api'nin dahili URL'si | `http://backend-api.railway.internal:5000` |
| `HSTS_PHASE` | Hayır | HSTS katılık seviyesi | `production` |

---

## Railway Kurulum Kılavuzu (Adım Adım)

### Ön Gereksinimler

1. Railway hesabı (https://railway.app)
2. GitHub repo'su (bu proje)
3. MongoDB Atlas cluster (aktif ve erişilebilir)
4. Cloudflare hesabı (DNS yönetimi için)

### Adım 1: Railway Projesi Oluşturma

1. https://railway.app/dashboard adresine gidin
2. **"New Project"** butonuna tıklayın
3. **"Empty Project"** seçin
4. Proje adını `megaradio` olarak ayarlayın

### Adım 2: Backend API Servisi Oluşturma

1. Proje içinde **"+ New"** → **"GitHub Repo"** tıklayın
2. Bu projenin GitHub repo'sunu seçin
3. Servis adını **`backend-api`** olarak değiştirin
4. **Settings** sekmesine gidin:

**Build & Deploy Ayarları:**

| Ayar | Değer |
|------|-------|
| Builder | Dockerfile |
| Dockerfile Path | `Dockerfile.api` |
| Watch Paths | `/server/**`, `/shared/**`, `/package.json` |
| Root Directory | `/` (boş bırakın) |
| Restart Policy | Always |
| Health Check Path | `/healthz` |
| Health Check Timeout | 300 saniye |

5. **Variables** sekmesine gidin ve aşağıdaki değişkenleri ekleyin:

```
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb+srv://KULLANICI:SIFRE@CLUSTER.mongodb.net/mega?retryWrites=true&w=majority
SESSION_SECRET=BURAYA_64_KARAKTER_RASTGELE_STRING_YAZIN
CORS_ALLOWED_ORIGINS=https://themegaradio.com,https://www.themegaradio.com
FRONTEND_URL=https://themegaradio.com
GOOGLE_CLIENT_ID=SIZIN_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=SIZIN_GOOGLE_CLIENT_SECRET
```

6. **Networking** sekmesine gidin:
   - **"Generate Domain"** tıklayın (Railway domain alın)
   - **"Custom Domain"** → `api.themegaradio.com` ekleyin

### Adım 3: Frontend Web Servisi Oluşturma

1. Aynı proje içinde **"+ New"** → **"GitHub Repo"** tıklayın
2. Aynı GitHub repo'sunu seçin
3. Servis adını **`frontend-web`** olarak değiştirin
4. **Settings** sekmesine gidin:

**Build & Deploy Ayarları:**

| Ayar | Değer |
|------|-------|
| Builder | Dockerfile |
| Dockerfile Path | `Dockerfile.web` |
| Watch Paths | `/client/**`, `/server/**`, `/shared/**`, `/public/**`, `/package.json` |
| Root Directory | `/` (boş bırakın) |
| Restart Policy | Always |
| Health Check Path | `/healthz` |
| Health Check Timeout | 300 saniye |

5. **Variables** sekmesine gidin:

```
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb+srv://KULLANICI:SIFRE@CLUSTER.mongodb.net/mega?retryWrites=true&w=majority
BACKEND_API_URL=http://backend-api.railway.internal:5000
```

**ÖNEMLİ:** `BACKEND_API_URL` değeri Railway'in dahili ağını kullanır. `backend-api` servisi adıyla otomatik olarak çözümlenir. Dışarıdan erişilemez, sadece aynı Railway projesi içindeki servisler arası iletişim için kullanılır.

6. **Networking** sekmesine gidin:
   - **"Generate Domain"** tıklayın
   - **"Custom Domain"** → `themegaradio.com` ekleyin

### Adım 4: Cloudflare DNS Yapılandırması

Cloudflare DNS panelinde aşağıdaki kayıtları ekleyin:

| Tip | Ad | Değer | Proxy |
|-----|-----|-------|-------|
| CNAME | `@` (veya `themegaradio.com`) | Railway'in frontend-web için verdiği domain | DNS Only (ilk kurulumda) |
| CNAME | `api` | Railway'in backend-api için verdiği domain | DNS Only (ilk kurulumda) |

**NOT:** İlk kurulumda Cloudflare proxy'sini kapatın (turuncu bulut → gri bulut). Railway SSL sertifikası doğrulandıktan sonra Cloudflare proxy'sini açabilirsiniz.

### Adım 5: Railway'de SSL Doğrulama

1. Railway dashboard'da her iki servisin **Networking** sekmesini kontrol edin
2. Custom domain'lerin yanında yeşil tik (✓) görünmeli
3. Eğer kırmızı veya sarı uyarı varsa, DNS kayıtlarının doğru olduğundan emin olun
4. SSL sertifikası otomatik olarak oluşturulur (Let's Encrypt)
5. Genellikle 5-15 dakika sürer

### Adım 6: Deploy Başlatma

1. Her iki servis de GitHub repo'suna bağlı olduğu için, push yapıldığında otomatik deploy olur
2. İlk deploy için Railway dashboard'da **"Deploy"** butonuna tıklayın
3. **Önce backend-api** deploy edin, başarılı olduğunu doğrulayın
4. **Sonra frontend-web** deploy edin

### Adım 7: Doğrulama (Kritik)

Aşağıdaki tüm kontrolleri yapın:

**Backend API Kontrolleri:**

```bash
# 1. Basit healthcheck
curl https://api.themegaradio.com/healthz
# Beklenen: "ok"

# 2. Detaylı healthcheck
curl https://api.themegaradio.com/health
# Beklenen: JSON { status: "ok", service: "backend-api", database: { status: "connected" } }

# 3. API endpoint testi
curl https://api.themegaradio.com/api/health
# Beklenen: JSON { status: "ok", mongo: "connected" }
```

**Frontend Web Kontrolleri:**

```bash
# 4. Frontend healthcheck
curl https://themegaradio.com/healthz
# Beklenen: "ok"

# 5. Frontend üzerinden API proxy testi
curl https://themegaradio.com/api/health
# Beklenen: JSON (backend-api'den proxy edilen yanıt)

# 6. SEO testi (bot olarak)
curl -A "Googlebot" https://themegaradio.com/
# Beklenen: Server-rendered HTML (SSR)

# 7. Statik dosya testi
curl -I https://themegaradio.com/favicon.png
# Beklenen: 200 OK, Content-Type: image/png
```

**WebSocket Testi:**

```bash
# 8. WebSocket testi (wscat gerekir: npm install -g wscat)
wscat -c wss://themegaradio.com/ws/metadata
# Beklenen: Bağlantı başarılı
```

**OAuth Testi:**

```
9. Tarayıcıda https://themegaradio.com adresine gidin
10. Google ile giriş yapın
11. Başarılı giriş sonrası ana sayfaya yönlendirilmeli
12. Profil bilgileri doğru görünmeli
```

**Admin Panel Testi:**

```
13. https://themegaradio.com/admin adresine gidin
14. Admin giriş yapın
15. Station yönetimi, kullanıcı yönetimi çalışmalı
```

---

## CORS Politikası

### Strict Allowlist (Varsayılan)

Backend-api, `CORS_ALLOWED_ORIGINS` env değişkenindeki origin'lere izin verir. Sadece bu origin'lerden gelen isteklere `Access-Control-Allow-Origin` header'ı eklenir.

### Açık CORS Route'ları (İstisnalar)

Aşağıdaki endpoint'ler `Access-Control-Allow-Origin: *` kullanır çünkü bunlar herkese açık medya kaynakları:

| Route | Neden |
|-------|-------|
| `/api/stream/*` | HLS/Icecast ses akışı — mobil uygulamalar, Samsung TV, Chromecast |
| `/api/image/*` | Station logo proxy — mobil uygulamalar, TV cihazları |

Bu route'lar `credentials: true` kullanmaz, sadece GET/HEAD/OPTIONS destekler.

---

## OAuth Akışı (Split Deployment)

```
1. Kullanıcı "Google ile Giriş" tıklar
2. Tarayıcı → themegaradio.com/api/auth/google (frontend-web proxy → backend-api)
3. Backend-api → Google OAuth redirect (callbackURL: themegaradio.com/api/auth/google/callback)
4. Google → themegaradio.com/api/auth/google/callback (frontend-web proxy → backend-api)
5. Backend-api session oluşturur, FRONTEND_URL'e redirect eder
6. Kullanıcı themegaradio.com'a yönlendirilir (session cookie ile)
```

**ÖNEMLİ:** OAuth callback URL'si her zaman frontend domain'ini kullanır (`themegaradio.com`), backend domain'ini DEĞİL. Çünkü:
- Google Console'da kayıtlı URL `themegaradio.com/api/auth/google/callback`
- Frontend-web bu isteği backend-api'ye proxy eder
- Session cookie `themegaradio.com` domain'inde set edilir

---

## Session Paylaşımı

Her iki servis de aynı MongoDB'yi session store olarak kullanır (`connect-mongo`). Ancak:
- **Backend-api**: Session middleware'i var, session oluşturur/günceller
- **Frontend-web**: Session middleware'i YOK, sadece proxy yapıyor

Session cookie `themegaradio.com` domain'inde set edilir. Frontend-web proxy ile gelen isteklerdeki cookie'leri backend-api'ye iletir.

---

## Mobil Uygulamalar

Mobil uygulamalar doğrudan `https://api.themegaradio.com` adresine bağlanır:

```
// React Native örneği
const API_BASE = 'https://api.themegaradio.com';

// API çağrısı
fetch(`${API_BASE}/api/stations/popular`);

// WebSocket
const ws = new WebSocket('wss://api.themegaradio.com/ws/metadata');

// Google Sign-In (idToken ile)
fetch(`${API_BASE}/api/auth/google`, {
  method: 'POST',
  body: JSON.stringify({ idToken, email, name, googleId }),
});
```

Mobil uygulamaların origin'ini `CORS_ALLOWED_ORIGINS`'e ekleyin. `/api/stream/*` ve `/api/image/*` zaten `*` CORS kullandığı için ek yapılandırma gerekmez.

---

## Monolitik Fallback

Orijinal monolitik dosyalar (`server/index.ts`, `Dockerfile`, `railway.toml`) değiştirilmeden korunmuştur. Monolitik dağıtıma geri dönmek için:

1. Railway'de Dockerfile path'i `Dockerfile` olarak değiştirin
2. Tek servis olarak deploy edin
3. Tüm env değişkenlerini tek servise taşıyın

---

## Build Betikleri

```bash
# Backend API build
bash scripts/build-api.sh
# Çıktı: dist/index-api.js

# Frontend Web build (client + server)
bash scripts/build-web.sh
# Çıktı: dist/index-web.js + dist/public/

# Monolitik build (eski yöntem)
npm run build
# Çıktı: dist/index.js + dist/public/
```

---

## Sorun Giderme

### "502 Bad Gateway" — Frontend Web

Backend-api çalışmıyor veya `BACKEND_API_URL` yanlış.
- Backend-api healthcheck'ini kontrol edin: `curl https://api.themegaradio.com/healthz`
- `BACKEND_API_URL` değerinin `http://backend-api.railway.internal:5000` olduğundan emin olun
- Railway'de her iki servisin de aynı projede olduğunu doğrulayın

### "CORS Error" — Tarayıcı

- Web uygulaması `themegaradio.com` üzerinden çalışıyorsa CORS sorunu OLMAMALI (aynı origin, proxy)
- Eğer doğrudan `api.themegaradio.com`'a istek yapılıyorsa, `CORS_ALLOWED_ORIGINS`'e origin'i ekleyin

### OAuth "redirect_uri_mismatch"

- Google Console'da callback URL'sinin `https://themegaradio.com/api/auth/google/callback` olduğundan emin olun
- `FRONTEND_URL` veya `GOOGLE_CALLBACK_URL` env değişkenini kontrol edin

### Session Kaybı

- `SESSION_SECRET` her iki dağıtımda da aynı olmalı
- `MONGODB_URI` aynı veritabanına işaret etmeli
- Cookie domain'inin doğru olduğundan emin olun

### MongoDB Bağlantı Hatası

- MongoDB Atlas'ta IP whitelist'e `0.0.0.0/0` ekleyin (Railway IP'leri değişebilir)
- Connection string'de `retryWrites=true&w=majority` olduğundan emin olun

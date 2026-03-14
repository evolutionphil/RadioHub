import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { Station } from '../shared/mongo-schemas';
import NodeCache from 'node-cache';

const ogImageCache = new NodeCache({ stdTTL: 3600, checkperiod: 600, maxKeys: 500 });

export function clearOgCache(): void {
  const count = ogImageCache.keys().length;
  ogImageCache.flushAll();
  console.log(`🧹 OG image cache cleared: ${count} entries`);
}

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const LOGO_SIZE = 300;

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'MegaRadio/1.0' },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function resolveLogoAssetUrl(folder: string, value: string): string | null {
  if (!value) return null;
  if (value.startsWith('https://') || value.startsWith('http://')) return value;
  const localPath = path.join(process.cwd(), 'public', 'station-logos', folder, value);
  return fs.existsSync(localPath) ? localPath : null;
}

async function getStationLogoBuffer(station: any): Promise<Buffer | null> {
  for (const key of ['webp256', 'webp96'] as const) {
    const value = station.logoAssets?.[key];
    if (!value) continue;
    const resolved = resolveLogoAssetUrl(station.logoAssets.folder, value);
    if (!resolved) continue;
    // S3 or remote URL — fetch via HTTP
    if (resolved.startsWith('https://') || resolved.startsWith('http://')) {
      const buf = await downloadImage(resolved);
      if (buf) return buf;
    } else {
      // Local file path
      try { return await fsp.readFile(resolved); } catch {}
    }
  }
  if (station.favicon?.startsWith('http')) return await downloadImage(station.favicon);
  return null;
}

export async function generateStationOgImage(stationSlug: string): Promise<Buffer | null> {
  const cacheKey = `og:${stationSlug}`;
  const cached = ogImageCache.get<Buffer>(cacheKey);
  if (cached) return cached;

  try {
    const station = await Station.findOne({ slug: stationSlug }).lean();
    if (!station) return null;

    const logoBuffer = await getStationLogoBuffer(station);
    
    if (logoBuffer) {
      try {
        const result = await sharp(logoBuffer)
          .resize(OG_WIDTH, OG_HEIGHT, { 
            fit: 'contain', 
            background: { r: 26, g: 26, b: 46, alpha: 1 }
          })
          .jpeg({ quality: 90 })
          .toBuffer();

        ogImageCache.set(cacheKey, result);
        return result;
      } catch (e) {
      }
    }

    return null;
  } catch (error) {
    console.error('Error generating OG image:', error);
    return null;
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function getDefaultOgImage(): Promise<Buffer> {
  const gradient = Buffer.from(`
    <svg width="${OG_WIDTH}" height="${OG_HEIGHT}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1a1a2e"/>
          <stop offset="50%" style="stop-color:#16213e"/>
          <stop offset="100%" style="stop-color:#0f0f23"/>
        </linearGradient>
        <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#ff6b6b"/>
          <stop offset="100%" style="stop-color:#ee5a5a"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <rect x="0" y="${OG_HEIGHT - 8}" width="100%" height="8" fill="url(#accent)"/>
    </svg>
  `);

  const textSvg = Buffer.from(`
    <svg width="${OG_WIDTH}" height="${OG_HEIGHT}">
      <style>
        .title { 
          fill: #ffffff; 
          font-family: Arial, sans-serif; 
          font-size: 72px; 
          font-weight: bold;
          text-anchor: middle;
        }
        .subtitle {
          fill: rgba(255,255,255,0.8);
          font-family: Arial, sans-serif;
          font-size: 32px;
          text-anchor: middle;
        }
        .accent {
          fill: #ff6b6b;
          font-family: Arial, sans-serif;
          font-size: 28px;
          text-anchor: middle;
        }
      </style>
      <text x="${OG_WIDTH / 2}" y="260" class="title">Mega Radio</text>
      <text x="${OG_WIDTH / 2}" y="330" class="subtitle">Listen to Free Live Radio Online</text>
      <text x="${OG_WIDTH / 2}" y="400" class="accent">60,000+ Radio Stations from 120+ Countries</text>
    </svg>
  `);

  return await sharp(gradient)
    .composite([{ input: textSvg, top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

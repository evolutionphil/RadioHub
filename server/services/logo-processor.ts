import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import sharp from 'sharp';
import zlib from 'zlib';
import { promisify } from 'util';
import { Station } from '../../shared/mongo-schemas';
import { logger } from '../utils/logger';
import { uploadToS3, deleteFolderFromS3, isS3Configured } from './s3-storage';

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);

const LOGO_SIZES = [256] as const;
const LOGOS_DIR = path.join(process.cwd(), 'public', 'station-logos');

type FailureType = 'http_error' | 'timeout' | 'invalid_format' | 'download_failed' | 'processing_failed';

export interface LogoProcessResult {
  success: boolean;
  folder?: string;
  error?: string;
  failureType?: FailureType;
}

interface DownloadResult {
  buffer: Buffer | null;
  error?: string;
  failureType?: FailureType;
  statusCode?: number;
  contentType?: string;
}

export class LogoProcessor {
  private processingQueue: Set<string> = new Set();

  constructor() {
    this.ensureLogosDirectory();
  }

  private async ensureLogosDirectory(): Promise<void> {
    try {
      await fs.access(LOGOS_DIR);
    } catch {
      await fs.mkdir(LOGOS_DIR, { recursive: true });
      logger.log('📁 Created station-logos directory');
    }
  }

  getFolderName(slug: string, stationId: string): string {
    const id8 = stationId.toString().slice(-8);
    const sanitizedSlug = this.sanitizeSlug(slug);
    return `${sanitizedSlug}_${id8}`;
  }

  private sanitizeSlug(slug: string): string {
    return slug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 100);
  }

  /**
   * Decompress buffer if needed (gzip or deflate)
   */
  private async decompressIfNeeded(buffer: Buffer, contentEncoding?: string): Promise<Buffer> {
    if (!contentEncoding) return buffer;
    
    const encoding = contentEncoding.toLowerCase();
    try {
      if (encoding.includes('gzip')) {
        return await gunzip(buffer);
      }
      if (encoding.includes('deflate')) {
        return await inflate(buffer);
      }
    } catch (e) {
      // If decompression fails, return original buffer
    }
    return buffer;
  }

  /**
   * Check magic bytes to identify if buffer is a valid image
   * This is more reliable than Content-Type headers which servers often misconfigure
   */
  private checkMagicBytes(buffer: Buffer): { isImage: boolean; format?: string; reason?: string } {
    if (!buffer || buffer.length < 4) {
      return { isImage: false, reason: 'Buffer too small' };
    }

    const bytes = buffer.slice(0, 16);
    
    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      return { isImage: true, format: 'png' };
    }
    
    // JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
      return { isImage: true, format: 'jpeg' };
    }
    
    // GIF: 47 49 46 38 (GIF8)
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return { isImage: true, format: 'gif' };
    }
    
    // WebP: 52 49 46 46 (RIFF) + WEBP at offset 8
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      if (buffer.length > 11 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return { isImage: true, format: 'webp' };
      }
    }
    
    // ICO: 00 00 01 00
    if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
      return { isImage: true, format: 'ico' };
    }
    
    // BMP: 42 4D (BM)
    if (bytes[0] === 0x42 && bytes[1] === 0x4D) {
      return { isImage: true, format: 'bmp' };
    }
    
    // TIFF: 49 49 2A 00 or 4D 4D 00 2A
    if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2A && bytes[3] === 0x00) ||
        (bytes[0] === 0x4D && bytes[1] === 0x4D && bytes[2] === 0x00 && bytes[3] === 0x2A)) {
      return { isImage: true, format: 'tiff' };
    }
    
    // Check for text-based content (HTML, SVG, XML, JSON errors)
    const headerText = buffer.slice(0, 200).toString('utf8').toLowerCase();
    
    // HTML/text page
    if (headerText.includes('<!doctype') || headerText.includes('<html') || 
        headerText.includes('<head') || headerText.includes('<body') ||
        headerText.startsWith('<?xml') || headerText.includes('<script')) {
      return { isImage: false, reason: 'HTML/XML page detected (server returned error page)' };
    }
    
    // SVG
    if (headerText.includes('<svg')) {
      return { isImage: false, reason: 'SVG file - not supported' };
    }
    
    // JSON error response
    if (headerText.startsWith('{') || headerText.startsWith('[')) {
      return { isImage: false, reason: 'JSON response (likely API error)' };
    }
    
    // If we can't identify it, it might still be a valid image
    // Let Sharp try to process it
    return { isImage: true, format: 'unknown' };
  }

  /**
   * Validate if buffer contains a valid image using Sharp metadata
   */
  private async isValidImageBuffer(buffer: Buffer): Promise<{ valid: boolean; reason?: string; format?: string }> {
    if (!buffer || buffer.length === 0) {
      return { valid: false, reason: 'Empty buffer' };
    }

    if (buffer.length < 8) {
      return { valid: false, reason: 'Buffer too small' };
    }

    // Check for text-based content (HTML, SVG, XML, JSON errors)
    const headerText = buffer.slice(0, 200).toString('utf8').toLowerCase();
    
    if (headerText.includes('<!doctype') || headerText.includes('<html') || 
        headerText.includes('<head') || headerText.includes('<body')) {
      return { valid: false, reason: 'HTML page detected (likely 404 error page)' };
    }
    
    if (headerText.includes('<?xml') || headerText.includes('<svg')) {
      return { valid: false, reason: 'SVG/XML file - not supported for processing' };
    }

    if (headerText.includes('"error"') || headerText.includes('{"message"') || 
        headerText.includes('not found') || headerText.includes('access denied')) {
      return { valid: false, reason: 'Error response detected' };
    }

    // Check for ICO magic bytes (00 00 01 00) - handle separately
    const isIco = buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00;
    
    // Use Sharp to validate the image format
    try {
      const metadata = await sharp(buffer).metadata();
      if (!metadata.format) {
        // ICO files might not report format correctly
        if (isIco) {
          return { valid: true, format: 'ico' };
        }
        return { valid: false, reason: 'Unknown image format' };
      }
      
      // Check for supported formats (including ico)
      const supportedFormats = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'tiff', 'avif', 'heif', 'ico'];
      if (!supportedFormats.includes(metadata.format)) {
        return { valid: false, reason: `Unsupported format: ${metadata.format}` };
      }

      return { valid: true, format: metadata.format };
    } catch (error: any) {
      // If Sharp fails but it's an ICO file, try to process anyway
      if (isIco) {
        return { valid: true, format: 'ico' };
      }
      return { valid: false, reason: `Sharp validation failed: ${error.message?.substring(0, 100)}` };
    }
  }

  /**
   * Extract image from ICO file and convert to format Sharp can handle
   * ICO files contain PNG or BMP (DIB) data - we need to handle both
   * Returns either PNG buffer or raw RGBA data with dimensions
   */
  private extractImageFromIco(buffer: Buffer): { type: 'png' | 'raw'; data: Buffer; width?: number; height?: number } | null {
    try {
      if (buffer.length < 6) return null;
      
      const imageCount = buffer.readUInt16LE(4);
      if (imageCount === 0 || imageCount > 256) return null;
      
      // Find largest image entry
      let best: { offset: number; size: number; width: number; height: number; bpp: number } | null = null;
      
      for (let i = 0; i < imageCount; i++) {
        const entryOffset = 6 + (i * 16);
        if (entryOffset + 16 > buffer.length) break;
        
        const width = buffer[entryOffset] || 256;
        const height = buffer[entryOffset + 1] || 256;
        const bpp = buffer.readUInt16LE(entryOffset + 6);
        const imageSize = buffer.readUInt32LE(entryOffset + 8);
        const imageOffset = buffer.readUInt32LE(entryOffset + 12);
        
        if (!best || width > best.width || (width === best.width && bpp > best.bpp)) {
          best = { offset: imageOffset, size: imageSize, width, height, bpp };
        }
      }
      
      if (!best || best.offset + best.size > buffer.length) return null;
      
      const imageData = buffer.slice(best.offset, best.offset + best.size);
      
      // Check if PNG (starts with PNG magic bytes)
      if (imageData[0] === 0x89 && imageData[1] === 0x50 && imageData[2] === 0x4E && imageData[3] === 0x47) {
        return { type: 'png', data: imageData };
      }
      
      // It's BMP/DIB data - convert to raw RGBA that Sharp can process
      const rgba = this.dibToRgba(imageData, best.width, best.height);
      if (rgba) {
        return { type: 'raw', data: rgba.data, width: rgba.width, height: rgba.height };
      }
      
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Convert DIB (Device Independent Bitmap) from ICO to raw RGBA buffer
   * This approach works because Sharp can process raw pixel data directly
   */
  private dibToRgba(dibData: Buffer, width: number, height: number): { data: Buffer; width: number; height: number } | null {
    try {
      if (dibData.length < 40) return null;
      
      const headerSize = dibData.readUInt32LE(0);
      if (headerSize < 40) return null;
      
      const bpp = dibData.readUInt16LE(14);
      const compression = dibData.readUInt32LE(16);
      
      // Only handle uncompressed bitmaps
      if (compression !== 0) return null;
      
      // Read color palette for indexed formats (1, 4, 8 bpp)
      let palette: { r: number; g: number; b: number; a: number }[] = [];
      if (bpp <= 8) {
        const numColors = 1 << bpp;
        const paletteStart = headerSize;
        for (let i = 0; i < numColors; i++) {
          const idx = paletteStart + i * 4;
          if (idx + 4 > dibData.length) break;
          palette.push({
            b: dibData[idx],
            g: dibData[idx + 1],
            r: dibData[idx + 2],
            a: 255
          });
        }
      }
      
      // Calculate offsets
      const paletteSize = bpp <= 8 ? (1 << bpp) * 4 : 0;
      const rowSize = Math.floor((bpp * width + 31) / 32) * 4;
      const pixelDataOffset = headerSize + paletteSize;
      
      // Create RGBA buffer (4 bytes per pixel)
      const rgba = Buffer.alloc(width * height * 4);
      
      for (let y = 0; y < height; y++) {
        // BMP is stored bottom-up, so we flip vertically
        const srcY = height - 1 - y;
        const srcRowStart = pixelDataOffset + srcY * rowSize;
        
        for (let x = 0; x < width; x++) {
          const dstIdx = (y * width + x) * 4;
          
          if (bpp === 1) {
            // 1-bit monochrome
            const byteIdx = srcRowStart + Math.floor(x / 8);
            const bitIdx = 7 - (x % 8);
            const palIdx = (dibData[byteIdx] >> bitIdx) & 1;
            if (palIdx < palette.length) {
              rgba[dstIdx] = palette[palIdx].r;
              rgba[dstIdx + 1] = palette[palIdx].g;
              rgba[dstIdx + 2] = palette[palIdx].b;
              rgba[dstIdx + 3] = 255;
            }
          } else if (bpp === 4) {
            // 4-bit indexed (16 colors)
            const byteIdx = srcRowStart + Math.floor(x / 2);
            const palIdx = (x % 2 === 0) ? (dibData[byteIdx] >> 4) & 0xF : dibData[byteIdx] & 0xF;
            if (palIdx < palette.length) {
              rgba[dstIdx] = palette[palIdx].r;
              rgba[dstIdx + 1] = palette[palIdx].g;
              rgba[dstIdx + 2] = palette[palIdx].b;
              rgba[dstIdx + 3] = 255;
            }
          } else if (bpp === 8) {
            // 8-bit indexed (256 colors)
            const palIdx = dibData[srcRowStart + x];
            if (palIdx < palette.length) {
              rgba[dstIdx] = palette[palIdx].r;
              rgba[dstIdx + 1] = palette[palIdx].g;
              rgba[dstIdx + 2] = palette[palIdx].b;
              rgba[dstIdx + 3] = 255;
            }
          } else if (bpp === 24) {
            // 24-bit BGR
            const srcIdx = srcRowStart + x * 3;
            rgba[dstIdx] = dibData[srcIdx + 2];     // R
            rgba[dstIdx + 1] = dibData[srcIdx + 1]; // G
            rgba[dstIdx + 2] = dibData[srcIdx];     // B
            rgba[dstIdx + 3] = 255;                 // A
          } else if (bpp === 32) {
            // 32-bit BGRA
            const srcIdx = srcRowStart + x * 4;
            rgba[dstIdx] = dibData[srcIdx + 2];     // R
            rgba[dstIdx + 1] = dibData[srcIdx + 1]; // G
            rgba[dstIdx + 2] = dibData[srcIdx];     // B
            rgba[dstIdx + 3] = dibData[srcIdx + 3]; // A
          }
        }
      }
      
      return { data: rgba, width, height };
    } catch {
      return null;
    }
  }

  /**
   * Safely process image buffer with Sharp, handling corrupt files and ICO
   */
  private async safeProcessImage(buffer: Buffer, size: number): Promise<Buffer> {
    // Check if it's an ICO file - Sharp handles ICO but needs special care
    const isIco = buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00;
    
    // For ICO files, extract embedded PNG or convert BMP to raw RGBA
    let processBuffer = buffer;
    let rawOptions: { width: number; height: number; channels: 4 } | null = null;
    
    if (isIco) {
      const extractedImage = this.extractImageFromIco(buffer);
      if (extractedImage) {
        processBuffer = extractedImage.data;
        if (extractedImage.type === 'raw' && extractedImage.width && extractedImage.height) {
          rawOptions = { width: extractedImage.width, height: extractedImage.height, channels: 4 };
        }
      }
    }
    
    try {
      // For ICO files with raw RGBA data, use raw input
      if (rawOptions) {
        return await sharp(processBuffer, { raw: rawOptions })
          .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .webp({ quality: 85, effort: 4 })
          .toBuffer();
      }
      
      // Standard processing for PNG, JPEG, WebP, etc.
      const sharpOptions: sharp.SharpOptions = { 
        failOn: 'none', 
        limitInputPixels: 268402689,
        pages: isIco && processBuffer === buffer ? 0 : undefined
      };
      
      return await sharp(processBuffer, sharpOptions)
        .resize(size, size, {
          fit: 'cover',
          position: 'center',
          background: { r: 255, g: 255, b: 255, alpha: 0 }
        })
        .webp({ quality: 85, effort: 4 })
        .toBuffer();
    } catch (firstError: any) {
      // Second try: flatten to remove alpha issues and convert
      try {
        if (rawOptions) {
          return await sharp(processBuffer, { raw: rawOptions })
            .flatten({ background: { r: 255, g: 255, b: 255 } })
            .resize(size, size, { fit: 'contain' })
            .webp({ quality: 85, effort: 4 })
            .toBuffer();
        }
        return await sharp(processBuffer, { failOn: 'none' })
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .resize(size, size, {
            fit: 'cover',
            position: 'center'
          })
          .webp({ quality: 85, effort: 4 })
          .toBuffer();
      } catch (secondError: any) {
        // Third try: If we have original ICO and extracted data failed, try original directly
        if (isIco && processBuffer !== buffer) {
          try {
            return await sharp(buffer, { failOn: 'none', pages: 0 })
              .resize(size, size, { fit: 'cover', position: 'center' })
              .webp({ quality: 85, effort: 4 })
              .toBuffer();
          } catch {
            // Fall through to error
          }
        }
        throw new Error(`Processing failed: ${firstError.message?.substring(0, 100)}`);
      }
    }
  }

  /**
   * Process a station's logo from favicon URL
   */
  async processFromUrl(stationId: string, slug: string, faviconUrl: string): Promise<LogoProcessResult> {
    if (!faviconUrl || !faviconUrl.startsWith('http')) {
      return { success: false, error: 'Invalid favicon URL', failureType: 'invalid_format' };
    }

    if (this.processingQueue.has(stationId)) {
      return { success: false, error: 'Already processing', failureType: 'processing_failed' };
    }

    this.processingQueue.add(stationId);
    
    // Log the URL being processed
    const shortUrl = faviconUrl.length > 80 ? faviconUrl.substring(0, 80) + '...' : faviconUrl;
    logger.log(`🔄 Processing: ${shortUrl}`);

    try {
      const folderName = this.getFolderName(slug, stationId);
      const useS3 = isS3Configured();

      if (!useS3) {
        logger.warn(`⚠️ S3 NOT configured — BUCKET: ${process.env.AWS_BUCKET_NAME ? 'SET' : 'MISSING'}, KEY: ${process.env.AWS_ACCESS_KEY_ID ? 'SET' : 'MISSING'}, SECRET: ${process.env.AWS_SECRET_ACCESS_KEY ? 'SET' : 'MISSING'}`);
      }

      await Station.updateOne(
        { _id: stationId },
        { $set: { 'logoAssets.status': 'processing', 'logoAssets.folder': folderName } }
      );

      if (!useS3) {
        const folderPath = path.join(LOGOS_DIR, folderName);
        await fs.mkdir(folderPath, { recursive: true });
      }

      // Download with detailed error reporting
      const downloadResult = await this.downloadImageWithRetry(faviconUrl, 2);
      
      if (!downloadResult.buffer) {
        const errorMsg = downloadResult.error || 'Download failed';
        throw new Error(errorMsg);
      }

      // Validate image format using Sharp metadata
      const validation = await this.isValidImageBuffer(downloadResult.buffer);
      if (!validation.valid) {
        throw new Error(validation.reason || 'Invalid image format');
      }

      const originalExt = this.getExtensionFromFormat(validation.format) || this.getExtension(faviconUrl);
      const originalFilename = `original${originalExt}`;

      const logoAssets: Record<string, string> = { folder: folderName };

      if (useS3) {
        // Upload to S3 — store full URLs directly in logoAssets
        const s3Key = (filename: string) => `station-logos/${folderName}/${filename}`;
        logoAssets.original = await uploadToS3(s3Key(originalFilename), downloadResult.buffer, 'image/webp');
        for (const size of LOGO_SIZES) {
          const filename = `logo-${size}.webp`;
          const buf = await this.safeProcessImage(downloadResult.buffer, size);
          logoAssets[`webp${size}`] = await uploadToS3(s3Key(filename), buf, 'image/webp');
        }
        logger.log(`☁️ S3 upload complete: ${folderName}`);
      } else {
        // Fallback: local filesystem
        const folderPath = path.join(LOGOS_DIR, folderName);
        await fs.writeFile(path.join(folderPath, originalFilename), downloadResult.buffer);
        logoAssets.original = originalFilename;
        for (const size of LOGO_SIZES) {
          const filename = `logo-${size}.webp`;
          const buf = await this.safeProcessImage(downloadResult.buffer, size);
          await fs.writeFile(path.join(folderPath, filename), buf);
          logoAssets[`webp${size}`] = filename;
        }
      }

      await Station.updateOne(
        { _id: stationId },
        {
          $set: {
            logoAssets: {
              ...logoAssets,
              status: 'completed',
              processedAt: new Date()
            }
          }
        }
      );

      logger.log(`✅ Logo processed: ${folderName} (${useS3 ? 'S3' : 'local'})`);
      return { success: true, folder: folderName };

    } catch (error: any) {
      const errorMsg = error.message?.substring(0, 200) || 'Unknown error';
      logger.log(`❌ Logo failed for ${stationId}: ${errorMsg} | URL: ${shortUrl}`);
      
      // Determine failure type for better classification
      // HTTP errors (4xx, 5xx) are permanent and should not be retried
      let failureType: FailureType = 'processing_failed';
      if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT') || errorMsg.includes('ECONNABORTED')) {
        failureType = 'timeout';
      } else if (/HTTP [4-5]\d\d/.test(errorMsg) || errorMsg.includes('DNS') || errorMsg.includes('ENOTFOUND')) {
        // Any HTTP 4xx or 5xx error, or DNS failure - permanent, don't retry
        failureType = 'http_error';
      } else if (errorMsg.includes('Download') || errorMsg.includes('ECONNREFUSED')) {
        failureType = 'download_failed';
      } else if (errorMsg.includes('format') || errorMsg.includes('HTML') || errorMsg.includes('SVG') || errorMsg.includes('XML')) {
        failureType = 'invalid_format';
      }

      await Station.updateOne(
        { _id: stationId },
        {
          $set: {
            'logoAssets.status': 'failed',
            'logoAssets.error': errorMsg,
            'logoAssets.failureType': failureType,
            'logoAssets.lastAttempt': new Date()
          }
        }
      );

      return { success: false, error: errorMsg, failureType };
    } finally {
      this.processingQueue.delete(stationId);
    }
  }

  /**
   * Process an uploaded file (for manual uploads)
   */
  async processFromBuffer(stationId: string, slug: string, buffer: Buffer, originalFilename: string): Promise<LogoProcessResult> {
    if (!buffer || buffer.length === 0) {
      return { success: false, error: 'Empty buffer' };
    }

    try {
      const folderName = this.getFolderName(slug, stationId);
      const useS3 = isS3Configured();

      await Station.updateOne(
        { _id: stationId },
        { $set: { 'logoAssets.status': 'processing', 'logoAssets.folder': folderName } }
      );

      const ext = path.extname(originalFilename) || '.png';
      const originalFile = `original${ext}`;
      const logoAssets: Record<string, string> = { folder: folderName };

      if (useS3) {
        const s3Key = (filename: string) => `station-logos/${folderName}/${filename}`;
        logoAssets.original = await uploadToS3(s3Key(originalFile), buffer, 'image/webp');
        for (const size of LOGO_SIZES) {
          const filename = `logo-${size}.webp`;
          const buf = await this.safeProcessImage(buffer, size);
          logoAssets[`webp${size}`] = await uploadToS3(s3Key(filename), buf, 'image/webp');
        }
        logger.log(`☁️ S3 upload complete (manual): ${folderName}`);
      } else {
        const folderPath = path.join(LOGOS_DIR, folderName);
        await fs.mkdir(folderPath, { recursive: true });
        await fs.writeFile(path.join(folderPath, originalFile), buffer);
        logoAssets.original = originalFile;
        for (const size of LOGO_SIZES) {
          const filename = `logo-${size}.webp`;
          const buf = await this.safeProcessImage(buffer, size);
          await fs.writeFile(path.join(folderPath, filename), buf);
          logoAssets[`webp${size}`] = filename;
        }
      }

      await Station.updateOne(
        { _id: stationId },
        {
          $set: {
            logoAssets: {
              ...logoAssets,
              status: 'completed',
              processedAt: new Date()
            },
            hasCustomFavicon: true
          }
        }
      );

      logger.log(`✅ Logo uploaded: ${folderName} (${useS3 ? 'S3' : 'local'})`);
      return { success: true, folder: folderName };

    } catch (error: any) {
      logger.log(`❌ Logo upload failed for ${stationId}: ${error.message}`);
      
      await Station.updateOne(
        { _id: stationId },
        {
          $set: {
            'logoAssets.status': 'failed',
            'logoAssets.error': error.message?.substring(0, 200)
          }
        }
      );

      return { success: false, error: error.message };
    }
  }

  /**
   * Download image with retry logic and detailed error reporting
   * PRIMARY: Direct downloads with aggressive retry (most reliable)
   * Uses proper browser headers and compression handling
   */
  private async downloadImageWithRetry(url: string, maxRetries: number): Promise<DownloadResult> {
    let lastResult: DownloadResult = { buffer: null, error: 'No attempts made' };
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.downloadImage(url, attempt);
      
      if (result.buffer && result.buffer.length > 0) {
        logger.log(`✅ DIRECT SUCCESS (attempt ${attempt}): ${url.substring(0, 60)}`);
        return result;
      }
      
      lastResult = result;
      
      // Don't retry on invalid format - the content won't change
      if (result.failureType === 'invalid_format') {
        return result;
      }
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
    
    return lastResult;
  }

  /**
   * Download via localhost proxy - same way admin displays images
   * This bypasses external firewall/rate-limit issues
   */
  private async downloadViaLocalProxy(url: string): Promise<DownloadResult> {
    try {
      const safeBase64Encode = (str: string) => {
        const buf = Buffer.from(str, 'utf-8');
        return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      };
      
      const encodedUrl = safeBase64Encode(url);
      const proxyPort = process.env.PORT || '5000';
      const proxyUrl = `http://localhost:${proxyPort}/api/image/${encodedUrl}`;
      
      const response = await axios.get(proxyUrl, {
        responseType: 'arraybuffer',
        timeout: 8000,
        maxContentLength: 10 * 1024 * 1024,
        validateStatus: (status) => status >= 200 && status < 300
      });

      if (!response.data || response.data.length === 0) {
        return { buffer: null, error: 'Empty proxy response', failureType: 'download_failed' };
      }

      const buffer = Buffer.from(response.data);
      const magicCheck = this.checkMagicBytes(buffer);
      if (!magicCheck.isImage) {
        return { buffer: null, error: 'Proxy returned invalid image', failureType: 'invalid_format' };
      }

      return { buffer, statusCode: 200 };
    } catch (error: any) {
      return { buffer: null, error: `Proxy failed: ${error.message}`, failureType: 'download_failed' };
    }
  }

  /**
   * Download image from URL with proper HTTP validation
   */
  private async downloadImage(url: string, attempt: number = 1): Promise<DownloadResult> {
    try {
      const timeout = 5000 + (attempt * 3000); // 5s, 8s
      
      // Parse URL to get host for Referer header
      let referer = '';
      try {
        const urlObj = new URL(url);
        referer = `${urlObj.protocol}//${urlObj.host}/`;
      } catch {}
      
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: timeout,
        maxContentLength: 10 * 1024 * 1024,
        maxRedirects: 5,
        decompress: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': referer,
          'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'image',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'same-origin',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        validateStatus: (status) => status >= 200 && status < 300 // Only accept 2xx
      });

      const statusCode = response.status;
      const contentType = response.headers['content-type'] || '';
      const contentEncoding = response.headers['content-encoding'] || '';

      if (!response.data || response.data.length === 0) {
        return {
          buffer: null,
          error: 'Empty response body',
          failureType: 'download_failed',
          statusCode
        };
      }

      let buffer = Buffer.from(response.data);
      
      // Decompress if needed (in case axios didn't handle it)
      buffer = await this.decompressIfNeeded(buffer, contentEncoding);
      
      // Check magic bytes instead of Content-Type header (many servers lie about Content-Type)
      const magicCheck = this.checkMagicBytes(buffer);
      if (!magicCheck.isImage) {
        return {
          buffer: null,
          error: magicCheck.reason || `Invalid content: ${contentType.substring(0, 50)}`,
          failureType: 'invalid_format',
          statusCode,
          contentType
        };
      }

      return {
        buffer,
        statusCode,
        contentType
      };

    } catch (error: any) {
      let failureType: FailureType = 'download_failed';
      let errorMsg = error.message || 'Unknown download error';

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || errorMsg.includes('timeout')) {
        failureType = 'timeout';
        errorMsg = `Timeout after ${10 + (attempt * 5)}s`;
      } else if (error.response) {
        failureType = 'http_error';
        const status = error.response.status;
        errorMsg = `HTTP ${status}`;
        
        if (status === 404) errorMsg = 'HTTP 404 - Image not found';
        else if (status === 403) errorMsg = 'HTTP 403 - Access denied';
        else if (status === 500) errorMsg = 'HTTP 500 - Server error';
      } else if (error.code === 'ENOTFOUND') {
        errorMsg = 'DNS lookup failed - host not found';
      } else if (error.code === 'ECONNREFUSED') {
        errorMsg = 'Connection refused';
      }

      return {
        buffer: null,
        error: errorMsg,
        failureType,
        statusCode: error.response?.status
      };
    }
  }

  private getExtensionFromFormat(format?: string): string | null {
    if (!format) return null;
    const formatMap: Record<string, string> = {
      'jpeg': '.jpg',
      'jpg': '.jpg',
      'png': '.png',
      'webp': '.webp',
      'gif': '.gif',
      'tiff': '.tiff',
      'avif': '.avif',
      'heif': '.heif'
    };
    return formatMap[format] || null;
  }

  private getExtension(url: string): string {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      if (pathname.includes('.png')) return '.png';
      if (pathname.includes('.jpg') || pathname.includes('.jpeg')) return '.jpg';
      if (pathname.includes('.gif')) return '.gif';
      if (pathname.includes('.webp')) return '.webp';
      if (pathname.includes('.svg')) return '.svg';
      if (pathname.includes('.ico')) return '.ico';
    } catch {}
    return '.png';
  }

  /**
   * Get the logo URL for a station
   */
  static getLogoUrl(station: any, size: 48 | 96 | 256 = 256): string {
    if (station.logoAssets?.status === 'completed' && station.logoAssets.folder) {
      const filename = station.logoAssets.webp256 || station.logoAssets[`webp${size}`];
      if (filename) {
        return `/station-logos/${station.logoAssets.folder}/${filename}`;
      }
    }

    if (station.localImagePath) {
      return `/station-images/${station.localImagePath}`;
    }

    if (station.favicon && station.favicon.startsWith('http')) {
      return station.favicon;
    }

    return '/images/no-image.webp';
  }

  /**
   * Delete logo folder for a station
   */
  async deleteLogos(stationId: string, slug: string): Promise<void> {
    try {
      const folderName = this.getFolderName(slug, stationId);
      if (isS3Configured()) {
        await deleteFolderFromS3(`station-logos/${folderName}/`);
      } else {
        const folderPath = path.join(LOGOS_DIR, folderName);
        await fs.rm(folderPath, { recursive: true, force: true });
        logger.log(`🗑️ Deleted local logo folder: ${folderName}`);
      }
    } catch (error) {
      // Ignore errors
    }
  }
}

export const logoProcessor = new LogoProcessor();

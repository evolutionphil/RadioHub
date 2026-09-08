import express, { type Express, type RequestHandler } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isS3Configured, uploadToS3 } from '../services/s3-storage';
import { logger } from '../utils/logger';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const formats: Record<string, { extension: string; contentType: string }> = {
  jpeg: { extension: 'jpg', contentType: 'image/jpeg' },
  png: { extension: 'png', contentType: 'image/png' },
  webp: { extension: 'webp', contentType: 'image/webp' },
  gif: { extension: 'gif', contentType: 'image/gif' },
};

export function registerAdvertisementUploadRoute(
  app: Express,
  requireAdmin: RequestHandler,
  options: { uploadsDirectory?: string; production?: boolean } = {},
): void {
  const uploadsDirectory = options.uploadsDirectory || path.resolve(process.cwd(), 'public', 'uploads');
  const production = options.production ?? process.env.NODE_ENV === 'production';
  // Retain existing local URLs where files still exist. Production uploads
  // below never use this ephemeral directory for newly accepted images.
  app.use('/uploads', express.static(uploadsDirectory));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1 },
    fileFilter: (_req, file, done) => {
      if (Object.values(formats).some(format => format.contentType === file.mimetype)) done(null, true);
      else done(new Error('Only JPEG, PNG, WebP and GIF images are allowed'));
    },
  }).single('image');

  // Register synchronously so the route is available when startup completes;
  // there is no detached setup promise or unhandled initialization rejection.
  app.post('/api/admin/advertisements/upload', requireAdmin, (req, res, next) => {
    if (production && !isS3Configured()) {
      res.status(503).json({ error: 'Persistent advertisement image storage is not configured' });
      return;
    }
    upload(req, res, error => {
      if (!error) return next();
      res.status(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        .json({ error: error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
          ? 'Image must not exceed 5 MB' : 'Upload one JPEG, PNG, WebP or GIF image' });
    });
  }, async (req, res) => {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    let format: { extension: string; contentType: string };
    try {
      const sharp = (await import('sharp')).default;
      const input = sharp(req.file.buffer, { animated: true, limitInputPixels: MAX_PIXELS, failOn: 'warning' });
      const metadata = await input.metadata();
      const detected = metadata.format && formats[metadata.format];
      const pixels = (metadata.width || 0) * (metadata.pageHeight || metadata.height || 0) * (metadata.pages || 1);
      if (!detected || !pixels || pixels > MAX_PIXELS) throw new Error('Unsupported image or dimensions');
      // metadata alone can accept a truncated header. Decode within the pixel
      // limit, but store the original bytes so animated GIFs are not flattened.
      await input.stats();
      format = detected;
    } catch {
      res.status(400).json({ error: 'Invalid image; use JPEG, PNG, WebP or GIF with at most 16 million pixels' });
      return;
    }
    const filename = `ad-${randomUUID()}.${format.extension}`;
    try {
      let imageUrl: string;
      if (isS3Configured()) {
        imageUrl = await uploadToS3(`advertisements/${filename}`, req.file.buffer, format.contentType);
      } else if (!production) {
        await mkdir(uploadsDirectory, { recursive: true });
        await writeFile(path.join(uploadsDirectory, filename), req.file.buffer, { flag: 'wx' });
        imageUrl = `/uploads/${filename}`;
      } else {
        res.status(503).json({ error: 'Persistent advertisement image storage is not configured' });
        return;
      }
      res.json({ imageUrl });
    } catch (error) {
      logger.warn('Advertisement image upload failed:', error instanceof Error ? error.message : 'unknown');
      res.status(503).json({ error: 'Advertisement image storage is temporarily unavailable' });
    }
  });
}

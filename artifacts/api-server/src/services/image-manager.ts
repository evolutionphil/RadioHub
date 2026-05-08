import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { logger } from '../utils/logger';

export class ImageManager {
  private imagesDir: string;

  constructor() {
    this.imagesDir = path.join(process.cwd(), 'public', 'station-images');
    this.ensureImagesDirectory();
  }

  private async ensureImagesDirectory(): Promise<void> {
    try {
      await fs.access(this.imagesDir);
    } catch {
      await fs.mkdir(this.imagesDir, { recursive: true });
    }
  }

  private sanitizeFilename(name: string): string {
    // Remove or replace invalid characters for filenames
    return name
      .replace(/[^a-zA-Z0-9\-_\s]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .substring(0, 100); // Limit length
  }

  private async getUniqueFilename(baseName: string, extension: string): Promise<string> {
    const sanitizedBase = this.sanitizeFilename(baseName);
    let filename = `${sanitizedBase}${extension}`;
    let counter = 1;

    // Check if file exists and increment counter if needed
    while (true) {
      try {
        await fs.access(path.join(this.imagesDir, filename));
        filename = `${sanitizedBase}${counter}${extension}`;
        counter++;
      } catch {
        // File doesn't exist, we can use this filename
        break;
      }
    }

    return filename;
  }

  private getImageExtension(url: string, contentType?: string): string {
    // Try to get extension from content type first
    if (contentType) {
      if (contentType.includes('png')) return '.png';
      if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
      if (contentType.includes('gif')) return '.gif';
      if (contentType.includes('webp')) return '.webp';
      if (contentType.includes('svg')) return '.svg';
    }

    // Fall back to URL extension
    const urlExtension = path.extname(new URL(url).pathname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(urlExtension)) {
      return urlExtension;
    }

    // Default to PNG if we can't determine
    return '.png';
  }

  async downloadStationImage(stationName: string, imageUrl: string): Promise<string | null> {
    if (!imageUrl || !imageUrl.startsWith('http')) {
      return null;
    }

    try {
      // First, make a HEAD request to check if the image exists and get content type
      const headResponse = await axios.head(imageUrl, { 
        timeout: 10000,
        validateStatus: (status) => status < 400
      });

      const contentType = headResponse.headers['content-type'];
      const extension = this.getImageExtension(imageUrl, typeof contentType === 'string' ? contentType : undefined);
      
      // Generate unique filename
      const filename = await this.getUniqueFilename(stationName, extension);
      const filePath = path.join(this.imagesDir, filename);

      // Download the image
      const response = await axios.get(imageUrl, {
        responseType: 'stream',
        timeout: 30000,
        maxContentLength: 5 * 1024 * 1024, // 5MB limit
      });

      const writeStream = createWriteStream(filePath);
      await pipeline(response.data, writeStream);

      // Downloaded image for station
      return filename;

    } catch (error) {
      // console.error(`Failed to download image for station "${stationName}" from ${imageUrl}:`, error);
      return null;
    }
  }

  async deleteStationImage(filename: string): Promise<void> {
    if (!filename) return;

    try {
      const filePath = path.join(this.imagesDir, filename);
      await fs.unlink(filePath);
      // console.log(`Deleted station image: ${filename}`);
    } catch (error) {
      // console.error(`Failed to delete station image ${filename}:`, error);
    }
  }

  async getImagePath(filename: string): Promise<string | null> {
    if (!filename) return null;

    try {
      const filePath = path.join(this.imagesDir, filename);
      await fs.access(filePath);
      return `/station-images/${filename}`;
    } catch {
      return null;
    }
  }

  async cleanupUnusedImages(activeFilenames: string[]): Promise<void> {
    try {
      const files = await fs.readdir(this.imagesDir);
      const activeSet = new Set(activeFilenames);

      for (const file of files) {
        if (!activeSet.has(file)) {
          await this.deleteStationImage(file);
        }
      }
    } catch (error) {
      // console.error('Failed to cleanup unused images:', error);
    }
  }
}

export const imageManager = new ImageManager();

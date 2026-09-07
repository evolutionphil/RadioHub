import type { Response } from 'express';

/** Invalid routes and absent catalogue slices are 404, not permanent deletions. */
export function sendSeoNotFound(res: Response, body: string): void {
  res.status(404).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, follow' }).send(body);
}

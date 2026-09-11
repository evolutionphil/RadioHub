const platforms = new Set(['facebook', 'instagram', 'twitter', 'linkedin', 'whatsapp', 'telegram', 'reddit', 'pinterest', 'youtube', 'tiktok']);
export function socialLinkInput(input: unknown, partial = false): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A social link object is required');
  const body = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  if (!partial || body.platform !== undefined) {
    if (typeof body.platform !== 'string' || !platforms.has(body.platform)) throw new Error('Unsupported social platform');
    result.platform = body.platform;
  }
  if (!partial || body.url !== undefined) {
    if (typeof body.url !== 'string' || body.url.trim().length > 2048) throw new Error('A valid HTTP(S) URL is required');
    let url: URL;
    try { url = new URL(body.url.trim()); } catch { throw new Error('A valid HTTP(S) URL is required'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('A valid HTTP(S) URL without credentials is required');
    result.url = body.url.trim();
  }
  if (body.position !== undefined) {
    if (typeof body.position !== 'number' || !Number.isSafeInteger(body.position) || body.position < 0 || body.position > 10000) throw new Error('Position must be an integer between 0 and 10000');
    result.position = body.position;
  } else if (!partial) result.position = 0;
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') throw new Error('Active must be a boolean');
    result.isActive = body.isActive;
  } else if (!partial) result.isActive = true;
  if (!Object.keys(result).length) throw new Error('No supported changes provided');
  return result;
}

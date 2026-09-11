type Validation<T> = { value: T; error?: never } | { error: string; value?: never };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateSubscriptionPlanUpdate(body: unknown): Validation<Record<string, string | number | boolean>> {
  if (!record(body)) return { error: 'Expected a plan settings object' };
  const value: Record<string, string | number | boolean> = {};
  for (const field of ['stripePriceId', 'paddlePriceId', 'label', 'description', 'currency'] as const) {
    if (!(field in body)) continue;
    if (typeof body[field] !== 'string') return { error: `${field} must be a string` };
    const text = (body[field] as string).trim();
    if (text.length > (field === 'description' ? 2000 : field === 'label' ? 200 : 128)) return { error: `${field} is too long` };
    if (field === 'currency' && !/^[a-z]{3}$/i.test(text)) return { error: 'currency must be a three-letter currency code' };
    if (field === 'stripePriceId' && text && !/^price_[a-z0-9]+$/i.test(text)) return { error: 'Invalid Stripe price ID' };
    if (field === 'paddlePriceId' && text && !/^pri_[a-z0-9]+$/i.test(text)) return { error: 'Invalid Paddle price ID' };
    value[field] = field === 'currency' ? text.toLowerCase() : text;
  }
  if ('amount' in body) {
    if (!Number.isSafeInteger(body.amount) || Number(body.amount) < 0) return { error: 'amount must be a non-negative integer in the smallest currency unit' };
    value.amount = body.amount as number;
  }
  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') return { error: 'isActive must be a boolean' };
    value.isActive = body.isActive;
  }
  if (!Object.keys(value).length) return { error: 'No supported plan settings supplied' };
  return { value };
}

export function validateTvVersionUpdate(body: unknown): Validation<Record<'latest' | 'minimum' | 'releaseNotes' | 'storeUrl', Record<string, string>>> {
  if (!record(body) || !record(body.latest)) return { error: '`latest` object is required' };
  const value = { latest: {}, minimum: {}, releaseNotes: {}, storeUrl: {} } as Record<'latest' | 'minimum' | 'releaseNotes' | 'storeUrl', Record<string, string>>;
  for (const field of ['latest', 'minimum', 'releaseNotes', 'storeUrl'] as const) {
    const map = body[field] === undefined ? {} : body[field];
    if (!record(map) || Object.keys(map).length > 100) return { error: `${field} must be a bounded string map` };
    for (const [key, raw] of Object.entries(map)) {
      if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || typeof raw !== 'string') return { error: `Invalid ${field} entry` };
      const text = raw.trim();
      if (text.length > (field === 'releaseNotes' ? 4000 : field === 'storeUrl' ? 2048 : 64)) return { error: `${field}.${key} is too long` };
      if ((field === 'latest' || field === 'minimum') && text && !/^\d+(?:\.\d+){0,3}(?:[-+][a-z0-9.-]+)?$/i.test(text)) return { error: `${field}.${key} must be a version number` };
      if (field === 'storeUrl' && text) {
        try {
          const url = new URL(text);
          if (!['https:', 'http:', 'market:', 'itms-apps:', 'macappstore:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
        } catch { return { error: `${field}.${key} must be a valid web or app-store URL` }; }
      }
      value[field][key] = text;
    }
  }
  return { value };
}

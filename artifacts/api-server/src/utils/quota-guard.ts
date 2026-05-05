let quotaExceeded = false;
let quotaExceededAt = 0;
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000;
let lastQuotaLog = 0;
const QUOTA_LOG_INTERVAL = 60 * 1000;

export function isQuotaExceeded(): boolean {
  if (!quotaExceeded) return false;
  if (Date.now() - quotaExceededAt > QUOTA_COOLDOWN_MS) {
    quotaExceeded = false;
    console.log('📦 MongoDB quota guard reset — retrying writes');
    return false;
  }
  return true;
}

export function markQuotaExceeded(): void {
  quotaExceeded = true;
  quotaExceededAt = Date.now();
}

export function isQuotaError(error: any): boolean {
  if (!error) return false;
  const msg = (error?.message || error?.errmsg || '').toLowerCase();
  return msg.includes('over your space quota') ||
    msg.includes('quota') ||
    error?.code === 8000 ||
    error?.codeName === 'AtlasError';
}

export function handleQuotaError(context: string, error: any): void {
  if (isQuotaError(error)) {
    markQuotaExceeded();
    const now = Date.now();
    if (now - lastQuotaLog > QUOTA_LOG_INTERVAL) {
      lastQuotaLog = now;
      console.warn(`⚠️ MongoDB quota exceeded — writes paused for 10min (${context})`);
    }
    return;
  }
  console.error(`❌ ${context}:`, error?.message || error);
}

export async function safeWrite<T>(
  context: string,
  fn: () => Promise<T>,
  optional: boolean = false
): Promise<T | null> {
  if (isQuotaExceeded()) return null;
  try {
    return await fn();
  } catch (error: any) {
    if (isQuotaError(error)) {
      handleQuotaError(context, error);
      return null;
    }
    if (optional) {
      console.error(`❌ ${context} (optional, skipped):`, error?.message || error);
      return null;
    }
    throw error;
  }
}

export function getQuotaStatus() {
  const active = isQuotaExceeded();
  return {
    quotaExceeded: active,
    quotaExceededAt: active ? new Date(quotaExceededAt).toISOString() : null,
    cooldownRemainingMs: active ? Math.max(0, QUOTA_COOLDOWN_MS - (Date.now() - quotaExceededAt)) : 0
  };
}

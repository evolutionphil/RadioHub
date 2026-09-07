export interface MigrationBatchLimits {
  readonly batchSize: number;
  readonly maxBytes: number;
}

const MIN_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 1_000;
const MIN_BATCH_BYTES = 64 * 1_024;
const MAX_BATCH_BYTES = 16 * 1_024 * 1_024;

function boundedInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const text = value.trim();
  // Do not use parseInt: "invalid" becomes NaN and "250oops" silently
  // succeeds. Either can defeat the capture loop's intended memory bound.
  if (!/^[+-]?\d+$/.test(text)) {
    throw new Error(`${name} must be a finite integer`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a finite safe integer`);
  }
  return Math.max(minimum, Math.min(maximum, parsed));
}

/** Validate operator settings before opening either database connection. */
export function migrationBatchLimits(
  environment: Record<string, string | undefined> = process.env,
): MigrationBatchLimits {
  return {
    batchSize: boundedInteger(
      environment.MIGRATION_BATCH_SIZE,
      "MIGRATION_BATCH_SIZE",
      250,
      MIN_BATCH_SIZE,
      MAX_BATCH_SIZE,
    ),
    maxBytes: boundedInteger(
      environment.MIGRATION_BATCH_MAX_BYTES,
      "MIGRATION_BATCH_MAX_BYTES",
      4 * 1_024 * 1_024,
      MIN_BATCH_BYTES,
      MAX_BATCH_BYTES,
    ),
  };
}

function nonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

/**
 * Before appending a document, flush a non-empty batch when it is already
 * full or the next document would exceed its byte budget. Empty batches
 * accept one document even when it alone exceeds the budget: never discard
 * or split a source document. Call again after appending with nextBytes=0
 * to flush full batches and oversized single documents immediately.
 */
export function shouldFlushMigrationBatch(
  currentCount: number,
  currentBytes: number,
  nextBytes: number,
  limits: MigrationBatchLimits,
): boolean {
  nonNegativeInteger(currentCount, "currentCount");
  nonNegativeInteger(currentBytes, "currentBytes");
  nonNegativeInteger(nextBytes, "nextBytes");
  if (
    !Number.isSafeInteger(limits.batchSize) ||
    limits.batchSize < MIN_BATCH_SIZE ||
    limits.batchSize > MAX_BATCH_SIZE ||
    !Number.isSafeInteger(limits.maxBytes) ||
    limits.maxBytes < MIN_BATCH_BYTES ||
    limits.maxBytes > MAX_BATCH_BYTES
  ) {
    throw new Error("Migration batch limits must be validated finite integers within their supported ranges");
  }
  if (currentCount === 0) return false;
  return currentCount >= limits.batchSize ||
    currentBytes >= limits.maxBytes ||
    // Subtract rather than adding two byte counts that could overflow the
    // safe-integer range when a document is larger than the normal budget.
    nextBytes > limits.maxBytes - currentBytes;
}

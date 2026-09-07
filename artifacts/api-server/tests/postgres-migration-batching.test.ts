import { test } from "node:test";
import assert from "node:assert/strict";
import {
  migrationBatchLimits,
  shouldFlushMigrationBatch,
} from "../../../lib/legacy-migration/src/migration-batching.ts";

test("migration batching defaults to 250 documents and a 4 MiB serialized byte budget", () => {
  assert.deepEqual(migrationBatchLimits({}), {
    batchSize: 250,
    maxBytes: 4 * 1_024 * 1_024,
  });
});

test("migration batch count accepts complete integers and clamps to 10 through 1000", () => {
  for (const [value, expected] of [
    ["-1", 10], ["0", 10], ["9", 10], ["10", 10],
    [" 250 ", 250], ["+300", 300], ["1000", 1_000], ["1001", 1_000],
  ] as const) {
    assert.equal(migrationBatchLimits({ MIGRATION_BATCH_SIZE: value }).batchSize, expected, value);
  }
});

test("malformed batch counts fail closed instead of disabling the flush threshold", () => {
  for (const value of [
    "", " ", "abc", "NaN", "Infinity", "-Infinity", "250oops",
    "250.5", "250.0", "1e3", "0x100", "1_000", "9007199254740992",
  ]) {
    assert.throws(
      () => migrationBatchLimits({ MIGRATION_BATCH_SIZE: value }),
      /MIGRATION_BATCH_SIZE must be a finite/,
      value,
    );
  }
});

test("migration byte budget accepts complete integers and clamps to 64 KiB through 16 MiB", () => {
  for (const [value, expected] of [
    ["-1", 65_536], ["0", 65_536], ["65535", 65_536], ["65536", 65_536],
    ["4194304", 4_194_304], ["16777216", 16_777_216], ["16777217", 16_777_216],
  ] as const) {
    assert.equal(migrationBatchLimits({ MIGRATION_BATCH_MAX_BYTES: value }).maxBytes, expected, value);
  }
});

test("malformed byte budgets are rejected before any capture can run", () => {
  for (const value of ["", "NaN", "Infinity", "4MB", "65536bytes", "1.5", "9007199254740992"]) {
    assert.throws(
      () => migrationBatchLimits({ MIGRATION_BATCH_MAX_BYTES: value }),
      /MIGRATION_BATCH_MAX_BYTES must be a finite/,
      value,
    );
  }
});

test("document count bounds a batch even when its byte count is tiny", () => {
  const limits = migrationBatchLimits({ MIGRATION_BATCH_SIZE: "10" });
  assert.equal(shouldFlushMigrationBatch(9, 9, 1, limits), false);
  assert.equal(shouldFlushMigrationBatch(10, 10, 0, limits), true);
  assert.equal(shouldFlushMigrationBatch(10, 10, 1, limits), true);
});

test("next document crossing the byte budget flushes the current batch first", () => {
  const limits = migrationBatchLimits({ MIGRATION_BATCH_MAX_BYTES: "65536" });
  assert.equal(shouldFlushMigrationBatch(2, 50_000, 15_536, limits), false);
  assert.equal(shouldFlushMigrationBatch(2, 50_000, 15_537, limits), true);
  assert.equal(shouldFlushMigrationBatch(3, 65_536, 0, limits), true);
});

test("an oversized document is allowed alone and flushed immediately after append", () => {
  const limits = migrationBatchLimits({ MIGRATION_BATCH_MAX_BYTES: "65536" });
  const oversizedBytes = 128 * 1_024;
  assert.equal(shouldFlushMigrationBatch(1, 512, oversizedBytes, limits), true);
  assert.equal(shouldFlushMigrationBatch(0, 0, oversizedBytes, limits), false);
  assert.equal(shouldFlushMigrationBatch(1, oversizedBytes, 0, limits), true);
});

test("count and byte checks retain every document and isolate oversized documents", () => {
  const limits = migrationBatchLimits({
    MIGRATION_BATCH_SIZE: "10",
    MIGRATION_BATCH_MAX_BYTES: "65536",
  });
  const documents = [10_000, 20_000, 100_000, 30_000, 40_000, ...Array<number>(12).fill(1)];
  const batches: number[][] = [];
  let batch: number[] = [];
  let bytes = 0;
  const flush = () => { batches.push(batch); batch = []; bytes = 0; };
  for (const documentBytes of documents) {
    if (shouldFlushMigrationBatch(batch.length, bytes, documentBytes, limits)) flush();
    batch.push(documentBytes);
    bytes += documentBytes;
    if (shouldFlushMigrationBatch(batch.length, bytes, 0, limits)) flush();
  }
  if (batch.length) flush();
  assert.deepEqual(batches.flat(), documents);
  assert.deepEqual(batches[1], [100_000]);
  for (const captured of batches) {
    assert.ok(captured.length <= limits.batchSize);
    assert.ok(captured.length === 1 || captured.reduce((sum, size) => sum + size, 0) <= limits.maxBytes);
  }
});

test("flush checks reject non-finite, negative, fractional and unsafe byte or document counts", () => {
  const limits = migrationBatchLimits({});
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => shouldFlushMigrationBatch(invalid, 0, 0, limits), /currentCount/);
    assert.throws(() => shouldFlushMigrationBatch(1, invalid, 0, limits), /currentBytes/);
    assert.throws(() => shouldFlushMigrationBatch(1, 0, invalid, limits), /nextBytes/);
  }
});

test("flush checks reject invalid caller-provided limits rather than silently growing a batch", () => {
  for (const limits of [
    { batchSize: Number.NaN, maxBytes: 65_536 },
    { batchSize: 10, maxBytes: Number.POSITIVE_INFINITY },
    { batchSize: 0, maxBytes: 65_536 },
    { batchSize: 1_001, maxBytes: 65_536 },
    { batchSize: 10, maxBytes: 0 },
    { batchSize: 10, maxBytes: 16_777_217 },
  ]) {
    assert.throws(() => shouldFlushMigrationBatch(1, 1, 1, limits), /limits must be validated/);
  }
});

test("large safe-integer byte counts cannot overflow into an unchecked batch", () => {
  const limits = migrationBatchLimits({});
  assert.equal(shouldFlushMigrationBatch(1, 1, Number.MAX_SAFE_INTEGER, limits), true);
  assert.equal(shouldFlushMigrationBatch(1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, limits), true);
});

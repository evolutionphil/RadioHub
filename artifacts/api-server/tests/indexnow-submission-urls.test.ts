/**
 * Task #336 — guard the IndexNowSubmissionUrls schema. The collection is
 * what backs the admin "Show all URLs for this night" view, so a regression
 * in its shape (missing TTL, missing logId index, missing fields) would
 * silently break the audit trail or grow the collection unbounded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IndexNowSubmissionUrls,
  INDEXNOW_SUBMISSION_URLS_RETENTION_DAYS,
} from '@workspace/db-shared/mongo-schemas';

test('IndexNowSubmissionUrls schema declares the fields we depend on', () => {
  const paths = IndexNowSubmissionUrls.schema.paths;
  for (const field of ['logId', 'timestamp', 'host', 'trigger', 'urls', 'urlCount', 'expiresAt']) {
    assert.ok(paths[field], `expected schema path '${field}' to exist`);
  }
  assert.equal(paths.logId.instance, 'ObjectId');
  assert.equal(paths.urls.instance, 'Array');
  assert.equal(paths.urlCount.instance, 'Number');
  assert.equal(paths.expiresAt.instance, 'Date');
});

test('IndexNowSubmissionUrls retention is bounded by a TTL index', () => {
  const indexes = IndexNowSubmissionUrls.schema.indexes();
  const ttl = indexes.find(([keys, opts]) =>
    (keys as Record<string, unknown>).expiresAt === 1 &&
    (opts as { expireAfterSeconds?: number } | undefined)?.expireAfterSeconds === 0,
  );
  assert.ok(ttl, 'expected a TTL index on { expiresAt: 1 } with expireAfterSeconds=0');

  const uniqueLogId = indexes.find(([keys, opts]) =>
    (keys as Record<string, unknown>).logId === 1 &&
    (opts as { unique?: boolean } | undefined)?.unique === true,
  );
  assert.ok(uniqueLogId, 'expected a unique index on logId so each log row maps to one URL doc');
});

test('IndexNowSubmissionUrls retention window is at least 7 days', () => {
  // Sanity guard so a future tweak doesn't accidentally drop retention to
  // a value too short to cover a typical "last week" admin investigation.
  assert.ok(
    INDEXNOW_SUBMISSION_URLS_RETENTION_DAYS >= 7,
    `retention should be >= 7 days, got ${INDEXNOW_SUBMISSION_URLS_RETENTION_DAYS}`,
  );
});

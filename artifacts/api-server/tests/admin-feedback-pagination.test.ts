import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

const calls: Array<{ sql: string; values?: unknown[] }> = [];
const groups = [
  { status: 'open', type: 'bug', count: 120 },
  { status: 'open', type: 'feature', count: 15 },
  { status: 'resolved', type: 'bug', count: 80 },
];
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => ({
  query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    return { rows: sql.includes('GROUP BY') ? groups : [{ id: 'older-report', subject: 'Older report' }] };
  },
}) } });
const { pgListFeedback } = await import('../src/data/postgres-content-store');
beforeEach(() => { calls.length = 0; });

test('feedback queue uses a bounded database offset and filtered total without changing global statistics', async () => {
  const result = await pgListFeedback({ status: 'open', type: 'bug' }, 50, 3);
  assert.match(calls[0].sql, /ORDER BY created_at DESC,id LIMIT \$3 OFFSET \$4/);
  assert.deepEqual(calls[0].values, ['open', 'bug', 50, 100]);
  assert.equal(result.feedback[0]._id, 'older-report');
  assert.equal(result.total, 120);
  assert.equal(result.page, 3);
  assert.equal(result.limit, 50);
  assert.equal(result.totalPages, 3);
  assert.deepEqual(result.stats, { total: 215, open: 135, inProgress: 0, resolved: 80, closed: 0, byType: { bug: 200, feature: 15, general: 0 } });
});

test('pagination retains the historical default and bounds malformed or excessive values', async () => {
  const defaults = await pgListFeedback();
  assert.deepEqual(calls[0].values, [null, null, 200, 0]);
  assert.equal(defaults.total, 215); assert.equal(defaults.totalPages, 2);
  calls.length = 0;
  const bounded = await pgListFeedback({ status: 'closed' }, Infinity, -9);
  assert.deepEqual(calls[0].values, ['closed', null, 500, 0]);
  assert.equal(bounded.total, 0); assert.equal(bounded.totalPages, 1);
});

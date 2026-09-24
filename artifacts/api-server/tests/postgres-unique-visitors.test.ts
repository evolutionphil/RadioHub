import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { pgTrackQualifiedVisitor, pgUniqueVisitorDetails, pgUniqueVisitorMetrics, pgPruneQualifiedVisitors } from '../src/data/postgres-visitor-metrics';
import type { VisitorContext } from '../src/middleware/visitor-client-context';

const unknown: VisitorContext = { countryCode: null, channel: 'unknown', platform: 'unknown', deviceType: 'unknown',
  os: null, browser: null, contextSource: 'unknown' };
const web: VisitorContext = { countryCode: 'DE', channel: 'web', platform: 'web', deviceType: 'desktop',
  os: 'Windows', browser: 'Chrome', contextSource: 'user-agent' };

test('details timeout is transaction-local and success releases the client after one snapshot and commit', async () => {
  const statements: string[] = [], releases: boolean[] = [];
  const timestamp = '2026-09-23T12:00:00.000Z';
  const pool = { connect: async () => ({ query: async (query: any) => {
    statements.push(query.text); assert.equal(query.query_timeout, 3000);
    return { rows: query.text.startsWith('WITH windowed') ? [{ measured_at: timestamp, started_at: timestamp,
      dimensions_started_at: timestamp, total_visitors: 0, matched_visitors: 0,
      countries: [], channels: [], platforms: [], devices: [], visitors: [] }] : [] };
  }, release: (destroy: boolean) => releases.push(destroy) }) } as any;
  assert.equal((await pgUniqueVisitorDetails({ window: 'active', page: 1, limit: 25 }, pool)).totalVisitors, 0);
  assert.equal(statements.length, 3);
  assert.equal(statements[0], "BEGIN READ ONLY; SET LOCAL statement_timeout='3s'");
  assert.ok(statements[1].startsWith('WITH windowed'));
  assert.equal(statements[2], 'COMMIT'); assert.deepEqual(releases, [false]);
});

test('details cancellation rolls back and releases; failed rollback destroys the client without hiding original error', async () => {
  for (const failureAt of ['BEGIN', 'WITH', 'COMMIT']) for (const rollbackFails of [false, true]) {
    const statements: string[] = [], releases: boolean[] = [];
    const original = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    const pool = { connect: async () => ({ query: async (query: any) => {
      statements.push(query.text); assert.equal(query.query_timeout, 3000);
      if (query.text.startsWith(failureAt)) throw original;
      if (query.text === 'ROLLBACK' && rollbackFails) throw new Error('connection gone');
      return { rows: [] };
    }, release: (destroy: boolean) => releases.push(destroy) }) } as any;
    await assert.rejects(pgUniqueVisitorDetails({ window: 'active', page: 1, limit: 25 }, pool), error => error === original);
    assert.equal(statements.at(-1), 'ROLLBACK'); assert.deepEqual(releases, [rollbackFails]);
  }
});

test('details respects connection acquisition errors without opening a transaction or fabricating counts', async () => {
  const error = new Error('connection acquisition timeout');
  await assert.rejects(pgUniqueVisitorDetails({ window: 'active', page: 1, limit: 25 }, {
    connect: async () => { throw error; },
  } as any), actual => actual === error);
});

test('qualified unique-IP migration, counters and retention use actual PostgreSQL semantics',
  { skip: !process.env.RADIOHUB_PGLITE_ENTRY, timeout: 90_000 }, async t => {
    const { PGlite } = await import(pathToFileURL(process.env.RADIOHUB_PGLITE_ENTRY!).href);
    const db = await PGlite.create();
    const pool = { query: async (input: string | { text: string; values?: unknown[] }, values?: unknown[]) => {
      const sql = typeof input === 'string' ? input : input.text;
      const parameters = values ?? (typeof input === 'string' ? undefined : input.values);
      if (sql.startsWith('BEGIN READ ONLY;')) { await db.exec(sql); return { rows: [], rowCount: 0 }; }
      const result = await db.query(sql, parameters);
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    }, connect: async () => ({ query: (input: any) => pool.query(input), release: () => {} }) } as any;
    try {
      await db.exec(`CREATE TABLE runtime_app_state(key text PRIMARY KEY,value jsonb NOT NULL);
        CREATE TABLE visitor_sessions(ip_address text PRIMARY KEY,last_active_date timestamptz);
        INSERT INTO visitor_sessions VALUES('198.51.100.99',now())`);
      const migration = await readFile(new URL('../../../lib/db/migrations/0037_qualified_unique_visitors.sql', import.meta.url), 'utf8');
      await db.exec(`BEGIN;${migration}COMMIT;`);
      await db.exec(await readFile(new URL('../../../lib/db/migrations/0040_visitor_activity.sql', import.meta.url), 'utf8'));
      await t.test('new series starts at a persisted cutover, never copies legacy bot/admin records', async () => {
        const metrics = await pgUniqueVisitorMetrics(pool);
        assert.equal(metrics.activeVisitors, 0); assert.equal(metrics.todayVisitors, 0); assert.equal(metrics.weekVisitors, 0);
        assert.equal(metrics.identity, 'unique-ip'); assert.equal(metrics.timezone, 'Europe/Berlin');
        assert.ok(Date.parse(metrics.collectionStartedAt) <= Date.parse(metrics.computedAt));
        assert.equal((await db.query('SELECT count(*)::int n FROM visitor_sessions')).rows[0].n, 1);
      });
      await t.test('dimensions start at a separate persisted cutover without inventing historical context', async () => {
        await db.exec("INSERT INTO qualified_visitor_presence(ip_address) VALUES('198.51.100.11')");
        const dimensionsMigration = await readFile(new URL('../../../lib/db/migrations/0038_qualified_visitor_dimensions.sql', import.meta.url), 'utf8');
        await db.exec(`BEGIN;${dimensionsMigration}COMMIT;`);
        const details = await pgUniqueVisitorDetails({ window: 'active', page: 1, limit: 25 }, pool);
        assert.equal(details.totalVisitors, 1);
        assert.ok(Date.parse(details.collectionStartedAt) <= Date.parse(details.dimensionsStartedAt));
        assert.ok(Date.parse(details.dimensionsStartedAt) <= Date.parse(details.computedAt));
        assert.deepEqual(details.visitors[0], { ...unknown, activityId: null, maskedIp: '198.51.100.0/24',
          firstSeenAt: details.visitors[0].firstSeenAt, lastSeenAt: details.visitors[0].lastSeenAt, contextCollectedAt: null });
        for (const breakdown of Object.values(details.breakdowns)) assert.deepEqual(breakdown, [{ value: 'unknown', count: 1 }]);
        assert.equal((await db.query('SELECT count(*)::int n FROM visitor_sessions')).rows[0].n, 1);
        await db.exec('TRUNCATE qualified_visitor_presence');
      });
      await t.test('repeated requests and canonical IPv6 spellings each count once', async () => {
        await pgTrackQualifiedVisitor('198.51.100.1', unknown, pool);
        const first = (await db.query("SELECT first_seen_at FROM qualified_visitor_presence WHERE ip_address='198.51.100.1'")).rows[0].first_seen_at;
        for (let i = 0; i < 5; i++) await pgTrackQualifiedVisitor('198.51.100.1', web, pool);
        await pgTrackQualifiedVisitor('2001:db8:0:0:0:0:0:1', unknown, pool);
        await pgTrackQualifiedVisitor('2001:DB8::1', unknown, pool);
        const metrics = await pgUniqueVisitorMetrics(pool);
        assert.equal(metrics.activeVisitors, 2); assert.equal(metrics.todayVisitors, 2); assert.equal(metrics.weekVisitors, 2);
        assert.deepEqual((await db.query("SELECT first_seen_at FROM qualified_visitor_presence WHERE ip_address='198.51.100.1'")).rows[0].first_seen_at, first);
        const details = await pgUniqueVisitorDetails({ window: 'active', page: 1, limit: 25, country: 'DE' }, pool);
        assert.equal(details.totalVisitors, 2); assert.equal(details.matchedVisitors, 1);
        assert.equal(details.visitors[0].channel, 'web'); assert.equal(details.visitors[0].os, 'Windows');
        assert.equal(details.visitors[0].contextCollectedAt, details.visitors[0].lastSeenAt);
        assert.deepEqual(details.breakdowns.countries, [{ value: 'DE', count: 1 }, { value: 'unknown', count: 1 }]);
        // Latest-request attribution replaces known values with unknown, rather than retaining invented certainty.
        await pgTrackQualifiedVisitor('198.51.100.1', unknown, pool);
        const latest = await pgUniqueVisitorDetails({ window: 'active', page: 1, limit: 25 }, pool);
        assert.equal(latest.totalVisitors, 2); assert.equal(latest.visitors[0].countryCode, null);
        await assert.rejects(pgTrackQualifiedVisitor('unknown', unknown, pool));
        await assert.rejects(pgTrackQualifiedVisitor('198.51.100.0/24', unknown, pool));
        await assert.rejects(pgTrackQualifiedVisitor('198.51.100.3', { ...web, browser: 'x'.repeat(65) }, pool));
        await assert.rejects(pgTrackQualifiedVisitor('198.51.100.3', { ...web, platform: 'made-up' } as any, pool));
      });
      await t.test('active, Berlin calendar day and rolling seven-day windows are separate', async () => {
        await db.exec(`TRUNCATE qualified_visitor_presence;
          INSERT INTO qualified_visitor_presence(ip_address,last_seen_at) VALUES
          ('198.51.100.1',now()),('198.51.100.2',now()-interval '31 minutes'),
          ('198.51.100.3',now()-interval '2 days'),('198.51.100.4',now()-interval '8 days')`);
        const expected = (await db.query(`SELECT count(*)::int n FROM qualified_visitor_presence
          WHERE last_seen_at>=date_trunc('day',now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin'`)).rows[0].n;
        const metrics = await pgUniqueVisitorMetrics(pool);
        assert.equal(metrics.activeVisitors, 1); assert.equal(metrics.todayVisitors, expected); assert.equal(metrics.weekVisitors, 3);
        for (const [window, count] of [['active', 1], ['today', expected], ['week', 3]] as const) {
          const details = await pgUniqueVisitorDetails({ window, page: 1, limit: 25 }, pool);
          assert.equal(details.totalVisitors, count); assert.equal(details.matchedVisitors, count);
          for (const breakdown of Object.values(details.breakdowns)) assert.equal(breakdown.reduce((sum, entry) => sum + entry.count, 0), count);
        }
        const boundaries = (await db.query(`SELECT
          (date_trunc('day','2026-07-01 23:30:00+00'::timestamptz AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin') AS summer,
          (date_trunc('day','2026-01-01 23:30:00+00'::timestamptz AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin') AS winter`)).rows[0];
        assert.equal(new Date(boundaries.summer).toISOString(), '2026-07-01T22:00:00.000Z');
        assert.equal(new Date(boundaries.winter).toISOString(), '2026-01-01T23:00:00.000Z');
      });
      await t.test('filters paginate distinct IPs stably while every breakdown remains unfiltered; only subnets leave SQL', async () => {
        await db.exec('TRUNCATE qualified_visitor_presence');
        await pgTrackQualifiedVisitor('198.51.100.23', web, pool);
        await pgTrackQualifiedVisitor('203.0.113.97', { ...web, channel: 'app', platform: 'ios', deviceType: 'mobile', os: 'iOS', browser: null, contextSource: 'client-header' }, pool);
        await pgTrackQualifiedVisitor('2001:db8:1234:5678::abcd', { ...web, countryCode: 'TR', channel: 'tv', platform: 'tizen', deviceType: 'tv', os: 'Tizen', browser: null }, pool);
        await pgTrackQualifiedVisitor('192.0.2.129', unknown, pool);
        // Identical timestamps deliberately exercise the inet tie-break rather than insertion order.
        await db.exec("UPDATE qualified_visitor_presence SET last_seen_at=date_trunc('second',now())");
        const first = await pgUniqueVisitorDetails({ window: 'week', page: 1, limit: 2 }, pool);
        const second = await pgUniqueVisitorDetails({ window: 'week', page: 2, limit: 2 }, pool);
        assert.deepEqual(first.visitors.map(v => v.maskedIp), ['192.0.2.0/24', '198.51.100.0/24']);
        assert.deepEqual(second.visitors.map(v => v.maskedIp), ['203.0.113.0/24', '2001:db8:1234::/48']);
        assert.equal(first.pagination.totalPages, 2); assert.equal(second.pagination.total, 4);
        const filtered = await pgUniqueVisitorDetails({ window: 'week', page: 1, limit: 25, country: 'DE', platform: 'ios', deviceType: 'mobile' }, pool);
        assert.equal(filtered.totalVisitors, 4); assert.equal(filtered.matchedVisitors, 1);
        assert.equal(filtered.visitors[0].maskedIp, '203.0.113.0/24');
        assert.deepEqual(filtered.breakdowns, first.breakdowns);
        for (const breakdown of Object.values(filtered.breakdowns)) assert.equal(breakdown.reduce((sum, entry) => sum + entry.count, 0), 4);
        const unknownOnly = await pgUniqueVisitorDetails({ window: 'week', page: 1, limit: 25, country: 'unknown', platform: 'unknown', deviceType: 'unknown' }, pool);
        assert.equal(unknownOnly.matchedVisitors, 1);
        const noMatch = await pgUniqueVisitorDetails({ window: 'week', page: 1, limit: 25, country: 'JP' }, pool);
        assert.equal(noMatch.totalVisitors, 4); assert.equal(noMatch.matchedVisitors, 0);
        assert.deepEqual(noMatch.visitors, []); assert.equal(noMatch.pagination.totalPages, 0);
        const beyond = await pgUniqueVisitorDetails({ window: 'week', page: 9, limit: 2 }, pool);
        assert.equal(beyond.pagination.page, 9); assert.deepEqual(beyond.visitors, []);
        const serialized = JSON.stringify([first, second, filtered]);
        for (const raw of ['198.51.100.23', '203.0.113.97', '2001:db8:1234:5678::abcd', '192.0.2.129']) assert.ok(!serialized.includes(raw));
        assert.doesNotMatch(serialized, /ip_address|userAgent|Mozilla|token/i);
        let snapshots = 0;
        const capturingPool = { connect: async () => ({ query: async (query: any) => {
          assert.equal(query.query_timeout, 3000);
          const result = await pool.query(query);
          if (query.text.startsWith('WITH windowed')) snapshots++;
          assert.ok(!JSON.stringify(result).includes('203.0.113.97'), 'raw IP must not even enter app memory from the details query');
          return result;
        }, release: () => {} }) } as any;
        await pgUniqueVisitorDetails({ window: 'week', page: 1, limit: 25 }, capturingPool);
        assert.equal(snapshots, 1, 'all counts, breakdowns and rows must come from one statement snapshot');
      });
      await t.test('empty collection reports actual zero arrays and missing dimension metadata fails closed', async () => {
        await db.exec('TRUNCATE qualified_visitor_presence');
        const empty = await pgUniqueVisitorDetails({ window: 'active', page: 1, limit: 25 }, pool);
        assert.equal(empty.totalVisitors, 0); assert.equal(empty.matchedVisitors, 0); assert.deepEqual(empty.visitors, []);
        for (const breakdown of Object.values(empty.breakdowns)) assert.deepEqual(breakdown, []);
        const metadata = (await db.query("SELECT value FROM runtime_app_state WHERE key='unique-visitor-details:v1'")).rows[0].value;
        await db.exec("DELETE FROM runtime_app_state WHERE key='unique-visitor-details:v1'");
        await assert.rejects(pgUniqueVisitorDetails({ window: 'active', page: 1, limit: 25 }, pool), /not initialized/);
        await db.query("INSERT INTO runtime_app_state(key,value) VALUES('unique-visitor-details:v1',$1)", [metadata]);
      });
      await t.test('retention preserves returning old visitors and prunes only inactive records', async () => {
        await db.exec(`TRUNCATE qualified_visitor_presence;
          INSERT INTO qualified_visitor_presence(ip_address,first_seen_at,last_seen_at) VALUES
          ('198.51.100.1',now()-interval '40 days',now()),
          ('198.51.100.2',now()-interval '40 days',now()-interval '31 days')`);
        assert.equal(await pgPruneQualifiedVisitors(pool), 1);
        assert.equal((await pgUniqueVisitorMetrics(pool)).activeVisitors, 1);
      });
      await t.test('missing collection metadata is unavailable, never an invented zero', async () => {
        await db.exec("DELETE FROM runtime_app_state WHERE key='unique-visitor-metrics:v1'");
        await assert.rejects(pgUniqueVisitorMetrics(pool), /not initialized/);
        await assert.rejects(pgUniqueVisitorDetails({ window: 'active', page: 1, limit: 25 }, pool), /not initialized/);
      });
    } finally { await db.close(); }
  });

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { pgTrackQualifiedVisitor, pgUniqueVisitorMetrics, pgPruneQualifiedVisitors } from '../src/data/postgres-visitor-metrics';

test('qualified unique-IP migration, counters and retention use actual PostgreSQL semantics',
  { skip: !process.env.RADIOHUB_PGLITE_ENTRY, timeout: 90_000 }, async t => {
    const { PGlite } = await import(pathToFileURL(process.env.RADIOHUB_PGLITE_ENTRY!).href);
    const db = await PGlite.create();
    const pool = { query: async (input: string | { text: string; values?: unknown[] }, values?: unknown[]) => {
      const result = await db.query(typeof input === 'string' ? input : input.text, values ?? (typeof input === 'string' ? undefined : input.values));
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    } } as any;
    try {
      await db.exec(`CREATE TABLE runtime_app_state(key text PRIMARY KEY,value jsonb NOT NULL);
        CREATE TABLE visitor_sessions(ip_address text PRIMARY KEY,last_active_date timestamptz);
        INSERT INTO visitor_sessions VALUES('198.51.100.99',now())`);
      const migration = await readFile(new URL('../../../lib/db/migrations/0037_qualified_unique_visitors.sql', import.meta.url), 'utf8');
      await db.exec(`BEGIN;${migration}COMMIT;`);
      await t.test('new series starts at a persisted cutover, never copies legacy bot/admin records', async () => {
        const metrics = await pgUniqueVisitorMetrics(pool);
        assert.equal(metrics.activeVisitors, 0); assert.equal(metrics.todayVisitors, 0); assert.equal(metrics.weekVisitors, 0);
        assert.equal(metrics.identity, 'unique-ip'); assert.equal(metrics.timezone, 'Europe/Berlin');
        assert.ok(Date.parse(metrics.collectionStartedAt) <= Date.parse(metrics.computedAt));
        assert.equal((await db.query('SELECT count(*)::int n FROM visitor_sessions')).rows[0].n, 1);
      });
      await t.test('repeated requests and canonical IPv6 spellings each count once', async () => {
        await pgTrackQualifiedVisitor('198.51.100.1', pool);
        const first = (await db.query("SELECT first_seen_at FROM qualified_visitor_presence WHERE ip_address='198.51.100.1'")).rows[0].first_seen_at;
        for (let i = 0; i < 5; i++) await pgTrackQualifiedVisitor('198.51.100.1', pool);
        await pgTrackQualifiedVisitor('2001:db8:0:0:0:0:0:1', pool);
        await pgTrackQualifiedVisitor('2001:DB8::1', pool);
        const metrics = await pgUniqueVisitorMetrics(pool);
        assert.equal(metrics.activeVisitors, 2); assert.equal(metrics.todayVisitors, 2); assert.equal(metrics.weekVisitors, 2);
        assert.deepEqual((await db.query("SELECT first_seen_at FROM qualified_visitor_presence WHERE ip_address='198.51.100.1'")).rows[0].first_seen_at, first);
        await assert.rejects(pgTrackQualifiedVisitor('unknown', pool));
        await assert.rejects(pgTrackQualifiedVisitor('198.51.100.0/24', pool));
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
        const boundaries = (await db.query(`SELECT
          (date_trunc('day','2026-07-01 23:30:00+00'::timestamptz AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin') AS summer,
          (date_trunc('day','2026-01-01 23:30:00+00'::timestamptz AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin') AS winter`)).rows[0];
        assert.equal(new Date(boundaries.summer).toISOString(), '2026-07-01T22:00:00.000Z');
        assert.equal(new Date(boundaries.winter).toISOString(), '2026-01-01T23:00:00.000Z');
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
      });
    } finally { await db.close(); }
  });

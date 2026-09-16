import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { LegacyNoindexRecoveryStore } from '../src/data/postgres-legacy-noindex-recovery';
import { AUDIT_LANGUAGES } from '../src/seo/station-indexability-audit';
import { pgAdminDescriptionCoverage } from '../src/data/postgres-admin-catalog-store';
import { catalogShape } from '../src/data/postgres-catalog-store';

/** Optional real PostgreSQL-engine SQL validation without a production
 * connection. PGlite checks SQL/transaction semantics, not network locking. */
test('PostgreSQL engine executes recovery SQL, preserves all content and journals before state; stale changes roll back',
  { skip: !process.env.RADIOHUB_PGLITE_ENTRY }, async () => {
    const { PGlite } = await import(pathToFileURL(process.env.RADIOHUB_PGLITE_ENTRY!).href);
    const db = await PGlite.create();
    try {
      await db.exec(`CREATE TABLE stations (
        id text PRIMARY KEY,station_uuid text NOT NULL,name text,slug text,slug_aliases text[] DEFAULT '{}',
        country text,country_code text,url text,url_resolved text,no_index boolean,redirect_to_slug text,
        manual_edit_fields jsonb,source jsonb,last_check_ok boolean,last_check_time timestamptz,
        descriptions jsonb,updated_at timestamptz DEFAULT now()
      )`);
      await db.exec(await readFile(new URL('../../../lib/db/migrations/0034_private_noindex_recovery_journal.sql', import.meta.url), 'utf8'));
      const descriptions = Object.fromEntries(AUDIT_LANGUAGES.map(language => [language, { full: `Full article ${language}`, meta: `Summary ${language}` }]));
      const source = { originalImport: { preserved: true }, noIndex: true };
      const existingJournal = { previous: { preserved: true } };
      await db.query(`INSERT INTO stations(id,station_uuid,name,slug,country,country_code,url,no_index,manual_edit_fields,
        source,last_check_ok,last_check_time,descriptions) VALUES
        ('station-a','00000000-0000-4000-8000-000000000001','Example Radio','example-radio','Germany','DE',
        'https://stream.example.invalid/live',true,'{}',$1,true,now()-interval '1 minute',$2)`, [source, descriptions]);
      assert.equal((await db.query('SELECT no_index_recovery_journal FROM stations')).rows[0].no_index_recovery_journal, null);
      await db.query('UPDATE stations SET no_index_recovery_journal=$1', [existingJournal]);
      const clients: any[] = [];
      let loseCommitAcknowledgement = false, rejectBeforeCommit = false, mutationCount = 0;
      const pool = { connect: async () => {
        const client = Object.assign(new EventEmitter(), {
          released: false, wrote: false,
          release() { this.released = true; },
          async query(config: string | { text: string; values?: any[] }, parameters?: any[]) {
            const sql = typeof config === 'string' ? config : config.text;
            if (sql.startsWith('UPDATE stations')) { this.wrote = true; mutationCount++; }
            if (sql === 'COMMIT' && this.wrote && rejectBeforeCommit) throw new Error('Commit not submitted');
            const result = await db.query(sql,
              typeof config === 'string' ? parameters : config.values);
            if (sql === 'COMMIT' && this.wrote && loseCommitAcknowledgement) {
              loseCommitAcknowledgement = false;
              throw new Error('COMMIT acknowledgement lost after server committed');
            }
            return { ...result, rowCount: result.affectedRows ?? result.rows.length };
          },
        }); clients.push(client); return client;
      } };
      let invalidations = 0;
      const store = new LegacyNoindexRecoveryStore(() => pool as any, async slugs => {
        assert.ok(clients.at(-1).released, 'cache invalidation occurs only after transaction connection release');
        assert.deepEqual(slugs, ['example-radio']); invalidations++; return true;
      });
      const preview = await store.preview();
      assert.equal(preview.totalScanned, 1); assert.equal(preview.totalCandidates, 1);
      const coveragePool = { query: (query: { text: string }) => db.query(query.text) } as any;
      const coverage = await pgAdminDescriptionCoverage(coveragePool);
      assert.equal(coverage.totalStations, 1);
      assert.equal(coverage.languages.length, 14);
      assert.ok(coverage.languages.every(locale => locale.withComplete === 1 && locale.missingComplete === 0));
      const before = (await db.query('SELECT * FROM stations')).rows[0];
      const result = await store.apply({ previewId: preview.previewId, stationIds: ['station-a'], actor: 'sql-fixture-admin' });
      assert.equal(result.restored, 1); assert.equal(invalidations, 1);
      const after = (await db.query('SELECT * FROM stations')).rows[0];
      assert.equal(after.no_index, false); assert.equal(after.source.noIndex, false);
      assert.deepEqual(after.source.originalImport, source.originalImport);
      assert.deepEqual(after.source, { ...source, noIndex: false }, 'public source contains no recovery evidence');
      assert.deepEqual(after.no_index_recovery_journal.previous, existingJournal.previous);
      const journal = after.no_index_recovery_journal[preview.previewId];
      assert.deepEqual(journal.before, { noIndex: true, sourceNoIndexPresent: true, sourceNoIndex: true, automaticNoIndex: null });
      assert.equal(journal.actor, 'sql-fixture-admin'); assert.equal(journal.evidence.completeLanguageCount, 14);
      const publicStation = catalogShape(after);
      assert.equal(Object.hasOwn(publicStation, 'no_index_recovery_journal'), false);
      assert.equal(Object.hasOwn(publicStation, 'noIndexRecoveryJournal'), false);
      assert.doesNotMatch(JSON.stringify(publicStation), /sql-fixture-admin|explicit-selected-legacy-noindex-recovery/);
      for (const field of Object.keys(before).filter(field => !['no_index', 'source', 'updated_at', 'no_index_recovery_journal'].includes(field))) {
        assert.deepEqual(after[field], before[field], `${field} must be preserved`);
      }

      // xmin protects content changes even when presence counts remain 14.
      await db.query("UPDATE stations SET no_index=true,source=source || '{\"noIndex\":true}'::jsonb");
      const stale = await store.preview();
      await db.query(`UPDATE stations SET descriptions=jsonb_set(descriptions,'{en,full}','"Edited retained article"'::jsonb)`);
      await assert.rejects(store.apply({ previewId: stale.previewId, stationIds: ['station-a'] }), { code: 'RECOVERY_STALE' });
      const retained = (await db.query('SELECT no_index,source,descriptions,no_index_recovery_journal FROM stations')).rows[0];
      assert.equal(retained.no_index, true); assert.equal(retained.descriptions.en.full, 'Edited retained article');
      assert.equal(Object.keys(retained.no_index_recovery_journal).length, 2);

      // Null/nonstring/whitespace descriptions never satisfy the SQL count.
      await db.query(`UPDATE stations SET descriptions=jsonb_set(descriptions,'{de,meta}','"   "'::jsonb)`);
      const incomplete = await store.preview();
      assert.equal(incomplete.totalCandidates, 0); assert.equal(incomplete.reasonCounts['incomplete-descriptions'], 1);
      const missingCoverage = await pgAdminDescriptionCoverage(coveragePool);
      assert.equal(missingCoverage.languages.find(locale => locale.language === 'de')?.missingComplete, 1);

      await db.query('UPDATE stations SET descriptions=$1', [descriptions]);
      const retry = await store.preview(); loseCommitAcknowledgement = true;
      const recovered = await store.apply({ previewId: retry.previewId, stationIds: ['station-a'] });
      assert.equal(recovered.restored, 1, 'private receipt confirms a committed mutation after its acknowledgement was lost');
      assert.equal(mutationCount, 2, 'receipt recovery must not resubmit UPDATE');
      assert.equal((await db.query('SELECT no_index FROM stations')).rows[0].no_index, false);

      await db.query("UPDATE stations SET no_index=true,source=source || '{\"noIndex\":true}'::jsonb");
      const notCommitted = await store.preview(); rejectBeforeCommit = true;
      await assert.rejects(store.apply({ previewId: notCommitted.previewId, stationIds: ['station-a'] }), /Commit not submitted/);
      const rolledBack = (await db.query('SELECT no_index,no_index_recovery_journal FROM stations')).rows[0];
      assert.equal(rolledBack.no_index, true);
      assert.equal(Object.hasOwn(rolledBack.no_index_recovery_journal, notCommitted.previewId), false,
        'a rolled back operation cannot claim success using another operation\'s receipt');
      assert.ok(clients.every(client => client.released));
    } finally { await db.close(); }
  });

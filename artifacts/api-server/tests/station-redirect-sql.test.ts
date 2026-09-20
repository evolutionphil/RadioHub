import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { pgSetStationRedirect } from '../src/data/postgres-station-redirect';

test('PostgreSQL redirect-only updates preserve records and references, reject unsafe targets and can be cleared',
  { skip: !process.env.RADIOHUB_PGLITE_ENTRY }, async t => {
    const { PGlite } = await import(pathToFileURL(process.env.RADIOHUB_PGLITE_ENTRY!).href);
    const db = await PGlite.create();
    const sourceId = '68a8c468bd66579311aaee28', targetId = '68a8c468bd66579311aaee26';
    const change = { id: sourceId, targetSlug: 'classical-kdfc', expectedRedirectToSlug: null };
    const completeDescriptions = Object.fromEntries(
      ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he']
        .map(language => [language, { full: `Canonical full description (${language})`, meta: `Canonical meta (${language})` }]),
    );
    const pool = { connect: async () => Object.assign(new EventEmitter(), {
      release() {},
      async query(config: { text: string; values?: any[] }) {
        const result = await db.query(config.text, config.values);
        return { ...result, rowCount: result.affectedRows ?? result.rows.length };
      },
    }) } as any;
    const rows = async () => (await db.query('SELECT * FROM stations ORDER BY id')).rows;
    const reset = async () => {
      await db.exec('DELETE FROM stations');
      const source = { noIndex: true, redirectToSlug: null, retained: { original: 'all metadata' }, automaticNoIndex: { preserved: true } };
      await db.query(`INSERT INTO stations(id,station_uuid,name,slug,slug_aliases,url,country,country_code,no_index,
        redirect_to_slug,manual_edit_fields,source,last_check_ok,is_list_visible,descriptions) VALUES
        ($1,'duplicate-uuid','Classical KDFC','classical-kdfc-1',ARRAY['classical-kdfc-2'],'https://stream.example.invalid/live',
          'The United States Minor Outlying Islands','UM',true,NULL,'{"country":true,"noIndex":true}',$3,false,false,'{"en":{"full":"Keep original"}}'),
        ($2,'canonical-uuid','Classical KDFC','classical-kdfc',ARRAY['classical-kdfc-1'],'https://stream.example.invalid/live',
          'The United States Of America','US',false,NULL,'{"noIndex":true}','{"retained":"canonical"}',false,true,$4)`,
        [sourceId, targetId, source, completeDescriptions]);
    };
    try {
      await db.exec(`CREATE TABLE stations (
        id text PRIMARY KEY,station_uuid text,name text,slug text,slug_aliases text[],url text,country text,country_code text,
        no_index boolean,redirect_to_slug text,manual_edit_fields jsonb,source jsonb,last_check_ok boolean,
        is_list_visible boolean,descriptions jsonb,updated_at timestamptz DEFAULT now()
      ); CREATE TABLE user_favorites(user_id text,station_id text);
      CREATE TABLE listening_history(user_id text,station_id text);
      CREATE TABLE station_blacklist(id text,source jsonb);`);
      await db.query('INSERT INTO user_favorites VALUES ($1,$2)', ['user', sourceId]);
      await db.query('INSERT INTO listening_history VALUES ($1,$2)', ['user', sourceId]);

      await t.test('verified pair with conflicting country metadata redirects without merging or changing any other field', async () => {
        await reset(); const before = await rows();
        const result = await pgSetStationRedirect(change, pool);
        assert.equal(result.changed, true); assert.equal(result.redirectToSlug, 'classical-kdfc');
        const after = await rows(); assert.equal(after.length, 2);
        assert.deepEqual(after[0], before[0], 'canonical station is untouched');
        const originalSource = before[1], redirectedSource = after[1];
        for (const field of Object.keys(originalSource).filter(field => !['redirect_to_slug', 'source', 'updated_at'].includes(field))) {
          assert.deepEqual(redirectedSource[field], originalSource[field], `${field} must be preserved`);
        }
        assert.deepEqual(redirectedSource.source, { ...originalSource.source, redirectToSlug: 'classical-kdfc' });
        assert.equal((await db.query('SELECT station_id FROM user_favorites')).rows[0].station_id, sourceId);
        assert.equal((await db.query('SELECT station_id FROM listening_history')).rows[0].station_id, sourceId);
        assert.equal((await db.query('SELECT * FROM station_blacklist')).rows.length, 0);
        const repeat = await pgSetStationRedirect({ ...change, expectedRedirectToSlug: 'classical-kdfc' }, pool);
        assert.equal(repeat.changed, false);
        assert.deepEqual(await rows(), after, 'an unchanged redirect does not rewrite station metadata');
        await pgSetStationRedirect({ ...change, targetSlug: null, expectedRedirectToSlug: 'classical-kdfc' }, pool);
        const cleared = (await rows())[1];
        assert.equal(cleared.redirect_to_slug, null);
        assert.deepEqual(cleared.source, originalSource.source);
        assert.equal(cleared.no_index, originalSource.no_index);
        assert.deepEqual(cleared.manual_edit_fields, originalSource.manual_edit_fields);
      });

      const reject = async (code: string, update: typeof change = change) => {
        const before = await rows();
        await assert.rejects(pgSetStationRedirect(update, pool), { code });
        assert.deepEqual(await rows(), before, 'rejection leaves every station unchanged');
      };
      await t.test('missing, same, excluded, junk, ambiguous or redirected targets are rejected', async () => {
        await reset(); await reject('REDIRECT_TARGET_INVALID', { ...change, targetSlug: 'missing' });
        await reject('REDIRECT_TARGET_INVALID', { ...change, targetSlug: 'classical-kdfc-1' });
        await db.query('UPDATE stations SET no_index=true WHERE id=$1', [targetId]);
        await reject('REDIRECT_TARGET_INVALID');
        await reset(); await db.query("UPDATE stations SET redirect_to_slug='classical-kdfc-1' WHERE id=$1", [targetId]);
        await reject('REDIRECT_TARGET_INVALID');
        await reset(); await db.query("UPDATE stations SET slug='12345' WHERE id=$1", [targetId]);
        await reject('REDIRECT_TARGET_INVALID', { ...change, targetSlug: '12345' });
        await reset(); await db.query("UPDATE stations SET name='Pink Noise Test Stream' WHERE id=$1", [targetId]);
        await reject('REDIRECT_TARGET_INVALID');
        await reset(); await db.exec("INSERT INTO stations(id,slug) VALUES ('third','classical-kdfc')");
        await reject('REDIRECT_TARGET_INVALID');
      });
      await t.test('different broadcaster/endpoint, stale edits and incoming redirect chains are rejected', async () => {
        await reset(); await db.query("UPDATE stations SET name='Different Station' WHERE id=$1", [targetId]);
        await reject('REDIRECT_NOT_DUPLICATE');
        await reset(); await db.query("UPDATE stations SET url='https://stream.example.invalid/other' WHERE id=$1", [targetId]);
        await reject('REDIRECT_NOT_DUPLICATE');
        await reset(); await db.query("UPDATE stations SET redirect_to_slug='previous-choice' WHERE id=$1", [sourceId]);
        await reject('REDIRECT_STALE');
        await reset(); await db.exec("INSERT INTO stations(id,slug,redirect_to_slug) VALUES ('incoming','earlier-alias','classical-kdfc-1')");
        await reject('REDIRECT_CHAIN');
        await reset(); await db.exec("INSERT INTO stations(id,slug) VALUES ('ambiguous','classical-kdfc-1')");
        await reject('REDIRECT_CHAIN');
      });
      await t.test('the real SQL projection requires full and meta content in all 14 destination languages', async () => {
        for (const descriptions of [null, {}, { en: completeDescriptions.en },
          { ...completeDescriptions, he: null },
          { ...completeDescriptions, he: { full: '  ', meta: 'Meta' } },
          { ...completeDescriptions, he: { full: 'Full', meta: '' } },
          { ...completeDescriptions, he: { full: 'Full', meta: 123 } }]) {
          await reset();
          await db.query('UPDATE stations SET descriptions=$2 WHERE id=$1', [targetId, descriptions]);
          await reject('REDIRECT_TARGET_CONTENT');
        }
      });
      await t.test('clearing works even when the old destination is missing or no longer indexable', async () => {
        await reset(); await pgSetStationRedirect(change, pool);
        await db.query('DELETE FROM stations WHERE id=$1', [targetId]);
        await pgSetStationRedirect({ ...change, targetSlug: null, expectedRedirectToSlug: 'classical-kdfc' }, pool);
        assert.equal((await rows())[0].redirect_to_slug, null);
        assert.equal((await rows())[0].no_index, true);
      });
    } finally { await db.close(); }
  });

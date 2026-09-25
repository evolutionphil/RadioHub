import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const migration = await readFile(new URL('../../../lib/db/migrations/0042_verified_ora_news_canonical_recovery.sql', import.meta.url), 'utf8');
const snapshot = JSON.parse(await readFile(new URL('../../../docs/audits/2026-09-25-radio-ora-news-recovery.json', import.meta.url), 'utf8'));
const reviewed = JSON.parse(migration.match(/\$reviewed\$([\s\S]*?)\$reviewed\$/)![1]);
const auditKey = 'verifiedOraNewsCanonicalRecovery20260925';
const roles = ['duplicate', 'canonical'] as const;
const languages = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];

test('Ora News exception pins only the reviewed pair and every observed full/meta content field', () => {
  assert.equal(reviewed.duplicate.id, '68a8c490bd66579311ab4fb6');
  assert.equal(reviewed.canonical.id, '68a8c490bd66579311ab4fb5');
  assert.equal(reviewed.canonical.slug, 'radio-ora-news');
  assert.deepEqual(reviewed.duplicate.slug_aliases, ['radio-ora-news-tirana-967-fm']);
  for (const field of ['url', 'url_resolved', 'homepage', 'country', 'country_code']) {
    assert.equal(reviewed.duplicate[field], reviewed.canonical[field]);
  }
  for (const role of roles) {
    const record = snapshot.records.find((row: any) => row.role === role);
    assert.deepEqual(record.identity, reviewed[role]);
    assert.ok(languages.every(language => Object.hasOwn(record.descriptions, language)));
    assert.equal(record.observed.noIndex, true);
    assert.equal(record.observed.redirectToSlug, null);
    for (const [language, value] of Object.entries(record.descriptions) as [string, any][]) {
      for (const field of ['full', 'meta']) {
        assert.equal(typeof value[field], 'string'); assert.ok(value[field].trim());
        assert.equal(createHash('sha256').update(value[field]).digest('hex'), reviewed.contentSha256[role][language][field]);
      }
    }
  }
  assert.doesNotMatch(migration, /\b(?:DELETE\s+FROM|TRUNCATE|INSERT\s+INTO)\b/i);
  assert.match(migration, /LOCK TABLE stations IN SHARE ROW EXCLUSIVE MODE NOWAIT/);
  assert.match(migration, /LOCK TABLE station_merge_aliases IN SHARE ROW EXCLUSIVE MODE NOWAIT/);
});

// Actual PostgreSQL SQL/PLpgSQL via a local engine; no production credentials.
// This does not claim native multi-connection NOWAIT contention coverage.
test('Ora News recovery executes atomically and fails closed against changed private/content/identity evidence',
  { skip: !process.env.RADIOHUB_PGLITE_ENTRY }, async t => {
    const { PGlite } = await import(pathToFileURL(process.env.RADIOHUB_PGLITE_ENTRY!).href);
    const db = await PGlite.create();
    const rows = async () => (await db.query('SELECT * FROM stations ORDER BY id')).rows;
    const references = async () => ({
      users: (await db.query('SELECT * FROM retained_user_data ORDER BY station_id')).rows,
      aliases: (await db.query('SELECT * FROM station_merge_aliases ORDER BY alias')).rows,
    });
    const reset = async () => {
      await db.exec('DELETE FROM retained_user_data; DELETE FROM station_merge_aliases; DELETE FROM stations');
      for (const role of roles) {
        const record = snapshot.records.find((row: any) => row.role === role);
        const columns = Object.keys(record.identity);
        await db.query(`INSERT INTO stations(${columns.join(',')},no_index,descriptions,source,updated_at,last_check_ok,is_list_visible)
          VALUES (${columns.map((_, index) => '$' + (index + 1)).join(',')},true,$${columns.length + 1},$${columns.length + 2},'2026-09-01T00:00:00Z',false,false)`,
        [...Object.values(record.identity), record.descriptions,
          { retained: { providerMetadata: true }, noIndex: true, redirectToSlug: null, manualEditFields: {}, isManuallyEdited: false }]);
        await db.query('INSERT INTO retained_user_data VALUES($1,3,4,5)', [record.identity.id]);
      }
      await db.exec("INSERT INTO stations(id,station_uuid,name,slug,country,country_code,url,no_index) VALUES('other','other-uuid','Unrelated','other','Germany','DE','https://unrelated.invalid/live',true)");
    };
    const unchanged = async () => {
      const before = await rows(), refs = await references();
      await db.exec(migration);
      assert.deepEqual(await rows(), before, 'any guard must leave BOTH reviewed rows and unrelated rows unchanged');
      assert.deepEqual(await references(), refs);
    };
    try {
      await db.exec(`CREATE TABLE stations (
        id text PRIMARY KEY,station_uuid text UNIQUE,name text,slug text,slug_aliases text[] DEFAULT '{}',
        country text,country_code text,url text,url_resolved text,homepage text,
        no_index boolean,redirect_to_slug text,manual_edit_fields jsonb DEFAULT '{}',descriptions jsonb,
        source jsonb DEFAULT '{}',no_index_recovery_journal jsonb,updated_at timestamptz DEFAULT now(),
        last_check_ok boolean,is_list_visible boolean
      ); CREATE TABLE retained_user_data(station_id text REFERENCES stations(id),favorites int,history int,ratings int);
      CREATE TABLE station_merge_aliases(alias text PRIMARY KEY,station_id text REFERENCES stations(id));`);

      await t.test('one canonical restored, duplicate redirects once, all content/health/user references preserved, private receipts are idempotent', async () => {
        await reset();
        await db.query('INSERT INTO station_merge_aliases VALUES($1,$2)', ['retired-ora-id', reviewed.duplicate.id]);
        const before = await rows(), refs = await references();
        await db.exec(migration); const after = await rows();
        for (const role of roles) {
          const previous = before.find((row: any) => row.id === reviewed[role].id)!;
          const current = after.find((row: any) => row.id === reviewed[role].id)!;
          const isDuplicate = role === 'duplicate';
          assert.equal(current.no_index, isDuplicate); assert.equal(current.source.noIndex, isDuplicate);
          assert.equal(current.redirect_to_slug, isDuplicate ? reviewed.canonical.slug : null);
          assert.equal(current.source.redirectToSlug, isDuplicate ? reviewed.canonical.slug : null);
          for (const field of Object.keys(previous).filter(key => !['no_index', 'redirect_to_slug', 'source', 'no_index_recovery_journal', 'updated_at'].includes(key))) {
            assert.deepEqual(current[field], previous[field], `${role}: ${field}`);
          }
          assert.deepEqual(current.source, { ...previous.source, noIndex: isDuplicate, ...(isDuplicate ? { redirectToSlug: reviewed.canonical.slug } : {}) });
          const receipt = current.no_index_recovery_journal[auditKey];
          assert.deepEqual(receipt.reviewedCanonical, reviewed.canonical);
          assert.deepEqual(receipt.reviewedDuplicate, reviewed.duplicate);
          assert.deepEqual(receipt.reviewedContentSha256, reviewed.contentSha256);
          assert.equal(receipt.previous.noIndex, true); assert.equal(receipt.previous.journalWasNull, true);
          assert.equal(receipt.previous.sourceHadNoIndex, true); assert.equal(receipt.previous.sourceNoIndex, true);
          assert.equal(receipt.previous.redirectToSlug, null);
          assert.equal(receipt.previous.updatedAt, '2026-09-01T00:00:00+00:00');
          assert.equal(Object.hasOwn(current.source, auditKey), false, 'receipts must never enter public source JSON');
        }
        assert.deepEqual(after.find((row: any) => row.id === 'other'), before.find((row: any) => row.id === 'other'));
        assert.deepEqual(await references(), refs);
        await db.exec(migration); assert.deepEqual(await rows(), after, 'reruns cannot overwrite original receipts');
      });

      await t.test('every pinned identity field and observed alias set must remain exact on both sides', async () => {
        for (const role of roles) for (const field of ['station_uuid', 'slug', 'name', 'country', 'country_code', 'homepage', 'url', 'url_resolved']) {
          await reset(); await db.query(`UPDATE stations SET ${field}=${field}||'-changed' WHERE id=$1`, [reviewed[role].id]); await unchanged();
        }
        for (const role of roles) {
          await reset(); await db.query("UPDATE stations SET slug_aliases=slug_aliases||ARRAY['new-unreviewed-alias'] WHERE id=$1", [reviewed[role].id]); await unchanged();
        }
      });

      await t.test('manual flags, nonobject source, preexisting native journal, redirects and changed index state all block both updates', async () => {
        for (const role of roles) for (const sql of [
          "manual_edit_fields='{\"descriptions\":true}'", "manual_edit_fields='{\"noIndex\":false}'", 'manual_edit_fields=NULL', "manual_edit_fields='[]'",
          "source='[]'", "source='null'", 'source=NULL', 'no_index=false', 'no_index=NULL', "redirect_to_slug='existing-choice'",
          "no_index_recovery_journal='{\"previous\":{}}'", "no_index_recovery_journal='[]'", "no_index_recovery_journal='null'",
        ]) {
          await reset(); await db.query(`UPDATE stations SET ${sql} WHERE id=$1`, [reviewed[role].id]); await unchanged();
        }
      });

      await t.test('conflicting source mirrors, ownership/provenance/journal flags and even ambiguous null provenance fail closed', async () => {
        for (const role of roles) for (const patch of [
          { noIndex: false }, { noIndex: null }, { redirectToSlug: 'elsewhere' }, { manualEditFields: { url: true } },
          { manualEditFields: null }, { isManuallyEdited: true }, { automaticNoIndex: null },
          { automaticNoIndex: { owner: 'radiohub-junk-policy', active: true } }, { noIndexReason: 'manual' },
          { noIndexRecoveryJournal: {} }, { verifiedOtherRepair: {} }, { excludeFromSitemap: true }, { excludeFromSeo: 'unknown' },
        ]) {
          await reset(); await db.query('UPDATE stations SET source=source||$2::jsonb WHERE id=$1', [reviewed[role].id, patch]); await unchanged();
        }
      });

      await t.test('every observed locale full/meta field is content pinned, including canonical sq', async () => {
        for (const role of roles) for (const language of Object.keys(reviewed.contentSha256[role])) for (const field of ['full', 'meta']) {
          await reset(); await db.query('UPDATE stations SET descriptions=jsonb_set(descriptions,ARRAY[$2,$3],to_jsonb((descriptions #>> ARRAY[$2,$3])||\' changed\')) WHERE id=$1',
            [reviewed[role].id, language, field]); await unchanged();
        }
        for (const role of roles) for (const value of [null, [], {}, { en: { full: 'Full', meta: 'Meta' } }]) {
          await reset(); await db.query('UPDATE stations SET descriptions=$2 WHERE id=$1', [reviewed[role].id, value]); await unchanged();
        }
      });

      await t.test('third canonical/slug-alias/merged-alias owners and every incoming redirect spelling are protected', async () => {
        for (const key of [reviewed.duplicate.slug, reviewed.canonical.slug, reviewed.duplicate.slug_aliases[0]]) {
          for (const sql of ['slug=$1', 'slug_aliases=ARRAY[$1]', 'redirect_to_slug=$1', "source=jsonb_build_object('redirectToSlug',$1::text)"]) {
            await reset(); await db.query(`UPDATE stations SET ${sql} WHERE id='other'`, [key]); await unchanged();
          }
          await reset(); await db.query("INSERT INTO station_merge_aliases VALUES($1,'other')", [key]); await unchanged();
        }
        for (const key of [reviewed.duplicate.id, reviewed.duplicate.station_uuid, reviewed.canonical.id, 'retired-ora-id']) {
          await reset(); await db.query('INSERT INTO station_merge_aliases VALUES($1,$2)', ['retired-ora-id', reviewed.duplicate.id]);
          await db.query("UPDATE stations SET redirect_to_slug=$1 WHERE id='other'", [key]); await unchanged();
        }
      });

      await t.test('hidden or redirected third stream/name/family peers are not ignored', async () => {
        for (const sql of [
          `url='${reviewed.canonical.url}'`, `url_resolved='${reviewed.canonical.url_resolved}'`,
          "name='RADIO ORA NEWS',country='Albania',country_code='AL'", "name='Radio_Ora_News',country_code=NULL",
          "slug='radio-ora-news-other'",
        ]) {
          await reset(); await db.exec(`UPDATE stations SET ${sql},is_list_visible=false,redirect_to_slug='elsewhere' WHERE id='other'`); await unchanged();
        }
      });

      await t.test('missing reviewed rows leave the survivor and user references unchanged', async () => {
        for (const role of roles) {
          await reset(); await db.query('DELETE FROM retained_user_data WHERE station_id=$1', [reviewed[role].id]);
          await db.query('DELETE FROM stations WHERE id=$1', [reviewed[role].id]); await unchanged();
        }
      });

      await t.test('private receipts restore exact original key presence, row flags and journal nullness without changing references', async () => {
        await reset();
        await db.query("UPDATE stations SET source=source-'noIndex'-'redirectToSlug',no_index_recovery_journal='{}' WHERE id=$1", [reviewed.canonical.id]);
        const before = await rows(), refs = await references(); await db.exec(migration);
        for (const role of roles) {
          await db.query(`UPDATE stations SET
            no_index=(no_index_recovery_journal->$2->'previous'->>'noIndex')::boolean,
            redirect_to_slug=no_index_recovery_journal->$2->'previous'->>'redirectToSlug',
            updated_at=(no_index_recovery_journal->$2->'previous'->>'updatedAt')::timestamptz,
            source=(source-'noIndex'-'redirectToSlug')
              || CASE WHEN (no_index_recovery_journal->$2->'previous'->>'sourceHadNoIndex')::boolean THEN jsonb_build_object('noIndex',no_index_recovery_journal->$2->'previous'->'sourceNoIndex') ELSE '{}'::jsonb END
              || CASE WHEN (no_index_recovery_journal->$2->'previous'->>'sourceHadRedirectToSlug')::boolean THEN jsonb_build_object('redirectToSlug',no_index_recovery_journal->$2->'previous'->'sourceRedirectToSlug') ELSE '{}'::jsonb END,
            no_index_recovery_journal=CASE WHEN (no_index_recovery_journal->$2->'previous'->>'journalWasNull')::boolean THEN NULL ELSE '{}'::jsonb END
            WHERE id=$1 AND no_index_recovery_journal->$2->'reviewedCanonical'->>'id'=$3`,
          [reviewed[role].id, auditKey, reviewed.canonical.id]);
        }
        assert.deepEqual(await rows(), before); assert.deepEqual(await references(), refs);
      });

      await t.test('an update failure cannot restore only one row or leave a partial receipt', async () => {
        await reset(); const before = await rows(), refs = await references();
        await db.exec(`CREATE FUNCTION reject_ora_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.id='${reviewed.canonical.id}' THEN RAISE EXCEPTION 'simulated canonical update failure'; END IF;
          RETURN NEW; END $$;
          CREATE TRIGGER reject_ora_update BEFORE UPDATE ON stations FOR EACH ROW EXECUTE FUNCTION reject_ora_update();`);
        await assert.rejects(db.exec(migration), /simulated canonical update failure/);
        assert.deepEqual(await rows(), before); assert.deepEqual(await references(), refs);
      });
    } finally { await db.close(); }
  });

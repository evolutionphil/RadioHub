import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { stripPlaceholders } from '../src/routes/shared-utils';

const previousSql = await readFile(new URL('../../../lib/db/migrations/0042_verified_ora_news_canonical_recovery.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../../lib/db/migrations/0043_verified_ora_news_native_content_recovery.sql', import.meta.url), 'utf8');
const previousEvidence = JSON.parse(await readFile(new URL('../../../docs/audits/2026-09-25-radio-ora-news-recovery.json', import.meta.url), 'utf8'));
const evidence = JSON.parse(await readFile(new URL('../../../docs/audits/2026-09-25-radio-ora-news-native-recovery.json', import.meta.url), 'utf8'));
const pins = JSON.parse(migration.match(/\$reviewed\$([\s\S]*?)\$reviewed\$/)![1]);
const oldPins = JSON.parse(previousSql.match(/\$reviewed\$([\s\S]*?)\$reviewed\$/)![1]);
const auditKey = 'verifiedOraNewsNativeCanonicalRecovery20260925';
const roles = ['duplicate', 'canonical'] as const;

test('0043 raw pins match native SQL cross-checks and all 58 fields normalize exactly to the previously reviewed public evidence', () => {
  let checked = 0, differences = 0;
  for (const role of roles) {
    const raw = evidence.records.find((row: any) => row.role === role);
    const old = previousEvidence.records.find((row: any) => row.role === role);
    assert.deepEqual(raw.identity, old.identity);
    assert.deepEqual(raw.identity, pins[role]);
    assert.deepEqual(pins[role], oldPins[role]);
    assert.deepEqual(stripPlaceholders({ descriptions: raw.descriptions }).descriptions, old.descriptions);
    for (const [locale, values] of Object.entries(raw.descriptions) as [string, any][]) for (const field of ['full', 'meta']) {
      checked++;
      assert.ok(typeof values[field] === 'string' && values[field].trim());
      assert.equal(createHash('sha256').update(values[field]).digest('hex'), pins.contentSha256[role][locale][field]);
      if (values[field] !== old.descriptions[locale][field]) differences++;
    }
  }
  assert.equal(checked, 58); assert.equal(differences, 15);
  assert.deepEqual(pins.contentSha256.canonical, oldPins.contentSha256.canonical);
  assert.equal(pins.contentSha256.duplicate.ar.full, '89807396e4457a258c3141d0c70d41a2d2f9f19b3e9205f3a2f0a1c186deb7b5');
  assert.equal(pins.contentSha256.duplicate.de.full, '4f7a92f957ddf9befe48011c56848aeb566162b21629595d14b8cb0c409b5fd9');
  assert.equal(pins.contentSha256.duplicate.en.full, '4b9350583b0580577ee0fda2678afe9ceb1669e1bdd306b465ffcdf902c7de19');
  assert.equal(pins.contentSha256.duplicate.en.meta, '68fef507a7a110b769a2db13bbd969f3e866e346bf34503da29ac1ccacc8d961');
  assert.equal(pins.contentSha256.duplicate.he.meta, oldPins.contentSha256.duplicate.he.meta, 'Hebrew is not replaced by a locale fallback');
});

test('0043 retains the exact 0042 safety/atomicity/receipt body; only reviewed pins and evidence/receipt identifiers differ', () => {
  const body = (sql: string) => sql.slice(sql.indexOf('DO $repair$')).trim()
    .replace(/\r\n/g, '\n')
    .replace(/\$reviewed\$[\s\S]*?\$reviewed\$::jsonb;/, '<reviewed raw or public snapshot>')
    .replace(/verifiedOraNews(?:Native)?CanonicalRecovery20260925/g, '<private receipt key>')
    .replace(/2026-09-25-radio-ora-news-(?:native-)?recovery\.json/g, '<evidence path>');
  assert.equal(body(migration), body(previousSql));
  assert.doesNotMatch(migration, /\b(?:DELETE\s+FROM|TRUNCATE|INSERT\s+INTO)\b/i);
});

// Actual local PostgreSQL SQL/PLpgSQL; no production connection and no claim
// of native multi-connection NOWAIT contention testing.
test('0043 reproduces the 0042 raw-content skip then safely recovers only the pinned pair',
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
        const record = evidence.records.find((row: any) => row.role === role);
        const keys = Object.keys(record.identity);
        await db.query(`INSERT INTO stations(${keys.join(',')},no_index,descriptions,source,updated_at,last_check_ok,is_list_visible)
          VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')},true,$${keys.length + 1},$${keys.length + 2},'2026-09-01T00:00:00Z',false,false)`,
        [...Object.values(record.identity), record.descriptions, { noIndex: true, redirectToSlug: null, manualEditFields: {}, isManuallyEdited: false, retained: { provider: true } }]);
        await db.query('INSERT INTO retained_user_data VALUES($1,3,4,5)', [record.identity.id]);
      }
      await db.exec("INSERT INTO stations(id,station_uuid,name,slug,url) VALUES('other','other-uuid','Unrelated','other','https://unrelated.invalid/live')");
    };
    const unchanged = async () => {
      const before = await rows(), refs = await references(); await db.exec(migration);
      assert.deepEqual(await rows(), before); assert.deepEqual(await references(), refs);
    };
    try {
      await db.exec(`CREATE TABLE stations (
        id text PRIMARY KEY,station_uuid text UNIQUE,name text,slug text,slug_aliases text[] DEFAULT '{}',
        country text,country_code text,url text,url_resolved text,homepage text,no_index boolean,redirect_to_slug text,
        manual_edit_fields jsonb DEFAULT '{}',descriptions jsonb,source jsonb DEFAULT '{}',no_index_recovery_journal jsonb,
        updated_at timestamptz DEFAULT now(),last_check_ok boolean,is_list_visible boolean
      ); CREATE TABLE retained_user_data(station_id text REFERENCES stations(id),favorites int,history int,ratings int);
      CREATE TABLE station_merge_aliases(alias text PRIMARY KEY,station_id text REFERENCES stations(id));`);

      await t.test('0042 skips raw fixture; 0043 retains exact raw text, failed health and user references with two private receipts', async () => {
        await reset(); const before = await rows(), refs = await references();
        await db.exec(previousSql); assert.deepEqual(await rows(), before, 'reproduce safe production skip');
        await db.exec(migration); const after = await rows();
        for (const role of roles) {
          const old = before.find((row: any) => row.id === pins[role].id)!;
          const current = after.find((row: any) => row.id === pins[role].id)!;
          const duplicate = role === 'duplicate';
          assert.equal(current.no_index, duplicate); assert.equal(current.source.noIndex, duplicate);
          assert.equal(current.redirect_to_slug, duplicate ? pins.canonical.slug : null);
          assert.deepEqual(current.source, { ...old.source, noIndex: duplicate, ...(duplicate ? { redirectToSlug: pins.canonical.slug } : {}) });
          for (const field of Object.keys(old).filter(key => !['no_index', 'redirect_to_slug', 'source', 'no_index_recovery_journal', 'updated_at'].includes(key))) {
            assert.deepEqual(current[field], old[field], `${role}: ${field}`);
          }
          assert.deepEqual(current.no_index_recovery_journal[auditKey].reviewedContentSha256, pins.contentSha256);
          assert.equal(current.no_index_recovery_journal[auditKey].previous.noIndex, true);
          assert.equal(current.no_index_recovery_journal[auditKey].previous.journalWasNull, true);
          assert.equal(Object.hasOwn(current.source, auditKey), false);
        }
        assert.deepEqual(after.find((row: any) => row.id === 'other'), before.find((row: any) => row.id === 'other'));
        assert.deepEqual(await references(), refs);
        await db.exec(migration); assert.deepEqual(await rows(), after, 'idempotency preserves original receipts');
      });

      await t.test('every changed raw full/meta pin rejects normalized or edited content, without SQL normalization', async () => {
        for (const diff of evidence.normalizationCheck.rawDifferentFields) {
          await reset();
          const old = previousEvidence.records.find((row: any) => row.role === diff.role);
          await db.query('UPDATE stations SET descriptions=jsonb_set(descriptions,ARRAY[$2,$3],$4::jsonb) WHERE id=$1',
            [pins[diff.role].id, diff.locale, diff.field, JSON.stringify(old.descriptions[diff.locale][diff.field])]);
          await unchanged();
        }
      });

      await t.test('existing private decisions, changed provider identity and canonical content remain protected', async () => {
        for (const role of roles) for (const sql of [
          "manual_edit_fields='{\"noIndex\":true}'", "source=source||'{\"automaticNoIndex\":null}'::jsonb",
          "no_index_recovery_journal='{\"prior\":{}}'", "url=url||'?changed'", "redirect_to_slug='elsewhere'",
          "descriptions=jsonb_set(descriptions,'{he,meta}','\"changed\"')",
        ]) {
          await reset(); await db.query(`UPDATE stations SET ${sql} WHERE id=$1`, [pins[role].id]); await unchanged();
        }
      });

      await t.test('third merged-alias owners, incoming paths and hidden stream peers still prevent both updates', async () => {
        for (const key of [pins.duplicate.slug, pins.duplicate.slug_aliases[0], pins.canonical.id]) {
          await reset(); await db.query("INSERT INTO station_merge_aliases VALUES($1,'other')", [key]); await unchanged();
          await reset(); await db.query("UPDATE stations SET redirect_to_slug=$1 WHERE id='other'", [key]); await unchanged();
        }
        await reset(); await db.query("UPDATE stations SET url=$1,is_list_visible=false WHERE id='other'", [pins.canonical.url]); await unchanged();
      });

      await t.test('a failed update leaves neither restored canonical nor partial duplicate redirect or journal', async () => {
        await reset(); const before = await rows(), refs = await references();
        await db.exec(`CREATE FUNCTION reject_native_ora_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.id='${pins.canonical.id}' THEN RAISE EXCEPTION 'simulated raw recovery failure'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER reject_native_ora_update BEFORE UPDATE ON stations FOR EACH ROW EXECUTE FUNCTION reject_native_ora_update();`);
        await assert.rejects(db.exec(migration), /simulated raw recovery failure/);
        assert.deepEqual(await rows(), before); assert.deepEqual(await references(), refs);
      });
    } finally { await db.close(); }
  });

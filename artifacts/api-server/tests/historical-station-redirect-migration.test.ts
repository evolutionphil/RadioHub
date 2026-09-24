import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const migration = await readFile(new URL('../../../lib/db/migrations/0039_verified_historical_station_redirects.sql', import.meta.url), 'utf8');
const auditKey = 'verifiedHistoricalRedirectRepair20260924';
const pairs = JSON.parse(migration.match(/\$reviewed\$([\s\S]*?)\$reviewed\$/)![1]) as Array<{
  source: Record<string, string>; target: Record<string, string>; evidence: string; reason: string;
}>;
const languages = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];
const descriptions = Object.fromEntries(languages.map(language => [language, { full: `Full ${language}`, meta: `Meta ${language}` }]));
const aliases: Record<string, string[]> = {
  'vesti-fm-aac': ['fm-aac-1', 'vesti-fm-aac-1'],
  'vesti-fm-vesti-fm': ['vesti-fm-1'],
  'dr-p4-kobenhavn-mp3': ['dr-p4-kbenhavn-mp3'],
  'dr-p4-kobenhavn': ['dr-p4-kbenhavn-1', 'dr-p4-kobenhavn-1'],
  'w-radio-88-5-villahermosa-88-5-fm-xhkv-fm-grupo-radio-canon-villahermosa-tabasco-1': ['w-radio-885-villahermosa-885-fm-xhkv-fm-grupo-radio-can-villahermosa-tabasco-1'],
  'sunshine-live-classics-1': ['sunshine-live-classics-4', 'sunshine-live-classics-2'],
  'sunshine-live-classics': ['sunshine-live-classics-3', 'sunshine-live-classics-1'],
};

test('historical repair is exactly the five independently verified retained identities', () => {
  assert.deepEqual(pairs.map(pair => [pair.source.id, pair.target.id]), [
    ['68a8c4a6bd66579311ab8808', '68a8c4a6bd66579311ab880c'],
    ['68a8c480bd66579311ab2a2a', '68a8c480bd66579311ab2a2b'],
    ['68a8c46cbd66579311aaf66b', '68a8c46cbd66579311aaf669'],
    ['68a8c458bd66579311aac72f', '68a8c458bd66579311aac72e'],
    ['6a0791d5bef34beb9148d739', '68a8c49cbd66579311ab7099'],
  ]);
  assert.equal(new Set(pairs.flatMap(pair => [pair.source.id, pair.target.id])).size, 10);
  for (const pair of pairs) for (const side of [pair.source, pair.target]) {
    assert.match(side.station_uuid, /^[a-f0-9-]{36}$/);
    for (const field of ['id', 'slug', 'name', 'country', 'country_code', 'url', 'url_resolved', 'homepage']) assert.ok(side[field]);
  }
  assert.doesNotMatch(migration, /\b(?:DELETE\s+FROM|TRUNCATE|INSERT\s+INTO)\b/i);
  assert.doesNotMatch(migration, /france-bleu-besanon|radio-russia|1fm-movie-soundtrack/);
});

// PGlite executes actual PostgreSQL SQL/PLpgSQL. It cannot establish native,
// multi-connection lock-contention behavior; that is explicitly not claimed.
test('historical redirect migration executes safely against real PostgreSQL semantics',
  { skip: !process.env.RADIOHUB_PGLITE_ENTRY }, async t => {
    const { PGlite } = await import(pathToFileURL(process.env.RADIOHUB_PGLITE_ENTRY!).href);
    const db = await PGlite.create();
    const rows = async () => (await db.query('SELECT * FROM stations ORDER BY id')).rows;
    const related = async () => (await db.query('SELECT * FROM retained_user_data ORDER BY station_id')).rows;
    const reset = async () => {
      await db.exec('DELETE FROM retained_user_data; DELETE FROM stations');
      for (const pair of pairs) for (const [side, identity] of Object.entries({ source: pair.source, target: pair.target })) {
        const columns = Object.keys(identity);
        await db.query(`INSERT INTO stations(${columns.join(',')},slug_aliases,no_index,descriptions,source,updated_at)
          VALUES (${columns.map((_, index) => '$' + (index + 1)).join(',')},$${columns.length + 1},$${columns.length + 2},$${columns.length + 3},$${columns.length + 4},'2026-09-01T00:00:00Z')`,
        [...Object.values(identity), aliases[identity.slug] || [], side === 'source', descriptions,
          { retained: { providerMetadata: true }, redirectToSlug: null, noIndex: side === 'source' }]);
        await db.query('INSERT INTO retained_user_data(station_id,favorites,history,ratings) VALUES ($1,3,4,5)', [identity.id]);
      }
    };
    const unchanged = async () => {
      const before = await rows();
      await db.exec(migration);
      assert.deepEqual(await rows(), before, 'all guarded records must be left byte-for-byte unchanged');
    };
    try {
      await db.exec(`CREATE TABLE stations (
        id text PRIMARY KEY,station_uuid text UNIQUE,name text,slug text,slug_aliases text[] NOT NULL DEFAULT '{}',
        country text,country_code text,state text,url text,url_resolved text,homepage text,
        no_index boolean,redirect_to_slug text,manual_edit_fields jsonb DEFAULT '{}',descriptions jsonb,
        source jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now()
      ); CREATE TABLE retained_user_data(station_id text REFERENCES stations(id),favorites int,history int,ratings int);`);

      await t.test('all five redirect once, retaining every source/target field, alias, description and user reference', async () => {
        await reset(); const before = await rows(), references = await related();
        await db.exec(migration); const after = await rows();
        assert.equal(after.length, 10);
        for (const pair of pairs) {
          const sourceBefore = before.find((row: any) => row.id === pair.source.id)!;
          const sourceAfter = after.find((row: any) => row.id === pair.source.id)!;
          assert.equal(sourceAfter.redirect_to_slug, pair.target.slug);
          assert.equal(sourceAfter.source.redirectToSlug, pair.target.slug);
          for (const field of Object.keys(sourceBefore).filter(field => !['redirect_to_slug', 'source', 'updated_at'].includes(field))) {
            assert.deepEqual(sourceAfter[field], sourceBefore[field], `${pair.source.slug}: ${field}`);
          }
          assert.deepEqual(sourceAfter.source.retained, sourceBefore.source.retained);
          assert.deepEqual(sourceAfter.source[auditKey].previous, {
            redirectToSlug: null, sourceHadRedirectToSlug: true, sourceRedirectToSlug: null,
            noIndex: true, updatedAt: '2026-09-01T00:00:00+00:00',
          });
          assert.deepEqual(sourceAfter.source[auditKey].reviewedSource, pair.source);
          assert.deepEqual(sourceAfter.source[auditKey].reviewedTarget, pair.target);
          assert.deepEqual(after.find((row: any) => row.id === pair.target.id), before.find((row: any) => row.id === pair.target.id));
        }
        assert.deepEqual(await related(), references);
        await db.exec(migration);
        assert.deepEqual(await rows(), after, 'repeat execution must not replace original audit values/timestamps');
      });

      await t.test('source/target identity drift fails closed for UUID, slug, name, country, homepage and both URLs', async () => {
        for (const side of ['source', 'target'] as const) for (const field of ['station_uuid', 'slug', 'name', 'country', 'country_code', 'homepage', 'url', 'url_resolved']) {
          await reset();
          await db.query(`UPDATE stations SET ${field}=${field}||'-changed' WHERE id=ANY($1::text[])`, [pairs.map(pair => pair[side].id)]);
          await unchanged();
        }
      });

      await t.test('manual edits, existing redirects, nonobject metadata and exclusion changes are never overridden', async () => {
        for (const [side, sql] of [
          ['source', "manual_edit_fields='{\"name\":true}'"], ['target', "manual_edit_fields='{\"descriptions\":true}'"],
          ['source', "redirect_to_slug='previous-choice'"], ['target', "redirect_to_slug='elsewhere'"],
          ['source', "source='[]'"], ['source', 'no_index=false'], ['target', 'no_index=true'],
          ['source', `source=jsonb_build_object('${auditKey}',jsonb_build_object('retained',true))`],
        ] as const) {
          await reset(); await db.query(`UPDATE stations SET ${sql} WHERE id=ANY($1::text[])`, [pairs.map(pair => pair[side].id)]);
          await unchanged();
        }
      });

      await t.test('every target must retain all 14 nonempty string full/meta pairs', async () => {
        for (const value of [null, {}, { en: descriptions.en },
          { ...descriptions, he: null }, { ...descriptions, he: { full: '\t\n ', meta: 'Meta' } },
          { ...descriptions, he: { full: 'Full', meta: '' } }, { ...descriptions, he: { full: 'Full', meta: 123 } }]) {
          await reset(); await db.query('UPDATE stations SET descriptions=$1 WHERE no_index=false', [value]); await unchanged();
        }
      });

      await t.test('ambiguous canonical/alias owners and incoming direct/alias chains cannot be introduced', async () => {
        for (const scenario of ['source-slug', 'target-slug', 'source-alias', 'incoming', 'incoming-alias', 'claimed-alias']) {
          await reset();
          for (const pair of pairs) {
            const alias = aliases[pair.source.slug]?.[0] || pair.source.slug + '-historic';
            await db.query('UPDATE stations SET slug_aliases=ARRAY[$2] WHERE id=$1', [pair.source.id, alias]);
            await db.query('INSERT INTO stations(id,station_uuid,slug,slug_aliases,redirect_to_slug) VALUES ($1,$1,$2,$3,$4)',
              ['other-' + pair.source.id,
                scenario === 'source-slug' ? pair.source.slug : scenario === 'target-slug' ? pair.target.slug : scenario === 'source-alias' ? alias : 'other-' + pair.source.slug,
                scenario === 'claimed-alias' ? [alias] : [],
                scenario === 'incoming' ? pair.source.slug : scenario === 'incoming-alias' ? alias : null]);
          }
          await unchanged();
        }
      });

      await t.test('missing reviewed rows are skipped without touching remaining targets or unrelated stations', async () => {
        await reset();
        await db.exec('DELETE FROM retained_user_data WHERE station_id IN (SELECT id FROM stations WHERE no_index=true); DELETE FROM stations WHERE no_index=true');
        await unchanged();
      });

      await t.test('audited previous values can exactly restore source rows without changing user references', async () => {
        await reset();
        await db.exec("UPDATE stations SET source=source-'redirectToSlug' WHERE no_index=true");
        const before = await rows(), references = await related(); await db.exec(migration);
        for (const pair of pairs) {
          await db.query(`UPDATE stations SET redirect_to_slug=source->$2->'previous'->>'redirectToSlug',
            updated_at=(source->$2->'previous'->>'updatedAt')::timestamptz,
            source=CASE WHEN (source->$2->'previous'->>'sourceHadRedirectToSlug')::boolean
              THEN (source-$2)||jsonb_build_object('redirectToSlug',source->$2->'previous'->'sourceRedirectToSlug')
              ELSE source-$2-'redirectToSlug' END
            WHERE id=$1 AND redirect_to_slug=$3 AND source->$2->'reviewedTarget'->>'id'=$4`,
          [pair.source.id, auditKey, pair.target.slug, pair.target.id]);
        }
        assert.deepEqual(await rows(), before); assert.deepEqual(await related(), references);
      });
    } finally { await db.close(); }
  });

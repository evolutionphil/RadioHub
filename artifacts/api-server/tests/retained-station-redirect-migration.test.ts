import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const migration = await readFile(new URL('../../../lib/db/migrations/0041_verified_retained_station_redirects.sql', import.meta.url), 'utf8');
const audit = JSON.parse(await readFile(new URL('../../../docs/audits/2026-09-25-retained-redirect-candidates.json', import.meta.url), 'utf8'));
const auditKey = 'verifiedRetainedRedirectRepair20260925';
const pairs = JSON.parse(migration.match(/\$reviewed\$([\s\S]*?)\$reviewed\$/)![1]) as Array<{
  source: Record<string, string>; target: Record<string, string>; evidence: string; reason: string;
}>;
const languages = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];
const descriptions = Object.fromEntries(languages.map(language => [language, { full: `Full ${language}`, meta: `Meta ${language}` }]));

test('retained repair contains only the three audited exact identities and no destructive/indexing mutation', () => {
  assert.deepEqual(pairs.map(pair => [pair.source.id, pair.target.id]), [
    ['68a8c46dbd66579311aaf9f0', '68a8c46dbd66579311aaf9ef'],
    ['68a8c477bd66579311ab1214', '68a8c477bd66579311ab120d'],
    ['68a8c468bd66579311aaedf0', '68a8c468bd66579311aaeded'],
  ]);
  assert.equal(new Set(pairs.flatMap(pair => [pair.source.id, pair.target.id])).size, 6);
  const publicField: Record<string, string> = {
    station_uuid: 'stationuuid', country_code: 'countryCode', url_resolved: 'urlResolved',
  };
  for (const pair of pairs) {
    const reviewed = audit.pairs.find((entry: any) => entry.source.id === pair.source.id);
    assert.ok(reviewed);
    for (const side of ['source', 'target'] as const) {
      assert.match(pair[side].station_uuid, /^[a-f0-9-]{36}$/);
      assert.deepEqual(Object.keys(pair[side]).sort(), ['id', 'station_uuid', 'name', 'slug', 'country', 'country_code', 'url', 'url_resolved', 'homepage'].sort());
      for (const [field, value] of Object.entries(pair[side])) {
        assert.ok(value);
        assert.equal(value, reviewed[side][publicField[field] || field], `${side}.${field} must match the final read-only audit`);
      }
    }
    assert.equal(reviewed.checks.targetAll14FullMeta, true);
    assert.equal(reviewed.targetHtml.status, 200);
    assert.equal(reviewed.targetHtml.indexable, true);
    assert.equal(reviewed.targetHtml.canonical, `https://themegaradio.com/en/station/${pair.target.slug}`);
    assert.equal(pair.evidence, reviewed.target.apiUrl);
  }
  assert.doesNotMatch(migration, /\b(?:DELETE\s+FROM|TRUNCATE|INSERT\s+INTO)\b/i);
  assert.doesNotMatch(migration, /\b(?:no_index|slug_aliases|descriptions|name|url)\s*=/i);
  assert.match(migration, /LOCK TABLE stations IN SHARE ROW EXCLUSIVE MODE NOWAIT/);
  assert.match(migration, /ORDER BY id FOR UPDATE/);
});

// Actual isolated PostgreSQL/PLpgSQL execution. PGlite does not prove native
// multi-connection lock contention; no production connection is opened.
test('retained redirect migration preserves catalogue data and fails closed under drift',
  { skip: !process.env.RADIOHUB_PGLITE_ENTRY }, async t => {
    const { PGlite } = await import(pathToFileURL(process.env.RADIOHUB_PGLITE_ENTRY!).href);
    const db = await PGlite.create();
    const rows = async () => (await db.query('SELECT * FROM stations ORDER BY id')).rows;
    const related = async () => (await db.query('SELECT * FROM retained_user_data ORDER BY station_id')).rows;
    const ids = (side: 'source' | 'target') => pairs.map(pair => pair[side].id);
    const reset = async () => {
      await db.exec('DELETE FROM retained_user_data; DELETE FROM stations');
      for (const pair of pairs) for (const [side, identity] of Object.entries({ source: pair.source, target: pair.target })) {
        const columns = Object.keys(identity);
        const historicalAlias = `${identity.slug}-historical`;
        await db.query(`INSERT INTO stations(${columns.join(',')},slug_aliases,no_index,descriptions,source,updated_at)
          VALUES (${columns.map((_, index) => '$' + (index + 1)).join(',')},$${columns.length + 1},$${columns.length + 2},$${columns.length + 3},$${columns.length + 4},'2026-09-01T00:00:00Z')`,
        [...Object.values(identity), [historicalAlias], side === 'source', descriptions,
          { retained: { providerMetadata: true }, automaticNoIndex: { retained: true }, redirectToSlug: null, noIndex: side === 'source' }]);
        await db.query('INSERT INTO retained_user_data(station_id,favorites,history,ratings) VALUES ($1,3,4,5)', [identity.id]);
      }
      // Similar names/streams do not authorize another identity: only pinned IDs
      // may change, and retained references to unrelated records remain valid.
      await db.query(`INSERT INTO stations(id,station_uuid,name,slug,country,country_code,url,url_resolved,homepage,no_index,source)
        VALUES ('unreviewed','unreviewed-uuid',$1,'unreviewed-channel',$2,$3,$4,$4,$5,true,'{"untouched":true}')`,
      [pairs[0].source.name, pairs[0].source.country, pairs[0].source.country_code, pairs[0].source.url, pairs[0].source.homepage]);
      await db.query('INSERT INTO retained_user_data(station_id,favorites,history,ratings) VALUES ($1,7,8,9)', ['unreviewed']);
    };
    const unchanged = async () => {
      const before = await rows(), references = await related();
      await db.exec(migration);
      assert.deepEqual(await rows(), before, 'guarded records remain byte-for-byte unchanged');
      assert.deepEqual(await related(), references);
    };
    const restore = async () => {
      for (const pair of pairs) await db.query(`UPDATE stations
        SET redirect_to_slug=source->$2->'previous'->>'redirectToSlug',
          updated_at=(source->$2->'previous'->>'updatedAt')::timestamptz,
          source=CASE WHEN (source->$2->'previous'->>'sourceHadRedirectToSlug')::boolean
            THEN (source-$2)||jsonb_build_object('redirectToSlug',source->$2->'previous'->'sourceRedirectToSlug')
            ELSE source-$2-'redirectToSlug' END
        WHERE id=$1 AND redirect_to_slug=$3 AND source->$2->'reviewedTarget'->>'id'=$4`,
      [pair.source.id, auditKey, pair.target.slug, pair.target.id]);
    };
    try {
      await db.exec(`CREATE TABLE stations (
        id text PRIMARY KEY,station_uuid text UNIQUE,name text,slug text,slug_aliases text[] NOT NULL DEFAULT '{}',
        country text,country_code text,state text,url text,url_resolved text,homepage text,
        no_index boolean,redirect_to_slug text,manual_edit_fields jsonb DEFAULT '{}',descriptions jsonb,
        source jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now()
      ); CREATE TABLE retained_user_data(station_id text REFERENCES stations(id),favorites int,history int,ratings int);`);

      await t.test('all three redirect once while every target, alias, index flag, description and user reference is retained', async () => {
        await reset(); const before = await rows(), references = await related();
        await db.exec(migration); const after = await rows();
        assert.equal(after.length, 7);
        for (const pair of pairs) {
          const original = before.find((row: any) => row.id === pair.source.id)!;
          const changed = after.find((row: any) => row.id === pair.source.id)!;
          assert.equal(changed.redirect_to_slug, pair.target.slug);
          assert.equal(changed.source.redirectToSlug, pair.target.slug);
          for (const field of Object.keys(original).filter(field => !['redirect_to_slug', 'source', 'updated_at'].includes(field))) {
            assert.deepEqual(changed[field], original[field], `${pair.source.slug}: ${field}`);
          }
          assert.deepEqual({ ...changed.source, redirectToSlug: original.source.redirectToSlug, [auditKey]: undefined },
            { ...original.source, [auditKey]: undefined });
          assert.deepEqual(changed.source[auditKey].previous, {
            redirectToSlug: null, sourceHadRedirectToSlug: true, sourceRedirectToSlug: null,
            noIndex: true, updatedAt: '2026-09-01T00:00:00+00:00',
          });
          assert.deepEqual(changed.source[auditKey].reviewedSource, pair.source);
          assert.deepEqual(changed.source[auditKey].reviewedTarget, pair.target);
          assert.equal(changed.source[auditKey].evidenceAudit, 'docs/audits/2026-09-25-retained-redirect-candidates.json');
          assert.deepEqual(after.find((row: any) => row.id === pair.target.id), before.find((row: any) => row.id === pair.target.id));
        }
        assert.deepEqual(after.find((row: any) => row.id === 'unreviewed'), before.find((row: any) => row.id === 'unreviewed'));
        assert.deepEqual(await related(), references);
      });

      await t.test('repeat execution preserves original audit data and timestamps', async () => {
        await reset(); await db.exec(migration); const after = await rows();
        await db.exec(migration); assert.deepEqual(await rows(), after);
      });

      await t.test('both identity snapshots fail closed on every pinned field change', async () => {
        for (const side of ['source', 'target'] as const) for (const field of ['station_uuid', 'slug', 'name', 'country', 'country_code', 'homepage', 'url', 'url_resolved']) {
          await reset();
          await db.query(`UPDATE stations SET ${field}=${field}||'-changed' WHERE id=ANY($1::text[])`, [ids(side)]);
          await unchanged();
        }
      });

      await t.test('missing exact IDs never substitute similar records', async () => {
        for (const side of ['source', 'target'] as const) {
          await reset();
          await db.query('DELETE FROM retained_user_data WHERE station_id=ANY($1::text[])', [ids(side)]);
          await db.query('DELETE FROM stations WHERE id=ANY($1::text[])', [ids(side)]);
          await unchanged();
        }
      });

      await t.test('manual flags and uncertain manual metadata are protected on either identity', async () => {
        for (const side of ['source', 'target'] as const) for (const value of [{ name: true }, { noIndex: false }, { descriptions: true }, [], null]) {
          await reset();
          await db.query('UPDATE stations SET manual_edit_fields=$1 WHERE id=ANY($2::text[])', [value, ids(side)]);
          await unchanged();
        }
      });

      await t.test('exclusion changes, existing redirects and inconsistent JSON redirect metadata are never overwritten', async () => {
        for (const [side, sql] of [
          ['source', 'no_index=false'], ['source', 'no_index=NULL'], ['target', 'no_index=true'], ['target', 'no_index=NULL'],
          ['source', "redirect_to_slug='prior-choice'"], ['target', "redirect_to_slug='another-destination'"],
          ['source', "source=source||'{\"redirectToSlug\":\"prior-choice\"}'"],
          ['target', "source=source||'{\"redirectToSlug\":\"another-destination\"}'"],
          ['source', `source=source||jsonb_build_object('${auditKey}',jsonb_build_object('prior',true))`],
        ] as const) {
          await reset(); await db.query(`UPDATE stations SET ${sql} WHERE id=ANY($1::text[])`, [ids(side)]);
          await unchanged();
        }
        for (const side of ['source', 'target'] as const) for (const sql of ["source='[]'", "source='null'", 'source=NULL']) {
          await reset(); await db.query(`UPDATE stations SET ${sql} WHERE id=ANY($1::text[])`, [ids(side)]); await unchanged();
        }
      });

      await t.test('all fourteen target locales require nonempty string full and meta descriptions', async () => {
        for (const language of languages) for (const field of ['full', 'meta']) {
          await reset();
          await db.query('UPDATE stations SET descriptions=descriptions #- $1::text[] WHERE id=ANY($2::text[])', [[language, field], ids('target')]);
          await unchanged();
        }
        for (const value of [null, {}, [], { ...descriptions, he: null },
          { ...descriptions, he: { full: '\t\n ', meta: 'Meta' } },
          { ...descriptions, he: { full: 'Full', meta: '' } },
          { ...descriptions, he: { full: 'Full', meta: 123 } }]) {
          await reset(); await db.query('UPDATE stations SET descriptions=$1 WHERE id=ANY($2::text[])', [value, ids('target')]);
          await unchanged();
        }
      });

      await t.test('third-party canonical and alias ownership plus incoming redirect chains fail closed', async () => {
        for (const scenario of ['source-slug', 'target-slug', 'source-alias', 'target-alias',
          'claimed-source', 'claimed-target', 'shared-source-alias', 'shared-target-alias', 'incoming', 'incoming-alias']) {
          await reset();
          for (const pair of pairs) {
            const sourceAlias = `${pair.source.slug}-historical`, targetAlias = `${pair.target.slug}-historical`;
            const slug = scenario === 'source-slug' ? pair.source.slug : scenario === 'target-slug' ? pair.target.slug
              : scenario === 'source-alias' ? sourceAlias : scenario === 'target-alias' ? targetAlias : 'other-' + pair.source.slug;
            const claimed = scenario === 'claimed-source' ? [pair.source.slug] : scenario === 'claimed-target' ? [pair.target.slug]
              : scenario === 'shared-source-alias' ? [sourceAlias] : scenario === 'shared-target-alias' ? [targetAlias] : [];
            const redirect = scenario === 'incoming' ? pair.source.slug : scenario === 'incoming-alias' ? sourceAlias : null;
            await db.query('INSERT INTO stations(id,station_uuid,slug,slug_aliases,redirect_to_slug) VALUES ($1,$1,$2,$3,$4)',
              ['other-' + pair.source.id, slug, claimed, redirect]);
          }
          await unchanged();
        }
      });

      await t.test('source and target may retain their own overlapping aliases without transferring them', async () => {
        await reset();
        for (const pair of pairs) await db.query('UPDATE stations SET slug_aliases=ARRAY[$2,$3] WHERE id=$1',
          [pair.target.id, pair.source.slug, `${pair.source.slug}-historical`]);
        const before = await rows(); await db.exec(migration); const after = await rows();
        for (const pair of pairs) {
          assert.equal(after.find((row: any) => row.id === pair.source.id)?.redirect_to_slug, pair.target.slug);
          for (const identity of [pair.source, pair.target]) assert.deepEqual(
            after.find((row: any) => row.id === identity.id)?.slug_aliases,
            before.find((row: any) => row.id === identity.id)?.slug_aliases);
        }
      });

      await t.test('one changed pair is skipped while the two independently proven pairs still apply', async () => {
        await reset(); await db.query("UPDATE stations SET name=name||'-changed' WHERE id=$1", [pairs[0].target.id]);
        await db.exec(migration); const after = await rows();
        assert.equal(after.find((row: any) => row.id === pairs[0].source.id)?.redirect_to_slug, null);
        for (const pair of pairs.slice(1)) assert.equal(after.find((row: any) => row.id === pair.source.id)?.redirect_to_slug, pair.target.slug);
      });

      await t.test('the previous-value journal exactly restores both absent and JSON-null source redirect fields', async () => {
        for (const absent of [false, true]) {
          await reset();
          if (absent) await db.query("UPDATE stations SET source=source-'redirectToSlug' WHERE id=ANY($1::text[])", [ids('source')]);
          const before = await rows(), references = await related();
          await db.exec(migration); await restore();
          assert.deepEqual(await rows(), before); assert.deepEqual(await related(), references);
        }
      });

      await t.test('a transaction failure rolls back earlier pairs and their audit journals together', async () => {
        await reset(); const before = await rows(), references = await related();
        await db.exec(`ALTER TABLE stations ADD CONSTRAINT fixture_reject_last_redirect CHECK
          (redirect_to_slug IS NULL OR id <> '${pairs[2].source.id}')`);
        await assert.rejects(db.exec(`BEGIN; ${migration} COMMIT;`), /fixture_reject_last_redirect/);
        await db.exec('ROLLBACK; ALTER TABLE stations DROP CONSTRAINT fixture_reject_last_redirect');
        assert.deepEqual(await rows(), before); assert.deepEqual(await related(), references);
      });
    } finally { await db.close(); }
  });

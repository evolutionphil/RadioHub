import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { pgAdminDescriptionCoverage, pgDescriptionRepairStationIds } from '../src/data/postgres-admin-catalog-store';
import { adminDescriptionFilterSql, descriptionTextSql } from '../src/data/station-description-sql';

const languages = SITEMAP_PRIORITY_LANGUAGES.universal14;
const allMask = (1 << languages.length) - 1;
const complete = () => Object.fromEntries(languages.map(language => [language, { full: `${language} full`, meta: `${language} meta` }]));
const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
function expectedMasks(descriptions: any) {
  let full_mask = 0, meta_mask = 0;
  if (descriptions && typeof descriptions === 'object' && !Array.isArray(descriptions)) {
    languages.forEach((language, index) => {
      if (hasText(descriptions[language]?.full)) full_mask |= 1 << index;
      if (hasText(descriptions[language]?.meta)) meta_mask |= 1 << index;
    });
  }
  return { full_mask, meta_mask };
}

// Explicit opt-in only: PGlite is an isolated PostgreSQL engine, never a
// production connection. It verifies SQL/transaction semantics, not concurrent
// network sessions or row-lock scheduling between different connections.
test('description summary migrations, triggers and admin queries match stored content',
  { skip: !process.env.RADIOHUB_PGLITE_ENTRY, timeout: 90_000 }, async t => {
    const { PGlite } = await import(pathToFileURL(process.env.RADIOHUB_PGLITE_ENTRY!).href);
    const db = await PGlite.create();
    const migrations = await Promise.all(['0035_station_description_summary.sql', '0036_backfill_station_description_summary.sql']
      .map(file => readFile(new URL(`../../../lib/db/migrations/${file}`, import.meta.url), 'utf8')));
    const pool = { query: async (query: string | { text: string; values?: unknown[] }, values?: unknown[]) => {
      const result = await db.query(typeof query === 'string' ? query : query.text, values ?? (typeof query === 'string' ? undefined : query.values));
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    } } as any;
    const insert = (id: string, descriptions: unknown, options: { noIndex?: boolean | null; redirect?: string | null; manual?: unknown } = {}) => db.query(
      'INSERT INTO stations(id,descriptions,no_index,redirect_to_slug,manual_edit_fields) VALUES($1,$2::jsonb,$3,$4,$5::jsonb)',
      [id, descriptions === undefined ? null : JSON.stringify(descriptions), options.noIndex === undefined ? false : options.noIndex,
        options.redirect ?? null, JSON.stringify(options.manual ?? {})]);
    const summary = async (id: string) => (await db.query('SELECT * FROM station_description_summary WHERE station_id=$1', [id])).rows[0];
    const clear = () => db.exec('TRUNCATE stations CASCADE');
    const applyMigration = (sql: string) => db.exec(`BEGIN;\n${sql}\nCOMMIT;`);
    try {
      await db.exec(`CREATE TABLE stations(id text PRIMARY KEY,descriptions jsonb,no_index boolean,
        redirect_to_slug text,manual_edit_fields jsonb);
        CREATE TABLE bulk_description_jobs(id text PRIMARY KEY)`);
      await insert('old-empty', {});
      await insert('old-updated', { en: { full: 'Old full' } });
      await applyMigration(migrations[0]);

      await t.test('backfill includes old rows while preserving newer trigger-written summaries', async () => {
        assert.equal((await db.query('SELECT count(*)::int count FROM station_description_summary')).rows[0].count, 0);
        await db.query('UPDATE stations SET descriptions=$1::jsonb WHERE id=$2', [JSON.stringify(complete()), 'old-updated']);
        const updated = await summary('old-updated');
        assert.equal(updated.full_mask, allMask); assert.equal(updated.meta_mask, allMask);
        await applyMigration(migrations[1]);
        assert.deepEqual(await summary('old-updated'), updated);
        assert.deepEqual(await summary('old-empty'), { station_id: 'old-empty', full_mask: 0, meta_mask: 0, language_check_needed: false });
        await applyMigration(migrations[1]);
        assert.equal((await db.query('SELECT count(*)::int count FROM station_description_summary')).rows[0].count, 2, 'backfill is repeatable');
        await db.query("INSERT INTO bulk_description_jobs(id,publish_status) VALUES('fixture-job','pending')");
        assert.equal((await db.query('SELECT publish_status FROM bulk_description_jobs')).rows[0].publish_status, 'pending');
      });

      await t.test('type, Unicode whitespace and all fourteen presence bits match the application contract', async () => {
        await clear();
        const fixtures: Array<{ id: string; descriptions: any }> = [
          { id: 'sql-null', descriptions: undefined }, { id: 'json-null', descriptions: null },
          { id: 'empty', descriptions: {} }, { id: 'array', descriptions: [{ full: 'wrong shape' }] },
          { id: 'scalar-string', descriptions: 'malformed' }, { id: 'scalar-boolean', descriptions: true },
          { id: 'scalar-number', descriptions: 42 }, { id: 'all-fourteen', descriptions: complete() },
          { id: 'full-only', descriptions: { en: { full: 'Article' } } },
          { id: 'meta-only', descriptions: { he: { meta: 'Metadata' } } },
          { id: 'different-bits', descriptions: { en: { full: 'Article' }, de: { meta: 'Metadata' } } },
          { id: 'locale-shapes', descriptions: { en: null, de: [], ar: 'not an object', ja: false } },
          { id: 'field-types', descriptions: { en: { full: 42, meta: true }, fr: { full: ['Article'], meta: { text: 'Metadata' } } } },
          { id: 'unsupported', descriptions: { xx: { full: 'Unsupported', meta: 'Unsupported' }, EN: { full: 'Uppercase key is unsupported' } } },
        ];
        const whitespace = [' ', '\t', '\n', '\r', '\v', '\f', '\u00a0', '\u1680', ...Array.from({ length: 11 }, (_, n) => String.fromCharCode(0x2000 + n)), '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff'];
        whitespace.forEach((space, index) => fixtures.push({ id: `space-${index}`, descriptions: { en: { full: space, meta: space.repeat(2) }, ja: { full: `${space}文${space}` } } }));
        for (const character of ['\u0085', '\u180e', '\u200b']) fixtures.push({ id: `nontrim-${character.codePointAt(0)}`, descriptions: { en: { full: character, meta: character } } });
        for (let index = 0; index < languages.length; index++) {
          fixtures.push({ id: `bit-${index}`, descriptions: { [languages[index]]: { full: 'Full', meta: 'Meta' } } });
        }
        for (const fixture of fixtures) {
          await insert(fixture.id, fixture.descriptions);
          const actual = await summary(fixture.id);
          assert.deepEqual({ full_mask: actual.full_mask, meta_mask: actual.meta_mask }, expectedMasks(fixture.descriptions), fixture.id);
          const direct = await db.query(`SELECT
            COALESCE(sum(1 << (locale.ordinality::int-1)) FILTER(WHERE ${descriptionTextSql("entry.value->'full'")}),0)::int AS full_mask,
            COALESCE(sum(1 << (locale.ordinality::int-1)) FILTER(WHERE ${descriptionTextSql("entry.value->'meta'")}),0)::int AS meta_mask
            FROM stations s CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(s.descriptions)='object' THEN s.descriptions ELSE '{}'::jsonb END) entry
            JOIN unnest($2::text[]) WITH ORDINALITY locale(language,ordinality) ON locale.language=entry.key
            WHERE s.id=$1`, [fixture.id, languages]);
          assert.deepEqual(direct.rows[0], expectedMasks(fixture.descriptions), `${fixture.id}: shared SQL text predicate`);
        }
        for (const state of ['yes', 'no', 'partial'] as const) {
          const expected = fixtures.filter(fixture => {
            const mask = expectedMasks(fixture.descriptions);
            return state === 'yes' ? (mask.full_mask | mask.meta_mask) !== 0 : state === 'no'
              ? (mask.full_mask | mask.meta_mask) === 0 : (mask.full_mask & mask.meta_mask) !== allMask;
          }).map(fixture => fixture.id).sort();
          const actual = await db.query(`SELECT s.id FROM stations s JOIN station_description_summary d ON d.station_id=s.id
            WHERE ${adminDescriptionFilterSql(state)} ORDER BY s.id`);
          assert.deepEqual(actual.rows.map((row: any) => row.id), expected, `${state} filter`);
        }
        assert.equal(adminDescriptionFilterSql(), 'TRUE');
        assert.equal(adminDescriptionFilterSql('unexpected'), 'TRUE');
      });

      await t.test('summary changes are transactional and foreign-key cascades follow station IDs', async () => {
        await clear(); await insert('changing', { en: { full: 'Retained full' } });
        const before = await summary('changing');
        await db.exec('BEGIN');
        await db.query('UPDATE stations SET descriptions=$1::jsonb WHERE id=$2', [JSON.stringify(complete()), 'changing']);
        assert.equal((await summary('changing')).full_mask, allMask);
        await db.exec('ROLLBACK');
        assert.deepEqual(await summary('changing'), before);
        await db.query("UPDATE stations SET descriptions='{}'::jsonb WHERE id='changing'");
        assert.equal((await summary('changing')).full_mask, 0);
        await db.query("UPDATE stations SET id='renamed' WHERE id='changing'");
        assert.equal(await summary('changing'), undefined); assert.equal((await summary('renamed')).station_id, 'renamed');
        await db.query("UPDATE stations SET id='renamed-with-content',descriptions=$1::jsonb WHERE id='renamed'", [JSON.stringify(complete())]);
        assert.equal(await summary('renamed'), undefined); assert.equal((await summary('renamed-with-content')).meta_mask, allMask);
        await db.query("DELETE FROM stations WHERE id='renamed-with-content'");
        assert.equal((await db.query('SELECT count(*)::int count FROM station_description_summary')).rows[0].count, 0);
      });

      await t.test('coverage and eligible repair IDs execute against the summary with correct exclusions', async () => {
        await clear();
        const rows = [
          { id: 'a-empty', descriptions: {}, options: {} },
          { id: 'b-meta-only', descriptions: { en: { meta: 'Retained metadata' } }, options: { redirect: '' } },
          { id: 'c-complete', descriptions: complete(), options: {} },
          { id: 'd-hidden', descriptions: { en: { full: 'Retained full' } }, options: { noIndex: true } },
          { id: 'e-redirect', descriptions: {}, options: { redirect: 'survivor' } },
          { id: 'f-manual', descriptions: {}, options: { manual: { descriptions: true } } },
          { id: 'g-null-indexability', descriptions: {}, options: { noIndex: null } },
          { id: 'h-other-manual', descriptions: {}, options: { manual: { name: true, descriptions: false } } },
          { id: 'i-script-candidate', descriptions: { ...complete(), ar: { full: 'This entire paragraph is English prose, even though the target locale requires Arabic.', meta: 'An English metadata sentence that requires Arabic translation.' } }, options: {} },
        ];
        for (const row of rows) await insert(row.id, row.descriptions, row.options);
        const coverage = await pgAdminDescriptionCoverage(pool);
        assert.equal(coverage.totalStations, rows.length); assert.equal(coverage.indexableStations, rows.length - 1);
        languages.forEach(language => {
          const withFull = rows.filter(row => hasText((row.descriptions as any)[language]?.full)).length;
          const withMeta = rows.filter(row => hasText((row.descriptions as any)[language]?.meta)).length;
          const withComplete = rows.filter(row => hasText((row.descriptions as any)[language]?.full) && hasText((row.descriptions as any)[language]?.meta)).length;
          assert.deepEqual(coverage.languages.find(value => value.language === language), { language, withFull, withMeta, withComplete,
            missingFull: rows.length - withFull, missingMeta: rows.length - withMeta, missingComplete: rows.length - withComplete,
            pctFull: Math.round(withFull / rows.length * 1000) / 10, pctComplete: Math.round(withComplete / rows.length * 1000) / 10 });
        });
        assert.equal((await summary('i-script-candidate')).language_check_needed, true);
        assert.deepEqual(await pgDescriptionRepairStationIds(pool), ['a-empty', 'b-meta-only', 'h-other-manual', 'i-script-candidate']);
        await clear();
        const empty = await pgAdminDescriptionCoverage(pool);
        assert.equal(empty.totalStations, 0); assert.equal(empty.indexableStations, 0);
        assert.ok(empty.languages.every(value => value.withComplete === 0 && value.pctComplete === 0 && value.pctFull === 0));
        assert.deepEqual(await pgDescriptionRepairStationIds(pool), []);
      });

      await t.test('one thousand multilingual articles preserve aggregate results with measured scan costs', async () => {
        await clear();
        const native: Record<string, string> = {
          ru: 'Радиостанция передаёт музыку и сохраняет сведения о своём вещании. ',
          ar: 'تقدم المحطة الموسيقى وتحافظ على المعلومات الواردة في وصفها الأصلي. ',
          zh: '电台资料介绍音乐内容并保留原始名称以及广播节目的基本信息。',
          ja: '放送局の紹介には音楽の内容と元の名前を含む基本情報が掲載されています。',
          ko: '방송국의 소개에는 음악과 원래 이름을 포함한 방송의 기본 정보가 있습니다. ',
          hi: 'रेडियो स्टेशन के विवरण में संगीत और मूल नाम से जुड़ी जानकारी दी गई है। ',
          he: 'תיאור תחנת הרדיו כולל מידע על המוזיקה ועל השם המקורי שלה. ',
        };
        const fixture = Object.fromEntries(languages.map(language => {
          const sentence = native[language] || `Station description for locale ${language} preserves the supplied music and location information. `;
          return [language, { full: sentence.repeat(24), meta: sentence.repeat(2) }];
        }));
        await db.query(`INSERT INTO stations(id,descriptions,no_index,manual_edit_fields)
          SELECT 'bench-'||n,$1::jsonb,false,'{}'::jsonb FROM generate_series(1,1000) n`, [JSON.stringify(fixture)]);
        const full = descriptionTextSql("entry.value->'full'"), meta = descriptionTextSql("entry.value->'meta'");
        const columns = languages.flatMap(language => [['full', full], ['meta', meta], ['complete', `(${full} AND ${meta})`]]
          .map(([field, predicate]) => `count(*) FILTER(WHERE entry.key='${language}' AND ${predicate})::int AS "${language}_${field}"`));
        const scanSql = `SELECT ${columns.join(',')} FROM stations s CROSS JOIN LATERAL jsonb_each(s.descriptions) entry`;
        await db.query(scanSql); await pgAdminDescriptionCoverage(pool);
        const scanStart = performance.now();
        const scanned = (await db.query(scanSql)).rows[0];
        const scanMs = performance.now() - scanStart;
        const summaryStart = performance.now();
        const summarized = await pgAdminDescriptionCoverage(pool);
        const summaryMs = performance.now() - summaryStart;
        assert.equal(summarized.totalStations, 1000);
        for (const locale of summarized.languages) {
          assert.equal(locale.withFull, scanned[`${locale.language}_full`]);
          assert.equal(locale.withMeta, scanned[`${locale.language}_meta`]);
          assert.equal(locale.withComplete, scanned[`${locale.language}_complete`]);
        }
        t.diagnostic(`1,000 stations × 14 locales (${Buffer.byteLength(JSON.stringify(fixture)).toLocaleString('en-US')} JSON bytes/station): full JSON aggregate ${scanMs.toFixed(1)}ms; summary coverage ${summaryMs.toFixed(1)}ms. Timing is informational, not a pass threshold.`);
      });
    } finally { await db.close(); }
  });

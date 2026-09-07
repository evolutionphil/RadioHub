// This is deliberately not a general non-transactional SQL runner. Only the
// single reviewed expression-index grammar below can opt out of BEGIN/COMMIT.
export function parseConcurrentIndexMigration(sql) {
  if (!sql.startsWith('-- radiohub:concurrent-index\n') && !sql.startsWith('-- radiohub:concurrent-index\r\n')) return null;
  const statement = sql.replace(/^--[^\r\n]*(?:\r?\n|$)/gm, '').trim();
  const match = /^CREATE INDEX CONCURRENTLY (stations_source_genre_trgm_idx) ON (stations) USING gin \(\(lower\(source->>'genre'\)\) gin_trgm_ops\);$/.exec(statement);
  if (!match) throw new Error('Unsupported concurrent-index migration: expected the reviewed station source genre index only');
  return { name: match[1], table: match[2], statement };
}

async function inspectIndex(client, spec) {
  const result = await client.query(`SELECT i.indisvalid AS valid,i.indisready AS ready,
    i.indrelid=$2::regclass AS correct_table,am.amname AS method,i.indisunique AS unique,
    i.indnkeyatts AS keys,pg_get_expr(i.indexprs,i.indrelid) AS expression,
    i.indpred IS NULL AS no_predicate,opc.opcname AS operator_class
    FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid
    JOIN pg_am am ON am.oid=c.relam JOIN pg_opclass opc ON opc.oid=i.indclass[0]
    WHERE c.oid=to_regclass($1)`, [spec.name, spec.table]);
  const row = result.rows[0];
  if (!row) return null;
  if (!row.correct_table || row.method !== 'gin' || row.unique || row.keys !== 1 || !row.no_predicate
    || row.operator_class !== 'gin_trgm_ops' || row.expression !== "lower((source ->> 'genre'::text))") {
    throw new Error(`Existing concurrent index ${spec.name} has an unexpected definition; refusing to replace it`);
  }
  return row;
}

/** Caller holds the schema advisory lock on this very connection. */
export async function applyConcurrentIndexMigration(client, spec) {
  const previous = await client.query("SELECT current_setting('lock_timeout') AS value");
  // Fail promptly if another writer/DDL cannot yield. CREATE INDEX CONCURRENTLY
  // does not block ordinary DML; the migrator's bounded statement timeout still
  // covers the complete operation and the old deployment can continue serving.
  await client.query("SELECT set_config('lock_timeout','5000',false)");
  try {
    const existing = await inspectIndex(client, spec);
    if (existing?.valid && existing.ready) return;
    if (existing) {
      // A cancelled concurrent build can leave an invalid index behind. Repair
      // only this exact owned definition; never mark an invalid index complete.
      await client.query(`DROP INDEX CONCURRENTLY ${spec.name}`);
    }
    await client.query(spec.statement);
    const completed = await inspectIndex(client, spec);
    if (!completed?.valid || !completed.ready) throw new Error(`Concurrent index ${spec.name} is not valid and ready`);
  } finally {
    await client.query("SELECT set_config('lock_timeout',$1,false)", [previous.rows[0].value]);
  }
}

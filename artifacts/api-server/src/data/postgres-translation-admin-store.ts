import { getPostgresPool } from '../postgres-runtime';
import { newPublicUserId } from './postgres-user-store';
import { seoShape, seoTransaction } from './postgres-seo-indexing-store';
import { pgSeoCatalog } from './postgres-seo-read-store';

/** Return only grouped counters, never full station documents/descriptions.
 * A repeated raw tag or the same legacy genre must count the station once.
 */
export async function pgGenrePopulationCounts():Promise<Array<{tag:string;count:number}>> {
  return (await getPostgresPool().query(`SELECT normalized.tag,count(*)::int count
    FROM stations s CROSS JOIN LATERAL (
      SELECT DISTINCT lower(regexp_replace(raw.tag,'^[[:space:]]+|[[:space:]]+$','','g')) tag
      FROM (
        SELECT unnest(string_to_array(s.tags_raw,',')) tag
        UNION ALL SELECT CASE WHEN jsonb_typeof(s.source->'genre')='string' THEN s.source->>'genre' END
      ) raw
    ) normalized
    WHERE char_length(normalized.tag)>0 AND char_length(normalized.tag)<50
    GROUP BY normalized.tag ORDER BY normalized.tag`)).rows;
}

export async function pgStationFacetCounts(field: 'country' | 'language' | 'codec' | 'tags') {
  const rows = await pgSeoCatalog().groupCount(field, { [field]: { $nin: ['', null] } });
  return rows.filter((row): row is { _id: string; count: number } => typeof row._id === 'string' && row._id !== '')
    .sort((a, b) => b.count - a.count || a._id.localeCompare(b._id));
}

export async function pgGenreLandingCountries(genre: string) {
  const rows = await getPostgresPool().query(`SELECT country AS _id,country AS name,count(*)::int count,
    round(avg(votes)::numeric,1)::float8 AS "avgVotes" FROM stations
    WHERE (source->>'genre'~*$1 OR tags_raw~*$1) AND country IS NOT NULL AND country<>''
    GROUP BY country ORDER BY count DESC,country LIMIT 50`, [genre]);
  return rows.rows;
}

export async function pgGenreLandingRelated(genre: string) {
  const rows = await getPostgresPool().query(`SELECT trim(tag) AS _id,trim(tag) AS name,count(*)::int count
    FROM stations CROSS JOIN LATERAL unnest(string_to_array(tags_raw,',')) tag
    WHERE (source->>'genre'~*$1 OR tags_raw~*$1)
      AND trim(tag)<>ALL($2::text[]) GROUP BY trim(tag) HAVING count(*)>=5
    ORDER BY count DESC,trim(tag) LIMIT 8`, [genre, [genre, '', 'music', 'radio', 'online', 'live', 'stream', 'station']]);
  return rows.rows.map(row => ({ ...row, slug: row.name.replaceAll(' ', '-').replaceAll('--', '-').toLowerCase() }));
}

export async function pgFavoriteIds(userId: string): Promise<string[]> {
  return (await getPostgresPool().query('SELECT station_id FROM user_favorites WHERE user_id=$1 ORDER BY created_at,station_id', [userId])).rows.map(row => row.station_id);
}

export async function pgAnalyticsEvents(options: { from?: Date; to?: Date; event?: string; limit: number }) {
  const rows = await getPostgresPool().query(`SELECT * FROM analytics_events
    WHERE ($1::timestamptz IS NULL OR timestamp>=$1) AND ($2::timestamptz IS NULL OR timestamp<=$2)
      AND ($3='' OR event=$3) ORDER BY timestamp DESC,id LIMIT $4`,
    [options.from || null, options.to || null, options.event || '', Math.max(1,Math.min(1000,options.limit))]);
  return rows.rows.map(row => ({ ...row.source, ...seoShape(row) }));
}

/** Admin fixture helper: account creation, public visibility and additions commit together. */
export async function pgAdminAddFavorites(email: string, stationIds: string[]) {
  const normalizedEmail = email.trim().toLowerCase();
  return seoTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`admin-favorites:${normalizedEmail}`]);
    const ids = [...new Set(stationIds)];
    const existing = await client.query('SELECT id FROM stations WHERE id=ANY($1::text[]) ORDER BY id FOR KEY SHARE', [ids]);
    if (existing.rowCount !== ids.length) throw Object.assign(new Error('One or more stations do not exist'), { statusCode: 400 });
    let user = (await client.query('SELECT * FROM users WHERE lower(email)=$1 FOR UPDATE', [normalizedEmail])).rows[0];
    const name = normalizedEmail.split('@')[0];
    if (!user) {
      const id = newPublicUserId();
      user = (await client.query(`INSERT INTO users(id,username,email,full_name,is_public_profile,source)
        VALUES($1,$2,$3,$4,true,$5) RETURNING *`, [id, `${name}-${id}`, normalizedEmail, name, JSON.stringify({ name })])).rows[0];
    } else {
      user = (await client.query(`UPDATE users SET is_public_profile=true,source=source||$2::jsonb,updated_at=now()
        WHERE id=$1 RETURNING *`, [user.id, JSON.stringify({ name, isPublicProfile: true })])).rows[0];
    }
    await client.query(`INSERT INTO user_favorites(user_id,station_id)
      SELECT $1,id FROM unnest($2::text[]) id ON CONFLICT DO NOTHING`, [user.id, ids]);
    const favorites = (await client.query('SELECT station_id FROM user_favorites WHERE user_id=$1 ORDER BY created_at,station_id', [user.id])).rows.map(row => row.station_id);
    return { _id: user.id, email: user.email, isPublicProfile: user.is_public_profile, favoriteStations: favorites };
  });
}

/** The destructive admin operation must not race a running provider import. */
export async function pgFlushStationData() {
  return seoTransaction(async client => {
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('radiohub-provider-sync')) AS owned");
    if (!lock.rows[0].owned) throw Object.assign(new Error('Station sync is running; request cancellation and wait for it to finish first'), { statusCode: 409 });
    const stations = await client.query('DELETE FROM stations');
    const logs = await client.query('DELETE FROM catalog_sync_runs');
    const blacklist = await client.query('DELETE FROM station_blacklist');
    return { deletedStations: stations.rowCount || 0, deletedSyncLogs: logs.rowCount || 0, deletedBlacklisted: blacklist.rowCount || 0 };
  });
}

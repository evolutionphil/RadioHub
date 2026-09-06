import crypto from 'node:crypto';
import type pg from 'pg';
import { getPostgresPool } from '../postgres-runtime';
const newId = () => crypto.randomBytes(12).toString('hex');
const boundedLimit = (limit: number, maximum = 1000) => Math.max(1, Math.min(maximum, Math.trunc(limit) || 1));
const profileShape = (row: any): any => row ? ({
  ...(row.source || {}), _id: row.id, sessionId: row.session_id, userId: row.user_id,
  preferredGenres: row.preferred_genres, preferredCountries: row.preferred_countries, preferredLanguages: row.preferred_languages,
  averageListenDuration: row.average_listen_duration, peakListeningHours: row.peak_listening_hours, skipRate: row.skip_rate,
  totalStationsListened: row.total_stations_listened, uniqueStationsCount: row.unique_stations_count,
  favoriteStationsCount: row.favorite_stations_count, lastListenedAt: row.last_listened_at, profileStrength: row.profile_strength,
  createdAt: row.created_at, updatedAt: row.updated_at,
}) : null;
export async function pgRecommendationProfile(sessionId: string): Promise<any | null> {
  if (!sessionId) return null;
  return profileShape((await getPostgresPool().query('SELECT * FROM recommendation_profiles WHERE session_id=$1', [sessionId])).rows[0]);
}
const historyShape = (row: any): any => ({
  ...(row.context || {}), _id: row.id, sessionId: row.session_id, userId: row.user_id, stationId: row.station_id,
  stationName: row.station_name, country: row.country, genre: row.genre, listenDuration: row.listen_duration,
  interactionType: row.interaction_type, listenedAt: row.listened_at, deviceType: row.device_type,
  tags: row.context?.tags ?? row.station_tags, language: row.context?.language ?? row.station_language,
  timeOfDay: row.context?.timeOfDay ?? new Date(row.listened_at).getUTCHours(),
});
async function recent(client: Pick<pg.Pool, 'query'> | pg.PoolClient, sessionId: string, limit: number): Promise<any[]> {
  const result = await client.query(`SELECT h.*,s.tags_raw station_tags,s.language station_language FROM listening_history h
    LEFT JOIN stations s ON s.id=h.station_id WHERE h.session_id=$1 ORDER BY h.listened_at DESC,h.id DESC LIMIT $2`, [sessionId, boundedLimit(limit)]);
  return result.rows.map(historyShape);
}
export const pgRecentSessionListening = (sessionId: string, limit = 1000) => recent(getPostgresPool(), sessionId, limit);

export async function pgRecordRecommendationInteraction(input: Record<string, any>, deriveProfile: (history: any[]) => Record<string, any>): Promise<void> {
  if (!input.sessionId || !Number.isFinite(input.listenDuration) || input.listenDuration < 0 || input.listenDuration > 2147483647)
    throw new Error('Invalid recommendation interaction');
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='8s'");
    // Insertion, history snapshot and profile upsert serialize per session on
    // every replica: a slow earlier calculation cannot overwrite a newer one.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['recommendation-profile:' + input.sessionId]);
    await client.query(`INSERT INTO listening_history(id,session_id,station_id,station_name,country,genre,
      listen_duration,interaction_type,listened_at,device_type,context)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [newId(), input.sessionId, input.stationId, input.stationName, input.country, input.genre || null,
      Math.max(0, Math.round(input.listenDuration)), input.interactionType, input.listenedAt, input.deviceType || null, JSON.stringify(input)]);
    const profile = deriveProfile(await recent(client, input.sessionId, 1000));
    await client.query(`INSERT INTO recommendation_profiles(id,session_id,preferred_genres,preferred_countries,preferred_languages,
      average_listen_duration,peak_listening_hours,skip_rate,total_stations_listened,unique_stations_count,favorite_stations_count,last_listened_at,profile_strength)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(session_id) DO UPDATE SET
      preferred_genres=EXCLUDED.preferred_genres,preferred_countries=EXCLUDED.preferred_countries,preferred_languages=EXCLUDED.preferred_languages,
      average_listen_duration=EXCLUDED.average_listen_duration,peak_listening_hours=EXCLUDED.peak_listening_hours,skip_rate=EXCLUDED.skip_rate,
      total_stations_listened=EXCLUDED.total_stations_listened,unique_stations_count=EXCLUDED.unique_stations_count,
      favorite_stations_count=EXCLUDED.favorite_stations_count,last_listened_at=EXCLUDED.last_listened_at,profile_strength=EXCLUDED.profile_strength,updated_at=now()`,
    [newId(), input.sessionId, JSON.stringify(profile.preferredGenres), JSON.stringify(profile.preferredCountries),
      JSON.stringify(profile.preferredLanguages), profile.averageListenDuration, profile.peakListeningHours, profile.skipRate,
      profile.totalStationsListened, profile.uniqueStationsCount, profile.favoriteStationsCount, profile.lastListenedAt, profile.profileStrength]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function pgCollaborativeRecommendations(sourceStationId: string, sessionId: string): Promise<any[]> {
  if (!sessionId) return [];
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='5s'");
    const result = await client.query(`WITH own_history AS MATERIALIZED (
      SELECT station_id FROM listening_history WHERE session_id=$2
    ), own_stations AS (SELECT DISTINCT station_id FROM own_history),
    peers AS (
      SELECT h.session_id,sum(h.listen_duration) duration FROM listening_history h JOIN own_stations o USING(station_id)
      WHERE h.session_id<>$2 AND (SELECT count(*) FROM own_history)>=3 GROUP BY h.session_id
      HAVING count(DISTINCT h.station_id)>=2 ORDER BY duration DESC,h.session_id LIMIT 50
    )
    SELECT h.station_id AS _id,
      avg(CASE WHEN (h.context->>'rating') ~ '^[0-5](\\.[0-9]+)?$' THEN (h.context->>'rating')::float8 END) score,
      count(*)::int AS "listenerCount",avg(h.listen_duration)::float8 AS "avgListenDuration"
    FROM listening_history h JOIN peers p USING(session_id)
    JOIN stations s ON s.id=h.station_id AND s.last_check_ok=true
    WHERE h.station_id<>$1 AND NOT EXISTS(SELECT 1 FROM own_stations o WHERE o.station_id=h.station_id)
      AND h.listen_duration>=30 GROUP BY h.station_id HAVING count(*)>=2
    ORDER BY score DESC NULLS LAST,"listenerCount" DESC,h.station_id LIMIT 20`, [sourceStationId, sessionId]);
    await client.query('COMMIT');
    return result.rows;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

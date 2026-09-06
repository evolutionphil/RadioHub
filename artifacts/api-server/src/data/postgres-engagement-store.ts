import crypto from "node:crypto";
import { getPostgresPool } from "../postgres-runtime";

const pool = () => getPostgresPool();

function stationShape(row: Record<string, any>): Record<string, any> {
  return {
    ...(row.source || {}),
    _id: row.id,
    name: row.name,
    country: row.country,
    tags: row.tags_raw,
    genre: row.tags_raw,
    favicon: row.favicon,
    votes: row.votes,
    slug: row.slug,
    language: row.language,
    codec: row.codec,
    bitrate: row.bitrate,
    url: row.url,
    urlResolved: row.url_resolved,
    hasLogo: row.has_logo,
    logoAssets: row.logo_assets,
    averageRating: row.average_rating,
    totalRatings: row.total_ratings,
  };
}

export async function pgResolveUserId(value: string): Promise<string | null> {
  const result = await pool().query<{ id: string }>(
    "SELECT id FROM users WHERE id=$1 OR slug=$1 OR username=$1 LIMIT 1",
    [value],
  );
  return result.rows[0]?.id ?? null;
}

export async function pgPublicProfile(value: string, currentUserId?: string): Promise<any | null> {
  const result = await pool().query(
    `SELECT u.*,
       (SELECT count(*)::int FROM user_follows f WHERE f.following_id=u.id) followers_count,
       (SELECT count(*)::int FROM user_follows f WHERE f.follower_id=u.id) following_count,
       EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=$2 AND f.following_id=u.id) is_following
     FROM users u
     WHERE (u.id=$1 OR u.slug=$1 OR u.username=$1) AND u.is_public_profile=true LIMIT 1`,
    [value, currentUserId || ""],
  );
  const user = result.rows[0];
  if (!user) return null;
  const favorites = await pool().query<{ tags_raw: string | null; country: string | null }>(
    `SELECT s.tags_raw, s.country FROM user_favorites f
     JOIN stations s ON s.id=f.station_id WHERE f.user_id=$1`,
    [user.id],
  );
  const genres = new Map<string, number>();
  const countries = new Map<string, number>();
  for (const station of favorites.rows) {
    for (const tag of (station.tags_raw || "").split(",")) {
      const key = tag.trim().toLowerCase();
      if (key.length > 2) genres.set(key, (genres.get(key) || 0) + 1);
    }
    const country = station.country?.trim();
    if (country) countries.set(country, (countries.get(country) || 0) + 1);
  }
  const total = favorites.rowCount || 0;
  const ranked = (values: Map<string, number>, key: string) =>
    [...values.entries()]
      .map(([name, count]) => ({ [key]: name, count, percentage: total ? Math.round(count / total * 100) : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  return {
    displayName: user.full_name || user.username || user.email?.split("@")[0] || "Anonymous User",
    bio: user.bio || `Radio enthusiast with ${total} favorite stations`,
    slug: user.slug || user.id,
    avatar: user.avatar,
    isPublic: user.is_public_profile,
    followersCount: user.followers_count,
    followingCount: user.following_count,
    isFollowing: user.is_following,
    listeningStats: {
      totalListenHours: Math.max(total * 2.5, 10),
      uniqueStationsListened: Math.max(total, 1),
      favoriteGenres: ranked(genres, "genre"),
      favoriteCountries: ranked(countries, "country"),
      peakListeningHours: [9, 10, 11, 14, 15, 18, 19, 20],
      joinedDate: new Date(user.created_at).toISOString(),
      lastActiveDate: new Date(user.updated_at).toISOString(),
    },
    privacy: { showFavorites: user.is_public_profile, showStatistics: user.is_public_profile },
  };
}

export async function pgUserFavorites(value: string, page: number, limit: number): Promise<any | null> {
  const userId = await pgResolveUserId(value);
  if (!userId) return null;
  const publicResult = await pool().query<{ is_public_profile: boolean }>(
    "SELECT is_public_profile FROM users WHERE id=$1",
    [userId],
  );
  if (!publicResult.rows[0]?.is_public_profile) return null;
  const offset = Math.max(0, page - 1) * limit;
  const [rows, count] = await Promise.all([
    pool().query(
      `SELECT s.* FROM user_favorites f JOIN stations s ON s.id=f.station_id
       WHERE f.user_id=$1 ORDER BY f.created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    pool().query<{ count: string }>("SELECT count(*)::text count FROM user_favorites WHERE user_id=$1", [userId]),
  ]);
  return { favorites: rows.rows.map(stationShape), total: Number(count.rows[0]?.count || 0), page, limit };
}

export async function pgTrendingStations(country: string | undefined, limit: number): Promise<any> {
  const result = await pool().query(
    `SELECT s.*, count(f.user_id)::int total_favorites,
       (count(f.user_id) * (1 + COALESCE(s.votes,0)::numeric / 100))::float8 trending_score
     FROM user_favorites f JOIN stations s ON s.id=f.station_id
     WHERE ($1='' OR s.country ILIKE '%' || $1 || '%')
     GROUP BY s.id ORDER BY trending_score DESC LIMIT $2`,
    [country && country !== "global" ? country : "", limit],
  );
  return {
    trending: result.rows.map((row) => ({
      stationId: row.id, totalFavorites: row.total_favorites,
      weeklyFavorites: row.total_favorites, trendingScore: Math.round(row.trending_score * 10) / 10,
      averageRating: row.average_rating || 0,
      station: { ...stationShape(row), genre: row.tags_raw },
    })),
    meta: { count: result.rowCount || 0, country: country || "global", generatedAt: new Date().toISOString() },
  };
}

export async function pgCommunityFavorites(
  country: string | undefined,
  genre: string | undefined,
  limit: number,
): Promise<any> {
  const result = await pool().query(
    `SELECT s.*, count(f.user_id)::int total_favorites,
       min(f.created_at) first_favorited, max(f.created_at) last_favorited
     FROM user_favorites f JOIN stations s ON s.id=f.station_id
     WHERE ($1='' OR s.country ILIKE '%' || $1 || '%')
       AND ($2='' OR s.tags_raw ILIKE '%' || $2 || '%')
     GROUP BY s.id ORDER BY total_favorites DESC, last_favorited DESC LIMIT $3`,
    [country && country !== "global" ? country : "", genre && genre !== "all" ? genre : "", limit],
  );
  return {
    favorites: result.rows.map((row) => ({
      stationId: row.id, totalFavorites: row.total_favorites,
      averageRating: row.average_rating || 0, totalRatings: row.total_ratings || 0,
      trendingScore: row.total_favorites * 2, station: stationShape(row),
    })),
    meta: { count: result.rowCount || 0, filters: { country: country || "global", genre: genre || "all" }, generatedAt: new Date().toISOString() },
  };
}

export async function pgRateStation(userId: string, stationId: string, rating: number, comment: string): Promise<any> {
  return pgRateStationIdentity({ userId }, stationId, rating, comment);
}

export interface RatingIdentity {
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
}

export async function pgRateStationIdentity(
  identity: RatingIdentity,
  stationId: string,
  rating: number,
  comment: string,
): Promise<any> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const identityType = identity.userId ? "user" : identity.sessionId ? "session" : "ip";
    const identityValue = identity.userId || identity.sessionId || identity.ipAddress;
    if (!identityValue) throw new Error("Rating identity is required");

    // All identities on a station must serialize BEFORE inserting and computing
    // aggregates; an identity-only lock permits stale averages/counts to win.
    const stationLock = await client.query("SELECT id FROM stations WHERE id=$1 FOR UPDATE", [stationId]);
    if (!stationLock.rowCount) throw new Error("Station not found");
    // Also retain identity uniqueness for anonymous IP-only ratings.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${stationId}:${identityType}:${identityValue}`,
    ]);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM station_ratings WHERE station_id=$1 AND
       (($2='user' AND user_id=$3) OR ($2='session' AND session_id=$3) OR ($2='ip' AND ip_address=$3))
       LIMIT 1`,
      [stationId, identityType, identityValue],
    );
    const isNew = existing.rowCount === 0;
    const result = isNew
      ? await client.query(
          `INSERT INTO station_ratings(id,station_id,user_id,session_id,ip_address,rating,comment)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id,user_id,session_id,ip_address,station_id,rating,comment,created_at`,
          [crypto.randomUUID(), stationId, identity.userId || null, identity.sessionId || null,
            identity.ipAddress || null, rating, comment || null],
        )
      : await client.query(
          `UPDATE station_ratings SET rating=$2,comment=$3,updated_at=now() WHERE id=$1
           RETURNING id,user_id,session_id,ip_address,station_id,rating,comment,created_at`,
          [existing.rows[0].id, rating, comment || null],
        );
    await client.query(
      `UPDATE stations s SET average_rating=x.average_rating,total_ratings=x.total_ratings,
         votes=CASE WHEN $2 THEN s.votes+1 ELSE s.votes END
       FROM (SELECT station_id,round(avg(rating)::numeric,1)::real average_rating,count(*)::int total_ratings
             FROM station_ratings WHERE station_id=$1 GROUP BY station_id) x
       WHERE s.id=x.station_id`,
      [stationId, isNew],
    );
    const stats = await pgStationRatingStats(stationId, client);
    const station = await client.query<{ votes: number }>("SELECT votes FROM stations WHERE id=$1", [stationId]);
    await client.query("COMMIT");
    return { success: true, message: "Rating submitted successfully", rating: result.rows[0], stats: {
      ...stats, votes: station.rows[0]?.votes || 0,
    } };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function pgStationRatingStats(stationId: string, queryable: { query: Function } = pool()): Promise<any> {
  const result = await queryable.query(
    `SELECT count(*)::int AS total,
       COALESCE(round(avg(rating)::numeric,1),0)::float8 AS average,
       count(*) FILTER (WHERE rating=1)::int AS stars1,
       count(*) FILTER (WHERE rating=2)::int AS stars2,
       count(*) FILTER (WHERE rating=3)::int AS stars3,
       count(*) FILTER (WHERE rating=4)::int AS stars4,
       count(*) FILTER (WHERE rating=5)::int AS stars5
     FROM station_ratings WHERE station_id=$1`,
    [stationId],
  );
  const row = result.rows[0];
  return { averageRating: Number(row?.average || 0), totalRatings: Number(row?.total || 0), ratingBreakdown: {
    stars1: Number(row?.stars1 || 0), stars2: Number(row?.stars2 || 0), stars3: Number(row?.stars3 || 0),
    stars4: Number(row?.stars4 || 0), stars5: Number(row?.stars5 || 0),
  } };
}

export async function pgStationRatings(stationId: string, page: number, limit: number): Promise<any> {
  const offset = Math.max(0, page - 1) * limit;
  const [ratings, stats] = await Promise.all([
    pool().query(
      `SELECT user_id AS "userId",rating,comment,created_at AS "createdAt"
       FROM station_ratings WHERE station_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [stationId, limit, offset],
    ),
    pool().query<{ total: string; average: string | null }>(
      "SELECT count(*)::text total,round(avg(rating)::numeric,1)::text average FROM station_ratings WHERE station_id=$1",
      [stationId],
    ),
  ]);
  return { ratings: ratings.rows, meta: { page, limit, total: Number(stats.rows[0]?.total || 0), averageRating: Number(stats.rows[0]?.average || 0) } };
}

export async function pgStationRatingsDetailed(stationId: string, page: number, limit: number): Promise<any> {
  const result = await pgStationRatings(stationId, page, limit);
  const stats = await pgStationRatingStats(stationId);
  return {
    ratings: result.ratings,
    pagination: { page, limit, total: result.meta.total, totalPages: Math.ceil(result.meta.total / limit) },
    stats,
  };
}

export async function pgFindStationRating(stationId: string, identity: RatingIdentity): Promise<any | null> {
  const identityType = identity.userId ? "user" : identity.sessionId ? "session" : "ip";
  const identityValue = identity.userId || identity.sessionId || identity.ipAddress;
  if (!identityValue) return null;
  const result = await pool().query(
    `SELECT id AS _id,user_id AS "userId",session_id AS "sessionId",ip_address AS "ipAddress",
       station_id AS "stationId",rating,comment,created_at AS "createdAt",updated_at AS "updatedAt"
     FROM station_ratings WHERE station_id=$1 AND
       (($2='user' AND user_id=$3) OR ($2='session' AND session_id=$3) OR ($2='ip' AND ip_address=$3))
     LIMIT 1`,
    [stationId, identityType, identityValue],
  );
  return result.rows[0] || null;
}

export async function pgFavoriteStationsForUser(
  userId: string,
  sort: string,
  page: number,
  limit: number,
): Promise<{ stations: any[]; total: number }> {
  const order = sort === "oldest" ? "f.created_at ASC" : sort === "name" ? "s.name ASC" :
    sort === "country" ? "s.country ASC NULLS LAST" : "f.created_at DESC";
  const pagination = page > 0 && limit > 0;
  const values: any[] = [userId];
  let suffix = "";
  if (pagination) {
    values.push(limit, (page - 1) * limit);
    suffix = " LIMIT $2 OFFSET $3";
  }
  const [rows, count] = await Promise.all([
    pool().query(
      `SELECT s.*,f.created_at AS favorited_at FROM user_favorites f
       JOIN stations s ON s.id=f.station_id WHERE f.user_id=$1 ORDER BY ${order}${suffix}`,
      values,
    ),
    pool().query<{ count: string }>("SELECT count(*)::text count FROM user_favorites WHERE user_id=$1", [userId]),
  ]);
  return {
    stations: rows.rows.map((row) => ({ ...stationShape(row), favoritedAt: row.favorited_at })),
    total: Number(count.rows[0]?.count || 0),
  };
}

export async function pgIsFavorite(userId: string, stationId: string): Promise<boolean> {
  const result = await pool().query("SELECT 1 FROM user_favorites WHERE user_id=$1 AND station_id=$2", [userId, stationId]);
  return (result.rowCount || 0) > 0;
}

export async function pgSetFavorite(userId: string, stationId: string, enabled: boolean): Promise<any> {
  if (enabled) {
    await pool().query(
      "INSERT INTO user_favorites(user_id,station_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [userId, stationId],
    );
  } else {
    await pool().query("DELETE FROM user_favorites WHERE user_id=$1 AND station_id=$2", [userId, stationId]);
  }
  return { success: true, message: enabled ? "Station added to favorites" : "Station removed from favorites" };
}

export async function pgSetFollow(followerId: string, followeeId: string, enabled: boolean): Promise<any> {
  if (enabled) {
    await pool().query(
      "INSERT INTO user_follows(follower_id,following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [followerId, followeeId],
    );
  } else {
    await pool().query("DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2", [followerId, followeeId]);
  }
  return { success: true, message: enabled ? "User followed successfully" : "User unfollowed successfully" };
}

export async function pgIsFollowing(followerId: string, followeeId: string): Promise<boolean> {
  const result = await pool().query(
    "SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=$2",
    [followerId, followeeId],
  );
  return (result.rowCount || 0) > 0;
}

export async function pgFollowPage(
  userId: string,
  direction: "followers" | "following",
  page: number,
  limit: number,
): Promise<any> {
  const offset = Math.max(0, page - 1) * limit;
  const targetColumn = direction === "followers" ? "f.follower_id" : "f.following_id";
  const filterColumn = direction === "followers" ? "f.following_id" : "f.follower_id";
  const [rows, count] = await Promise.all([
    pool().query(
      `SELECT u.id,u.username,u.full_name,u.avatar,u.source,f.created_at,
         (SELECT count(*)::int FROM user_follows x WHERE x.following_id=u.id) followers_count,
         (SELECT count(*)::int FROM user_follows x WHERE x.follower_id=u.id) following_count
       FROM user_follows f JOIN users u ON u.id=${targetColumn}
       WHERE ${filterColumn}=$1 ORDER BY f.created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    pool().query<{ count: string }>(`SELECT count(*)::text count FROM user_follows f WHERE ${filterColumn}=$1`, [userId]),
  ]);
  const entries = rows.rows.map((row) => ({
    user: {
      _id: row.id, fullName: row.full_name, username: row.username, avatar: row.avatar,
      location: row.source?.location, followersCount: row.followers_count,
      followingCount: row.following_count,
    },
    followedAt: row.created_at,
  }));
  const total = Number(count.rows[0]?.count || 0);
  return { [direction]: entries, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function pgPopularProfiles(limit: number): Promise<any[]> {
  const result = await pool().query(
    `SELECT u.id AS _id,u.full_name AS "fullName",u.username,u.email,u.slug,u.avatar,u.created_at AS "createdAt",
       COALESCE(count(f.station_id),0)::int AS "favoriteCount",
       COALESCE(u.full_name,u.username,split_part(u.email,'@',1)) AS "displayName"
     FROM users u LEFT JOIN user_favorites f ON f.user_id=u.id
     WHERE u.is_public_profile=true AND (u.full_name<>'' OR u.username<>'')
     GROUP BY u.id HAVING count(f.station_id)>=1
     ORDER BY count(f.station_id) DESC,u.created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function pgRecentlyPlayed(value: string, limit: number): Promise<any[]> {
  const result = await pool().query<{ source: any }>(
    "SELECT source FROM users WHERE id=$1 OR slug=$1 OR username=$1 LIMIT 1",
    [value],
  );
  const recent = result.rows[0]?.source?.recentlyPlayedStations;
  return Array.isArray(recent) ? recent.slice(0, limit) : [];
}

export async function pgRecentlyPlayedStations(userId: string, limit = 12): Promise<any[]> {
  const user = await pool().query<{ source: any }>("SELECT source FROM users WHERE id=$1", [userId]);
  const recent = Array.isArray(user.rows[0]?.source?.recentlyPlayedStations)
    ? user.rows[0].source.recentlyPlayedStations.slice(0, limit)
    : [];
  if (!recent.length) return [];
  const ids = recent.map((entry: any) => String(entry?.stationId || entry));
  const stations = await pool().query("SELECT * FROM stations WHERE id=ANY($1::text[])", [ids]);
  const byId = new Map(stations.rows.map((row) => [row.id, row]));
  return recent.flatMap((entry: any) => {
    const id = String(entry?.stationId || entry);
    const row = byId.get(id);
    return row ? [{ ...stationShape(row), playedAt: entry?.playedAt || null }] : [];
  });
}

export async function pgAddRecentlyPlayed(userId: string, stationId: string): Promise<boolean> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const [user, station] = await Promise.all([
      client.query<{ source: any }>("SELECT source FROM users WHERE id=$1 FOR UPDATE", [userId]),
      client.query("SELECT 1 FROM stations WHERE id=$1", [stationId]),
    ]);
    if (!user.rowCount || !station.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    const source = user.rows[0].source && typeof user.rows[0].source === "object" ? user.rows[0].source : {};
    const previous = Array.isArray(source.recentlyPlayedStations) ? source.recentlyPlayedStations : [];
    const next = [
      { stationId, playedAt: new Date().toISOString() },
      ...previous.filter((entry: any) => String(entry?.stationId || entry) !== stationId),
    ].slice(0, 12);
    await client.query(
      "UPDATE users SET source=jsonb_set(COALESCE(source,'{}'::jsonb),'{recentlyPlayedStations}',$2::jsonb,true) WHERE id=$1",
      [userId, JSON.stringify(next)],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

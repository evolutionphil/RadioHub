import type pg from "pg";
import { getPostgresPool } from "../../../artifacts/api-server/src/postgres-runtime";
import { bsonSafe, checksum, jsonSafe } from "./legacy-document-codec";

type StationDocument = Record<string, any>;

function stringId(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsedDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function genreSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

function stationGenres(value: unknown): string[] {
  const tags = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string" ? value.split(",") : [];
  return [...new Set(tags.map(genreSlug).filter(Boolean))];
}

export async function upsertPostgresStation(
  stationDocument: StationDocument,
  client?: pg.PoolClient,
): Promise<void> {
  const station = jsonSafe(stationDocument);
  const stationId = stringId(station._id);
  if (!stationId) throw new Error("Cannot mirror a station without _id");
  const bson = bsonSafe(stationDocument);
  const ownedClient = client || await getPostgresPool().connect();
  const shouldManageTransaction = !client;

  try {
    if (shouldManageTransaction) await ownedClient.query("BEGIN");
    await ownedClient.query(
      `INSERT INTO legacy_documents
         (collection_name, document_id, payload, checksum, last_seen_run_id, mongo_updated_at,bson_payload,bson_checksum)
       VALUES ('stations',$1,$2::jsonb,$3,'change-stream',$4,$5::jsonb,$6)
       ON CONFLICT (collection_name, document_id) DO UPDATE SET
         payload=EXCLUDED.payload, checksum=EXCLUDED.checksum,
         bson_payload=EXCLUDED.bson_payload,bson_checksum=EXCLUDED.bson_checksum,
         last_seen_run_id=EXCLUDED.last_seen_run_id,
         mongo_updated_at=EXCLUDED.mongo_updated_at, migrated_at=now()`,
      [stationId, JSON.stringify(station), checksum(station), parsedDate(station.updatedAt), JSON.stringify(bson), checksum(bson)],
    );

    await ownedClient.query(
      `INSERT INTO stations (
        id, station_uuid, change_uuid, name, slug, slug_aliases, redirect_to_slug,
        url, url_resolved, homepage, favicon, country, country_code, state,
        language, language_codes, tags_raw, codec, bitrate, hls, votes,
        click_count, click_trend, average_rating, total_ratings, last_check_ok,
        last_check_time, latitude, longitude, has_logo, logo_assets, descriptions,
        manual_edit_fields, media_group_id, is_featured, show_in_global_popular,
        no_index, source, created_at, updated_at
      ) VALUES (${Array.from({ length: 40 }, (_, index) => `$${index + 1}`).join(",")})
      ON CONFLICT (id) DO UPDATE SET
        station_uuid=EXCLUDED.station_uuid, change_uuid=EXCLUDED.change_uuid,
        name=EXCLUDED.name, slug=EXCLUDED.slug, slug_aliases=EXCLUDED.slug_aliases,
        redirect_to_slug=EXCLUDED.redirect_to_slug, url=EXCLUDED.url,
        url_resolved=EXCLUDED.url_resolved, homepage=EXCLUDED.homepage,
        favicon=EXCLUDED.favicon, country=EXCLUDED.country,
        country_code=EXCLUDED.country_code, state=EXCLUDED.state,
        language=EXCLUDED.language, language_codes=EXCLUDED.language_codes,
        tags_raw=EXCLUDED.tags_raw, codec=EXCLUDED.codec, bitrate=EXCLUDED.bitrate,
        hls=EXCLUDED.hls,
        votes=CASE WHEN $41::boolean THEN stations.votes ELSE EXCLUDED.votes END,
        click_count=EXCLUDED.click_count, click_trend=EXCLUDED.click_trend,
        average_rating=CASE WHEN $41::boolean THEN stations.average_rating ELSE EXCLUDED.average_rating END,
        total_ratings=CASE WHEN $41::boolean THEN stations.total_ratings ELSE EXCLUDED.total_ratings END,
        last_check_ok=EXCLUDED.last_check_ok,
        last_check_time=EXCLUDED.last_check_time, latitude=EXCLUDED.latitude,
        longitude=EXCLUDED.longitude, has_logo=EXCLUDED.has_logo,
        logo_assets=EXCLUDED.logo_assets, descriptions=EXCLUDED.descriptions,
        manual_edit_fields=EXCLUDED.manual_edit_fields,
        media_group_id=EXCLUDED.media_group_id, is_featured=EXCLUDED.is_featured,
        show_in_global_popular=EXCLUDED.show_in_global_popular,
        no_index=EXCLUDED.no_index, source=EXCLUDED.source,
        created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at`,
      [
        stationId,
        stringId(station.stationuuid || station.stationUuid || stationId),
        station.changeUuid || station.changeuuid || null,
        String(station.name || "Unnamed station"),
        station.slug || null,
        Array.isArray(station.slugAliases) ? station.slugAliases.map(String) : [],
        station.redirectToSlug || null,
        String(station.url || station.urlResolved || "about:blank"),
        station.urlResolved || null,
        station.homepage || null,
        station.favicon || null,
        station.country || null,
        station.countryCode || station.countrycode || null,
        station.state || null,
        station.language || null,
        station.languageCodes || null,
        station.tags || null,
        station.codec || null,
        station.bitrate == null ? null : finiteNumber(station.bitrate),
        booleanValue(station.hls),
        finiteNumber(station.votes),
        finiteNumber(station.clickCount ?? station.clickcount),
        finiteNumber(station.clickTrend),
        finiteNumber(station.averageRating),
        finiteNumber(station.totalRatings),
        booleanValue(station.lastCheckOk, true),
        parsedDate(station.lastCheckTime),
        station.geoLat == null ? null : finiteNumber(station.geoLat),
        station.geoLong == null ? null : finiteNumber(station.geoLong),
        booleanValue(station.hasLogo),
        station.logoAssets ? JSON.stringify(station.logoAssets) : null,
        JSON.stringify(station.descriptions || {}),
        JSON.stringify(station.manualEditFields || {}),
        station.mediaGroupId ? stringId(station.mediaGroupId) : null,
        booleanValue(station.isFeatured),
        booleanValue(station.showInGlobalPopular),
        booleanValue(station.noIndex),
        JSON.stringify(station),
        parsedDate(station.createdAt) || new Date(),
        parsedDate(station.updatedAt) || parsedDate(station.createdAt) || new Date(),
        (process.env.ENGAGEMENT_STORE || "mongo").toLowerCase() === "postgres",
      ],
    );

    await ownedClient.query("DELETE FROM station_genres WHERE station_id=$1", [stationId]);
    for (const [position, slug] of stationGenres(station.tags).entries()) {
      await ownedClient.query(
        `INSERT INTO station_genres(station_id,genre_slug,position)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [stationId, slug, position],
      );
    }
    if (shouldManageTransaction) await ownedClient.query("COMMIT");
  } catch (error) {
    if (shouldManageTransaction) await ownedClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (shouldManageTransaction) ownedClient.release();
  }
}

export async function deletePostgresStation(
  stationId: string,
  client?: pg.PoolClient,
): Promise<void> {
  if (!stationId) throw new Error("Cannot delete a mirrored station without _id");
  const ownedClient = client || await getPostgresPool().connect();
  const shouldManageTransaction = !client;
  try {
    if (shouldManageTransaction) await ownedClient.query("BEGIN");
    await ownedClient.query("DELETE FROM stations WHERE id=$1", [stationId]);
    await ownedClient.query(
      "DELETE FROM legacy_documents WHERE collection_name='stations' AND document_id=$1",
      [stationId],
    );
    if (shouldManageTransaction) await ownedClient.query("COMMIT");
  } catch (error) {
    if (shouldManageTransaction) await ownedClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (shouldManageTransaction) ownedClient.release();
  }
}

export async function upsertPostgresGenre(
  genreDocument: StationDocument,
  client?: pg.PoolClient,
): Promise<void> {
  const genre = jsonSafe(genreDocument);
  const genreId = stringId(genre._id);
  if (!genreId) throw new Error("Cannot mirror a genre without _id");
  const bson = bsonSafe(genreDocument);
  const slug = genre.slug ? String(genre.slug) : genreSlug(String(genre.name || ""));
  const ownedClient = client || await getPostgresPool().connect();
  const shouldManageTransaction = !client;
  try {
    if (shouldManageTransaction) await ownedClient.query("BEGIN");
    await ownedClient.query(
      `INSERT INTO legacy_documents
         (collection_name,document_id,payload,checksum,last_seen_run_id,mongo_updated_at,bson_payload,bson_checksum)
       VALUES ('genres',$1,$2::jsonb,$3,'change-stream',$4,$5::jsonb,$6)
       ON CONFLICT (collection_name,document_id) DO UPDATE SET
         payload=EXCLUDED.payload,checksum=EXCLUDED.checksum,
         bson_payload=EXCLUDED.bson_payload,bson_checksum=EXCLUDED.bson_checksum,
         last_seen_run_id=EXCLUDED.last_seen_run_id,
         mongo_updated_at=EXCLUDED.mongo_updated_at,migrated_at=now()`,
      [genreId, JSON.stringify(genre), checksum(genre), parsedDate(genre.updatedAt), JSON.stringify(bson), checksum(bson)],
    );
    await ownedClient.query(
      `INSERT INTO genres(id,name,slug,is_discoverable,station_count,source,created_at,updated_at)
       VALUES ($1,$2,NULLIF($3,''),$4,$5,$6::jsonb,$7,$8)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,slug=EXCLUDED.slug,
         is_discoverable=EXCLUDED.is_discoverable,station_count=EXCLUDED.station_count,
         source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`,
      [genreId, String(genre.name || slug || genreId), slug,
        booleanValue(genre.isDiscoverable, true), finiteNumber(genre.stationCount),
        JSON.stringify(genre), parsedDate(genre.createdAt) || new Date(),
        parsedDate(genre.updatedAt) || parsedDate(genre.createdAt) || new Date()],
    );
    if (shouldManageTransaction) await ownedClient.query("COMMIT");
  } catch (error) {
    if (shouldManageTransaction) await ownedClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (shouldManageTransaction) ownedClient.release();
  }
}

export async function deletePostgresGenre(
  genreId: string,
  client?: pg.PoolClient,
): Promise<void> {
  if (!genreId) throw new Error("Cannot delete a mirrored genre without _id");
  const ownedClient = client || await getPostgresPool().connect();
  const shouldManageTransaction = !client;
  try {
    if (shouldManageTransaction) await ownedClient.query("BEGIN");
    await ownedClient.query("DELETE FROM genres WHERE id=$1", [genreId]);
    await ownedClient.query(
      "DELETE FROM legacy_documents WHERE collection_name='genres' AND document_id=$1",
      [genreId],
    );
    if (shouldManageTransaction) await ownedClient.query("COMMIT");
  } catch (error) {
    if (shouldManageTransaction) await ownedClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (shouldManageTransaction) ownedClient.release();
  }
}

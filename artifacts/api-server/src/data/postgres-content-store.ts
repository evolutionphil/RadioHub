import crypto from "node:crypto";
import { getPostgresPool } from "../postgres-runtime";
const newId = () => crypto.randomBytes(12).toString("hex");
const limitOf = (value: unknown, fallback = 50, max = 500) =>
  Math.max(1, Math.min(max, Math.trunc(Number(value)) || fallback));
const pageOf = (value: unknown) =>
  Math.max(1, Math.min(1000000, Math.trunc(Number(value)) || 1));
const fields = {
  advertisements: {
    title: "title",
    imageUrl: "image_url",
    altText: "alt_text",
    seoDescription: "seo_description",
    url: "url",
    position: "position",
    isActive: "is_active",
  },
  footer_social_media: {
    platform: "platform",
    url: "url",
    isActive: "is_active",
    position: "position",
  },
  seo_metadata: {
    pageType: "page_type",
    routeKey: "route_key",
    language: "language",
    title: "title",
    description: "description",
    ogTitle: "og_title",
    ogDescription: "og_description",
    ogImageUrl: "og_image_url",
    twitterTitle: "twitter_title",
    twitterDescription: "twitter_description",
    twitterImageUrl: "twitter_image_url",
    canonicalUrl: "canonical_url",
    metaKeywords: "meta_keywords",
    noIndex: "no_index",
    noFollow: "no_follow",
    source: "source",
    status: "status",
    updatedBy: "updated_by",
  },
  feedback: {
    type: "type",
    subject: "subject",
    message: "message",
    email: "email",
    userId: "user_id",
    status: "status",
    response: "response",
  },
} as const;
type ContentTable = keyof typeof fields;
function shape(table: ContentTable, row: any): any {
  if (!row) return null;
  const result: any = {
    _id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  for (const [field, column] of Object.entries(fields[table]))
    result[field] = row[column];
  return result;
}
// Only explicit domain columns are writable. _id, timestamps, prototype keys and
// unknown properties from an admin request cannot become SQL identifiers.
async function save(
  table: ContentTable,
  id: string | null,
  input: Record<string, any>,
): Promise<any> {
  const selected = Object.entries(fields[table]).filter(
    ([field]) => input[field] !== undefined,
  );
  const values = selected.map(([field]) => input[field]);
  const columns: string[] = selected.map(([, column]) => column);
  if (id) {
    values.push(id);
    return shape(
      table,
      (
        await getPostgresPool().query(
          `UPDATE ${table} SET ${columns
            .map((column, i) => column + "=$" + (i + 1))
            .concat("updated_at=now()")
            .join(",")}
      WHERE id=$${values.length} RETURNING *`,
          values,
        )
      ).rows[0],
    );
  }
  values.push(newId());
  return shape(
    table,
    (
      await getPostgresPool().query(
        `INSERT INTO ${table}(${columns.concat("id").join(",")})
    VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
        values,
      )
    ).rows[0],
  );
}
async function remove(table: ContentTable, id: string): Promise<any> {
  return shape(
    table,
    (
      await getPostgresPool().query(
        `DELETE FROM ${table} WHERE id=$1 RETURNING *`,
        [id],
      )
    ).rows[0],
  );
}
export async function pgListAdvertisements(activeOnly = false): Promise<any[]> {
  return (
    await getPostgresPool().query(
      "SELECT * FROM advertisements WHERE (NOT $1 OR is_active=true) ORDER BY position,created_at DESC,id LIMIT $2",
      [activeOnly, activeOnly ? 50 : 1000],
    )
  ).rows.map((row) => shape("advertisements", row));
}
export const pgSaveAdvertisement = (
  id: string | null,
  input: Record<string, any>,
) => save("advertisements", id, input);
export const pgDeleteAdvertisement = (id: string) =>
  remove("advertisements", id);
export async function pgListFooterSocialMedia(
  activeOnly = false,
): Promise<any[]> {
  return (
    await getPostgresPool().query(
      "SELECT * FROM footer_social_media WHERE (NOT $1 OR is_active=true) ORDER BY position,id LIMIT 1000",
      [activeOnly],
    )
  ).rows.map((row) => shape("footer_social_media", row));
}
export const pgSaveFooterSocialMedia = (
  id: string | null,
  input: Record<string, any>,
) => save("footer_social_media", id, input);
export const pgDeleteFooterSocialMedia = (id: string) =>
  remove("footer_social_media", id);

type SeoFilter = {
  id?: string;
  pageType?: string;
  routeKey?: string;
  language?: string;
  status?: string;
};
function seoWhere(filter: SeoFilter) {
  const pairs = [
    ["id", "id"],
    ["pageType", "page_type"],
    ["routeKey", "route_key"],
    ["language", "language"],
    ["status", "status"],
  ].filter(([field]) => filter[field as keyof SeoFilter] !== undefined);
  return {
    sql:
      pairs.map(([, column], i) => column + "=$" + (i + 1)).join(" AND ") ||
      "TRUE",
    values: pairs.map(([field]) => filter[field as keyof SeoFilter]),
  };
}
export async function pgSeoMetadata(filter: SeoFilter): Promise<any | null> {
  const { sql, values } = seoWhere(filter);
  return shape(
    "seo_metadata",
    (
      await getPostgresPool().query(
        "SELECT * FROM seo_metadata WHERE " +
          sql +
          " ORDER BY updated_at DESC,id LIMIT 1",
        values,
      )
    ).rows[0],
  );
}
export async function pgListSeoMetadata(
  filter: SeoFilter,
  page = 1,
  limit = 50,
): Promise<{ items: any[]; total: number }> {
  const { sql, values } = seoWhere(filter);
  const total = (
    await getPostgresPool().query(
      "SELECT count(*)::int count FROM seo_metadata WHERE " + sql,
      values,
    )
  ).rows[0].count;
  const rows = (
    await getPostgresPool().query(
      `SELECT * FROM seo_metadata WHERE ${sql} ORDER BY page_type,route_key,language,id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limitOf(limit), (pageOf(page) - 1) * limitOf(limit)],
    )
  ).rows;
  return { items: rows.map((row) => shape("seo_metadata", row)), total };
}
export const pgSaveSeoMetadata = (
  id: string | null,
  input: Record<string, any>,
) => save("seo_metadata", id, input);
export const pgDeleteSeoMetadata = (id: string) => remove("seo_metadata", id);
export async function pgBulkSeoStatus(
  ids: string[],
  status: "draft" | "published",
): Promise<{ modifiedCount: number }> {
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== "string") ||
    !["draft", "published"].includes(status)
  )
    throw new Error("Invalid bulk SEO status");
  return {
    modifiedCount:
      (
        await getPostgresPool().query(
          "UPDATE seo_metadata SET status=$2,updated_at=now() WHERE id=ANY($1::text[])",
          [ids.slice(0, 1000), status],
        )
      ).rowCount || 0,
  };
}
export async function pgSeoMetadataStats(): Promise<any> {
  const result = await getPostgresPool().query(
    "SELECT page_type,status,count(*)::int count FROM seo_metadata GROUP BY page_type,status",
  );
  const byPageType: Record<string, number> = {},
    byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of result.rows) {
    total += row.count;
    byPageType[row.page_type] = (byPageType[row.page_type] || 0) + row.count;
    byStatus[row.status] = (byStatus[row.status] || 0) + row.count;
  }
  return { total, byPageType, byStatus };
}
export async function pgContentCounts(): Promise<Record<string, number>> {
  const result = await getPostgresPool().query(`SELECT
    (SELECT count(*)::int FROM advertisements) advertisements,(SELECT count(*)::int FROM footer_social_media) "footerSocialMedia",
    (SELECT count(*)::int FROM seo_metadata) "seoMetadata",(SELECT count(*)::int FROM feedback) feedback,
    (SELECT count(*)::int FROM feedback WHERE status='open') "openFeedback"`);
  return result.rows[0];
}

export async function pgCreateAppLog(
  input: Record<string, any>,
): Promise<void> {
  await getPostgresPool().query(
    `INSERT INTO app_logs(id,device_id,platform,app_version,build_number,api_key_hash,is_car_play_log,logs)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      newId(),
      input.deviceId,
      input.platform,
      input.appVersion || "unknown",
      input.buildNumber || "",
      input.apiKeyHash || "",
      input.isCarPlayLog === true,
      JSON.stringify(input.logs || []),
    ],
  );
}
export type AppLogFilter = {
  ownerHash?: string;
  platform?: string;
  deviceId?: string;
  level?: string;
  search?: string;
  from?: Date;
  to?: Date;
  isCarPlay?: boolean;
  crashes?: boolean;
};
function logWhere(filter: AppLogFilter) {
  const values: unknown[] = [],
    parts = ["created_at>=now()-interval '30 days'"];
  const bind = (value: unknown) => {
    values.push(value);
    return "$" + values.length;
  };
  if (filter.ownerHash !== undefined)
    parts.push("api_key_hash=" + bind(filter.ownerHash));
  if (filter.platform) parts.push("platform=" + bind(filter.platform));
  if (filter.deviceId)
    parts.push(
      "strpos(lower(device_id),lower(" + bind(filter.deviceId) + "))>0",
    );
  if (filter.isCarPlay !== undefined)
    parts.push("is_car_play_log=" + bind(filter.isCarPlay));
  if (filter.from) parts.push("created_at>=" + bind(filter.from));
  if (filter.to) parts.push("created_at<=" + bind(filter.to));
  if (filter.level)
    parts.push(
      "EXISTS(SELECT 1 FROM jsonb_array_elements(logs) l WHERE l->>'level'=" +
        bind(filter.level) +
        ")",
    );
  if (filter.search)
    parts.push(
      "EXISTS(SELECT 1 FROM jsonb_array_elements(logs) l WHERE strpos(lower(l->>'message'),lower(" +
        bind(filter.search) +
        "))>0)",
    );
  if (filter.crashes)
    parts.push(
      "EXISTS(SELECT 1 FROM jsonb_array_elements(logs) l WHERE l->>'message' ~* 'APP_CRASH|crash')",
    );
  return { sql: parts.join(" AND "), values };
}
export async function pgListAppLogs(
  filter: AppLogFilter,
  page = 1,
  limit = 50,
): Promise<{ items: any[]; total: number }> {
  const { sql, values } = logWhere(filter);
  const total = (
    await getPostgresPool().query(
      "SELECT count(*)::int count FROM app_logs WHERE " + sql,
      values,
    )
  ).rows[0].count;
  const rows = (
    await getPostgresPool().query(
      `SELECT id AS _id,device_id AS "deviceId",platform,app_version AS "appVersion",
    build_number AS "buildNumber",is_car_play_log AS "isCarPlayLog",logs,created_at AS "createdAt" FROM app_logs
    WHERE ${sql} ORDER BY created_at DESC,id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limitOf(limit), (pageOf(page) - 1) * limitOf(limit)],
    )
  ).rows;
  return { items: rows, total };
}
export async function pgAppLogStats(ownerHash?: string): Promise<any> {
  const { sql, values } = logWhere({ ownerHash });
  const totals = (
    await getPostgresPool().query(
      `SELECT count(*)::int total,count(*) FILTER(WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int today FROM app_logs WHERE ${sql}`,
      values,
    )
  ).rows[0];
  const platforms = (
    await getPostgresPool().query(
      `SELECT platform,count(*)::int count FROM app_logs WHERE ${sql} GROUP BY platform`,
      values,
    )
  ).rows;
  const entries = (
    await getPostgresPool().query(
      `SELECT l->>'level' level,count(*)::int count,
    count(*) FILTER(WHERE l->>'message' ILIKE '%CarPlay CONNECTED%')::int connected,
    count(*) FILTER(WHERE l->>'message' ILIKE '%CarPlay DISCONNECTED%')::int disconnected,
    count(*) FILTER(WHERE l->>'message' ILIKE '%Template created%')::int template,
    count(*) FILTER(WHERE l->>'level'='error' AND l->>'message' ~* 'CarPlay|Template')::int errors
    FROM app_logs CROSS JOIN LATERAL jsonb_array_elements(logs) l WHERE ${sql} GROUP BY l->>'level'`,
      values,
    )
  ).rows;
  const carplayEvents = {
    connected: 0,
    disconnected: 0,
    templateCreated: 0,
    errors: 0,
  };
  for (const row of entries) {
    carplayEvents.connected += row.connected;
    carplayEvents.disconnected += row.disconnected;
    carplayEvents.templateCreated += row.template;
    carplayEvents.errors += row.errors;
  }
  return {
    ...totals,
    byPlatform: Object.fromEntries(
      platforms.map((row) => [row.platform, row.count]),
    ),
    byLevel: Object.fromEntries(entries.map((row) => [row.level, row.count])),
    carplayEvents,
  };
}
export async function pgDeleteOldAppLogs(
  cutoff: Date,
  ownerHash?: string,
): Promise<{ deletedCount: number }> {
  return {
    deletedCount:
      (
        await getPostgresPool().query(
          "DELETE FROM app_logs WHERE created_at<$1 AND ($2::text IS NULL OR api_key_hash=$2)",
          [cutoff, ownerHash ?? null],
        )
      ).rowCount || 0,
  };
}
export async function pgListFeedback(
  filter: { status?: string; type?: string } = {},
  limit = 200,
): Promise<any> {
  const rows = (
    await getPostgresPool().query(
      "SELECT * FROM feedback WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR type=$2) ORDER BY created_at DESC,id LIMIT $3",
      [filter.status || null, filter.type || null, limitOf(limit, 200)],
    )
  ).rows;
  const groups = (
    await getPostgresPool().query(
      "SELECT status,type,count(*)::int count FROM feedback GROUP BY status,type",
    )
  ).rows;
  const statusCounts: Record<string, number> = {},
    byType: Record<string, number> = { bug: 0, feature: 0, general: 0 };
  let total = 0;
  for (const row of groups) {
    total += row.count;
    statusCounts[row.status] = (statusCounts[row.status] || 0) + row.count;
    byType[row.type] = (byType[row.type] || 0) + row.count;
  }
  return {
    feedback: rows.map((row) => shape("feedback", row)),
    stats: {
      total,
      open: statusCounts.open || 0,
      inProgress: statusCounts["in-progress"] || 0,
      resolved: statusCounts.resolved || 0,
      closed: statusCounts.closed || 0,
      byType,
    },
  };
}
export const pgSaveFeedback = (id: string | null, input: Record<string, any>) =>
  save("feedback", id, input);
export const pgDeleteFeedback = (id: string) => remove("feedback", id);
export async function pgAdminListeningHistory(limit = 100): Promise<any[]> {
  const rows = (
    await getPostgresPool().query(
      `SELECT h.*,u.id uid,u.email,u.full_name,s.id sid,s.name,s.slug
    FROM listening_history h LEFT JOIN users u ON u.id=h.user_id LEFT JOIN stations s ON s.id=h.station_id
    ORDER BY h.listened_at DESC,h.id DESC LIMIT $1`,
      [limitOf(limit, 100)],
    )
  ).rows;
  return rows.map((row) => ({
    ...(row.context || {}),
    _id: row.id,
    userId: row.uid
      ? { _id: row.uid, email: row.email, fullName: row.full_name }
      : null,
    stationId: row.sid
      ? { _id: row.sid, name: row.name, slug: row.slug }
      : row.station_id,
    sessionId: row.session_id,
    stationName: row.station_name,
    country: row.country,
    genre: row.genre,
    listenDuration: row.listen_duration,
    interactionType: row.interaction_type,
    listenedAt: row.listened_at,
    deviceType: row.device_type,
    createdAt: row.created_at,
  }));
}

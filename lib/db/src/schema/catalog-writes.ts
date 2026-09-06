import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const catalogSyncRuns = pgTable("catalog_sync_runs", {
  id: text("id").primaryKey(), syncType: text("sync_type").notNull(), status: text("status").notNull(),
  counters: jsonb("counters").notNull().default({}), error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }), cancelRequested: boolean("cancel_requested").notNull().default(false),
}, (table) => [index("catalog_sync_runs_started_idx").on(table.startedAt.desc()),
  check("catalog_sync_runs_sync_type_check", sql`${table.syncType} IN ('full','incremental')`),
  check("catalog_sync_runs_status_check", sql`${table.status} IN ('running','completed','failed','stopped')`)]);

export const stationBlacklist = pgTable("station_blacklist", {
  id: text("id").primaryKey(), stationUuid: text("station_uuid"), url: text("url").notNull(), name: text("name").notNull(),
  reason: text("reason"), deletedBy: text("deleted_by"), deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  source: jsonb("source").notNull().default({}), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("station_blacklist_uuid_idx").on(table.stationUuid), index("station_blacklist_url_idx").on(table.url)]);

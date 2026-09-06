import { sql } from 'drizzle-orm';
import { pgTable, text, integer, timestamp, jsonb, index, uniqueIndex, check } from 'drizzle-orm/pg-core';

export const genreCounts = pgTable('genre_counts', {
  id: text('id').primaryKey(), country: text('country').notNull(), slug: text('slug').notNull(),
  count: integer('count').notNull().default(0), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('genre_counts_country_slug_key').on(t.country,t.slug), index('genre_counts_country_count_idx').on(t.country,t.count.desc()), check('genre_counts_count_check', sql`${t.count} >= 0`)]);

export const genreWhitelistOverrides = pgTable('genre_whitelist_overrides', {
  id: text('id').primaryKey(), kind: text('kind').notNull(), slug: text('slug').notNull(), canonical: text('canonical'),
  notes: text('notes').notNull().default(''), createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('genre_whitelist_overrides_kind_slug_key').on(t.kind,t.slug), index('genre_whitelist_overrides_canonical_idx').on(t.canonical), check('genre_whitelist_overrides_kind_check',sql`${t.kind} IN ('slug-add','slug-remove','alias-add','alias-remove')`)]);

export const genreStationCountsRuns = pgTable('genre_station_counts_runs', {
  id: text('id').primaryKey(), trigger: text('trigger').notNull(), status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(), finishedAt: timestamp('finished_at', { withTimezone: true }),
  durationMs: integer('duration_ms'), totalGenres: integer('total_genres').notNull().default(0),
  updatedSlugs: integer('updated_slugs').notNull().default(0), errorMessage: text('error_message'),
}, t => [index('genre_station_counts_runs_started_idx').on(t.startedAt.desc(),t.id.desc()), check('genre_station_counts_runs_status_check',sql`${t.status} IN ('running','completed','failed')`)]);

export const genreWhitelistPushLogs = pgTable('genre_whitelist_push_logs', {
  id: text('id').primaryKey(), triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull(), triggeredBy: text('triggered_by'),
  trigger: text('trigger').notNull(), affectedSlugs: text('affected_slugs').array().notNull().default([]),
  sitemapRebuild: jsonb('sitemap_rebuild').notNull(), indexnowSitemap: jsonb('indexnow_sitemap').notNull(), indexnowGenreUrls: jsonb('indexnow_genre_urls').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('genre_whitelist_push_logs_triggered_idx').on(t.triggeredAt.desc(),t.id.desc()), index('genre_whitelist_push_logs_created_idx').on(t.createdAt)]);

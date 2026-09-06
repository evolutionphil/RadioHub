import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const stationDebugLogs = pgTable('station_debug_logs', {
  id: text('id').primaryKey(), stationId: text('station_id').notNull(), stationName: text('station_name').notNull(),
  stationUrl: text('station_url').notNull(), errorType: text('error_type').notNull(), errorMessage: text('error_message').notNull(),
  errorDetails: jsonb('error_details').notNull().default({}), stationMeta: jsonb('station_meta').notNull().default({}),
  userAgent: text('user_agent'), clientIP: text('client_ip'), timestamp: timestamp('timestamp', {withTimezone:true}).notNull().defaultNow(),
  isResolved: boolean('is_resolved').notNull().default(false), resolvedAt: timestamp('resolved_at', {withTimezone:true}),
  resolvedBy: text('resolved_by'), notes: text('notes'), reportingUsers: jsonb('reporting_users').notNull().default([]),
  uniqueUserCount: integer('unique_user_count').notNull().default(1), totalOccurrences: integer('total_occurrences').notNull().default(1),
  serverLogs: text('server_logs').array().notNull().default(sql`'{}'::text[]`),
}, t => [
  check('station_debug_logs_error_type_check', sql`${t.errorType} IN ('AUDIO_ERROR','CONNECTION_TIMEOUT','STREAM_UNAVAILABLE','CODEC_UNSUPPORTED','CORS_ERROR','NETWORK_ERROR')`),
  check('station_debug_logs_reporting_users_check', sql`jsonb_typeof(${t.reportingUsers})='array'`),
  check('station_debug_logs_unique_user_count_check', sql`${t.uniqueUserCount}>=0`),
  check('station_debug_logs_total_occurrences_check', sql`${t.totalOccurrences}>=0`),
  index('station_debug_logs_group_time').on(t.stationId,t.errorType,t.timestamp.desc()),
  index('station_debug_logs_time').on(t.timestamp.desc()),
  index('station_debug_logs_error_time').on(t.errorType,t.timestamp.desc()),
  index('station_debug_logs_resolved_time').on(t.isResolved,t.timestamp.desc()),
]);

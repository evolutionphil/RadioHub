import { sql } from 'drizzle-orm';
import { bigint,check,index,inet,integer,jsonb,pgTable,text,timestamp } from 'drizzle-orm/pg-core';
export const qualifiedVisitorPresence = pgTable('qualified_visitor_presence', {
  ipAddress: inet('ip_address').primaryKey(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  countryCode: text('country_code'),
  channel: text('channel').notNull().default('unknown'),
  platform: text('platform').notNull().default('unknown'),
  deviceType: text('device_type').notNull().default('unknown'),
  os: text('os'),
  browser: text('browser'),
  contextSource: text('context_source').notNull().default('unknown'),
  contextCollectedAt: timestamp('context_collected_at', { withTimezone: true }),
}, table => [index('qualified_visitor_presence_last_seen_idx').on(table.lastSeenAt),
  check('qualified_visitor_presence_ip_address_check', sql`masklen(${table.ipAddress})=CASE family(${table.ipAddress}) WHEN 4 THEN 32 ELSE 128 END`),
  check('qualified_visitor_presence_country_code_check', sql`${table.countryCode} ~ '^[A-Z]{2}$'`),
  check('qualified_visitor_presence_channel_check', sql`${table.channel} IN ('web','app','tv','unknown')`),
  check('qualified_visitor_presence_platform_check', sql`${table.platform} IN ('web','ios','android','tizen','webos','tvos','androidtv','desktop','unknown')`),
  check('qualified_visitor_presence_device_type_check', sql`${table.deviceType} IN ('desktop','mobile','tablet','tv','unknown')`),
  check('qualified_visitor_presence_os_check', sql`char_length(${table.os})<=64`),
  check('qualified_visitor_presence_browser_check', sql`char_length(${table.browser})<=64`),
  check('qualified_visitor_presence_context_source_check', sql`${table.contextSource} IN ('client-header','user-agent','unknown')`)]);
export const visitorSessions = pgTable('visitor_sessions',{
  id:text('id').primaryKey(),ipAddress:text('ip_address').notNull().unique(),userAgent:text('user_agent'),
  lastActiveDate:timestamp('last_active_date',{withTimezone:true}).notNull().defaultNow(),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),visitCount:bigint('visit_count',{mode:'bigint'}).notNull().default(sql`1`),
},table=>[index('visitor_sessions_active_idx').on(table.lastActiveDate),index('visitor_sessions_created_idx').on(table.createdAt),check('visitor_sessions_visit_count_check',sql`${table.visitCount}>=0`)]);
export const runtimeAppState = pgTable('runtime_app_state',{
  key:text('key').primaryKey(),value:jsonb('value').notNull().default({}),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
});
export const bulkDescriptionJobs = pgTable('bulk_description_jobs',{
  id:text('id').primaryKey(),jobId:text('job_id').notNull().unique(),filterByCountry:text('filter_by_country'),status:text('status').notNull().default('running'),
  totalStations:integer('total_stations').notNull(),processedStations:integer('processed_stations').notNull().default(0),successCount:integer('success_count').notNull().default(0),
  failedCount:integer('failed_count').notNull().default(0),skippedCount:integer('skipped_count').notNull().default(0),lastProcessedStationId:text('last_processed_station_id'),
  lastProcessedSkip:integer('last_processed_skip').notNull().default(0),errorMessage:text('error_message'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},table=>[index('bulk_description_jobs_status_created_idx').on(table.status,table.createdAt.desc()),check('bulk_description_jobs_status_check',sql`${table.status} IN ('running','paused','completed','failed','cancelled')`)]);

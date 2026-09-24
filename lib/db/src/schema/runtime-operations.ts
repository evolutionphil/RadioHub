import { sql } from 'drizzle-orm';
import { bigint,check,index,inet,integer,jsonb,pgTable,text,timestamp,uuid,unique } from 'drizzle-orm/pg-core';
export const visitorActivitySubjects = pgTable('visitor_activity_subjects', {
  id: uuid('id').primaryKey().defaultRandom(), ipAddress: inet('ip_address').notNull(),
  trafficKind: text('traffic_kind').notNull(), firstSeenAt: timestamp('first_seen_at',{withTimezone:true}).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at',{withTimezone:true}).notNull().defaultNow(), countryCode: text('country_code'),
  channel: text('channel').notNull(), platform: text('platform').notNull(), deviceType: text('device_type').notNull(),
  os: text('os'), browser: text('browser'), contextSource: text('context_source').notNull(),
  hourStartedAt: timestamp('hour_started_at',{withTimezone:true}).notNull().default(sql`date_trunc('hour',now())`),
  hourEvents: integer('hour_events').notNull().default(1),
}, t => [unique('visitor_activity_subjects_ip_address_traffic_kind_key').on(t.ipAddress,t.trafficKind),
  index('visitor_activity_subjects_kind_seen_idx').on(t.trafficKind,t.lastSeenAt.desc(),t.id.desc()),
  index('visitor_activity_subjects_seen_idx').on(t.lastSeenAt),
  check('visitor_activity_subjects_ip_address_check',sql`masklen(${t.ipAddress})=CASE family(${t.ipAddress}) WHEN 4 THEN 32 ELSE 128 END`),
  check('visitor_activity_subjects_traffic_kind_check',sql`${t.trafficKind} IN ('qualified','automated')`),
  check('visitor_activity_subjects_country_code_check',sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
  check('visitor_activity_subjects_channel_check',sql`${t.channel} IN ('web','app','tv','unknown')`),
  check('visitor_activity_subjects_platform_check',sql`${t.platform} IN ('web','ios','android','tizen','webos','tvos','androidtv','desktop','unknown')`),
  check('visitor_activity_subjects_device_type_check',sql`${t.deviceType} IN ('desktop','mobile','tablet','tv','unknown')`),
  check('visitor_activity_subjects_os_check',sql`char_length(${t.os})<=64`),
  check('visitor_activity_subjects_browser_check',sql`char_length(${t.browser})<=64`),
  check('visitor_activity_subjects_context_source_check',sql`${t.contextSource} IN ('client-header','user-agent','unknown')`),
  check('visitor_activity_subjects_hour_events_check',sql`${t.hourEvents} BETWEEN 1 AND 60`)]);
export const visitorActivityEvents = pgTable('visitor_activity_events', {
  id: uuid('id').primaryKey().defaultRandom(), subjectId: uuid('subject_id').notNull().references(()=>visitorActivitySubjects.id,{onDelete:'cascade'}),
  occurredAt: timestamp('occurred_at',{withTimezone:true}).notNull().defaultNow(), path: text('path').notNull(),
  action: text('action').notNull(), method: text('method').notNull(), status: integer('status').notNull(),
  source: text('source').notNull(), referralCategory: text('referral_category').notNull(), automationStatus: text('automation_status').notNull(),
}, t => [index('visitor_activity_events_subject_time_idx').on(t.subjectId,t.occurredAt.desc(),t.id.desc()),
  index('visitor_activity_events_time_idx').on(t.occurredAt),
  check('visitor_activity_events_path_check',sql`char_length(${t.path}) BETWEEN 1 AND 256 AND ${t.path} LIKE '/%' AND ${t.path} !~ '[?#]' AND position(chr(92) in ${t.path})=0`),
  check('visitor_activity_events_action_check',sql`${t.action} IN ('page-view','station-view','play-request','favorite-add','favorite-remove','rating-submit')`),
  check('visitor_activity_events_method_check',sql`${t.method} IN ('GET','POST','PUT','PATCH','DELETE')`),
  check('visitor_activity_events_status_check',sql`${t.status} BETWEEN 200 AND 299`),
  check('visitor_activity_events_source_check',sql`${t.source} IN ('http','client-pageview')`),
  check('visitor_activity_events_referral_category_check',sql`${t.referralCategory} IN ('google','search','social','internal','direct-or-unknown','other-referral')`),
  check('visitor_activity_events_automation_status_check',sql`${t.automationStatus} IN ('unknown','browser-like','automated')`)]);
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

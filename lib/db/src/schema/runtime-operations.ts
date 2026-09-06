import { sql } from 'drizzle-orm';
import { bigint,check,index,integer,jsonb,pgTable,text,timestamp } from 'drizzle-orm/pg-core';
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
},table=>[index('bulk_description_jobs_status_created_idx').on(table.status,table.createdAt.desc()),check('bulk_description_jobs_status_check',sql`${table.status} IN ('running','paused','completed','failed')`)]);

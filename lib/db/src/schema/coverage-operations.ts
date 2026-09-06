import { pgTable,text,integer,doublePrecision,timestamp,jsonb,index,uniqueIndex } from 'drizzle-orm/pg-core';
const date=(name:string)=>timestamp(name,{withTimezone:true});
const statusFields=()=>({
  outcome:text('outcome').notNull(),message:text('message').notNull(),observedAt:date('observed_at').notNull(),
  startedAt:date('started_at'),finishedAt:date('finished_at'),durationMs:doublePrecision('duration_ms'),
  thresholdDays:integer('threshold_days'),historicalDayCount:integer('historical_day_count'),seedDays:integer('seed_days'),
  daysSeeded:integer('days_seeded'),inserted:integer('inserted'),preserved:integer('preserved'),error:text('error'),
});
export const coverageSnapshots=pgTable('coverage_snapshots',{
  id:text('id').primaryKey(),countryCode:text('country_code').notNull(),snapshotDate:date('snapshot_date').notNull(),
  total:integer('total').notNull().default(0),withLogo:integer('with_logo').notNull().default(0),withTags:integer('with_tags').notNull().default(0),
  logoCoveragePct:doublePrecision('logo_coverage_pct').notNull().default(0),tagCoveragePct:doublePrecision('tag_coverage_pct').notNull().default(0),
  source:text('source'),createdAt:date('created_at').notNull().defaultNow(),
},t=>[uniqueIndex('coverage_snapshots_country_code_snapshot_date_key').on(t.countryCode,t.snapshotDate),index('coverage_snapshots_date_idx').on(t.snapshotDate.desc())]);
export const coverageBackfillStatus=pgTable('coverage_backfill_status',{
  id:text('id').primaryKey(),key:text('key').notNull().unique().default('latest'),...statusFields(),updatedAt:date('updated_at').notNull().defaultNow(),
});
export const coverageBackfillRuns=pgTable('coverage_backfill_runs',{
  id:text('id').primaryKey(),...statusFields(),createdAt:date('created_at').notNull().defaultNow(),
},t=>[index('coverage_backfill_runs_observed_idx').on(t.observedAt.desc(),t.id.desc())]);
export const backfillRuns=pgTable('backfill_runs',{
  id:text('id').primaryKey(),trigger:text('trigger').notNull(),status:text('status').notNull(),topN:integer('top_n').notNull().default(5),
  overrideCountry:text('override_country'),startedAt:date('started_at').notNull(),finishedAt:date('finished_at'),durationMs:doublePrecision('duration_ms'),
  logos:jsonb('logos').notNull().default([]),tags:jsonb('tags').notNull().default([]),errorMessage:text('error_message'),attempts:jsonb('attempts').notNull().default([]),
},t=>[index('backfill_runs_started_idx').on(t.startedAt.desc(),t.id.desc()),index('backfill_runs_status_idx').on(t.status,t.startedAt.desc())]);

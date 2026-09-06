import { sql } from 'drizzle-orm';
import { pgTable,text,integer,doublePrecision,boolean,timestamp,index,check } from 'drizzle-orm/pg-core';
const date=(name:string)=>timestamp(name,{withTimezone:true});
export const genreSlugCleanupRuns=pgTable('genre_slug_cleanup_runs',{
  id:text('id').primaryKey(),trigger:text('trigger').notNull(),status:text('status').notNull(),
  startedAt:date('started_at').notNull(),finishedAt:date('finished_at'),durationMs:doublePrecision('duration_ms'),
  scanned:integer('scanned').notNull().default(0),alreadyValid:integer('already_valid').notNull().default(0),
  normalized:integer('normalized').notNull().default(0),markedUndiscoverable:integer('marked_undiscoverable').notNull().default(0),
  emptySlugMarked:integer('empty_slug_marked').notNull().default(0),collisionMarked:integer('collision_marked').notNull().default(0),
  errorCount:integer('error_count').notNull().default(0),rewarmed:boolean('rewarmed').notNull().default(false),errorMessage:text('error_message'),
},t=>[index('genre_slug_cleanup_runs_started_idx').on(t.startedAt.desc(),t.id.desc()),
  index('genre_slug_cleanup_runs_status_idx').on(t.status,t.startedAt.desc()),
  check('genre_slug_cleanup_runs_status_check',sql`${t.status} IN ('running','completed','failed')`)]);

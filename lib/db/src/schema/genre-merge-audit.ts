import { sql } from 'drizzle-orm';
import { check,index,integer,pgTable,text,timestamp } from 'drizzle-orm/pg-core';

export const genreMergeAuditLogs=pgTable('genre_merge_audit_logs',{
  id:text('id').primaryKey(),demotedGenreId:text('demoted_genre_id').notNull(),demotedGenreName:text('demoted_genre_name').notNull(),demotedGenreSlug:text('demoted_genre_slug').notNull().default(''),
  winnerGenreId:text('winner_genre_id').notNull(),winnerGenreName:text('winner_genre_name').notNull(),winnerGenreSlug:text('winner_genre_slug').notNull().default(''),
  targetSource:text('target_source').notNull(),stationsMatched:integer('stations_matched').notNull().default(0),stationsRetagged:integer('stations_retagged').notNull().default(0),
  actorUserId:text('actor_user_id'),actorEmail:text('actor_email'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
  check('genre_merge_audit_logs_target_source_check',sql`${t.targetSource} IN ('manual','auto-recorded')`),
  check('genre_merge_audit_logs_stations_matched_check',sql`${t.stationsMatched}>=0`),check('genre_merge_audit_logs_stations_retagged_check',sql`${t.stationsRetagged}>=0`),
  index('genre_merge_audit_logs_created').on(t.createdAt.desc()),index('genre_merge_audit_logs_demoted').on(t.demotedGenreId,t.createdAt.desc()),
  index('genre_merge_audit_logs_winner').on(t.winnerGenreId,t.createdAt.desc()),index('genre_merge_audit_logs_target').on(t.targetSource,t.createdAt.desc()),
]);

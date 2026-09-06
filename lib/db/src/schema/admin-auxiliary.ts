import { pgTable,text,jsonb,timestamp,integer,uniqueIndex,index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const adminPreferences = pgTable('admin_preferences',{
  id:text('id').primaryKey(),adminUsername:text('admin_username').notNull(),key:text('key').notNull(),value:jsonb('value'),
  createdAt:timestamp('created_at',{ withTimezone:true }).notNull().defaultNow(),updatedAt:timestamp('updated_at',{ withTimezone:true }).notNull().defaultNow(),
},t=>[uniqueIndex('admin_preferences_admin_username_key_key').on(t.adminUsername,t.key)]);
export const sharedComparisonPresets = pgTable('shared_comparison_presets',{
  id:text('id').primaryKey(),name:text('name').notNull(),countries:text('countries').array().notNull(),ownerUsername:text('owner_username').notNull(),
  createdAt:timestamp('created_at',{ withTimezone:true }).notNull().defaultNow(),updatedAt:timestamp('updated_at',{ withTimezone:true }).notNull().defaultNow(),
},t=>[uniqueIndex('shared_comparison_presets_name_uq').on(sql`lower(${t.name})`),index('shared_comparison_presets_owner_idx').on(t.ownerUsername)]);
export const semrushIssues = pgTable('semrush_issues',{
  id:text('id').primaryKey(),url:text('url').notNull(),statusCode:integer('status_code').notNull().default(0),issueType:text('issue_type').notNull(),
  issueDescription:text('issue_description').notNull().default(''),priority:text('priority').notNull(),
  importedAt:timestamp('imported_at',{ withTimezone:true }).notNull().defaultNow(),expiresAt:timestamp('expires_at',{ withTimezone:true }).notNull(),
});
export const analyticsEvents = pgTable('analytics_events',{
  id:text('id').primaryKey(),event:text('event').notNull(),stationId:text('station_id'),userId:text('user_id'),sessionId:text('session_id'),
  timestamp:timestamp('timestamp',{ withTimezone:true }).notNull().defaultNow(),source:jsonb('source').notNull().default({}),
  createdAt:timestamp('created_at',{ withTimezone:true }).notNull().defaultNow(),
});

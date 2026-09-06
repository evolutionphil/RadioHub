import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const apiDeveloperUsers = pgTable('api_developer_users', {
  id: text('id').primaryKey(), email: text('email').notNull(), passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(), company: text('company'), website: text('website'),
  plan: text('plan').notNull().default('free'), status: text('status').notNull().default('active'),
  source: jsonb('source').notNull().default({}), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, table => [
  uniqueIndex('api_developer_users_email_uq').on(sql`lower(${table.email})`),
  index('api_developer_users_created_idx').on(table.createdAt.desc()),
  check('api_developer_users_plan_check', sql`${table.plan} IN ('free','pro')`),
  check('api_developer_users_status_check', sql`${table.status} IN ('active','suspended')`),
]);

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(), keyHash: text('key_hash').notNull().unique(), keyPrefix: text('key_prefix').notNull(),
  name: text('name').notNull(), email: text('email').notNull(), appName: text('app_name'), appUrl: text('app_url'), usageReason: text('usage_reason'),
  userId: text('user_id').references(() => apiDeveloperUsers.id, { onDelete: 'cascade' }),
  plan: text('plan').notNull().default('free'), status: text('status').notNull().default('active'),
  rateLimitPerMin: integer('rate_limit_per_min').notNull().default(60),
  dailyQuota: bigint('daily_quota', { mode: 'number' }).notNull().default(1000),
  monthlyQuota: bigint('monthly_quota', { mode: 'number' }).notNull().default(10000),
  todayCount: bigint('today_count', { mode: 'number' }).notNull().default(0),
  monthCount: bigint('month_count', { mode: 'number' }).notNull().default(0),
  totalCount: bigint('total_count', { mode: 'number' }).notNull().default(0),
  lastResetDay: text('last_reset_day'), lastResetMonth: text('last_reset_month'), lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  minuteCount: integer('minute_count').notNull().default(0), minuteResetAt: timestamp('minute_reset_at', { withTimezone: true }),
  source: jsonb('source').notNull().default({}), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, table => [
  index('api_keys_email_idx').on(sql`lower(${table.email})`), index('api_keys_user_idx').on(table.userId),
  index('api_keys_plan_status_idx').on(table.plan, table.status), index('api_keys_used_idx').on(table.lastUsedAt.desc(), table.createdAt.desc()),
  index('api_keys_expiry_idx').on(table.expiresAt).where(sql`${table.expiresAt} IS NOT NULL`),
  check('api_keys_plan_check', sql`${table.plan} IN ('demo','free','pro','internal')`),
  check('api_keys_status_check', sql`${table.status} IN ('active','revoked','expired','suspended')`),
  check('api_keys_rate_limit_per_min_check', sql`${table.rateLimitPerMin} > 0`),
  check('api_keys_daily_quota_check', sql`${table.dailyQuota} >= 0`), check('api_keys_monthly_quota_check', sql`${table.monthlyQuota} >= 0`),
  check('api_keys_today_count_check', sql`${table.todayCount} >= 0`), check('api_keys_month_count_check', sql`${table.monthCount} >= 0`),
  check('api_keys_total_count_check', sql`${table.totalCount} >= 0`), check('api_keys_minute_count_check', sql`${table.minuteCount} >= 0`),
]);

export const apiDemoUsage = pgTable('api_demo_usage', {
  id: text('id').primaryKey(), ipHash: text('ip_hash').notNull().unique(), demoKeyHash: text('demo_key_hash').notNull(),
  lastIssuedAt: timestamp('last_issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usageCount: bigint('usage_count', { mode: 'number' }).notNull().default(1), source: jsonb('source').notNull().default({}),
}, table => [index('api_demo_usage_expiry_idx').on(table.expiresAt), check('api_demo_usage_usage_count_check', sql`${table.usageCount} >= 0`)]);

export const apiDeveloperSessions = pgTable('api_developer_sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(() => apiDeveloperUsers.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, table => [index('api_developer_sessions_expiry_idx').on(table.expiresAt), index('api_developer_sessions_user_idx').on(table.userId)]);

// A login may reference no account (or a deleted one), so user_id is provenance,
// not an FK. Audit retention is bounded to 30 days by the access-store cleanup.
export const authEventLogs = pgTable('auth_event_logs', {
  id: text('id').primaryKey(), ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  method: text('method').notNull(), event: text('event').notNull(), ok: boolean('ok').notNull(),
  email: text('email'), userId: text('user_id'), ip: text('ip'), userAgent: text('user_agent'),
  message: text('message'), detail: jsonb('detail'), source: jsonb('source').notNull().default({}),
}, table => [index('auth_event_logs_ts_idx').on(table.ts.desc()), index('auth_event_logs_method_ts_idx').on(table.method, table.ts.desc()),
  index('auth_event_logs_email_ts_idx').on(table.email, table.ts.desc()), index('auth_event_logs_user_idx').on(table.userId)]);

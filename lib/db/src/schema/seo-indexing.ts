import { sql } from 'drizzle-orm';
import { bigint, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
const time=(name:string)=>timestamp(name,{withTimezone:true});
const strings=(name:string)=>text(name).array().notNull().default(sql`'{}'::text[]`);
export const indexNowLogs=pgTable('indexnow_logs',{
  id:text('id').primaryKey(),timestamp:time('timestamp').notNull().defaultNow(),host:text('host').notNull(),urlCount:integer('url_count').notNull(),status:text('status').notNull(),
  statusCode:integer('status_code'),trigger:text('trigger').notNull(),errorMessage:text('error_message'),sampleUrls:strings('sample_urls'),retryAttempt:integer('retry_attempt').notNull().default(0),
  responseTime:integer('response_time'),runDate:text('run_date'),createdAt:time('created_at').notNull().defaultNow(),
},t=>[check('indexnow_logs_status_check',sql`${t.status} IN ('success','failed')`),index('indexnow_logs_timestamp').on(t.timestamp.desc()),index('indexnow_logs_host_time').on(t.host,t.timestamp.desc()),index('indexnow_logs_trigger_time').on(t.trigger,t.timestamp.desc())]);
export const indexNowSubmissionUrls=pgTable('indexnow_submission_urls',{
  id:text('id').primaryKey(),logId:text('log_id').notNull().unique().references(()=>indexNowLogs.id,{onDelete:'cascade'}),timestamp:time('timestamp').notNull(),host:text('host').notNull(),
  trigger:text('trigger').notNull(),urls:strings('urls'),urlCount:integer('url_count').notNull(),expiresAt:time('expires_at').notNull(),
},t=>[index('indexnow_submission_urls_expiry').on(t.expiresAt)]);
export const sitemapUrlSnapshots=pgTable('sitemap_url_snapshots',{
  id:text('id').primaryKey(),type:text('type').notNull(),language:text('language').notNull(),chunk:integer('chunk').notNull().default(0),urls:strings('urls'),urlCount:integer('url_count').notNull(),
  generatedAt:time('generated_at').notNull().defaultNow(),updatedAt:time('updated_at').notNull().defaultNow(),
},t=>[check('sitemap_url_snapshots_type_check',sql`${t.type} IN ('main','genres','stations')`),uniqueIndex('sitemap_url_snapshots_type_language_chunk_key').on(t.type,t.language,t.chunk)]);
export const sitemapManifests=pgTable('sitemap_manifests',{
  id:text('id').primaryKey(),type:text('type').notNull(),language:text('language').notNull(),version:text('version').notNull(),status:text('status').notNull(),
  qualifiedLanguagesHash:text('qualified_languages_hash').notNull(),qualifiedLanguages:strings('qualified_languages'),chunks:jsonb('chunks').notNull().default([]),
  totalUrls:integer('total_urls').notNull().default(0),chunkCount:integer('chunk_count').notNull().default(0),generatedAt:time('generated_at').notNull().defaultNow(),expiresAt:time('expires_at').notNull(),errorMessage:text('error_message'),
},t=>[check('sitemap_manifests_type_check',sql`${t.type} IN ('main','genres','stations')`),check('sitemap_manifests_status_check',sql`${t.status} IN ('building','active','superseded','failed','retired')`),
  index('sitemap_manifests_read').on(t.type,t.language,t.status,t.generatedAt.desc()),uniqueIndex('sitemap_manifests_one_build').on(t.type,t.language).where(sql`${t.status}='building'`),
  uniqueIndex('sitemap_manifests_one_active').on(t.type,t.language).where(sql`${t.status}='active'`),index('sitemap_manifests_expiry').on(t.expiresAt).where(sql`${t.status}<>'active'`)]);
export const gscUrlInspections=pgTable('gsc_url_inspections',{
  id:text('id').primaryKey(),url:text('url').notNull().unique(),language:text('language').notNull(),group:text('url_group').notNull(),state:text('state').notNull().default('pending'),
  coverageState:text('coverage_state'),verdict:text('verdict'),robotsTxtState:text('robots_txt_state'),indexingState:text('indexing_state'),pageFetchState:text('page_fetch_state'),lastCrawlTime:time('last_crawl_time'),
  googleCanonical:text('google_canonical'),userCanonical:text('user_canonical'),inspectionResultLink:text('inspection_result_link'),lastInspectedAt:time('last_inspected_at'),lastError:text('last_error'),errorCount:integer('error_count').notNull().default(0),
  discoveredAt:time('discovered_at').notNull().defaultNow(),updatedAt:time('updated_at').notNull().defaultNow(),notIndexedSince:time('not_indexed_since'),lastResubmitAt:time('last_resubmit_at'),lastResubmitStatus:text('last_resubmit_status'),
  lastResubmitError:text('last_resubmit_error'),resubmitCount:integer('resubmit_count').notNull().default(0),inspectionLeaseToken:text('inspection_lease_token'),inspectionLeaseUntil:time('inspection_lease_until'),resubmitLeaseToken:text('resubmit_lease_token'),resubmitLeaseUntil:time('resubmit_lease_until'),
},t=>[check('gsc_url_inspections_state_check',sql`${t.state} IN ('indexed','crawled-not-indexed','discovered-not-indexed','excluded','error','unknown','pending')`),
  index('gsc_url_inspections_group_state').on(t.language,t.group,t.state),index('gsc_url_inspections_rotation').on(t.lastInspectedAt.asc().nullsFirst(),t.discoveredAt.desc(),t.id),
  index('gsc_url_inspections_stuck').on(t.state,t.notIndexedSince,t.lastResubmitAt),index('gsc_url_inspections_url_prefix').on(t.url.op('text_pattern_ops'))]);
export const gscIndexingSnapshots=pgTable('gsc_indexing_snapshots',{
  id:text('id').primaryKey(),date:time('date').notNull(),language:text('language').notNull(),group:text('url_group').notNull(),total:integer('total').notNull().default(0),indexed:integer('indexed').notNull().default(0),
  crawledNotIndexed:integer('crawled_not_indexed').notNull().default(0),discoveredNotIndexed:integer('discovered_not_indexed').notNull().default(0),excluded:integer('excluded').notNull().default(0),error:integer('error').notNull().default(0),
  pending:integer('pending').notNull().default(0),unknown:integer('unknown').notNull().default(0),createdAt:time('created_at').notNull().defaultNow(),
},t=>[uniqueIndex('gsc_indexing_snapshots_date_language_url_group_key').on(t.date,t.language,t.group),index('gsc_indexing_snapshots_date').on(t.date.desc())]);
export const gscOAuthTokens=pgTable('gsc_oauth_tokens',{
  id:text('id').primaryKey(),refreshToken:text('refresh_token').notNull(),accessToken:text('access_token'),expiryDate:bigint('expiry_date',{mode:'number'}),scope:text('scope').notNull().default('https://www.googleapis.com/auth/webmasters.readonly'),
  connectedEmail:text('connected_email'),createdAt:time('created_at').notNull().defaultNow(),updatedAt:time('updated_at').notNull().defaultNow(),
},t=>[index('gsc_oauth_tokens_created').on(t.createdAt.desc())]);
export const gscInspectionQuota=pgTable('gsc_inspection_quota',{
  day:date('day').notNull(),siteUrl:text('site_url').notNull(),requests:integer('requests').notNull().default(0),
},t=>[primaryKey({columns:[t.day,t.siteUrl]})]);
export const gscOAuthStates=pgTable('gsc_oauth_states',{
  stateHash:text('state_hash').primaryKey(),sessionId:text('session_id').notNull(),expiresAt:time('expires_at').notNull(),
},t=>[index('gsc_oauth_states_expiry').on(t.expiresAt)]);

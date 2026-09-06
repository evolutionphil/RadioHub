import { sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
const ts = (name: string) => timestamp(name, { withTimezone: true });
export const recommendationProfiles = pgTable('recommendation_profiles', {
  id: text('id').primaryKey(), sessionId: text('session_id').notNull().unique(), userId: text('user_id'),
  preferredGenres: jsonb('preferred_genres').notNull().default([]), preferredCountries: jsonb('preferred_countries').notNull().default([]),
  preferredLanguages: jsonb('preferred_languages').notNull().default([]), averageListenDuration: doublePrecision('average_listen_duration').notNull().default(0),
  peakListeningHours: integer('peak_listening_hours').array().notNull().default([]), skipRate: doublePrecision('skip_rate').notNull().default(0),
  totalStationsListened: integer('total_stations_listened').notNull().default(0), uniqueStationsCount: integer('unique_stations_count').notNull().default(0),
  favoriteStationsCount: integer('favorite_stations_count').notNull().default(0), lastListenedAt: ts('last_listened_at'),
  profileStrength: doublePrecision('profile_strength').notNull().default(0), source: jsonb('source').notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow(),
}, t => [index('recommendation_profiles_user').on(t.userId), check('recommendation_profiles_skip_rate_check', sql`${t.skipRate} BETWEEN 0 AND 1`),
  check('recommendation_profiles_profile_strength_check', sql`${t.profileStrength} BETWEEN 0 AND 1`)]);
export const userMusicProfiles = pgTable('user_music_profiles', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().unique(), genres: jsonb('genres').notNull().default([]),
  countries: jsonb('countries').notNull().default([]), languages: jsonb('languages').notNull().default([]),
  listeningHabits: jsonb('listening_habits').notNull().default({}), mood: jsonb('mood').notNull().default({}),
  discovery: jsonb('discovery').notNull().default({}), source: jsonb('source').notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const stationSimilarities = pgTable('station_similarities', {
  id: text('id').primaryKey(), stationId1: text('station_id_1').notNull(), stationId2: text('station_id_2').notNull(),
  similarityScore: doublePrecision('similarity_score').notNull(), confidence: doublePrecision('confidence').notNull(),
  calculationType: text('calculation_type').notNull(), features: jsonb('features').notNull().default({}),
  lastCalculated: ts('last_calculated').notNull(), sampleSize: integer('sample_size').notNull().default(0),
  source: jsonb('source').notNull().default({}), createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow(),
}, t => [unique().on(t.stationId1, t.stationId2), index('station_similarities_score').on(t.stationId1, t.similarityScore.desc(), t.confidence.desc()),
  check('station_similarities_similarity_score_check', sql`${t.similarityScore} BETWEEN 0 AND 1`), check('station_similarities_confidence_check', sql`${t.confidence} BETWEEN 0 AND 1`)]);
export const recommendationEvents = pgTable('recommendation_events', {
  id: text('id').primaryKey(), userId: text('user_id'), stationId: text('station_id').notNull(), stationName: text('station_name').notNull(),
  recommendationType: text('recommendation_type').notNull(), confidence: doublePrecision('confidence').notNull(), reason: text('reason').notNull(),
  metadata: jsonb('metadata').notNull().default({}), generated: ts('generated').notNull().defaultNow(), presented: ts('presented'),
  clicked: ts('clicked'), liked: ts('liked'), dismissed: ts('dismissed'), feedback: text('feedback'), source: jsonb('source').notNull().default({}),
}, t => [index('recommendation_events_user').on(t.userId, t.generated.desc()), check('recommendation_events_confidence_check', sql`${t.confidence} BETWEEN 0 AND 100`)]);
export const listeningSessions = pgTable('listening_sessions', {
  id: text('id').primaryKey(), userId: text('user_id'), sessionId: text('session_id').notNull(), stationId: text('station_id').notNull(),
  stationName: text('station_name').notNull(), genre: text('genre').notNull(), country: text('country').notNull(), language: text('language').notNull(),
  startTime: ts('start_time').notNull().defaultNow(), endTime: ts('end_time'), duration: doublePrecision('duration').notNull().default(0),
  skipReason: text('skip_reason'), liked: boolean('liked').notNull().default(false), mood: text('mood'), context: text('context'),
  deviceType: text('device_type'), location: jsonb('location'), source: jsonb('source').notNull().default({}),
}, t => [index('listening_sessions_user').on(t.userId, t.startTime.desc()), index('listening_sessions_session').on(t.sessionId, t.startTime.desc())]);

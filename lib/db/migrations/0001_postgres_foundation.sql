-- MegaRadio MongoDB -> PostgreSQL foundation.
-- IDs remain Mongo-compatible text values until the cutover is complete.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS countries (
  id text PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL,
  continent text, station_count integer NOT NULL DEFAULT 0,
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS languages (
  id text PRIMARY KEY, code text UNIQUE, name text NOT NULL,
  station_count integer NOT NULL DEFAULT 0, source jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS languages_name_idx ON languages(name);

CREATE TABLE IF NOT EXISTS genres (
  id text PRIMARY KEY, name text NOT NULL, slug text UNIQUE,
  is_discoverable boolean NOT NULL DEFAULT true, station_count integer NOT NULL DEFAULT 0,
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS genres_discoverable_count_idx ON genres(is_discoverable, station_count);

CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY, station_uuid text NOT NULL UNIQUE, change_uuid text,
  name text NOT NULL, slug text, slug_aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  redirect_to_slug text, url text NOT NULL, url_resolved text, homepage text, favicon text,
  country text, country_code text, state text, language text, language_codes text,
  tags_raw text, codec text, bitrate integer, hls boolean NOT NULL DEFAULT false,
  votes integer NOT NULL DEFAULT 0, click_count integer NOT NULL DEFAULT 0,
  click_trend double precision NOT NULL DEFAULT 0, average_rating real NOT NULL DEFAULT 0,
  total_ratings integer NOT NULL DEFAULT 0, last_check_ok boolean NOT NULL DEFAULT true,
  last_check_time timestamptz, latitude double precision, longitude double precision,
  has_logo boolean NOT NULL DEFAULT false, logo_assets jsonb,
  descriptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  manual_edit_fields jsonb NOT NULL DEFAULT '{}'::jsonb, media_group_id text,
  is_featured boolean NOT NULL DEFAULT false,
  show_in_global_popular boolean NOT NULL DEFAULT false,
  no_index boolean NOT NULL DEFAULT false, source jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stations_country_working_popular_idx ON stations(country_code, last_check_ok, votes DESC);
CREATE INDEX IF NOT EXISTS stations_slug_idx ON stations(slug);
CREATE INDEX IF NOT EXISTS stations_working_logo_votes_idx ON stations(last_check_ok, has_logo DESC, votes DESC);
CREATE INDEX IF NOT EXISTS stations_updated_idx ON stations(updated_at DESC);
CREATE INDEX IF NOT EXISTS stations_media_group_idx ON stations(media_group_id);
CREATE INDEX IF NOT EXISTS stations_name_search_idx ON stations(lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS stations_country_search_idx ON stations(lower(country) text_pattern_ops);
CREATE INDEX IF NOT EXISTS stations_descriptions_gin_idx ON stations USING gin(descriptions);
CREATE INDEX IF NOT EXISTS stations_name_trgm_idx ON stations USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS stations_country_trgm_idx ON stations USING gin(country gin_trgm_ops);
CREATE INDEX IF NOT EXISTS stations_state_trgm_idx ON stations USING gin(state gin_trgm_ops);
CREATE INDEX IF NOT EXISTS stations_tags_trgm_idx ON stations USING gin(tags_raw gin_trgm_ops);
CREATE INDEX IF NOT EXISTS stations_language_trgm_idx ON stations USING gin(language gin_trgm_ops);

CREATE TABLE IF NOT EXISTS station_genres (
  station_id text NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  genre_slug text NOT NULL, position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(station_id, genre_slug)
);
CREATE INDEX IF NOT EXISTS station_genres_slug_station_idx ON station_genres(genre_slug, station_id);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, username text NOT NULL UNIQUE, email text NOT NULL UNIQUE,
  password_hash text, full_name text NOT NULL, slug text, bio text, avatar text,
  role text NOT NULL DEFAULT 'user', status text NOT NULL DEFAULT 'active',
  email_verified boolean NOT NULL DEFAULT false, is_public_profile boolean NOT NULL DEFAULT false,
  google_id text UNIQUE, facebook_id text UNIQUE, apple_id text UNIQUE,
  preferences jsonb DEFAULT '{}'::jsonb, permissions jsonb DEFAULT '{}'::jsonb,
  stats jsonb DEFAULT '{}'::jsonb, last_login_at timestamptz,
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_public_slug_idx ON users(is_public_profile, slug);
CREATE INDEX IF NOT EXISTS users_role_status_idx ON users(role, status);

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id text NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, station_id)
);
CREATE INDEX IF NOT EXISTS user_favorites_station_created_idx ON user_favorites(station_id, created_at DESC);

CREATE TABLE IF NOT EXISTS station_ratings (
  id text PRIMARY KEY, station_id text NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE CASCADE, session_id text, ip_address text,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5), comment text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS station_ratings_user_uq ON station_ratings(station_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS station_ratings_session_uq ON station_ratings(station_id, session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS station_ratings_station_created_idx ON station_ratings(station_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_follows (
  follower_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX IF NOT EXISTS user_follows_following_idx ON user_follows(following_id);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id text PRIMARY KEY, token text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_type text NOT NULL DEFAULT 'mobile', device_name text,
  expires_at timestamptz NOT NULL, last_used_at timestamptz NOT NULL,
  is_revoked boolean NOT NULL DEFAULT false,
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS auth_tokens_expiry_idx ON auth_tokens(expires_at);

CREATE TABLE IF NOT EXISTS listening_history (
  id text PRIMARY KEY, user_id text REFERENCES users(id) ON DELETE SET NULL,
  session_id text NOT NULL, station_id text NOT NULL, station_name text NOT NULL,
  country text, genre text, listen_duration integer NOT NULL DEFAULT 0,
  interaction_type text NOT NULL, listened_at timestamptz NOT NULL,
  device_type text, context jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listening_user_time_idx ON listening_history(user_id, listened_at DESC);
CREATE INDEX IF NOT EXISTS listening_session_time_idx ON listening_history(session_id, listened_at DESC);
CREATE INDEX IF NOT EXISTS listening_station_time_idx ON listening_history(station_id, listened_at DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'none', platform text, status text NOT NULL DEFAULT 'inactive',
  product_id text, transaction_id text, original_transaction_id text UNIQUE,
  purchase_token text UNIQUE, stripe_customer_id text, stripe_subscription_id text,
  paddle_customer_id text, paddle_subscription_id text,
  is_active boolean NOT NULL DEFAULT false, is_trial boolean NOT NULL DEFAULT false,
  expires_at timestamptz, renews_at timestamptz, started_at timestamptz,
  cancelled_at timestamptz, last_verified_at timestamptz,
  provider_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_active_expiry_idx ON subscriptions(is_active, expires_at);

CREATE TABLE IF NOT EXISTS payment_events (
  id text PRIMARY KEY, provider text NOT NULL, provider_event_id text NOT NULL,
  user_id text REFERENCES users(id) ON DELETE SET NULL, event_type text NOT NULL,
  status text NOT NULL, plan text, amount_minor integer, currency text,
  occurred_at timestamptz NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS payment_events_user_time_idx ON payment_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_status_time_idx ON payment_events(status, occurred_at DESC);

CREATE TABLE IF NOT EXISTS translation_keys (
  id text PRIMARY KEY, key text NOT NULL UNIQUE, default_value text NOT NULL,
  category text NOT NULL, description text, context text,
  is_plural boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS translations (
  id text PRIMARY KEY, key_id text NOT NULL REFERENCES translation_keys(id) ON DELETE CASCADE,
  language text NOT NULL, value text NOT NULL, is_completed boolean NOT NULL DEFAULT false,
  last_modified timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(key_id, language)
);
CREATE INDEX IF NOT EXISTS translations_language_completed_idx ON translations(language, is_completed);

CREATE TABLE IF NOT EXISTS url_translations (
  id text PRIMARY KEY, language_code text NOT NULL, english_path text NOT NULL,
  translated_path text NOT NULL, is_active boolean NOT NULL DEFAULT true, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(language_code, english_path)
);
CREATE INDEX IF NOT EXISTS url_translations_reverse_idx ON url_translations(language_code, translated_path);

CREATE TABLE IF NOT EXISTS legacy_documents (
  collection_name text NOT NULL, document_id text NOT NULL, payload jsonb NOT NULL,
  checksum text NOT NULL, last_seen_run_id text NOT NULL, mongo_updated_at timestamptz,
  migrated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(collection_name, document_id)
);
ALTER TABLE legacy_documents ADD COLUMN IF NOT EXISTS last_seen_run_id text;
UPDATE legacy_documents SET last_seen_run_id='bootstrap' WHERE last_seen_run_id IS NULL;
ALTER TABLE legacy_documents ALTER COLUMN last_seen_run_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS legacy_documents_collection_updated_idx ON legacy_documents(collection_name, mongo_updated_at);

CREATE TABLE IF NOT EXISTS migration_runs (
  id text PRIMARY KEY, mode text NOT NULL, status text NOT NULL,
  started_at timestamptz NOT NULL, finished_at timestamptz,
  source_database text, stats jsonb NOT NULL DEFAULT '{}'::jsonb, error text
);
CREATE INDEX IF NOT EXISTS migration_runs_started_idx ON migration_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS migration_checkpoints (
  collection_name text PRIMARY KEY, last_document_id text,
  documents_processed integer NOT NULL DEFAULT 0, source_count integer NOT NULL DEFAULT 0,
  target_count integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS migration_checkpoints_status_idx ON migration_checkpoints(status);

-- express-session compatible storage. Session cutover can happen independently.
CREATE TABLE IF NOT EXISTS user_sessions (
  sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions(expire);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['countries','languages','genres','stations','users','station_ratings','subscriptions','translation_keys','url_translations','migration_checkpoints']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', table_name);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', table_name);
  END LOOP;
END $$;

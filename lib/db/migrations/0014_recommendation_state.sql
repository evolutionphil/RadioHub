CREATE TABLE recommendation_profiles (
  id text PRIMARY KEY, session_id text NOT NULL UNIQUE, user_id text,
  preferred_genres jsonb NOT NULL DEFAULT '[]', preferred_countries jsonb NOT NULL DEFAULT '[]',
  preferred_languages jsonb NOT NULL DEFAULT '[]', average_listen_duration double precision NOT NULL DEFAULT 0,
  peak_listening_hours integer[] NOT NULL DEFAULT ARRAY[]::integer[], skip_rate double precision NOT NULL DEFAULT 0 CHECK(skip_rate BETWEEN 0 AND 1),
  total_stations_listened integer NOT NULL DEFAULT 0, unique_stations_count integer NOT NULL DEFAULT 0,
  favorite_stations_count integer NOT NULL DEFAULT 0, last_listened_at timestamptz,
  profile_strength double precision NOT NULL DEFAULT 0 CHECK(profile_strength BETWEEN 0 AND 1),
  source jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recommendation_profiles_user ON recommendation_profiles(user_id);
CREATE TABLE user_music_profiles (
  id text PRIMARY KEY, user_id text NOT NULL UNIQUE, genres jsonb NOT NULL DEFAULT '[]',
  countries jsonb NOT NULL DEFAULT '[]', languages jsonb NOT NULL DEFAULT '[]',
  listening_habits jsonb NOT NULL DEFAULT '{}', mood jsonb NOT NULL DEFAULT '{}', discovery jsonb NOT NULL DEFAULT '{}',
  source jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE station_similarities (
  id text PRIMARY KEY, station_id_1 text NOT NULL, station_id_2 text NOT NULL,
  similarity_score double precision NOT NULL CHECK(similarity_score BETWEEN 0 AND 1),
  confidence double precision NOT NULL CHECK(confidence BETWEEN 0 AND 1), calculation_type text NOT NULL,
  features jsonb NOT NULL DEFAULT '{}', last_calculated timestamptz NOT NULL, sample_size integer NOT NULL DEFAULT 0,
  source jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(station_id_1,station_id_2)
);
CREATE INDEX station_similarities_score ON station_similarities(station_id_1,similarity_score DESC,confidence DESC);
CREATE TABLE recommendation_events (
  id text PRIMARY KEY, user_id text, station_id text NOT NULL, station_name text NOT NULL,
  recommendation_type text NOT NULL, confidence double precision NOT NULL CHECK(confidence BETWEEN 0 AND 100),
  reason text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', generated timestamptz NOT NULL DEFAULT now(),
  presented timestamptz, clicked timestamptz, liked timestamptz, dismissed timestamptz, feedback text, source jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX recommendation_events_user ON recommendation_events(user_id,generated DESC);
CREATE TABLE listening_sessions (
  id text PRIMARY KEY, user_id text, session_id text NOT NULL, station_id text NOT NULL, station_name text NOT NULL,
  genre text NOT NULL, country text NOT NULL, language text NOT NULL, start_time timestamptz NOT NULL DEFAULT now(),
  end_time timestamptz, duration double precision NOT NULL DEFAULT 0, skip_reason text, liked boolean NOT NULL DEFAULT false,
  mood text, context text, device_type text, location jsonb, source jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX listening_sessions_user ON listening_sessions(user_id,start_time DESC);
CREATE INDEX listening_sessions_session ON listening_sessions(session_id,start_time DESC);
CREATE INDEX listening_history_collaborative ON listening_history(station_id,session_id) INCLUDE(listen_duration);

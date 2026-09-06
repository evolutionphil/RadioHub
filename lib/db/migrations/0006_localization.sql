CREATE TABLE translation_metadata (
  scope text PRIMARY KEY,
  languages_version bigint NOT NULL DEFAULT 1 CHECK (languages_version >= 1),
  last_bumped_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON translation_metadata
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE country_language_mappings (
  id text PRIMARY KEY,
  country_code text NOT NULL UNIQUE,
  country_name text NOT NULL,
  language_code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX country_language_mappings_active_priority_idx
  ON country_language_mappings(is_active, priority DESC);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON country_language_mappings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE translation_languages (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

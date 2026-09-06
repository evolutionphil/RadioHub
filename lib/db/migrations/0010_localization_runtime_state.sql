CREATE TABLE seo_qualified_languages_lkg (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  languages text[] NOT NULL DEFAULT ARRAY[]::text[],
  hash text NOT NULL,
  source text NOT NULL CHECK (source IN ('computed','seed')),
  computed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seo_qualified_languages_lkg_expiry_idx ON seo_qualified_languages_lkg(expires_at);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON seo_qualified_languages_lkg
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE admin_settings (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value jsonb,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON admin_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE admin_setting_history (
  id text PRIMARY KEY,
  key text NOT NULL,
  action text NOT NULL CHECK (action IN ('update','clear')),
  previous_value jsonb,
  new_value jsonb,
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_setting_history_key_changed_idx ON admin_setting_history(key,changed_at DESC);

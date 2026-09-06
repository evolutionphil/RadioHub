CREATE TABLE country_language_mapping_audit (
  id text PRIMARY KEY,
  action text NOT NULL DEFAULT 'clear-overrides',
  actor_email text,
  deleted_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text
);
CREATE INDEX country_language_mapping_audit_created_idx
  ON country_language_mapping_audit(created_at DESC);

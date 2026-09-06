-- Keep identifiers as text snapshots: the demoted genre is deleted in the same transaction.
CREATE TABLE genre_merge_audit_logs (
  id text PRIMARY KEY,
  demoted_genre_id text NOT NULL,demoted_genre_name text NOT NULL,demoted_genre_slug text NOT NULL DEFAULT '',
  winner_genre_id text NOT NULL,winner_genre_name text NOT NULL,winner_genre_slug text NOT NULL DEFAULT '',
  target_source text NOT NULL CHECK(target_source IN ('manual','auto-recorded')),
  stations_matched integer NOT NULL DEFAULT 0 CHECK(stations_matched>=0),
  stations_retagged integer NOT NULL DEFAULT 0 CHECK(stations_retagged>=0),
  actor_user_id text,actor_email text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX genre_merge_audit_logs_created ON genre_merge_audit_logs(created_at DESC);
CREATE INDEX genre_merge_audit_logs_demoted ON genre_merge_audit_logs(demoted_genre_id,created_at DESC);
CREATE INDEX genre_merge_audit_logs_winner ON genre_merge_audit_logs(winner_genre_id,created_at DESC);
CREATE INDEX genre_merge_audit_logs_target ON genre_merge_audit_logs(target_source,created_at DESC);

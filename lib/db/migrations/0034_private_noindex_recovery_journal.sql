-- Recovery evidence includes the acting administrator and must not live in
-- stations.source, which is deliberately spread into public catalog records.
-- A nullable native column keeps existing rows unchanged and is not mapped by
-- catalogShape. Normal catalog updates leave this private journal untouched.
ALTER TABLE stations ADD COLUMN no_index_recovery_journal jsonb;

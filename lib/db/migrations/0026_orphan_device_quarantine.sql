-- Offline migration history only: never an authentication/device lookup table.
-- Keep malformed ownership out of runtime tables without losing its captured
-- JSON/BSON, original owner reference, or immutable expected content hashes.
CREATE TABLE migration_quarantine (
  collection_name text NOT NULL CHECK (collection_name = 'userdevices'),
  document_id text NOT NULL,
  reason text NOT NULL CHECK (reason = 'missing_user'),
  original_owner_id text NOT NULL CHECK (length(btrim(original_owner_id)) > 0),
  source_checksum text NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
  source_bson_checksum text NOT NULL CHECK (source_bson_checksum ~ '^[0-9a-f]{64}$'),
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_name, document_id),
  CONSTRAINT migration_quarantine_capture_fk FOREIGN KEY (collection_name, document_id)
    REFERENCES legacy_documents(collection_name, document_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- Friendly JSON is used for normalization; Extended JSON separately retains
-- BSON types (ObjectId, Date, Decimal128, Int64, Binary) for forensic recovery.
-- Existing mirrors must be re-captured before verification may certify them.
ALTER TABLE legacy_documents ADD COLUMN bson_payload jsonb;
ALTER TABLE legacy_documents ADD COLUMN bson_checksum text;

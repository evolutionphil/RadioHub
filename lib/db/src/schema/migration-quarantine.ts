import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { legacyDocuments } from './relational';

/** Offline preservation only; runtime device/authentication stores never read this table. */
export const migrationQuarantine = pgTable('migration_quarantine', {
  collectionName: text('collection_name').notNull(), documentId: text('document_id').notNull(),
  reason: text('reason').notNull(), originalOwnerId: text('original_owner_id').notNull(),
  sourceChecksum: text('source_checksum').notNull(), sourceBsonChecksum: text('source_bson_checksum').notNull(),
  quarantinedAt: timestamp('quarantined_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.collectionName, t.documentId] }),
  foreignKey({ name: 'migration_quarantine_capture_fk', columns: [t.collectionName, t.documentId],
    foreignColumns: [legacyDocuments.collectionName, legacyDocuments.documentId] }).onDelete('restrict').onUpdate('restrict'),
  check('migration_quarantine_collection_name_check', sql`${t.collectionName} = 'userdevices'`),
  check('migration_quarantine_reason_check', sql`${t.reason} = 'missing_user'`),
  check('migration_quarantine_original_owner_id_check', sql`length(btrim(${t.originalOwnerId})) > 0`),
  check('migration_quarantine_source_checksum_check', sql`${t.sourceChecksum} ~ '^[0-9a-f]{64}$'`),
  check('migration_quarantine_source_bson_checksum_check', sql`${t.sourceBsonChecksum} ~ '^[0-9a-f]{64}$'`),
]);

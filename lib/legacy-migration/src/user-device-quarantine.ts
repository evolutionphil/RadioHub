import type pg from 'pg';
import { checksum } from './legacy-document-codec';

type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;
type Document = Record<string, any>;

/** Only a well-formed reference to an absent SOURCE user is eligible. */
export async function userDeviceOwner(client: Queryable, value: unknown): Promise<string | null> {
  if (typeof value !== 'string' || !value || /[\s\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Missing or malformed user-device owner; quarantine refused');
  }
  const result = await client.query(`SELECT EXISTS(SELECT 1 FROM users WHERE id=$1) AS native_owner,
    EXISTS(SELECT 1 FROM legacy_documents WHERE collection_name='users' AND document_id=$1) AS source_owner`, [value]);
  if (result.rows[0].native_owner) return value;
  if (result.rows[0].source_owner) throw new Error('User-device source owner was not normalized; quarantine refused');
  return null;
}

async function expectedCapture(client: Queryable, item: Document) {
  if (typeof item._id !== 'string' || !item._id) throw new Error('Malformed user-device capture identity');
  const result = await client.query(`SELECT checksum,bson_checksum,payload,bson_payload FROM legacy_documents
    WHERE collection_name='userdevices' AND document_id=$1`, [item._id]);
  const capture = result.rows[0];
  if (!capture || !capture.bson_payload || checksum(item) !== capture.checksum ||
      checksum(capture.payload) !== capture.checksum || checksum(capture.bson_payload) !== capture.bson_checksum) {
    throw new Error('User-device quarantine capture checksum mismatch');
  }
  return capture;
}

export async function quarantineUserDevice(client: Queryable, item: Document): Promise<void> {
  if (await userDeviceOwner(client, item.userId) !== null) throw new Error('Quarantine refused an existing user owner');
  if ((await client.query('SELECT 1 FROM user_devices WHERE id=$1', [item._id])).rowCount) {
    throw new Error('Quarantine refused an existing runtime device');
  }
  const capture = await expectedCapture(client, item);
  // Append-only expected hashes: a retry never rewrites evidence to hide drift.
  await client.query(`INSERT INTO migration_quarantine
    (collection_name,document_id,reason,original_owner_id,source_checksum,source_bson_checksum)
    VALUES ('userdevices',$1,'missing_user',$2,$3,$4) ON CONFLICT (collection_name,document_id) DO NOTHING`,
    [item._id, item.userId, capture.checksum, capture.bson_checksum]);
  await verifyQuarantinedUserDevice(client, item);
}

export async function verifyQuarantinedUserDevice(client: Queryable, item: Document): Promise<void> {
  const capture = await expectedCapture(client, item);
  const match = await client.query(`SELECT 1 FROM migration_quarantine q
    WHERE q.collection_name='userdevices' AND q.document_id=$1 AND q.reason='missing_user'
      AND q.original_owner_id=$2 AND q.source_checksum=$3 AND q.source_bson_checksum=$4
      AND NOT EXISTS(SELECT 1 FROM user_devices WHERE id=q.document_id)
      AND NOT EXISTS(SELECT 1 FROM users WHERE id=q.original_owner_id)
      AND NOT EXISTS(SELECT 1 FROM legacy_documents WHERE collection_name='users' AND document_id=q.original_owner_id)`,
    [item._id, item.userId, capture.checksum, capture.bson_checksum]);
  if (!match.rowCount) throw new Error('User-device quarantine content/ownership verification failed');
}

/** Exact disjoint union, including unexpected quarantine and later owner revival. */
export async function verifyUserDeviceQuarantine(client: Queryable): Promise<{ native: number; quarantined: number; source: number }> {
  const result = await client.query(`WITH expected AS (
      SELECT d.document_id,d.payload->>'userId' AS owner,d.checksum,d.bson_checksum
      FROM legacy_documents d WHERE d.collection_name='userdevices'
        AND NOT EXISTS(SELECT 1 FROM users WHERE id=d.payload->>'userId')
    ), differences AS (
      (SELECT document_id,owner,checksum,bson_checksum FROM expected EXCEPT
       SELECT document_id,original_owner_id,source_checksum,source_bson_checksum FROM migration_quarantine)
      UNION ALL
      (SELECT document_id,original_owner_id,source_checksum,source_bson_checksum FROM migration_quarantine EXCEPT
       SELECT document_id,owner,checksum,bson_checksum FROM expected)
    ) SELECT (SELECT count(*)::int FROM differences) AS differences,
      (SELECT count(*)::int FROM migration_quarantine q JOIN user_devices d ON d.id=q.document_id) AS overlap,
      (SELECT count(*)::int FROM user_devices) AS native,
      (SELECT count(*)::int FROM migration_quarantine) AS quarantined,
      (SELECT count(*)::int FROM legacy_documents WHERE collection_name='userdevices') AS source`);
  const row = result.rows[0];
  if (row.differences || row.overlap || row.native + row.quarantined !== row.source) {
    throw new Error('User-device native/quarantine identity parity verification failed');
  }
  return { native: row.native, quarantined: row.quarantined, source: row.source };
}

/** Never overwrite or prune the captures backing preserved quarantine history. */
export async function assertNoQuarantineReplay(client: Queryable): Promise<void> {
  if ((await client.query('SELECT 1 FROM migration_quarantine LIMIT 1')).rowCount) {
    throw new Error('Capture replay/pruning refused: retained user-device quarantine requires independent historical review');
  }
}

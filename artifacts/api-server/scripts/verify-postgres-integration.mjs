import pg from "pg";

if (process.env.POSTGRES_INTEGRATION_TEST !== "true") {
  throw new Error("Refusing to mutate a database unless POSTGRES_INTEGRATION_TEST=true");
}
const connectionString = process.env.DATABASE_URL || "";
if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) throw new Error("DATABASE_URL must be PostgreSQL");

const pool = new pg.Pool({
  connectionString,
  ssl: process.env.POSTGRES_SSL === "disable" ? false : { rejectUnauthorized: true },
  application_name: "radiohub-postgres-integration-test",
});
const client = await pool.connect();
const suffix = `${process.pid}-${Date.now()}`;
try {
  const required = ["stations", "users", "user_favorites", "station_ratings", "subscriptions",
    "payment_events", "auth_tokens", "user_sessions", "user_notifications", "direct_messages",
    "legacy_documents", "migration_runs", "mongo_change_stream_checkpoints",
    "translation_metadata", "translation_languages", "country_language_mappings",
    "country_language_mapping_audit", "database_write_authority"];
  const tables = await client.query(
    "SELECT name,to_regclass('public.' || name) relation FROM unnest($1::text[]) name",
    [required],
  );
  const missing = tables.rows.filter((row) => !row.relation).map((row) => row.name);
  if (missing.length) throw new Error(`Missing tables: ${missing.join(", ")}`);

  await client.query("BEGIN");
  await client.query("INSERT INTO countries(id,name,code) VALUES ($1,'Testland',$2)",
    [`country-${suffix}`, `T${String(process.pid).slice(-1)}`]);
  await client.query("INSERT INTO stations(id,station_uuid,name,url,country_code) VALUES ($1,$2,'Test Radio','https://invalid.test',$3)",
    [`station-${suffix}`, `uuid-${suffix}`, `T${String(process.pid).slice(-1)}`]);
  await client.query("INSERT INTO users(id,email,username,full_name) VALUES ($1,$2,$3,'Integration User')",
    [`user-${suffix}`, `integration-${suffix}@invalid.test`, `integration-${suffix}`]);
  await client.query("INSERT INTO users(id,email,username,full_name) VALUES ($1,$2,$3,'Peer User')",
    [`peer-${suffix}`, `peer-${suffix}@invalid.test`, `peer-${suffix}`]);
  await client.query("INSERT INTO user_favorites(user_id,station_id) VALUES ($1,$2)",
    [`user-${suffix}`, `station-${suffix}`]);
  await client.query("INSERT INTO station_ratings(id,station_id,user_id,rating) VALUES ($1,$2,$3,5)",
    [`rating-${suffix}`, `station-${suffix}`, `user-${suffix}`]);
  await client.query("INSERT INTO subscriptions(user_id,plan,status,is_active) VALUES ($1,'premium_monthly','active',true)",
    [`user-${suffix}`]);
  await client.query("INSERT INTO user_notifications(id,user_id,type,title,message) VALUES ($1,$2,'system','Test','Test')",
    [`notification-${suffix}`, `user-${suffix}`]);
  await client.query("INSERT INTO direct_messages(id,from_user_id,to_user_id,content) VALUES ($1,$2,$3,'hello')",
    [`message-${suffix}`, `user-${suffix}`, `peer-${suffix}`]);
  const insertedEvent = await client.query("INSERT INTO payment_events(id,provider,provider_event_id,user_id,event_type,status,occurred_at) VALUES ($1,'stripe',$2,$3,'test','processed',now()) RETURNING origin",
    [`event-${suffix}`, `provider-event-${suffix}`, `user-${suffix}`]);
  if (insertedEvent.rows[0]?.origin !== "runtime") {
    throw new Error("payment_events origin default must preserve PostgreSQL-native runtime events");
  }
  await client.query("INSERT INTO mongo_change_stream_checkpoints(stream_name,status) VALUES ($1,'test')",
    [`integration-${suffix}`]);
  await client.query("SAVEPOINT duplicate_check");
  let duplicateRejected = false;
  try {
    await client.query("INSERT INTO payment_events(id,provider,provider_event_id,event_type,status,occurred_at) VALUES ($1,'stripe',$2,'test','processed',now())",
      [`event-duplicate-${suffix}`, `provider-event-${suffix}`]);
  } catch (error) {
    duplicateRejected = error?.code === "23505";
    await client.query("ROLLBACK TO SAVEPOINT duplicate_check");
  }
  if (!duplicateRejected) throw new Error("payment_events provider idempotency constraint did not reject duplicate");

  await client.query("SAVEPOINT follow_check");
  let selfFollowRejected = false;
  try {
    await client.query("INSERT INTO user_follows(follower_id,following_id) VALUES ($1,$1)", [`user-${suffix}`]);
  } catch (error) {
    selfFollowRejected = error?.code === "23514";
    await client.query("ROLLBACK TO SAVEPOINT follow_check");
  }
  if (!selfFollowRejected) throw new Error("user_follows self-reference constraint did not reject invalid data");
  await client.query("ROLLBACK");
  console.log("PostgreSQL schema integration verification passed");
} finally {
  client.release();
  await pool.end();
}

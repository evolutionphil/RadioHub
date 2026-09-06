import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { bsonSafe, checksum, exactInteger, jsonSafe, nativeMigrationCollections, normalize, normalizeNativeDomains,
  pruneNormalizedData, verify, verifyNativeDomains } from '@workspace/legacy-migration/migrate-mongo-to-postgres';

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('Native-domain migration integer fidelity', () => {
  it('preserves signed Int64 decimal strings and rejects rounded/fractional/overflow input', () => {
    assert.equal(exactInteger('9223372036854775807'), '9223372036854775807');
    assert.equal(exactInteger('-9223372036854775808'), '-9223372036854775808');
    assert.throws(() => exactInteger('9223372036854775808'), /exceeds/);
    assert.throws(() => exactInteger(9007199254740992), /inexact/);
    assert.throws(() => exactInteger('1.5'), /inexact/);
    assert.throws(() => exactInteger('2147483648', 0, 32), /exceeds/);
  });
});
describe('Native-domain snapshot migration', { skip: !connectionString }, () => {
  const schema = `native_etl_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const ssl = process.env.PG_TEST_SSL === 'require' ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString, ssl, max: 1 });
  const pool = new pg.Pool({ connectionString, ssl, max: 5, options: `-c search_path=${schema},public` });
  let schemaCreated = false;
  const future = '2099-01-01T00:00:00.000Z', past = '2000-01-01T00:00:00.000Z';
  const fixtures: Record<string, Record<string, any>[]> = {
    users: [{ _id: 'user-a', username: 'a', email: 'a@example.invalid' }],
    genres: [
      { _id: 'duplicate-a', name: 'Rock A', slug: 'rock', stationCount: 100, isDiscoverable: true, createdAt: past, extra: { preserved: 'A' } },
      { _id: 'duplicate-b', name: 'Rock B', slug: 'rock', stationCount: 101, isDiscoverable: false, createdAt: past, extra: { preserved: 'B' } },
      { _id: 'duplicate-c', name: 'Rock C', slug: 'rock', stationCount: 101, isDiscoverable: true, createdAt: past, extra: { preserved: 'C' } },
      { _id: 'hidden-original', name: 'Previously demoted', slug: null, isDiscoverable: false, cleanupDemotion: { reason: 'collision', originalSlug: 'prior' } },
    ],
    genreslugcleanupruns: [{ _id: 'cleanup-run', trigger: 'manual', status: 'completed', startedAt: past, finishedAt: past, durationMs: 12.5,
      scanned: 50, alreadyValid: 40, normalized: 3, markedUndiscoverable: 7, emptySlugMarked: 2, collisionMarked: 5, errorCount: 0, rewarmed: true }],
    adminpreferences: [{ _id: 'preference', adminUsername: 'admin', key: 'layout', value: { collapsed: true } }],
    sharedcomparisonpresets: [{ _id: 'preset', name: 'Comparison', countries: ['TR', 'DE'], ownerUsername: 'admin' }],
    semrush_issues: [{ _id: 'semrush', url: 'https://example.invalid/404', statusCode: 404, issueType: 'broken', issueDescription: 'Not found', priority: 'High', importedAt: past, expiresAt: future }],
    analyticsevents: [{ _id: 'analytics', event: 'station_play', stationId: 'station-a', userId: 'user-a', sessionId: 'session-a', timestamp: past, customDetail: { origin: 'web' } }],
    genremergeauditlogs: [{ _id: 'genre-merge', demotedGenreId: 'old-genre', demotedGenreName: 'Old', demotedGenreSlug: 'old',
      winnerGenreId: 'genre', winnerGenreName: 'New', winnerGenreSlug: 'new', targetSource: 'manual', stationsMatched: 15, stationsRetagged: 12,
      actorUserId: 'admin', actorEmail: 'admin@example.invalid', createdAt: past }],
    coveragesnapshots: [{ _id: 'coverage', countryCode: 'TR', snapshotDate: past, total: 100, withLogo: 75, withTags: 90, logoCoveragePct: 75, tagCoveragePct: 90, source: 'cron' }],
    coveragebackfillstatuses: [{ _id: 'coverage-status', key: 'latest', outcome: 'running', message: 'Boot started', observedAt: past, startedAt: past, seedDays: 14 }],
    coveragebackfillruns: [{ _id: 'coverage-run', outcome: 'done', message: 'Complete', observedAt: past, startedAt: past, finishedAt: past, durationMs: 25.5, daysSeeded: 14, inserted: 50, preserved: 2 }],
    backfillruns: [{ _id: 'backfill', trigger: 'manual', status: 'running', topN: 5, overrideCountry: 'TR', startedAt: past,
      logos: [{ country: 'TR', sampleStations: [{ stationId: 'station-a', logo: '/logo.webp' }] }], tags: [], attempts: [{ failedAt: past, message: 'Retry' }] }],
    stationdebuglogs: [{ _id: 'debug', stationId: 'unknown-or-deleted', stationName: 'Historical Radio', stationUrl: 'https://example.invalid/offline',
      errorType: 'NETWORK_ERROR', errorMessage: 'Offline', errorDetails: { code: 4 }, stationMeta: { codec: 'AAC' }, clientIP: '127.0.0.1',
      timestamp: past, isResolved: true, resolvedAt: past, resolvedBy: 'admin@example.invalid', notes: 'Historical', uniqueUserCount: 2, totalOccurrences: 5,
      reportingUsers: [{ userAgent: 'Fixture', clientIP: '127.0.0.1', timestamp: past }], serverLogs: ['One', 'Two'] }],
    advertisements: [{ _id: 'ad', title: 'Advertisement', imageUrl: '/image.webp', altText: 'Image', seoDescription: 'Sponsored', url: 'https://example.invalid', position: 'desktop_sidebar', isActive: false }],
    footersocialmedias: [{ _id: 'social', platform: 'instagram', url: 'https://example.invalid/social', isActive: true, position: 2 }],
    seometadatas: [{ _id: 'seo', pageType: 'static', routeKey: '/about', language: 'en', title: 'About', description: 'About us', ogTitle: 'OG About', twitterDescription: 'Social about', noIndex: true, status: 'published' }],
    applogs: [{ _id: 'app-log', deviceId: 'ios-a', appVersion: '1.2.3', platform: 'ios', apiKeyHash: 'legacy-owner-hash', isCarPlayLog: true,
      logs: [{ _id: 'embedded-log-id', level: 'info', message: 'CarPlay CONNECTED', timestamp: past, data: { nested: ['value', 2] } }], createdAt: past }],
    feedbacks: [{ _id: 'feedback', type: 'bug', subject: 'Playback', message: 'Cannot play', email: 'user@example.invalid', userId: 'historical-user', status: 'resolved', response: 'Fixed' }],
    genre_counts: [{ _id: 'count-row', country: 'TR', slug: 'rock', count: 123 }],
    genrewhitelistoverrides: [{ _id: 'override', kind: 'alias-add', slug: 'classic-rock', canonical: 'rock', notes: 'Alias', createdBy: 'admin@example.invalid' }],
    genrestationcountsruns: [{ _id: 'counts-run', trigger: 'manual', status: 'completed', startedAt: past, finishedAt: past, durationMs: 25, totalGenres: 30, updatedSlugs: 5 }],
    genrewhitelistpushlogs: [{ _id: 'push-log', triggeredAt: past, completedAt: past, trigger: 'manual', affectedSlugs: ['rock'],
      sitemapRebuild: { status: 'success', error: null }, indexnowSitemap: { status: 'success', urlCount: 1 }, indexnowGenreUrls: { status: 'skipped', urlCount: 0 } }],
    indexnowlogs: [{ _id: 'indexnow-log', timestamp: past, host: 'example.invalid', urlCount: 1, status: 'success', statusCode: 200, trigger: 'manual', sampleUrls: ['https://example.invalid'], retryAttempt: 1 }],
    indexnowsubmissionurls: [{ _id: 'submitted-urls', logId: 'indexnow-log', timestamp: past, host: 'example.invalid', trigger: 'manual', urls: ['https://example.invalid'], urlCount: 1, expiresAt: future }],
    sitemapurlsnapshots: [{ _id: 'sitemap-url', type: 'main', language: 'en', urls: ['https://example.invalid'], urlCount: 1, generatedAt: past }],
    sitemapmanifests: [
      { _id: 'manifest-old', type: 'main', language: 'en', version: 'old', status: 'active', qualifiedLanguagesHash: 'hash', qualifiedLanguages: ['en'], generatedAt: past, expiresAt: future },
      { _id: 'manifest-new', type: 'main', language: 'en', version: 'new', status: 'active', qualifiedLanguagesHash: 'hash', qualifiedLanguages: ['en'], generatedAt: '2026-09-06T00:00:00Z', expiresAt: future, chunks: [{ stationIds: ['station-a'], maxUpdatedAt: past }], totalUrls: 1, chunkCount: 1 },
      { _id: 'manifest-building', type: 'stations', language: 'en', version: 'building', status: 'building', qualifiedLanguagesHash: 'hash', qualifiedLanguages: ['en'], generatedAt: past, expiresAt: future },
    ],
    gscurlinspections: [{ _id: 'inspection', url: 'https://example.invalid', language: 'en', group: 'static', state: 'indexed', googleCanonical: 'https://example.invalid', lastCrawlTime: past, errorCount: 0 }],
    gscindexingsnapshots: [{ _id: 'gsc-snapshot', date: past, language: 'en', group: 'all', total: 1, indexed: 1 }],
    gsc_oauth_tokens: [{ _id: 'gsc-token', refreshToken: 'legacy-refresh-token', accessToken: 'legacy-access-token', expiryDate: 1788645600000, connectedEmail: 'gsc@example.invalid' }],
    visitor_sessions: [{ _id: 'visitor', ipAddress: '127.0.0.1', lastActiveDate: past, visitCount: 7, userAgent: 'Fixture' }],
    app_state: [{ _id: 'bootstrap:v1', runAt: past, customFlag: true }],
    bulkdescriptionjobs: [{ _id: 'description-job', jobId: 'job-123', filterByCountry: 'TR', status: 'running', totalStations: 30, processedStations: 10, successCount: 8, failedCount: 1, skippedCount: 1 }],
    userprofiles: [{ _id: 'profile', sessionId: 'session-a', userId: 'user-a', preferredGenres: [{ genre: 'rock', weight: 0.8, confidence: 0.9 }],
      preferredCountries: [{ country: 'Turkey', weight: 0.5, confidence: 1 }], preferredLanguages: [{ language: 'Turkish', weight: 1, confidence: 1 }],
      profileStrength: 0.8, skipRate: 0.1, peakListeningHours: [3, 20], totalStationsListened: 40, uniqueStationsCount: 12 }],
    usermusicprofiles: [{ _id: 'music-profile', userId: 'user-a', genres: [{ name: 'rock', preference: 90 }], mood: { currentMood: 'focused' }, discovery: { explorationLevel: 80 } }],
    stationsimilarities: [{ _id: 'similarity', stationId1: 'station-a', stationId2: 'station-b', similarityScore: 0.5, confidence: 0.8, calculationType: 'hybrid', lastCalculated: past, sampleSize: 20 }],
    recommendations: [{ _id: 'recommendation', userId: 'user-a', stationId: 'station-a', stationName: 'Radio', recommendationType: 'discovery', confidence: 80, reason: 'Test', generated: past }],
    listeningsessions: [{ _id: 'listening-session', sessionId: 'session-a', userId: 'user-a', stationId: 'station-a', stationName: 'Radio', genre: 'rock', country: 'Turkey', language: 'Turkish', startTime: past, duration: 300 }],
    seoqualifiedlanguageslkgs: [{ _id: 'lkg', key: 'global', languages: ['tr', 'de'], hash: 'known-hash', source: 'computed', computedAt: past, expiresAt: future }],
    adminsettings: [{ _id: 'setting', key: 'coverage.minimum', value: { enabled: true, count: 5 }, updatedBy: 'admin@example.invalid' }],
    adminsettinghistories: [{ _id: 'history', key: 'coverage.minimum', action: 'update', previousValue: false, newValue: { count: 5 }, changedBy: 'admin@example.invalid', changedAt: past }],
    tvlogincodes: [
      { _id: 'login', code: '012345', deviceId: 'tv-a', platform: 'webos', status: 'activated', userId: 'user-a', token: 'existing-login-token', expiresAt: future, activatedAt: past },
      { _id: 'expired-login', code: '012345', deviceId: 'tv-old', status: 'pending', expiresAt: past },
    ],
    tvsubscriptioncodes: [{ _id: 'subscription-code', code: '012345', deviceId: 'tv-a', status: 'completed', userId: 'user-a', plan: 'premium_monthly', stripeSessionId: 'stripe-session', expiresAt: future, completedAt: past }],
    userdevices: [{ _id: 'device', userId: 'user-a', deviceId: 'tv-a', deviceName: 'Living room', platform: 'webos', isActive: true }],
    castsessions: [
      { _id: 'cast', sessionId: 'cast-session', pairingCode: '999999', userId: 'user-a', tvDeviceId: 'tv-a', status: 'active', currentStation: { name: 'Radio', stationId: 'station-a' }, isPlaying: true, expiresAt: future },
      { _id: 'cast-expired', sessionId: 'old-session', pairingCode: '999999', userId: 'user-a', status: 'waiting_for_pair', expiresAt: past },
    ],
    castcommands: [{ _id: 'command', userId: 'user-a', deviceId: 'tv-a', type: 'cast:pause', timestamp: '9223372036854775807', consumed: true }],
    castnowplayings: [{ _id: 'now-playing', userId: 'user-a', deviceId: 'tv-a', platform: 'webos', stationName: 'Radio', artist: 'Artist', isPlaying: true }],
    pushtokens: [{ _id: 'push', userId: 'user-a', token: 'legacy-push-token', platform: 'ios', tokenType: 'apns', country: 'TR', language: 'tr', isActive: true }],
    tv_version_config: [{ _id: 'version', latest: { webos: '2.3.4' }, minimum: { webos: '1.0.0' }, releaseNotes: { en: 'Notes' }, storeUrl: { webos: 'https://example.invalid' } }],
    tv_telemetry: [{ _id: 'telemetry', ts: past, src: 'remote', v: '2.3.4', plat: 'webos', did: 'device-hash', country: 'TR' }],
    tv_telemetry_daily: [{ _id: '2026-09-06|webos|remote|2.3.4', day: '2026-09-06', plat: 'webos', src: 'remote', v: '2.3.4', count: '9223372036854775807', uniqueDids: ['a', 'b'] }],
    stripe_subscription_plans: [{ _id: 'plan', planId: 'premium_monthly', stripePriceId: 'price_legacy', paddlePriceId: 'pri_legacy', label: 'Premium', description: 'Premium access', currency: 'eur', amount: 499 }],
    apiusers: [{ _id: 'developer', email: 'Developer@example.invalid', passwordHash: 'existing-bcrypt-hash', name: 'Developer', plan: 'pro', status: 'active' }],
    apikeys: [{ _id: 'api-key', keyHash: 'existing-api-key-hash', keyPrefix: 'mr_old_', email: 'Developer@example.invalid', name: 'Developer', userId: 'developer',
      plan: 'pro', status: 'active', rateLimitPerMin: 300, dailyQuota: 10000, monthlyQuota: 100000,
      usage: { todayCount: 24, monthCount: 99, totalCount: '9223372036854775807', lastResetDay: '2026-09-06', lastResetMonth: '2026-09', lastUsedAt: past } }],
    demousages: [{ _id: 'demo', ipHash: 'ip-hash', demoKeyHash: 'demo-key-hash', expiresAt: future, usageCount: 2 }],
    auth_event_logs: [{ _id: 'auth-event', ts: past, method: 'email', event: 'failure', ok: false, userId: 'historical-deleted-user', email: 'user@example.invalid', detail: { reason: 'invalid_credentials' } }],
    synclogs: [{ _id: 'sync', syncType: 'full', status: 'running', startedAt: past, stationsProcessed: 20, stationsAdded: 10, stationsUpdated: 5, stationsSkipped: 5, stationsAutoFlagged: 1 }],
    blacklistedstations: [{ _id: 'blacklist', stationUuid: 'blacklisted-uuid', radioBrowserId: 'legacy-provider-id', url: 'https://example.invalid/blocked', name: 'Blocked Radio', reason: 'Duplicate', deletedBy: 'admin@example.invalid', deletedAt: past }],
  };
  async function mirror(collection: string, document: Record<string, any>) {
    const payload = jsonSafe(document), bson = bsonSafe(document);
    await pool.query(`INSERT INTO legacy_documents(collection_name,document_id,payload,checksum,bson_payload,bson_checksum,last_seen_run_id)
      VALUES ($1,$2,$3,$4,$5,$6,'test') ON CONFLICT(collection_name,document_id) DO UPDATE
      SET payload=EXCLUDED.payload,checksum=EXCLUDED.checksum,bson_payload=EXCLUDED.bson_payload,bson_checksum=EXCLUDED.bson_checksum`,
    [collection, document._id, payload, checksum(payload), bson, checksum(bson)]);
  }
  before(async () => {
    assert.match(schema, /^native_etl_test_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const migrations = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(migrations)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(migrations, file), 'utf8'));
    }
    for (const [collection, documents] of Object.entries(fixtures)) for (const document of documents) await mirror(collection, document);
  });
  after(async () => {
    await pool.end();
    try {
      if (schemaCreated) {
        assert.match(schema, /^native_etl_test_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await admin.end(); }
  });

  it('normalizes every new source domain and verifies stable repeatable content', async () => {
    assert.deepEqual(nativeMigrationCollections.map(row => row.collection).sort(), Object.keys(fixtures).filter(key => !['users','genres'].includes(key)).sort());
    await normalize(pool);
    await verify(pool);
    await normalize(pool);
    await verify(pool);
    assert.equal((await pool.query("SELECT status,token FROM tv_device_codes WHERE id='login'")).rows[0].token, 'existing-login-token');
    assert.equal((await pool.query("SELECT status FROM tv_device_codes WHERE id='expired-login'")).rows[0].status, 'expired');
    assert.equal((await pool.query("SELECT status FROM cast_sessions WHERE id='cast-expired'")).rows[0].status, 'expired');
    assert.equal((await pool.query("SELECT total_count FROM api_keys WHERE id='api-key'")).rows[0].total_count, '9223372036854775807');
    assert.equal((await pool.query("SELECT timestamp FROM cast_commands WHERE id='command'")).rows[0].timestamp, '9223372036854775807');
    assert.equal((await pool.query('SELECT count FROM tv_telemetry_daily')).rows[0].count, '9223372036854775807');
    assert.equal((await pool.query("SELECT password_hash,email FROM api_developer_users WHERE id='developer'")).rows[0].password_hash, 'existing-bcrypt-hash');
    assert.equal((await pool.query("SELECT email FROM api_developer_users WHERE id='developer'")).rows[0].email, 'developer@example.invalid');
    const sync = (await pool.query("SELECT status,counters,error FROM catalog_sync_runs WHERE id='sync'")).rows[0];
    assert.equal(sync.status, 'failed');
    assert.equal(sync.counters.stationsAutoFlagged, 1);
    assert.match(sync.error, /Source sync worker stopped/);
    assert.equal((await pool.query("SELECT source->>'radioBrowserId' value FROM station_blacklist WHERE id='blacklist'")).rows[0].value, 'legacy-provider-id');
    assert.equal((await pool.query("SELECT status FROM sitemap_manifests WHERE id='manifest-old'")).rows[0].status, 'superseded');
    assert.equal((await pool.query("SELECT status FROM sitemap_manifests WHERE id='manifest-new'")).rows[0].status, 'active');
    assert.equal((await pool.query("SELECT status FROM sitemap_manifests WHERE id='manifest-building'")).rows[0].status, 'failed');
    assert.equal((await pool.query("SELECT status,processed_stations FROM bulk_description_jobs WHERE id='description-job'")).rows[0].status, 'paused');
    assert.equal((await pool.query("SELECT value FROM runtime_app_state WHERE key='bootstrap:v1'")).rows[0].value.customFlag, true);
    assert.equal((await pool.query("SELECT outcome FROM coverage_backfill_status WHERE id='coverage-status'")).rows[0].outcome, 'failed');
    assert.equal((await pool.query("SELECT status,attempts FROM backfill_runs WHERE id='backfill'")).rows[0].status, 'failed');
    assert.equal((await pool.query("SELECT reporting_users FROM station_debug_logs WHERE id='debug'")).rows[0].reporting_users[0].timestamp, past);
    const genres=(await pool.query('SELECT * FROM genres ORDER BY id')).rows;
    assert.equal(genres.find(row=>row.id==='duplicate-c').slug,'rock');
    assert.equal(genres.find(row=>row.id==='duplicate-a').slug,null);
    assert.equal(genres.find(row=>row.id==='duplicate-b').is_discoverable,false);
    assert.equal(genres.find(row=>row.id==='duplicate-a').source.extra.preserved,'A');
    assert.equal(genres.find(row=>row.id==='duplicate-a').source.cleanupDemotion.collisionWinnerId,'duplicate-c');
    assert.equal(genres.find(row=>row.id==='hidden-original').slug,null);
    assert.equal(genres.find(row=>row.id==='hidden-original').source.cleanupDemotion.originalSlug,'prior');
  });

  it('detects wrong identities and mutated fields even when row counts match', async () => {
    await pool.query("UPDATE auth_event_logs SET id='wrong-event' WHERE id='auth-event'");
    await assert.rejects(verifyNativeDomains(pool), /identity mismatch: auth_event_logs/);
    await pool.query("UPDATE auth_event_logs SET id='auth-event' WHERE id='wrong-event'");
    await pool.query("UPDATE api_keys SET daily_quota=123 WHERE id='api-key'");
    await assert.rejects(verifyNativeDomains(pool), /content mismatch: api_keys/);
    await normalizeNativeDomains(pool);
    await verifyNativeDomains(pool);
  });

  it('uses telemetry natural identity while preserving an existing physical ID', async () => {
    await pool.query("UPDATE tv_telemetry_daily SET id='prior-runtime-id'");
    await normalizeNativeDomains(pool);
    await verifyNativeDomains(pool);
    assert.equal((await pool.query('SELECT id FROM tv_telemetry_daily')).rows[0].id, 'prior-runtime-id');
  });

  it('refuses ambiguous live TV codes and orphan auth owners without minting replacement credentials', async () => {
    await mirror('tvlogincodes', { _id: 'conflicting-login', code: '012345', deviceId: 'other-device', userId: 'user-a', expiresAt: future, status: 'pending' });
    await assert.rejects(normalizeNativeDomains(pool), (error: any) => error.code === '23505');
    await pool.query("DELETE FROM legacy_documents WHERE collection_name='tvlogincodes' AND document_id='conflicting-login'");
    await mirror('apikeys', { ...fixtures.apikeys[0], userId: 'missing-developer' });
    await assert.rejects(normalizeNativeDomains(pool), /Missing referenced owner/);
    assert.equal((await pool.query("SELECT user_id,key_hash FROM api_keys WHERE id='api-key'")).rows[0].user_id, 'developer');
    await mirror('apikeys', fixtures.apikeys[0]);
    await mirror('castcommands', { _id: 'broadcast', userId: 'user-a', type: 'cast:pause', timestamp: Date.now(), consumed: false, createdAt: new Date().toISOString() });
    await assert.rejects(normalizeNativeDomains(pool), /no target device/);
    await pool.query("DELETE FROM legacy_documents WHERE collection_name='castcommands' AND document_id='broadcast'");
  });

  it('refuses fractional quotas and rolls back the whole affected batch', async () => {
    await mirror('apikeys', { ...fixtures.apikeys[0], dailyQuota: 3.5 });
    await assert.rejects(normalizeNativeDomains(pool), /inexact integer/);
    assert.equal((await pool.query("SELECT daily_quota FROM api_keys WHERE id='api-key'")).rows[0].daily_quota, '10000');
    await mirror('apikeys', fixtures.apikeys[0]);
    await mirror('tv_version_config', { _id: 'second-version', latest: { webos: '9.9.9' } });
    await assert.rejects(normalizeNativeDomains(pool), /Multiple TV version-config/);
    await pool.query("DELETE FROM legacy_documents WHERE collection_name='tv_version_config' AND document_id='second-version'");
    await normalizeNativeDomains(pool);
    await verify(pool);
  });

  it('prunes stale normalized source rows without touching runtime-only sessions, presence, outbox or receipts', async () => {
    await pool.query("INSERT INTO api_developer_sessions(token_hash,user_id,expires_at) VALUES ('session-hash','developer',now()+interval '1 day')");
    await pool.query("INSERT INTO user_sessions(sid,sess,expire) VALUES ('web-session','{}',now()+interval '1 day')");
    await pool.query("INSERT INTO cast_connections(connection_id,node_id,session_id,user_id,role,expires_at) VALUES ('connection','node','cast-session','user-a','mobile',now()+interval '1 day')");
    await pool.query("INSERT INTO cast_events(session_id,payload) VALUES ('cast-session','{}')");
    await pool.query("INSERT INTO gsc_inspection_quota(day,site_url,requests) VALUES ('2026-09-06','example.invalid',10)");
    await pool.query("INSERT INTO gsc_oauth_states(state_hash,session_id,expires_at) VALUES ('oauth-state','admin-session',now()+interval '1 hour')");
    await pool.query("INSERT INTO admin_maintenance_jobs(id,kind,status,owner_token) VALUES ('maintenance','optimization','completed','runtime-only-token')");
    await pool.query("UPDATE gsc_url_inspections SET inspection_lease_token='runtime-lease',inspection_lease_until=now()+interval '1 day' WHERE id='inspection'");
    await normalizeNativeDomains(pool);
    assert.equal((await pool.query("SELECT inspection_lease_token FROM gsc_url_inspections WHERE id='inspection'")).rows[0].inspection_lease_token, 'runtime-lease');
    await pool.query("INSERT INTO payment_events(id,provider,provider_event_id,event_type,status,occurred_at,payload,origin) VALUES ('receipt','apple','event','renew','success',now(),'{}','runtime')");
    await pool.query("INSERT INTO admin_settings(id,key,value) VALUES ('stale-setting','removed.key','true')");
    await pool.query("INSERT INTO api_keys(id,key_hash,key_prefix,name,email) VALUES ('stale-key','stale-hash','mr_old_','Removed','removed@example.invalid')");
    const prior = process.env.DATABASE_MAINTENANCE_READ_ONLY;
    process.env.DATABASE_MAINTENANCE_READ_ONLY = 'true';
    try { await pruneNormalizedData(pool); }
    finally { if (prior === undefined) delete process.env.DATABASE_MAINTENANCE_READ_ONLY; else process.env.DATABASE_MAINTENANCE_READ_ONLY = prior; }
    for (const table of ['api_developer_sessions', 'user_sessions', 'cast_connections', 'cast_events', 'payment_events', 'gsc_inspection_quota', 'gsc_oauth_states', 'admin_maintenance_jobs']) {
      assert.equal((await pool.query(`SELECT count(*)::int count FROM ${table}`)).rows[0].count, 1, table);
    }
    assert.equal((await pool.query("SELECT 1 FROM admin_settings WHERE id='stale-setting'")).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM api_keys WHERE id='stale-key'")).rowCount, 0);
    assert.equal((await pool.query('SELECT id FROM tv_telemetry_daily')).rows[0].id, 'prior-runtime-id');
    await verify(pool);
  });

  it('blocks runtime-session cascade deletion and sticky-authority replay pruning', async () => {
    const prior = process.env.DATABASE_MAINTENANCE_READ_ONLY;
    process.env.DATABASE_MAINTENANCE_READ_ONLY = 'true';
    try {
      await pool.query("INSERT INTO api_developer_users(id,email,password_hash,name) VALUES ('runtime-owner','runtime@example.invalid','hash','Runtime')");
      await pool.query("INSERT INTO api_developer_sessions(token_hash,user_id,expires_at) VALUES ('runtime-session','runtime-owner',now()+interval '1 day')");
      await assert.rejects(pruneNormalizedData(pool), /cascade into runtime-only sessions/);
      assert.equal((await pool.query("SELECT 1 FROM api_developer_sessions WHERE token_hash='runtime-session'")).rowCount, 1);
      await pool.query("DELETE FROM api_developer_sessions WHERE token_hash='runtime-session'; DELETE FROM api_developer_users WHERE id='runtime-owner'");
      await pool.query("INSERT INTO database_write_authority(domain,authority) VALUES ('API_ACCESS','postgres')");
      await assert.rejects(pruneNormalizedData(pool), /durable PostgreSQL write authority/);
    } finally { if (prior === undefined) delete process.env.DATABASE_MAINTENANCE_READ_ONLY; else process.env.DATABASE_MAINTENANCE_READ_ONLY = prior; }
  });
});

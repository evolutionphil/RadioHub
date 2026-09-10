import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createNativePostgresFixture, type NativePostgresFixture } from './helpers/native-postgres-fixture';
import { PostgresCatalogStore, pgSyncBlacklist, pgBlacklistAdd, pgBlacklistFind } from '../src/data/postgres-catalog-store';
import { PostgresDuplicateJobsStore } from '../src/data/postgres-duplicate-jobs-store';
import { buildSyncBlacklist } from '../src/utils/sync-blacklist';

const url = process.env.PG_TEST_DATABASE_URL;
if (url && !/^postgres(?:ql)?:\/\/[^@]*@(?:127\.0\.0\.1|localhost):\d+\/[^?]*test[^?]*$/.test(url)) throw new Error('Duplicate tests require an explicit loopback test database');

describe('durable duplicate preview/apply worker', { skip: !url }, () => {
  let fixture: NativePostgresFixture, store: PostgresDuplicateJobsStore, catalog: PostgresCatalogStore, now: Date;
  let sequence = 0;
  before(async () => {
    fixture = await createNativePostgresFixture('duplicate_jobs');
    store = new PostgresDuplicateJobsStore(fixture.pool);
    catalog = new PostgresCatalogStore(fixture.pool);
  });
  after(async () => { await fixture?.close(); });
  beforeEach(async () => {
    await fixture.clear('station_duplicate_jobs', 'stations', 'station_blacklist', 'catalog_sync_runs');
    now = new Date(); sequence = 0;
    await fixture.pool.query("UPDATE station_duplicate_merge_control SET next_cycle_at=$1,next_auto_at=$1::timestamptz+interval '24 hours',last_run_at=NULL,summary='{}'", [now]);
  });
  const add = async (name: string, patch: Record<string, any> = {}) => {
    const id = (++sequence).toString(16).padStart(24, '0');
    // Seed legacy duplicates directly; the ordinary catalog insert guard now
    // prevents creating these same-name/URL duplicates in the first place.
    return fixture.insert('stations', { _id: id, stationuuid: 'fixture-' + id, slug: 'station-' + id,
      name, country: 'Austria', countryCode: 'AT', city: 'Vienna',
      url: 'https://example.invalid/' + encodeURIComponent(name), votes: sequence, ...patch });
  };
  const advance = () => { now = new Date(+now + 16_000); return now; };
  const finish = async (jobId: string, max = 40) => {
    for (let index = 0; index < max; index++) {
      const job = await store.getJob(jobId);
      if (job?.status !== 'running') return job!;
      await store.runCycle(advance());
    }
    throw new Error('Fixture job did not finish');
  };

  it('preview persists eligible/skipped reasons without merging or hydrating source payloads', async () => {
    await add('Safe station'); await add('Safe station');
    await add('Different stream'); await add('Different stream', { url: 'https://other.invalid/live' });
    await add('Different city'); await add('Different city', { city: 'Graz' });
    const id = await store.createPreview();
    const job = await finish(id);
    assert.equal(job.status, 'completed'); assert.equal(job.dryRun, true);
    assert.equal(job.results.totalGroups, 3); assert.equal(job.results.eligibleGroups, 1); assert.equal(job.results.skippedGroups, 2);
    assert.equal(job.results.totalStationsToDelete, 1); assert.equal(job.results.totalStationsDeleted, 0);
    assert.equal(await catalog.count(), 6);
    assert.ok(job.results.skippedReasons.some(item => item.reason.includes('city')));
    assert.equal((await fixture.pool.query('SELECT station_ids FROM station_duplicate_job_groups WHERE job_id=$1 AND status=$2', [id,'eligible'])).rows[0].station_ids.length, 2);
  });

  it('requires a completed preview, applies immutable IDs once, and preserves added stations', async () => {
    await add('Safe station'); await add('Safe station');
    await assert.rejects(store.createApply(undefined), { status: 400 });
    const preview = await store.createPreview();
    await assert.rejects(store.createApply(preview), { status: 409 });
    await finish(preview);
    const extra = await add('Safe station');
    const apply = await store.createApply(preview);
    assert.equal(await store.createApply(preview), apply);
    const job = await finish(apply);
    assert.equal(job.status, 'completed'); assert.equal(job.previewJobId, preview);
    assert.equal(job.results.mergedGroups, 1); assert.equal(job.results.totalStationsDeleted, 1);
    assert.equal(await catalog.count(), 2);
    assert.ok(await catalog.findOne({ _id: extra._id }));
    assert.equal(await store.createApply(preview), apply);
  });

  it('revalidates changed URLs and missing preview members before merging', async () => {
    await add('Changed'); const changed = await add('Changed');
    await add('Missing'); const missing = await add('Missing');
    const preview = await store.createPreview(); await finish(preview);
    await fixture.pool.query('UPDATE stations SET url=$2 WHERE id=$1', [changed._id, 'https://different.invalid/live']);
    await fixture.pool.query('DELETE FROM stations WHERE id=$1', [missing._id]);
    const apply = await store.createApply(preview), job = await finish(apply);
    assert.equal(job.status, 'completed'); assert.equal(job.results.skippedGroups, 2);
    assert.equal(job.results.totalStationsDeleted, 0); assert.equal(await catalog.count(), 3);
  });

  it('shares max10 group quota between replicas and resumes after restart', async () => {
    for (let i = 0; i < 21; i++) { await add('Group ' + i); await add('Group ' + i); }
    const id = await store.createPreview();
    const results = await Promise.all([store.runCycle(now), new PostgresDuplicateJobsStore(fixture.pool).runCycle(now)]);
    assert.ok(results.reduce((sum,result) => sum + result.processed, 0) <= 10);
    const first = await store.getJob(id);
    assert.equal(first?.status, 'running'); assert.ok(first!.progress.groupsProcessed <= 10);
    assert.equal((await store.runCycle(now)).processed, 0);
    store = new PostgresDuplicateJobsStore(fixture.pool);
    const complete = await finish(id);
    assert.equal(complete.results.eligibleGroups, 21); assert.equal(complete.progress.groupsProcessed, 21);
  });

  it('rolls back a merge when its checkpoint fails, then safely retries on restart', async () => {
    await add('Atomic'); await add('Atomic');
    const preview = await store.createPreview(); await finish(preview);
    const apply = await store.createApply(preview);
    await fixture.pool.query(`CREATE FUNCTION fail_duplicate_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='merged' THEN RAISE EXCEPTION 'fixture checkpoint failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_duplicate_checkpoint BEFORE UPDATE ON station_duplicate_job_groups FOR EACH ROW EXECUTE FUNCTION fail_duplicate_checkpoint()`);
    try {
      await store.runCycle(advance());
      assert.equal(await catalog.count(), 2);
      assert.equal((await store.getJob(apply))!.progress.groupsProcessed, 0);
      assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM station_blacklist')).rows[0].n, 0);
      assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM station_merge_aliases')).rows[0].n, 0);
    } finally {
      await fixture.pool.query('DROP TRIGGER fail_duplicate_checkpoint ON station_duplicate_job_groups; DROP FUNCTION fail_duplicate_checkpoint()');
    }
    store = new PostgresDuplicateJobsStore(fixture.pool);
    const job = await finish(apply);
    assert.equal(job.results.totalStationsDeleted, 1); assert.equal(await catalog.count(), 1);
  });

  it('yields on row contention without changing the group or losing its checkpoint', async () => {
    const locked = await add('Contended'); await add('Contended');
    const preview = await store.createPreview(); await finish(preview);
    const apply = await store.createApply(preview), blocker = await fixture.pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM stations WHERE id=$1 FOR UPDATE', [locked._id]);
      await store.runCycle(advance());
      assert.equal((await store.getJob(apply))!.progress.groupsProcessed, 0);
      assert.equal(await catalog.count(), 2);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    assert.equal((await finish(apply)).results.totalStationsDeleted, 1);
  });

  it('does not auto-merge on deployment and limits each due daily job to100 groups', async () => {
    for (let i = 0; i < 105; i++) { await add('Auto ' + i); await add('Auto ' + i); }
    await store.runCycle(now);
    assert.equal((await store.getStatus()).latestApply, null);
    await fixture.pool.query('UPDATE station_duplicate_merge_control SET next_auto_at=$1', [now]);
    await store.runCycle(advance());
    const automatic = (await store.getStatus()).latestApply!;
    assert.equal(automatic.kind, 'automatic'); assert.equal(automatic.results.totalGroups, 100);
    const job = await finish(automatic.jobId, 110);
    assert.equal(job.results.mergedGroups, 100); assert.equal(job.results.totalStationsDeleted, 100);
    assert.equal(job.results.mergedStations.length, 20); assert.equal(job.results.summariesTruncated, true);
    assert.equal(await catalog.count(), 110);
    await store.runCycle(advance());
    assert.equal((await store.getStatus()).latestApply!.jobId, automatic.jobId);
    assert.ok(new Date((await store.getStatus()).nextRunAt).getTime() > +now);
  });

  it('automatic mode never merges review-only or oversized groups', async () => {
    await add('Review city'); await add('Review city', { city: 'Salzburg' });
    for (let i = 0; i < 51; i++) await add('Oversized');
    await fixture.pool.query('UPDATE station_duplicate_merge_control SET next_auto_at=$1', [now]);
    await store.runCycle(advance());
    const id = (await store.getStatus()).latestApply!.jobId;
    const job = await finish(id);
    assert.equal(job.results.skippedGroups, 2); assert.equal(job.results.totalStationsDeleted, 0);
    assert.equal(await catalog.count(), 53);
  });

  it('rotates the daily cursor so100 review-only groups cannot starve later safe groups', async () => {
    for (let i = 0; i < 100; i++) { await add('A review ' + i); await add('A review ' + i, { city: 'Graz' }); }
    await add('Z safe'); await add('Z safe');
    await fixture.pool.query('UPDATE station_duplicate_merge_control SET next_auto_at=$1', [now]);
    await store.runCycle(advance());
    const first = await finish((await store.getStatus()).latestApply!.jobId);
    assert.equal(first.results.skippedGroups, 100); assert.equal(first.results.totalStationsDeleted, 0);
    now = new Date(+now + 86_400_000);
    await store.runCycle(now);
    const secondId = (await store.getStatus()).latestApply!.jobId;
    assert.notEqual(secondId, first.jobId);
    const second = await finish(secondId);
    assert.equal(second.results.totalGroups, 1); assert.equal(second.results.totalStationsDeleted, 1);
    assert.equal(await catalog.count(), 201);
  });

  it('a repeatedly timed-out group is deferred for review without starving the next group', async () => {
    await add('A blocked'); await add('A blocked'); await add('Z passes'); await add('Z passes');
    const preview = await store.createPreview();
    await fixture.pool.query(`CREATE FUNCTION slow_duplicate_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='eligible' AND NEW.group_name='a blocked' THEN PERFORM pg_sleep(1); END IF; RETURN NEW; END $$;
      CREATE TRIGGER slow_duplicate_checkpoint BEFORE UPDATE ON station_duplicate_job_groups FOR EACH ROW EXECUTE FUNCTION slow_duplicate_checkpoint()`);
    try {
      const job = await finish(preview, 8);
      assert.equal(job.status, 'completed'); assert.equal(job.results.eligibleGroups, 1); assert.equal(job.results.skippedGroups, 1);
      assert.ok(job.results.skippedReasons.some(item => item.reason === 'deferred_timeout_requires_review'));
      assert.equal(await catalog.count(), 4);
    } finally { await fixture.pool.query('DROP TRIGGER slow_duplicate_checkpoint ON station_duplicate_job_groups; DROP FUNCTION slow_duplicate_checkpoint()'); }
  });

  it('short and Unicode-normalized exact names are not silently excluded from previews', async () => {
    await add('FM'); await add('FM');
    await add('Ｒａｄｉｏ', { url: 'https://example.invalid/shared' }); await add('Radio', { url: 'https://example.invalid/shared' });
    const job = await finish(await store.createPreview());
    assert.equal(job.results.eligibleGroups, 2); assert.equal(job.results.totalGroups, 2);
  });

  it('merge archives ban loser UUIDs but never block survivor sync; explicit URL bans still win', async () => {
    await add('Shared stream'); await add('Shared stream');
    const preview = await store.createPreview(); await finish(preview);
    await finish(await store.createApply(preview));
    const survivor = (await catalog.find())[0], snapshot = await pgSyncBlacklist();
    const loserUuid = snapshot[0].stationUuid;
    assert.equal(snapshot[0].blocksUrl, false);
    const lists = buildSyncBlacklist(snapshot);
    assert.equal(lists.blacklistedUuids.has(loserUuid), true);
    assert.equal(lists.blacklistedUuids.has(survivor.stationuuid), false);
    assert.equal(lists.blacklistedUrls.has(survivor.url), false);
    await fixture.pool.query("INSERT INTO catalog_sync_runs(id,sync_type,status) VALUES('merge-sync-run','incremental','running')");
    const input = { name:'Another valid station',stationuuid:'different-provider-uuid',url:survivor.url,country:'Austria',countryCode:'AT' };
    assert.equal((await catalog.insertMany([{...input,stationuuid:loserUuid}],{syncRunId:'merge-sync-run'})).length,0);
    assert.equal((await catalog.insertMany([input],{syncRunId:'merge-sync-run'})).length,1);
    assert.equal(await pgBlacklistFind(survivor.url,survivor.stationuuid),null);
    const ban = await pgBlacklistAdd({ name:survivor.name,url:survivor.url,stationUuid:survivor.stationuuid,reason:'Explicit manual ban',
      mergeAudit:{survivorId:'old-restored-archive'} });
    assert.equal(ban.reason,'Explicit manual ban');
    assert.equal(ban.mergeAudit,undefined);
    assert.equal(buildSyncBlacklist(await pgSyncBlacklist()).blacklistedUrls.has(survivor.url),true);
    assert.equal((await catalog.insertMany([{...input,name:'One more',stationuuid:'yet-another-uuid'}],{syncRunId:'merge-sync-run'})).length,0);
    assert.equal((await pgBlacklistFind(survivor.url))?.reason,'Explicit manual ban');
  });
});

/**
 * Regression tests for the per-country sample-stations capture on
 * BackfillRun rows (Task #234, covered by Task #314).
 *
 * Three invariants we lock in:
 *
 *   1. `enqueueLogosForCountry` returns a sample of touched stations,
 *      capped at `BACKFILL_SAMPLE_STATIONS_PER_COUNTRY`, with `_id`,
 *      `slug`, and `name` populated from the seeded candidates.
 *
 *   2. The snapshot is materialized and locked before clearing logo assets
 *      in the same SQL statement. We observe the real query and verify
 *      both the captured sample and persisted asset clearing, guarding
 *      against sampling rows only after their qualifying fields changed.
 *
 *   3. End-to-end: running an actual sweep via
 *      `ScheduledBackfillService.runOnce` persists `sampleStations`
 *      arrays into the BackfillRun document for BOTH the logo and tag
 *      phases (non-empty, capped, and carrying slug/name). This is the
 *      contract the run detail page in the admin UI consumes, so we
 *      assert what is actually stored on the row, not just what the
 *      helpers return in-process.
 *
 * We override `BACKFILL_SAMPLE_STATIONS_PER_COUNTRY` to a small value
 * BEFORE importing the service so the resolved module-level constant
 * picks it up.
 *
 * Runner: `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createNativePostgresFixture,
  type NativePostgresFixture,
} from "./helpers/native-postgres-fixture";
import {
  pgCoverage,
  PostgresCoverageStore,
} from "../src/data/postgres-coverage-store";
import { getPostgresPool } from "../src/postgres-runtime";

// Pin the cap to a small, easy-to-assert number BEFORE importing the
// service module — the constant is resolved at module-load time.
const SAMPLE_CAP = 3;
process.env.BACKFILL_SAMPLE_STATIONS_PER_COUNTRY = String(SAMPLE_CAP);
// Drop the inter-attempt backoff so a forced retry in a sweep test
// wouldn't sleep for minutes. Belt-and-braces — none of the tests
// below force retries, but cheaper to be safe.
process.env.BACKFILL_RETRY_BASE_MS = "0";

// ---------------------------------------------------------------------------
// Module mocks — installed BEFORE the service is dynamically imported in
// `before()` so the real SyncService and notifier never run. The sweep
// integration test still drives the real ScheduledBackfillService, which
// in turn calls the mocked dependencies.
// ---------------------------------------------------------------------------

// Recording stub so the integration test can assert the sweep called
// the hydrator with the expected country / limit, and so the test can
// fabricate per-country tag counts.
const hydrateCalls: Array<{ countryCode?: string; limit?: number }> = [];
let hydrateImpl: (opts: { countryCode?: string; limit?: number }) => Promise<{
  processed: number;
  hydrated: number;
  emptyUpstream: number;
  failed: number;
}> = async () => ({ processed: 0, hydrated: 0, emptyUpstream: 0, failed: 0 });

mock.module(new URL("../src/services/sync.ts", import.meta.url).href, {
  namedExports: {
    SyncService: class {
      async hydrateMissingTagsInBackground(
        opts: { countryCode?: string; limit?: number } = {},
      ) {
        hydrateCalls.push({ countryCode: opts.countryCode, limit: opts.limit });
        return hydrateImpl(opts);
      }
    },
  },
});

// Mirror the FULL named export surface scheduled-backfill imports from
// backfill-notifier so module instantiation doesn't blow up. The
// slowdown getters return values that effectively disable the slowdown
// detector for these tests (huge minSamples / minBaseline so no
// historical run ever qualifies), and notifyBackfillPhaseSlowdowns is a
// no-op.
mock.module(
  new URL("../src/services/backfill-notifier.ts", import.meta.url).href,
  {
    namedExports: {
      notifyBackfillResult: async () => {},
      notifyBackfillPhaseSlowdowns: async () => {},
      getBackfillPhaseSlowdownLookback: () => 10,
      getBackfillPhaseSlowdownMinSamples: () => Number.MAX_SAFE_INTEGER,
      getBackfillPhaseSlowdownMultiplier: () => 1000,
      getBackfillPhaseSlowdownMinBaselineMs: () => Number.MAX_SAFE_INTEGER,
    },
  },
);

let fixture: NativePostgresFixture;

// Imported lazily inside `before()` so the env override above is in
// effect when scheduled-backfill.ts evaluates BACKFILL_SAMPLE_STATIONS_PER_COUNTRY.
type ServiceModule = typeof import("../src/services/scheduled-backfill.ts");
let service: ServiceModule;

before(async () => {
  fixture = await createNativePostgresFixture("backfill-samples");
  const acquireJob = PostgresCoverageStore.prototype.acquireJob;
  // Keep real lock semantics without contending with another fixture schema.
  mock.method(
    PostgresCoverageStore.prototype,
    "acquireJob",
    function (name: string) {
      return acquireJob.call(this, `${fixture.schema}:${name}`);
    },
  );
  service = await import("../src/services/scheduled-backfill.ts");

  // Sanity: env override actually landed.
  assert.equal(
    service.BACKFILL_SAMPLE_STATIONS_PER_COUNTRY,
    SAMPLE_CAP,
    "BACKFILL_SAMPLE_STATIONS_PER_COUNTRY must reflect the test env override",
  );
});

after(async () => {
  mock.restoreAll();
  await fixture?.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let stationCounter = 0;
function nextUuid(): string {
  stationCounter += 1;
  return `uuid-${stationCounter.toString().padStart(6, "0")}`;
}

async function seedLogoCandidate(opts: {
  countryCode: string;
  slug: string;
  name: string;
}): Promise<void> {
  // Matches buildLogoBackfillFilter via the `'logoAssets.status':
  // 'pending'` branch. Explicit pending status (rather than an absent
  // logoAssets subdoc) so $unset has something to remove and
  // modifiedCount > 0.
  await fixture.insert("stations", {
    stationuuid: nextUuid(),
    name: opts.name,
    url: "https://example.com/stream",
    favicon: "https://example.com/favicon.png",
    slug: opts.slug,
    countryCode: opts.countryCode,
    logoAssets: { status: "pending" },
    // Non-empty `tags` so logo candidates are NOT also picked up by the
    // tags-backfill filter (which matches stations with missing/empty
    // tags). Without this, a sweep test that seeds both phases would
    // see logo candidates leak into the tags sample.
    tags: "placeholder",
  });
}

async function seedTagsCandidate(opts: {
  countryCode: string;
  slug: string;
  name: string;
}): Promise<void> {
  // Matches buildTagsBackfillFilter: stationuuid set, tags missing,
  // tagsCheckedAt missing.
  await fixture.insert("stations", {
    stationuuid: nextUuid(),
    name: opts.name,
    url: "https://example.com/stream",
    slug: opts.slug,
    countryCode: opts.countryCode,
    // intentionally NO tags + NO tagsCheckedAt
  });
}

// ---------------------------------------------------------------------------
// 1. enqueueLogosForCountry: capped sample with the right shape
// ---------------------------------------------------------------------------

test("enqueueLogosForCountry returns a capped sampleStations array with _id/slug/name", async () => {
  const country = "TR";
  // Seed more candidates than the cap so we can prove the limit is
  // applied and not just "everything that happens to match".
  const seeded = SAMPLE_CAP + 2;
  const expectedSlugs = new Set<string>();
  const expectedNames = new Set<string>();
  for (let i = 0; i < seeded; i++) {
    const slug = `tr-station-${i}`;
    const name = `TR Station ${i}`;
    expectedSlugs.add(slug);
    expectedNames.add(name);
    await seedLogoCandidate({ countryCode: country, slug, name });
  }

  // A station in another country must NOT show up in TR's sample.
  await seedLogoCandidate({
    countryCode: "DE",
    slug: "de-station-1",
    name: "DE Station 1",
  });

  const result = await service.enqueueLogosForCountry(country);

  assert.equal(result.candidates, seeded, "all TR candidates must be counted");
  assert.equal(
    result.enqueued,
    seeded,
    "all TR candidates must have logoAssets unset",
  );

  assert.equal(
    result.sampleStations.length,
    SAMPLE_CAP,
    `sampleStations must be capped at BACKFILL_SAMPLE_STATIONS_PER_COUNTRY (${SAMPLE_CAP})`,
  );
  for (const sample of result.sampleStations) {
    assert.equal(typeof sample._id, "string", "sample._id must be a string");
    assert.ok(sample._id.length > 0, "sample._id must be non-empty");
    assert.ok(
      sample.slug && expectedSlugs.has(sample.slug),
      `sample.slug "${sample.slug}" must come from a seeded TR candidate`,
    );
    assert.ok(
      sample.name && expectedNames.has(sample.name),
      `sample.name "${sample.name}" must come from a seeded TR candidate`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Call-ordering proof: snapshot must run BEFORE $unset
// ---------------------------------------------------------------------------

test("enqueueLogosForCountry captures the locked snapshot before clearing assets atomically", async () => {
  const country = "IT";
  for (let i = 0; i < 2; i++) {
    await seedLogoCandidate({
      countryCode: country,
      slug: `it-station-${i}`,
      name: `IT Station ${i}`,
    });
  }

  const statements: string[] = [];
  const pool = getPostgresPool(),
    original = pool.query.bind(pool);
  const spy = mock.method(pool, "query", ((sql: any, ...args: any[]) => {
    if (typeof sql === "string") statements.push(sql);
    return (original as any)(sql, ...args);
  }) as any);
  try {
    const result = await service.enqueueLogosForCountry(country);
    assert.ok(
      result.sampleStations.length > 0,
      "snapshot must survive the clear",
    );
    assert.equal(result.candidates, 2);
    assert.equal(result.enqueued, 2);
    const statement = statements.find((sql) => sql.includes("UPDATE stations"));
    assert.ok(statement, "actual SQL update must execute");
    assert.match(
      statement,
      /WITH selected AS MATERIALIZED\([\s\S]*FOR UPDATE\)/,
      "lock and materialize the snapshot before mutation",
    );
    assert.ok(
      statement.indexOf("WITH selected") < statement.indexOf("UPDATE stations"),
      "snapshot must precede clearing",
    );
    const after = (
      await fixture.pool.query(
        "SELECT logo_assets FROM stations WHERE country_code=$1",
        [country],
      )
    ).rows;
    assert.ok(
      after.every((row) => row.logo_assets === null),
      "candidate logo assets must actually be cleared",
    );
  } finally {
    spy.mock.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. Empty country — no candidates, no sample, no exception
// ---------------------------------------------------------------------------

test("enqueueLogosForCountry returns an empty sample when nothing matches", async () => {
  const result = await service.enqueueLogosForCountry("ZZ"); // unseeded
  assert.equal(result.candidates, 0);
  assert.equal(result.enqueued, 0);
  assert.deepEqual(result.sampleStations, []);
});

// ---------------------------------------------------------------------------
// 4. End-to-end sweep: persisted BackfillRun row carries sampleStations
//    for BOTH logo and tag phases. This is the contract the admin run
//    detail page consumes, so we assert what's actually stored on the
//    document — not just what the helpers return in-process.
// ---------------------------------------------------------------------------

test("runOnce persists capped sampleStations on BackfillRun.logos[] and BackfillRun.tags[] for the swept country", async () => {
  const country = "FR";

  // Seed extra candidates for both phases so the cap is actually
  // exercised in the persisted arrays.
  const seededLogos = SAMPLE_CAP + 2;
  const expectedLogoSlugs = new Set<string>();
  const expectedLogoNames = new Set<string>();
  for (let i = 0; i < seededLogos; i++) {
    const slug = `fr-logo-${i}`;
    const name = `FR Logo Station ${i}`;
    expectedLogoSlugs.add(slug);
    expectedLogoNames.add(name);
    await seedLogoCandidate({ countryCode: country, slug, name });
  }

  const seededTags = SAMPLE_CAP + 1;
  const expectedTagSlugs = new Set<string>();
  const expectedTagNames = new Set<string>();
  for (let i = 0; i < seededTags; i++) {
    const slug = `fr-tags-${i}`;
    const name = `FR Tags Station ${i}`;
    expectedTagSlugs.add(slug);
    expectedTagNames.add(name);
    await seedTagsCandidate({ countryCode: country, slug, name });
  }

  // The mocked SyncService just reports synthetic counts so the sweep
  // can complete without hitting radio-browser. The sample we assert on
  // is captured by `sampleStationsForFilter` BEFORE this is called.
  hydrateCalls.length = 0;
  hydrateImpl = async () => ({
    processed: seededTags,
    hydrated: seededTags,
    emptyUpstream: 0,
    failed: 0,
  });

  // overrideCountry skips the top-N aggregation and runs both phases
  // for just this market — exactly the path admins hit when they
  // backfill a single country from the UI (Task #234's primary use case).
  const ranSweep = await service.scheduledBackfill.runOnce("test:sweep", {
    countryCode: country,
  });
  assert.ok(ranSweep, "runOnce must return the persisted BackfillRun row");

  // Sanity: hydrator was called with the country we targeted.
  assert.equal(
    hydrateCalls.length,
    1,
    "sync.hydrateMissingTagsInBackground must be called once",
  );
  assert.equal(hydrateCalls[0]?.countryCode, country);

  // Re-read from PostgreSQL so we assert against what was actually stored,
  // not the in-memory document that flowed through the worker.
  const persisted = await pgCoverage().run(String(ranSweep._id));
  assert.ok(persisted, "BackfillRun row must be persisted");
  assert.equal(
    persisted!.status,
    "completed",
    "sweep must complete successfully",
  );

  // ---- Logos phase ------------------------------------------------------
  const logoEntry = persisted!.logos.find((l) => l.countryCode === country);
  assert.ok(
    logoEntry,
    `BackfillRun.logos must include an entry for ${country}`,
  );
  assert.equal(logoEntry!.candidates, seededLogos);
  assert.equal(logoEntry!.enqueued, seededLogos);
  assert.ok(
    Array.isArray(logoEntry!.sampleStations),
    "persisted logos[].sampleStations must be present (snapshot was captured)",
  );
  assert.equal(
    logoEntry!.sampleStations!.length,
    SAMPLE_CAP,
    `persisted logos[].sampleStations must be capped at ${SAMPLE_CAP}`,
  );
  for (const sample of logoEntry!.sampleStations!) {
    assert.ok(sample._id, "persisted logo sample row must have _id");
    assert.ok(
      sample.slug && expectedLogoSlugs.has(sample.slug),
      `persisted logo sample slug "${sample.slug}" must come from a seeded FR logo candidate`,
    );
    assert.ok(
      sample.name && expectedLogoNames.has(sample.name),
      `persisted logo sample name "${sample.name}" must come from a seeded FR logo candidate`,
    );
  }

  // ---- Tags phase -------------------------------------------------------
  const tagEntry = persisted!.tags.find((t) => t.countryCode === country);
  assert.ok(tagEntry, `BackfillRun.tags must include an entry for ${country}`);
  assert.ok(
    Array.isArray(tagEntry!.sampleStations),
    "persisted tags[].sampleStations must be present (snapshot was captured)",
  );
  assert.equal(
    tagEntry!.sampleStations!.length,
    SAMPLE_CAP,
    `persisted tags[].sampleStations must be capped at ${SAMPLE_CAP}`,
  );
  for (const sample of tagEntry!.sampleStations!) {
    assert.ok(sample._id, "persisted tag sample row must have _id");
    assert.ok(
      sample.slug && expectedTagSlugs.has(sample.slug),
      `persisted tag sample slug "${sample.slug}" must come from a seeded FR tags candidate`,
    );
    assert.ok(
      sample.name && expectedTagNames.has(sample.name),
      `persisted tag sample name "${sample.name}" must come from a seeded FR tags candidate`,
    );
  }
});

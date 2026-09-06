import { after, mock, test } from "node:test";
import assert from "node:assert/strict";
import { BSON } from "@workspace/legacy-migration/legacy-document-codec";
import { validatePostgresStoreConfiguration } from '../src/data/postgres-store-config';

const stationId = "507f1f77bcf86cd799439011";
const queries: Array<{ text: string; values: any[] }> = [];
const mongoWrites: any[] = [];
const lookups: Array<{ collection: string; filter: any; options: any }> = [];
let watchedOptions: Record<string, any> | undefined;
let notifyStreamOpened: (() => void) | undefined;
let finishStream: (() => void) | undefined;
let storedResumeToken: Record<string, any> | null = null;
let checkouts = 0;
let releases = 0;
let mongoWriteError: Error | null = null;
let mongoWriteResult: any = { votes: 42 };
let lookupError: Error | null = null;
let lookupResult: any = null;
let queryErrorPattern: RegExp | null = null;
let emptyCounterResult = false;

const client = {
  async query(text: string, values: any[] = []) {
    queries.push({ text, values });
    if (queryErrorPattern?.test(text)) throw new Error("simulated SQL failure");
    if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }], rowCount: 1 };
    if (text.includes("SELECT resume_token")) return { rows: [{ resume_token: storedResumeToken, events_processed: "0" }], rowCount: 1 };
    if (emptyCounterResult && text.startsWith('UPDATE stations')) return { rows: [], rowCount: 0 };
    return { rows: [{ value: 43 }], rowCount: 1 };
  },
  release() { releases++; },
};
mock.module(new URL("../src/postgres-runtime.ts", import.meta.url).href, {
  namedExports: { getPostgresPool: () => ({
    query: client.query,
    connect: async () => { checkouts++; return client; },
  }) },
});
function model(collection: string) {
  return {
    collection: {
      collectionName: collection,
      async findOne(filter: any, options: any) {
        lookups.push({ collection, filter, options });
        if (lookupError) throw lookupError;
        return lookupResult;
      },
    },
    db: {
      watch(_pipeline: any[], options: any) {
        watchedOptions = options;
        notifyStreamOpened?.();
        return {
          [Symbol.asyncIterator]() {
            return { next: () => new Promise(resolve => { finishStream = () => resolve({ done: true }); }) };
          },
          async close() { finishStream?.(); },
        };
      },
    },
    async findByIdAndUpdate(...args: any[]) {
      mongoWrites.push(args);
      if (mongoWriteError) throw mongoWriteError;
      return mongoWriteResult;
    },
  };
}
mock.module("@workspace/legacy-migration/mongo-schemas", {
  namedExports: { Station: model("stations"), Genre: model("genres") },
});
mock.module(new URL("../src/utils/logger.ts", import.meta.url).href, {
  namedExports: { logger: { log() {}, warn() {}, error() {} } },
});

const prior = {
  STATION_WRITE_MODE: process.env.STATION_WRITE_MODE,
  STATION_CDC_ENABLED: process.env.STATION_CDC_ENABLED,
  ENGAGEMENT_STORE: process.env.ENGAGEMENT_STORE,
};
process.env.STATION_WRITE_MODE = "mongo";
process.env.STATION_CDC_ENABLED = "false";
const { persistCatalogChangeEvent } = await import("../../../lib/legacy-migration/src/station-change-stream-cdc.ts");
const { upsertPostgresStation, upsertPostgresGenre } = await import("../../../lib/legacy-migration/src/postgres-station-sync.ts");
after(() => {
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  mock.restoreAll();
});

async function counters(mode: string, cdc: string, scenario: string) {
  process.env.STATION_WRITE_MODE = mode;
  process.env.STATION_CDC_ENABLED = cdc;
  return import(new URL(`../src/data/station-write-store.ts?scenario=${scenario}`, import.meta.url).href);
}

test("native counters never fall back to Mongo after a PostgreSQL failure or a missing row", async () => {
  const store = await counters("postgres", "false", "native-failure");
  queries.length = 0;
  mongoWrites.length = 0;
  assert.equal(await store.incrementStationClick(stationId), true);
  assert.equal(await store.incrementStationVote(stationId), 43);
  queryErrorPattern = /UPDATE stations/;
  await assert.rejects(store.incrementStationVote(stationId), /simulated SQL failure/);
  queryErrorPattern = null;
  emptyCounterResult = true;
  assert.equal(await store.incrementStationClick(stationId), false);
  assert.equal(await store.incrementStationVote(stationId), null);
  emptyCounterResult = false;
  assert.equal(mongoWrites.length, 0, 'No compensating legacy write after an ambiguous SQL commit');
});

test("PostgreSQL-only counters execute atomic SQL and do not call MongoDB", async () => {
  const store = await counters("postgres", "false", "postgres-success");
  queries.length = 0;
  mongoWrites.length = 0;
  assert.equal(await store.incrementStationClick(stationId), true);
  assert.equal(await store.incrementStationVote(stationId), 43);
  assert.equal(mongoWrites.length, 0);
  assert.match(queries[0].text, /click_count=click_count\+1/);
  assert.match(queries[1].text, /votes=votes\+1/);
  assert.deepEqual(queries[0].values, [stationId, true]);
  assert.deepEqual(queries[1].values, [stationId, false]);
});

test("startup rejects legacy counter modes and competing CDC writers", () => {
  assert.throws(()=>validatePostgresStoreConfiguration({STATION_WRITE_MODE:'postgres',STATION_CDC_ENABLED:'true'}), /forbidden/);
  assert.throws(()=>validatePostgresStoreConfiguration({STATION_WRITE_MODE:'dual',STATION_CDC_ENABLED:'false'}), /no longer supported/);
  assert.doesNotThrow(()=>validatePostgresStoreConfiguration({}));
});

test("null fullDocument reconciles a deleted station and commits the resume token", async () => {
  queries.length = 0;
  lookups.length = 0;
  lookupResult = null;
  await persistCatalogChangeEvent(client as any, {
    _id: { token: 1 }, ns: { coll: "stations" }, operationType: "update",
    documentKey: { _id: stationId }, fullDocument: null,
  });
  assert.deepEqual(lookups, [{ collection: "stations", filter: { _id: stationId },
    options: { readPreference: "primary", promoteValues: false } }]);
  const deletion = queries.findIndex(q => q.text === "DELETE FROM stations WHERE id=$1");
  const checkpoint = queries.findIndex(q => q.text.includes("resume_token=$2"));
  assert.ok(deletion > 0 && checkpoint > deletion);
  assert.equal(queries.at(-1)?.text, "COMMIT");
  assert.equal(queries[checkpoint].values[1], JSON.stringify(BSON.EJSON.serialize({ token: 1 }, { relaxed: false })));
});

test("null fullDocument re-reads a current genre instead of deleting a recreated row", async () => {
  queries.length = 0;
  lookupResult = { _id: stationId, name: "Jazz", slug: "jazz" };
  await persistCatalogChangeEvent(client as any, {
    _id: { token: 2 }, ns: { coll: "genres" }, operationType: "update",
    documentKey: { _id: stationId }, fullDocument: null,
  });
  assert.ok(queries.some(q => q.text.includes("INSERT INTO genres")));
  assert.ok(!queries.some(q => q.text.startsWith("DELETE FROM genres")));
  assert.equal(queries.at(-1)?.text, "COMMIT");
});

test("both CDC event and raw fallback retain distinct BSON numeric types in the mirror", async () => {
  const { Double, Int32, Long, Decimal128 } = BSON;
  const document = {
    _id: stationId, name: "Typed source", diagnostics: {
      double: new Double(1), integer: new Int32(1),
      long: Long.fromString("9007199254740993"), decimal: Decimal128.fromString("1.000"),
    },
  };
  for (const fullDocument of [document, null]) {
    queries.length = 0;
    lookupResult = document;
    await persistCatalogChangeEvent(client as any, {
      _id: { _data: "typed-snapshot" }, ns: { coll: "stations" }, operationType: "update",
      documentKey: { _id: stationId }, fullDocument,
    });
    const mirror = queries.find(q => q.text.includes("INSERT INTO legacy_documents"))!;
    const raw = JSON.parse(mirror.values[4]);
    assert.deepEqual(raw.diagnostics, {
      double: { $numberDouble: "1.0" }, integer: { $numberInt: "1" },
      long: { $numberLong: "9007199254740993" }, decimal: { $numberDecimal: "1.000" },
    });
    assert.equal(JSON.parse(mirror.values[1]).diagnostics.long, "9007199254740993");
  }
});

async function openAndCloseTestStream() {
  process.env.STATION_WRITE_MODE = "mongo";
  process.env.STATION_CDC_ENABLED = "true";
  const cdc = await import(new URL("../../../lib/legacy-migration/src/station-change-stream-cdc.ts?scenario=raw-bson", import.meta.url).href);
  const opened = new Promise<void>(resolve => { notifyStreamOpened = resolve; });
  cdc.startStationChangeStreamCdc();
  try {
    await opened;
    return watchedOptions;
  } finally {
    await cdc.stopStationChangeStreamCdc();
    notifyStreamOpened = undefined;
  }
}

test("change-stream driver preserves BSON numeric types before lossless capture", async () => {
  const options = await openAndCloseTestStream();
  assert.equal(options?.promoteValues, false);
  assert.equal(options?.fullDocument, "updateLookup");
  assert.equal(Object.hasOwn(options!, "resumeAfter"), false);
});

test("resume tokens retain binary type bits and deserialize without extra wrapping", async () => {
  const token = {
    _data: "8268C00123000000012B042C0100296E5A1004",
    _typeBits: new BSON.Binary(Buffer.from([0, 1, 128, 255])),
  };
  queries.length = 0;
  await persistCatalogChangeEvent(client as any, {
    _id: token, ns: { coll: "genres" }, operationType: "update",
    fullDocument: { _id: stationId, name: "Jazz", slug: "jazz" },
  });
  const checkpoint = queries.find(q => q.text.includes("resume_token=$2"))!;
  storedResumeToken = JSON.parse(checkpoint.values[1]);
  assert.deepEqual(storedResumeToken, {
    _data: token._data, _typeBits: { $binary: { base64: "AAGA/w==", subType: "00" } },
  });
  const options = await openAndCloseTestStream();
  assert.deepEqual(options?.resumeAfter, token);
  assert.deepEqual(Object.keys(options!.resumeAfter).sort(), ["_data", "_typeBits"]);
  storedResumeToken = null;
});

test("old plain string resume tokens remain accepted", async () => {
  storedResumeToken = { _data: "legacy-resume-token" };
  const options = await openAndCloseTestStream();
  assert.deepEqual(options?.resumeAfter, storedResumeToken);
  storedResumeToken = null;
});

test("failed null-document lookup rolls back without advancing the checkpoint", async () => {
  queries.length = 0;
  lookupError = new Error("Mongo primary unavailable");
  await assert.rejects(persistCatalogChangeEvent(client as any, {
    _id: { token: 3 }, ns: { coll: "stations" }, operationType: "update",
    documentKey: { _id: stationId }, fullDocument: null,
  }), /primary unavailable/);
  lookupError = null;
  assert.deepEqual(queries.map(q => q.text), ["BEGIN", "ROLLBACK"]);
});

test("invalid mirror documents never check out a PostgreSQL connection", async () => {
  const initial = checkouts;
  await assert.rejects(upsertPostgresStation({ name: "Missing ID" }), /without _id/);
  await assert.rejects(upsertPostgresGenre({ name: "Missing ID" }), /without _id/);
  const circular: any = { _id: stationId }; circular.self = circular;
  await assert.rejects(upsertPostgresStation(circular), /circular/i);
  assert.equal(checkouts, initial);
});

test("mirror releases owned clients after SQL failure", async () => {
  const initialReleases = releases;
  queryErrorPattern = /INSERT INTO stations/;
  await assert.rejects(upsertPostgresStation({ _id: stationId, name: "Test" }), /simulated SQL/);
  queryErrorPattern = null;
  assert.equal(releases, initialReleases + 1);
  assert.equal(queries.at(-1)?.text, "ROLLBACK");
});

test("metadata mirror protects PostgreSQL-owned rating aggregates", async () => {
  process.env.ENGAGEMENT_STORE = "postgres";
  queries.length = 0;
  await upsertPostgresStation({ _id: stationId, name: "Metadata update", votes: 1, averageRating: 1, totalRatings: 1 }, client as any);
  const upsert = queries.find(q => q.text.includes("INSERT INTO stations"))!;
  assert.equal(upsert.values[40], true);
  assert.match(upsert.text, /average_rating=CASE WHEN \$41::boolean THEN stations\.average_rating ELSE EXCLUDED\.average_rating END/);
  assert.match(upsert.text, /total_ratings=CASE WHEN \$41::boolean THEN stations\.total_ratings ELSE EXCLUDED\.total_ratings END/);
  assert.match(upsert.text, /votes=CASE WHEN \$41::boolean THEN stations\.votes ELSE EXCLUDED\.votes END/);
});

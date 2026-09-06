import crypto from "node:crypto";
import os from "node:os";
import mongoose from "mongoose";
import { Genre, Station } from "./mongo-schemas";
import type pg from "pg";
import { getPostgresPool } from "../../../artifacts/api-server/src/postgres-runtime";
import {
  deletePostgresGenre, deletePostgresStation, upsertPostgresGenre, upsertPostgresStation,
} from "./postgres-station-sync";
import { logger } from "../../../artifacts/api-server/src/utils/logger";

const streamName = "catalog-v1";
const ownerId = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
const retryDelayMs = Math.max(1_000, Math.min(60_000,
  Number.parseInt(process.env.STATION_CDC_RETRY_MS || "10000", 10) || 10_000));

export const stationCdcEnabled = process.env.STATION_CDC_ENABLED === "true";
if (stationCdcEnabled && (process.env.STATION_WRITE_MODE || "mongo").toLowerCase() === "postgres") {
  throw new Error("STATION_CDC_ENABLED must be false after STATION_WRITE_MODE=postgres cutover");
}

type CdcState = {
  enabled: boolean;
  role: "disabled" | "starting" | "leader" | "standby" | "error" | "stopped";
  eventsProcessed: number;
  lastEventAt: string | null;
  error: string | null;
};

const state: CdcState = {
  enabled: stationCdcEnabled,
  role: stationCdcEnabled ? "starting" : "disabled",
  eventsProcessed: 0,
  lastEventAt: null,
  error: null,
};

let stopping = false;
let loopPromise: Promise<void> | null = null;
let activeStream: { close(): Promise<void> } | null = null;
let activeLeaderClient: pg.PoolClient | null = null;

const wait = (duration: number) => new Promise<void>((resolve) => setTimeout(resolve, duration));

async function recordStatus(
  client: pg.PoolClient,
  status: string,
  error: string | null = null,
): Promise<void> {
  await client.query(
    `INSERT INTO mongo_change_stream_checkpoints(stream_name,status,last_error,owner_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (stream_name) DO UPDATE SET
       status=EXCLUDED.status,last_error=EXCLUDED.last_error,
       owner_id=EXCLUDED.owner_id,updated_at=now()`,
    [streamName, status, error, ownerId],
  );
}

export async function persistCatalogChangeEvent(
  client: pg.PoolClient,
  event: Record<string, any>,
): Promise<void> {
  await client.query("BEGIN");
  try {
    const collection = String(event.ns?.coll || "");
    const stationCollection = Station.collection.collectionName;
    const genreCollection = Genre.collection.collectionName;
    if (["insert", "replace", "update"].includes(event.operationType)) {
      if (collection !== stationCollection && collection !== genreCollection) {
        throw new Error(`Unexpected catalog collection in change stream: ${collection}`);
      }
      let document = event.fullDocument;
      if (!document) {
        // updateLookup can legitimately be null if a later delete already won.
        // Reconcile this one key from the primary so that replay can advance to
        // the subsequent delete/insert instead of retrying the same event forever.
        // Raw collection reads preserve BSON numeric types for the lossless
        // mirror; a Mongoose document would already have cast those values.
        const documentId = event.documentKey?._id;
        if (!documentId) throw new Error("Catalog change event is missing documentKey._id");
        document = collection === stationCollection
          ? await Station.collection.findOne({ _id: documentId }, { readPreference: "primary", promoteValues: false })
          : await Genre.collection.findOne({ _id: documentId }, { readPreference: "primary", promoteValues: false });
        if (!document) {
          if (collection === stationCollection) await deletePostgresStation(String(documentId), client);
          else await deletePostgresGenre(String(documentId), client);
        }
      }
      if (document) {
        if (collection === stationCollection) await upsertPostgresStation(document, client);
        else await upsertPostgresGenre(document, client);
      }
    } else if (event.operationType === "delete") {
      const documentId = String(event.documentKey?._id || "");
      if (collection === stationCollection) await deletePostgresStation(documentId, client);
      else if (collection === genreCollection) await deletePostgresGenre(documentId, client);
      else throw new Error(`Unexpected catalog collection in delete event: ${collection}`);
    } else if (["drop", "rename", "dropDatabase", "invalidate"].includes(event.operationType)) {
      throw new Error(`Destructive MongoDB change-stream event: ${event.operationType}`);
    }

    await client.query(
      `UPDATE mongo_change_stream_checkpoints SET
         resume_token=$2::jsonb,status='active',events_processed=events_processed+1,
         last_event_at=now(),last_error=NULL,owner_id=$3,updated_at=now()
       WHERE stream_name=$1`,
      [streamName, JSON.stringify(mongoose.mongo.BSON.EJSON.serialize(event._id, { relaxed: false })), ownerId],
    );
    await client.query("COMMIT");
    state.eventsProcessed += 1;
    state.lastEventAt = new Date().toISOString();
    state.error = null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function lead(client: pg.PoolClient): Promise<void> {
  activeLeaderClient = client;
  await recordStatus(client, "active");
  const checkpoint = await client.query<{ resume_token: Record<string, unknown> | null; events_processed: string }>(
    "SELECT resume_token,events_processed::text FROM mongo_change_stream_checkpoints WHERE stream_name=$1",
    [streamName],
  );
  // Resume tokens may contain Binary _typeBits as well as the usual _data
  // string. Extended JSON restores their BSON types; plain older tokens remain
  // compatible because their string fields deserialize unchanged.
  const storedResumeToken = checkpoint.rows[0]?.resume_token;
  const resumeToken = storedResumeToken
    ? mongoose.mongo.BSON.EJSON.deserialize(storedResumeToken, { relaxed: false })
    : undefined;
  state.eventsProcessed = Number(checkpoint.rows[0]?.events_processed || 0);
  state.role = "leader";
  state.error = null;

  const options: Record<string, unknown> = {
    fullDocument: "updateLookup", maxAwaitTimeMS: 10_000, promoteValues: false,
  };
  if (resumeToken) options.resumeAfter = resumeToken;
  const catalogCollections = [Station.collection.collectionName, Genre.collection.collectionName];
  const stream = Station.db.watch([
    { $match: { $or: [
      { "ns.coll": { $in: catalogCollections } },
      { operationType: { $in: ["dropDatabase", "invalidate"] } },
    ] } },
  ], options as any);
  activeStream = stream as any;
  logger.log(`✅ Catalog CDC leader active${resumeToken ? " (resumed)" : " (new stream)"}`);

  try {
    for await (const rawEvent of stream as any) {
      if (stopping) break;
      await persistCatalogChangeEvent(client, rawEvent as Record<string, any>);
    }
  } finally {
    activeStream = null;
    await stream.close().catch(() => undefined);
  }
}

async function leaderLoop(): Promise<void> {
  while (!stopping) {
    let client: pg.PoolClient | null = null;
    let ownsLock = false;
    try {
      client = await getPostgresPool().connect();
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
        [`radiostation-cdc:${streamName}`],
      );
      ownsLock = lock.rows[0]?.acquired === true;
      if (!ownsLock) {
        state.role = "standby";
        state.error = null;
      } else {
        await lead(client);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.role = "error";
      state.error = message;
      logger.error(`❌ Station CDC error; retrying in ${retryDelayMs}ms: ${message}`);
      if (client && ownsLock) await recordStatus(client, "error", message).catch(() => undefined);
    } finally {
      activeLeaderClient = null;
      if (client) {
        if (ownsLock) {
          await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`radiostation-cdc:${streamName}`])
            .catch(() => undefined);
        }
        client.release();
      }
    }
    if (!stopping) await wait(retryDelayMs);
  }
  state.role = "stopped";
}

export function startStationChangeStreamCdc(): void {
  if (!stationCdcEnabled || loopPromise) return;
  stopping = false;
  loopPromise = leaderLoop().finally(() => { loopPromise = null; });
}

export async function stopStationChangeStreamCdc(): Promise<void> {
  if (!stationCdcEnabled) return;
  stopping = true;
  await activeStream?.close().catch(() => undefined);
  if (activeLeaderClient) {
    await recordStatus(activeLeaderClient, "stopped").catch(() => undefined);
  }
  await Promise.race([loopPromise || Promise.resolve(), wait(2_000)]);
  state.role = "stopped";
}

export function getStationCdcStatus(): CdcState {
  return { ...state };
}

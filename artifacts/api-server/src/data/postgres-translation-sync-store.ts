import { randomBytes } from "node:crypto";
import type pg from "pg";
import { getPostgresCoordinationPool } from "../postgres-runtime";
import type { TranslationKeyInput } from "./postgres-localization-store";

export interface GeneratedTranslation {
  keyId: string;
  defaultValue: string;
  language: string;
  value: string;
  /** Explicit admin repair mode only; still requires the exact observed row to match. */
  allowCompletedRepair?: boolean;
  observed?: {
    _id: string;
    value: string;
    isCompleted: boolean;
    lastModified: Date;
  };
}

export interface TranslationSyncWriter {
  assertOwned(): void;
  syncKeys(
    keys: TranslationKeyInput[],
  ): Promise<{ added: number; existing: number }>;
  saveGenerated(inputs: GeneratedTranslation[]): Promise<number>;
  saveGeneratedDetailed(inputs: GeneratedTranslation[]): Promise<string[]>;
}

/** All writes use the lock-owning session: a disconnected old worker cannot commit on another pool. */
export class PostgresTranslationSyncStore {
  constructor(private readonly coordinationPool: Pick<pg.Pool, "connect">) {}

  async withLeader<T>(
    operation: (writer: TranslationSyncWriter) => Promise<T>,
  ): Promise<T> {
    const client = await this.coordinationPool.connect();
    let failure: Error | undefined;
    let locked = false;
    const onFailure = (error?: Error) => {
      failure =
        error || new Error("Translation sync coordination connection closed");
    };
    client.on("error", onFailure);
    client.on("end", onFailure);
    const assertOwned = () => {
      if (failure) throw failure;
      if (!locked)
        throw new Error("Translation sync leadership is no longer held");
    };
    const transaction = async <R>(work: () => Promise<R>): Promise<R> => {
      assertOwned();
      await client.query("BEGIN");
      try {
        const result = await work();
        assertOwned();
        await client.query("COMMIT");
        assertOwned();
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    };
    const bumpVersion = async (notes: string) => {
      await client.query(
        `INSERT INTO translation_metadata(scope,languages_version,notes) VALUES ('global',2,$1)
        ON CONFLICT(scope) DO UPDATE SET languages_version=translation_metadata.languages_version+1,
          last_bumped_at=now(),updated_at=now(),notes=EXCLUDED.notes`,
        [notes],
      );
    };
    const saveGeneratedDetailed = (
      inputs: GeneratedTranslation[],
    ): Promise<string[]> =>
      transaction(async () => {
        const changed: string[] = [];
        for (const input of [...inputs].sort(
          (a, b) =>
            a.language.localeCompare(b.language) ||
            a.keyId.localeCompare(b.keyId),
        )) {
          assertOwned();
          if (typeof input.value !== "string" || !input.value.trim())
            throw new Error("Generated translation must be a non-empty string");
          const enabled = await client.query(
            "SELECT code FROM translation_languages WHERE code=$1 AND is_enabled=true FOR SHARE",
            [input.language],
          );
          if (!enabled.rowCount)
            throw new Error(
              `Translation language ${input.language} is no longer enabled`,
            );
          // Hold the source row through the translation conflict wait, not merely an MVCC snapshot.
          const source = await client.query(
            "SELECT id FROM translation_keys WHERE id=$1 AND default_value=$2 FOR SHARE",
            [input.keyId, input.defaultValue],
          );
          if (!source.rowCount) continue;
          const observed = input.observed;
          // An observed row must still exist: never resurrect a translation an admin deleted.
          const saved = observed
            ? await client.query(
                `UPDATE translations SET value=$1,is_completed=true,last_modified=now()
                  WHERE key_id=$2 AND language=$3 AND id=$4 AND value=$5 AND is_completed=$6
                    AND date_trunc('milliseconds',last_modified)=$7::timestamptz
                    AND ($8::boolean OR is_completed=false OR value !~ '[^[:space:]]') RETURNING key_id`,
                [
                  input.value,
                  input.keyId,
                  input.language,
                  observed._id,
                  observed.value,
                  observed.isCompleted,
                  observed.lastModified,
                  input.allowCompletedRepair === true,
                ],
              )
            : await client.query(
                `INSERT INTO translations(id,key_id,language,value,is_completed,last_modified)
                  VALUES ($1,$2,$3,$4,true,now()) ON CONFLICT(key_id,language) DO NOTHING RETURNING key_id`,
                [
                  randomBytes(12).toString("hex"),
                  input.keyId,
                  input.language,
                  input.value,
                ],
              );
          changed.push(...saved.rows.map((row) => row.key_id));
        }
        if (changed.length)
          await bumpVersion(`Auto-translated ${changed.length} strings`);
        return changed;
      });
    try {
      const result = await client.query(
        "SELECT pg_try_advisory_lock(hashtextextended(current_schema() || ':' || $1,0)) acquired",
        ["radiohub:translation-sync"],
      );
      locked = result.rows[0].acquired;
      if (!locked)
        throw Object.assign(
          new Error("Translation sync is already running on another worker"),
          { status: 409 },
        );
      return await operation({
        assertOwned,
        syncKeys: (keys) =>
          transaction(async () => {
            const unique = Array.from(
              new Map(keys.map((key) => [key.key, key])).values(),
            ).sort((a, b) => a.key.localeCompare(b.key));
            if (!unique.length) return { added: 0, existing: 0 };
            const records = unique.map((key) => ({
              id: randomBytes(12).toString("hex"),
              key: key.key,
              default_value: key.defaultValue,
              category: key.category || "general",
              description: key.description || null,
              context: key.context || null,
              is_plural: key.isPlural || false,
            }));
            const inserted = await client.query(
              `INSERT INTO translation_keys(id,key,default_value,category,description,context,is_plural)
            SELECT id,key,default_value,category,description,context,is_plural FROM jsonb_to_recordset($1::jsonb)
            AS k(id text,key text,default_value text,category text,description text,context text,is_plural boolean)
            ORDER BY key ON CONFLICT(key) DO NOTHING`,
              [JSON.stringify(records)],
            );
            const added = inserted.rowCount || 0;
            if (added) await bumpVersion(`Auto-sync added ${added} new keys`);
            return { added, existing: unique.length - added };
          }),
        saveGenerated: (inputs) =>
          saveGeneratedDetailed(inputs).then((ids) => ids.length),
        saveGeneratedDetailed,
      });
    } finally {
      try {
        if (locked && !failure)
          await client.query(
            "SELECT pg_advisory_unlock(hashtextextended(current_schema() || ':' || $1,0))",
            ["radiohub:translation-sync"],
          );
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        throw error;
      } finally {
        locked = false;
        client.off("error", onFailure);
        client.off("end", onFailure);
        client.release(Boolean(failure));
      }
    }
  }
}

export const pgTranslationSync = () =>
  new PostgresTranslationSyncStore(getPostgresCoordinationPool());

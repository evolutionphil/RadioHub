import type { EventEmitter } from "node:events";
import type pg from "pg";

type ErrorEmitter = Pick<EventEmitter, "on" | "off">;
export type MigrationInterruption = "postgres-pool" | "postgres-client" | "coordinator" | "SIGTERM" | "SIGINT";

const messages: Record<MigrationInterruption, string> = {
  "postgres-pool": "Migration interrupted because a PostgreSQL pool connection failed; inspect database and deployment events before retrying.",
  "postgres-client": "Migration interrupted because a held PostgreSQL connection failed; write-lock ownership is no longer assured.",
  coordinator: "Migration interrupted because its coordinator stopped or lost its connection; inspect initialization before retrying.",
  SIGTERM: "Migration interrupted by SIGTERM; inspect deployment termination events before retrying.",
  SIGINT: "Migration interrupted by SIGINT; initialization was not completed.",
};

/** Fixed context only: driver errors, SQL, document IDs and credentials are never retained. */
export class MigrationLifecycleError extends Error {
  readonly code = "MIGRATION_INTERRUPTED";
  constructor(readonly kind: MigrationInterruption) {
    super(messages[kind]);
    this.name = "MigrationLifecycleError";
  }
}

export interface MigrationLifecycleOptions {
  pool: ErrorEmitter;
  parentSignal?: AbortSignal;
  log?: (message: string) => void;
  /** Injectable in tests; production uses process SIGTERM/SIGINT events. */
  signalTarget?: ErrorEmitter;
}

/**
 * Turn asynchronous driver errors/signals into a controlled, fail-closed import.
 * The caller must check assertHealthy before every write/phase, pass signal to
 * cancellable source operations, and persist failure only through the original
 * lock-owning session while usable (never a replacement bookkeeping connection).
 * This helper never catches unrelated uncaught exceptions or exits the process.
 */
export function createMigrationLifecycle({ pool, parentSignal, log, signalTarget = process }: MigrationLifecycleOptions) {
  const controller = new AbortController();
  const clients = new Set<ErrorEmitter>();
  let failure: MigrationLifecycleError | undefined;
  let cleaned = false;

  const interrupt = (kind: MigrationInterruption) => {
    if (cleaned || failure) return;
    failure = new MigrationLifecycleError(kind);
    try { log?.(`[migration:lifecycle] ${failure.message}`); } catch { /* Logging cannot suppress interruption. */ }
    controller.abort(failure);
  };
  const onPoolError = () => interrupt("postgres-pool");
  const onClientError = () => interrupt("postgres-client");
  const onTerminate = () => interrupt("SIGTERM");
  const onInterrupt = () => interrupt("SIGINT");
  const onParentAbort = () => interrupt("coordinator");

  pool.on("error", onPoolError);
  signalTarget.on("SIGTERM", onTerminate);
  signalTarget.on("SIGINT", onInterrupt);
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  if (parentSignal?.aborted) onParentAbort();

  return {
    signal: controller.signal,
    interrupt,
    assertHealthy(): void {
      if (failure) throw failure;
      if (cleaned) throw new Error("Migration lifecycle is already closed; further import work is forbidden.");
    },
    /** Attach immediately after checkout; keep the handler through release/end. */
    watchClient(client: ErrorEmitter): void {
      if (cleaned) throw new Error("Cannot watch a client after migration lifecycle cleanup.");
      if (clients.has(client)) return;
      clients.add(client);
      client.on("error", onClientError);
    },
    /** Call ONLY after all watched clients and the pool have been destroyed/ended. */
    cleanupAfterConnectionsClosed(): void {
      if (cleaned) return;
      cleaned = true;
      pool.off("error", onPoolError);
      for (const client of clients) client.off("error", onClientError);
      clients.clear();
      signalTarget.off("SIGTERM", onTerminate);
      signalTarget.off("SIGINT", onInterrupt);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

export type MigrationLifecycle = ReturnType<typeof createMigrationLifecycle>;

export type MigrationDatabase = {
  query: pg.PoolClient["query"];
  connect(): Promise<pg.PoolClient>;
};

/**
 * Every import query uses the physical session that owns its advisory lock.
 * Losing that session cannot leave a second connection committing unfenced work.
 * Existing sequential transaction helpers may lease it, but never release it to
 * the real pool. Only the run owner releases/destroys the physical connection.
 */
export function lockedMigrationDatabase(client: pg.PoolClient, lifecycle: Pick<MigrationLifecycle, "assertHealthy">): MigrationDatabase {
  let leased = false;
  const query = ((...args: unknown[]) => {
    const first = args[0];
    const text = typeof first === "string" ? first : first && typeof first === "object" && "text" in first ? first.text : undefined;
    // Permit teardown only, never a multi-statement string disguised as cleanup.
    if (typeof text !== "string" || !/^\s*ROLLBACK\s*;?\s*$/i.test(text)) lifecycle.assertHealthy();
    return Reflect.apply(client.query, client, args);
  }) as pg.PoolClient["query"];
  const lease = Object.create(client) as pg.PoolClient;
  Object.defineProperties(lease, {
    query: { value: query },
    release: { value: () => { leased = false; } },
    on: { value: client.on.bind(client) },
    off: { value: client.off.bind(client) },
  });
  return {
    query,
    async connect() {
      lifecycle.assertHealthy();
      if (leased) throw new Error("Concurrent migration database leases are forbidden; import transactions must remain sequential.");
      leased = true;
      return lease;
    },
  };
}

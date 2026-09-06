import type pg from "pg";

export function postgresMigrationConnectionOptions(environment?: NodeJS.ProcessEnv): pg.PoolConfig;
export function postgresMigrationLockTimeout(environment?: NodeJS.ProcessEnv): number;
export function safePostgresInitializationError(error: unknown, environment?: NodeJS.ProcessEnv): string;
export function applyPostgresMigrations(options?: {
  environment?: NodeJS.ProcessEnv;
  cwd?: string;
  migrationsDirectory?: string;
  createPool?: (options: pg.PoolConfig) => pg.Pool;
  log?: (message: string) => void;
}): Promise<{ applied: number; skipped: number }>;

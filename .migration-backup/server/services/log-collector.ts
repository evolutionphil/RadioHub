import { uploadToS3 } from "./s3-storage";

const FLUSH_INTERVAL_MS = 15 * 60 * 1000;
const MAX_BUFFER_SIZE = 300;
const MAX_LINE_LENGTH = 500;
const LOG_PREFIX = "logs";

let logBuffer: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let isInitialized = false;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

function getLogKey(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const time = now.toISOString().split("T")[1].replace(/:/g, "-").split(".")[0];
  const pid = process.pid;
  return `${LOG_PREFIX}/${date}/${time}-${pid}.log`;
}

function formatLogLine(level: string, args: any[]): string {
  const ts = new Date().toISOString();
  const msg = args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        const s = JSON.stringify(a);
        return s.length > MAX_LINE_LENGTH ? s.slice(0, MAX_LINE_LENGTH) + "..." : s;
      } catch {
        return String(a);
      }
    })
    .join(" ");
  const line = `[${ts}] [${level}] ${msg}`;
  return line.length > 1000 ? line.slice(0, 1000) + "..." : line;
}

// Half-open circuit breaker: after MAX_CONSECUTIVE_FAILURES the collector
// stops accepting logs, but every PROBE_RECOVERY_MS we attempt one "probe"
// flush so transient S3 outages don't permanently lose logs until restart.
const PROBE_RECOVERY_MS = 5 * 60_000;
let lastFailureAt = 0;

async function flushToS3(): Promise<void> {
  // Circuit-breaker logic must run BEFORE the empty-buffer check, otherwise
  // the probe never executes (the buffer stays empty during open-circuit
  // because interceptConsole drops new logs in that state).
  const breakerOpen = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
  if (breakerOpen) {
    if (Date.now() - lastFailureAt < PROBE_RECOVERY_MS) {
      // Still in cooldown — drop anything that slipped into the buffer.
      logBuffer.length = 0;
      return;
    }
    // Cooldown elapsed: synthesize a tiny probe payload so we always have
    // something to upload, even if no real logs were buffered while open.
    if (logBuffer.length === 0) {
      logBuffer.push(formatLogLine('INFO', ['[LogCollector] S3 recovery probe']));
    }
    originalConsole.warn('[LogCollector] Probing S3 recovery after circuit-breaker open');
  } else if (logBuffer.length === 0) {
    return;
  }

  const lines = logBuffer.splice(0);
  const content = lines.join("\n") + "\n";
  const key = getLogKey();

  try {
    await uploadToS3(key, Buffer.from(content, "utf-8"), "text/plain; charset=utf-8");
    if (consecutiveFailures > 0) {
      originalConsole.log('[LogCollector] S3 recovered — circuit breaker closed');
    }
    consecutiveFailures = 0;
    lastFailureAt = 0;
  } catch (err: any) {
    consecutiveFailures++;
    lastFailureAt = Date.now();
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      originalConsole.error(`[LogCollector] S3 flush failed ${consecutiveFailures}x — circuit breaker open, will probe again in ${PROBE_RECOVERY_MS / 1000}s`);
    }
  }
}

const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
};

const SKIP_PATTERNS = ['EVENT LOOP LAG:', 'LOAD SHEDDING:', 'EVENT LOOP BLOCKED:'];
let isFlushingToS3 = false;

function interceptConsole(): void {
  const wrap = (level: string, original: (...args: any[]) => void) => {
    return (...args: any[]) => {
      original(...args);
      const firstArg = typeof args[0] === 'string' ? args[0] : '';
      if (SKIP_PATTERNS.some(p => firstArg.includes(p))) return;
      // While the breaker is open, keep accepting up to a SMALL ring of recent
      // logs (50 lines) so when the probe succeeds the user gets some context
      // back and we don't lose data for the entire outage. Without this we'd
      // either lose everything or risk unbounded memory growth.
      const breakerOpen = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
      const cap = breakerOpen ? 50 : MAX_BUFFER_SIZE * 2;
      if (logBuffer.length < cap) {
        logBuffer.push(formatLogLine(level, args));
      } else if (breakerOpen) {
        // Ring behavior: drop oldest, push newest.
        logBuffer.shift();
        logBuffer.push(formatLogLine(level, args));
      }
      if (logBuffer.length >= MAX_BUFFER_SIZE && !isFlushingToS3) {
        isFlushingToS3 = true;
        flushToS3().catch(() => {}).finally(() => { isFlushingToS3 = false; });
      }
    };
  };

  console.log = wrap("LOG", originalConsole.log);
  console.error = wrap("ERROR", originalConsole.error);
  console.warn = wrap("WARN", originalConsole.warn);
  console.info = wrap("INFO", originalConsole.info);
}

export function initLogCollector(): void {
  if (isInitialized) return;
  if (!process.env.AWS_BUCKET_NAME || !process.env.AWS_ACCESS_KEY_ID) {
    originalConsole.warn("[LogCollector] S3 not configured — log collection disabled");
    return;
  }

  interceptConsole();

  flushTimer = setInterval(() => {
    flushToS3().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  // Don't block process exit on this background timer.
  if (typeof (flushTimer as any).unref === 'function') (flushTimer as any).unref();

  process.on("beforeExit", () => {
    if (flushTimer) { try { clearInterval(flushTimer); } catch {} flushTimer = null; }
    flushToS3().catch(() => {});
  });

  process.on("SIGTERM", () => {
    if (flushTimer) { try { clearInterval(flushTimer); } catch {} flushTimer = null; }
    flushToS3().catch(() => {});
  });

  isInitialized = true;
  console.log(`📋 LOG COLLECTOR: Initialized — flushing to S3 every ${FLUSH_INTERVAL_MS / 60000} min`);
}

export async function forceFlushLogs(): Promise<{ flushed: number }> {
  consecutiveFailures = 0;
  const count = logBuffer.length;
  await flushToS3();
  return { flushed: count };
}

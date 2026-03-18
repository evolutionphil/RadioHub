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

async function flushToS3(): Promise<void> {
  if (logBuffer.length === 0) return;
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    logBuffer.length = 0;
    return;
  }

  const lines = logBuffer.splice(0);
  const content = lines.join("\n") + "\n";
  const key = getLogKey();

  try {
    await uploadToS3(key, Buffer.from(content, "utf-8"), "text/plain; charset=utf-8");
    consecutiveFailures = 0;
  } catch (err: any) {
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      originalConsole.error(`[LogCollector] S3 flush failed ${consecutiveFailures}x — disabling until next successful flush`);
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
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return;
      const firstArg = typeof args[0] === 'string' ? args[0] : '';
      if (SKIP_PATTERNS.some(p => firstArg.includes(p))) return;
      if (logBuffer.length < MAX_BUFFER_SIZE * 2) {
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

  process.on("beforeExit", () => {
    flushToS3().catch(() => {});
  });

  process.on("SIGTERM", () => {
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

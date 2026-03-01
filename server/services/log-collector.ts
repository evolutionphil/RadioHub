import { uploadToS3 } from "./s3-storage";

const FLUSH_INTERVAL_MS = 15 * 60 * 1000;
const MAX_BUFFER_SIZE = 500;
const LOG_PREFIX = "logs";

let logBuffer: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let isInitialized = false;

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
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  return `[${ts}] [${level}] ${msg}`;
}

async function flushToS3(): Promise<void> {
  if (logBuffer.length === 0) return;

  const lines = logBuffer.splice(0);
  const content = lines.join("\n") + "\n";
  const key = getLogKey();

  try {
    await uploadToS3(key, Buffer.from(content, "utf-8"), "text/plain; charset=utf-8");
  } catch (err: any) {
    originalConsole.error(`[LogCollector] S3 flush failed: ${err.message}`);
    logBuffer.unshift(...lines);
    if (logBuffer.length > MAX_BUFFER_SIZE * 2) {
      logBuffer.splice(0, logBuffer.length - MAX_BUFFER_SIZE);
    }
  }
}

const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
};

function interceptConsole(): void {
  const wrap = (level: string, original: (...args: any[]) => void) => {
    return (...args: any[]) => {
      original(...args);
      logBuffer.push(formatLogLine(level, args));
      if (logBuffer.length >= MAX_BUFFER_SIZE) {
        flushToS3().catch(() => {});
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
    flushToS3()
      .catch(() => {})
      .finally(() => process.exit(0));
  });

  isInitialized = true;
  console.log(`📋 LOG COLLECTOR: Initialized — flushing to S3 every ${FLUSH_INTERVAL_MS / 60000} min`);
}

export async function forceFlushLogs(): Promise<{ flushed: number }> {
  const count = logBuffer.length;
  await flushToS3();
  return { flushed: count };
}

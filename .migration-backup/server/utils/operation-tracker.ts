const activeOperations = new Map<string, { name: string; startedAt: number; details?: string }>();
let opCounter = 0;
const MAX_TRACKED = 500;

export function startOperation(name: string, details?: string): string {
  const id = `op_${++opCounter}`;
  if (activeOperations.size >= MAX_TRACKED) {
    const oldest = activeOperations.keys().next().value;
    if (oldest) activeOperations.delete(oldest);
  }
  activeOperations.set(id, { name, startedAt: Date.now(), details });
  return id;
}

export function endOperation(id: string): void {
  activeOperations.delete(id);
}

export function getActiveOperations(): Array<{ id: string; name: string; runningMs: number; details?: string }> {
  const now = Date.now();
  const ops: Array<{ id: string; name: string; runningMs: number; details?: string }> = [];
  for (const [id, op] of activeOperations) {
    ops.push({ id, name: op.name, runningMs: now - op.startedAt, details: op.details });
  }
  return ops.sort((a, b) => b.runningMs - a.runningMs);
}

export function getActiveOperationsSummary(): string {
  const ops = getActiveOperations();
  if (ops.length === 0) return 'No active operations';
  return ops.map(o => `[${o.name} ${o.runningMs}ms${o.details ? ` (${o.details})` : ''}]`).join(', ');
}

export async function trackOperation<T>(name: string, fn: () => Promise<T>, details?: string): Promise<T> {
  const id = startOperation(name, details);
  try {
    return await fn();
  } finally {
    endOperation(id);
  }
}

let lastGcLog = 0;
const GC_LOG_COOLDOWN = 30_000;
let gcPauseTotal = 0;
let gcPauseCount = 0;
let gcPauseMax = 0;

export async function initGcTracking(): Promise<void> {
  const gcExposed = typeof (globalThis as any).gc === 'function';
  console.log(`🔧 Node flags: execArgv=${JSON.stringify(process.execArgv)}, gc exposed=${gcExposed}`);

  try {
    const perfHooks = await import(/* @vite-ignore */ 'node:perf_hooks');
    const obs = new perfHooks.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const durationMs = Math.round(entry.duration);
        gcPauseCount++;
        gcPauseTotal += durationMs;
        if (durationMs > gcPauseMax) gcPauseMax = durationMs;

        if (durationMs > 500) {
          const now = Date.now();
          if (now - lastGcLog > GC_LOG_COOLDOWN) {
            lastGcLog = now;
            const kind = (entry as any).detail?.kind || entry.name || 'unknown';
            console.error(`🗑️ GC PAUSE: ${durationMs}ms (type: ${kind}) | Active ops: ${getActiveOperationsSummary()}`);
          }
        }
      }
    });

    try {
      obs.observe({ type: 'gc', buffered: true });
      console.log('✅ GC tracking enabled (type: gc, buffered)');
    } catch {
      try {
        obs.observe({ entryTypes: ['gc'] });
        console.log('✅ GC tracking enabled (entryTypes: gc)');
      } catch (e2: any) {
        console.warn(`⚠️ GC PerformanceObserver not supported: ${e2.message}`);
      }
    }
  } catch (err: any) {
    console.warn(`⚠️ GC tracking init failed: ${err.message}`);
  }
}

export function getGcStats(): { count: number; totalMs: number; maxMs: number; avgMs: number } {
  return {
    count: gcPauseCount,
    totalMs: gcPauseTotal,
    maxMs: gcPauseMax,
    avgMs: gcPauseCount > 0 ? Math.round(gcPauseTotal / gcPauseCount) : 0
  };
}

export function resetGcStats(): void {
  gcPauseTotal = 0;
  gcPauseCount = 0;
  gcPauseMax = 0;
}

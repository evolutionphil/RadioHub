import { apiRequest } from './queryClient';

/** A single-flight, cancellable poll. Errors stop polling, never repeat a write. */
export function pollAdminOperation<T>(options: {
  url: string;
  intervalMs?: number;
  onData: (data: T) => void;
  isTerminal: (data: T) => boolean;
  onError: (error: Error) => void;
}): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      const response = await apiRequest('GET', options.url, { signal: controller.signal });
      const data: T = await response.json();
      if (controller.signal.aborted) return;
      options.onData(data);
      if (!options.isTerminal(data)) timer = setTimeout(tick, options.intervalMs ?? 2000);
    } catch (error) {
      if (!controller.signal.aborted) options.onError(error instanceof Error ? error : new Error('Unable to read job status'));
    }
  };
  timer = setTimeout(tick, options.intervalMs ?? 2000);
  return () => { controller.abort(); clearTimeout(timer); };
}

/** Native table names map to the API's retained, allow-listed operation names. */
export const OPERATIONAL_TABLES: Record<string, { target: string; clearable: boolean }> = {
  analytics_events: { target: 'analyticsevents', clearable: true },
  catalog_sync_runs: { target: 'synclogs', clearable: false },
  station_debug_logs: { target: 'stationdebuglogs', clearable: true },
  bulk_description_jobs: { target: 'bulkdescriptionjobs', clearable: true },
  app_logs: { target: 'applogs', clearable: true },
  visitor_sessions: { target: 'visitorsessions', clearable: false },
  listening_history: { target: 'userlisteninghistories', clearable: false },
};

export function isTerminalLogoJob(status?: string): boolean {
  return !!status && ['completed', 'failed', 'cancelled', 'lost'].includes(status);
}

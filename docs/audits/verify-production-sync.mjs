import { writeFile } from 'node:fs/promises';

// Read-only verification of one explicitly started production run. A queued
// request, stale previous success, or partial failed run must never count.
const runId = process.argv[2];
if (!/^[a-f0-9]{24}$/.test(runId || '')) throw new Error('Supply the exact sync run ID');
const started = Date.now();
const observations = [];
let previousProcessed = -1;
while (Date.now() - started < 45 * 60_000) {
  try {
    const response = await fetch('https://api.themegaradio.com/api/sync/logs?limit=5', {
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'RadioHub-Production-Sync-Verification/1.0' },
    });
    if (!response.ok) throw new Error(`Sync status HTTP ${response.status}`);
    const runs = await response.json();
    const run = runs.find(row => row._id === runId);
    if (!run) throw new Error('Requested run not present in recent persisted logs');
    const sample = {
      observedAt: new Date().toISOString(), id: run._id, status: run.status,
      startedAt: run.startedAt, completedAt: run.completedAt,
      processed: run.stationsProcessed, added: run.stationsAdded,
      updated: run.stationsUpdated, skipped: run.stationsSkipped,
      invalid: run.stationsInvalid, error: run.error || run.errorMessage || null,
    };
    observations.push(sample);
    if (sample.processed !== previousProcessed || sample.status !== 'running') {
      console.log(JSON.stringify(sample));
      previousProcessed = sample.processed;
    }
    if (sample.status !== 'running') {
      await writeFile(new URL(`./${new Date().toISOString().slice(0, 10)}-production-sync-result.json`, import.meta.url),
        JSON.stringify({ run: sample, observations }, null, 2) + '\n');
      if (sample.status !== 'completed' || !sample.completedAt || !(sample.processed > 0)) {
        throw new Error(`Run did not complete successfully: ${sample.status}`);
      }
      process.exit(0);
    }
  } catch (error) {
    console.error(JSON.stringify({ observedAt: new Date().toISOString(), error: error.message }));
    if (observations.at(-1)?.status && observations.at(-1).status !== 'running') process.exit(1);
  }
  await new Promise(resolve => setTimeout(resolve, 60_000));
}
throw new Error('Verification deadline reached; sync was NOT cancelled and completion is unconfirmed');

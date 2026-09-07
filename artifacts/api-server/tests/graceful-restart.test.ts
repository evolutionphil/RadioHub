import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createGracefulRestartController } from '../src/utils/graceful-restart';

test('external shutdown remains exit zero when no internal recovery was requested', () => {
  const restart = createGracefulRestartController(() => assert.fail('unexpected signal'), () => assert.fail('unexpected force exit'));
  assert.equal(restart.exitCode(), 0);
});
test('internal restart sets failure status before dispatching its graceful signal', () => {
  const exits: number[] = [];
  const restart = createGracefulRestartController(() => exits.push(restart.exitCode()), () => assert.fail('unexpected force exit'));
  restart.request();
  assert.deepEqual(exits, [1]);
  assert.equal(restart.exitCode(), 1);
});
test('concurrent watchdog/RSS restart requests signal only once and retain failure intent', () => {
  let signals = 0;
  const restart = createGracefulRestartController(() => { signals++; }, () => assert.fail('unexpected force exit'));
  restart.request(); restart.request();
  assert.equal(signals, 1);
  assert.equal(restart.exitCode(), 1);
});
test('signal dispatch failure falls back to a forced failure exit', () => {
  let forced = 0;
  const restart = createGracefulRestartController(() => { throw new Error('signal failed'); }, () => { forced++; });
  restart.request();
  assert.equal(forced, 1);
  assert.equal(restart.exitCode(), 1);
});
test('API recovery paths and optional scheduled restart use the same nonzero graceful intent', () => {
  const api = readFileSync(new URL('../src/index-api.ts', import.meta.url), 'utf8');
  const scheduled = readFileSync(new URL('../src/services/scheduled-cache-clear.ts', import.meta.url), 'utf8');
  assert.equal((api.match(/requestGracefulRestart\(\)/g) || []).length, 5, 'fatal, three watchdog paths and RSS');
  assert.ok(api.includes('const shutdownExitCode = requestedShutdownExitCode()'));
  assert.ok(api.includes('process.exit(shutdownExitCode)'));
  assert.ok(api.includes("process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))"));
  assert.doesNotMatch(api, /process\.kill\(process\.pid,\s*'SIGTERM'\)/);
  assert.ok(scheduled.includes('requestGracefulRestart()'));
  assert.doesNotMatch(scheduled, /process\.kill\(process\.pid,\s*'SIGTERM'\)/);
});

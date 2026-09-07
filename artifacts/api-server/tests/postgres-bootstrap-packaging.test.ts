import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

test('API and web images use the guarded launcher and both package schema assets', () => {
  for (const service of ['api', 'web']) {
    const docker = read(`Dockerfile.${service}`);
    assert.match(docker, /\/app\/lib\/db\/migrations \/deploy\/db-migrations/);
    assert.ok(docker.includes(`"scripts/start-postgres.mjs", "dist/index-${service}.mjs"`));
    assert.doesNotMatch(docker, /COPY.*(?:auto-bootstrap|legacy-migration\/dist)|CMD.*bootstrap\.mjs/);
    assert.match(docker, /http\.get\([^\n]+\/healthz/);
  }
  const manifest = JSON.parse(read('artifacts/api-server/package.json'));
  for (const file of ['apply-postgres-migrations', 'postgres-initialization', 'start-postgres', 'postgres-startup-server']) {
    assert.ok(manifest.files.includes(`scripts/${file}.mjs`), `${file} must survive production deployment`);
  }
  assert.match(manifest.scripts.start, /scripts\/start-postgres\.mjs dist\/index\.mjs/);
});

test('runtime rechecks initialization under the data-import lock before first authority write', () => {
  const source = read('artifacts/api-server/src/data/postgres-migration-safety.ts');
  const lock = source.indexOf("await client.query(\"SELECT pg_advisory_xact_lock(hashtext('radiohub-data-migration'))\")");
  const gate = source.indexOf('await assertPostgresInitializationReady(client, environment)');
  const write = source.indexOf('INSERT INTO database_write_authority');
  assert.ok(lock >= 0 && gate > lock && write > gate, 'cutover check must be inside its serialization lock');
});

test('one-time Railway job has a separate image, no HTTP check, and no successful-run restart loop', () => {
  const config = JSON.parse(read('railway.migration.json'));
  assert.equal(config.build.dockerfilePath, 'Dockerfile.migration');
  assert.equal(config.deploy.startCommand, 'node dist/bootstrap.mjs');
  assert.equal(config.deploy.healthcheckPath, null);
  assert.equal(config.deploy.restartPolicyType, 'ON_FAILURE');
  assert.ok(config.deploy.restartPolicyMaxRetries <= 10);
  const docker = read('Dockerfile.migration');
  assert.match(docker, /@workspace\/legacy-migration deploy --prod --legacy \/deploy/);
  assert.doesNotMatch(docker, /COPY.*\.env|ENV MONGODB_URI|ENV MIGRATION_.*=true/);
});

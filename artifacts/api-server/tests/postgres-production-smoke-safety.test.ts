import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  configuration,
  childEnvironment,
} from "../scripts/verify-postgres-production.mjs";

const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const args = ["--api-dir=" + fixtureDirectory, "--web-dir=" + fixtureDirectory];

test("production smoke refuses unapproved, remote and production-named databases", () => {
  assert.throws(
    () => configuration({}, args),
    /POSTGRES_PRODUCTION_SMOKE=true/,
  );
  assert.throws(
    () =>
      configuration(
        {
          POSTGRES_PRODUCTION_SMOKE: "true",
          PG_TEST_DATABASE_URL:
            "postgresql://test@remote.invalid/radiohub_test",
        },
        args,
      ),
    /loopback/,
  );
  assert.throws(
    () =>
      configuration(
        {
          POSTGRES_PRODUCTION_SMOKE: "true",
          PG_TEST_DATABASE_URL:
            "postgresql://test@127.0.0.1/radiohub_production",
        },
        args,
      ),
    /test\/smoke\/validation/,
  );
  assert.equal(
    configuration(
      {
        POSTGRES_PRODUCTION_SMOKE: "true",
        PG_TEST_DATABASE_URL:
          "postgresql://test@127.0.0.1/radiohub_validation_fixture",
      },
      args,
    ).databaseUrl,
    "postgresql://test@127.0.0.1/radiohub_validation_fixture",
  );
});

test("production smoke child environment drops inherited credentials, runtime switches and Node injection flags", () => {
  const environment = childEnvironment(
    "postgresql://test@127.0.0.1/radiohub_test",
    3101,
    3101,
    3102,
    {
      PATH: "safe-path",
      SystemRoot: "safe-system-root",
      OPENAI_API_KEY: "must-not-leak",
      STRIPE_SECRET_KEY: "must-not-leak",
      MONGODB_URI: "must-not-leak",
      DATABASE_URL: "must-not-leak",
      REDIS_URL: "must-not-leak",
      NODE_OPTIONS: "--inspect=0.0.0.0",
      NODE_ENV: "development",
      USER_STORE: "mongo",
      STATION_CDC_ENABLED: "true",
      AWS_ACCESS_KEY_ID: "must-not-leak",
      GOOGLE_APPLICATION_CREDENTIALS: "must-not-leak",
    },
  );
  assert.equal(environment.NODE_ENV, "production");
  assert.equal(environment.BACKGROUND_JOBS_ENABLED, "false");
  assert.equal(environment.PATH, "safe-path");
  assert.equal(environment.SystemRoot, "safe-system-root");
  assert.ok(environment.SESSION_SECRET.length >= 32);
  assert.doesNotMatch(
    JSON.stringify(environment),
    /must-not-leak|NODE_OPTIONS|MONGODB_URI|STATION_CDC_ENABLED|USER_STORE/,
  );
});

test("smoke preload rejects external TCP and fetch attempts before contacting the network", () => {
  const guard = new URL(
    "../scripts/production-smoke-network-guard.mjs",
    import.meta.url,
  ).href;
  for (const code of [
    "try { require('node:net').connect({host:'example.invalid',port:443}); process.exitCode=2; } catch(error) { if (!error.message.includes('SMOKE_BLOCKED_EXTERNAL')) throw error; }",
    "try { fetch('https://example.invalid'); process.exitCode=2; } catch(error) { if (!error.message.includes('SMOKE_BLOCKED_EXTERNAL')) throw error; }",
  ]) {
    const child = spawnSync(
      process.execPath,
      ["--import", guard, "--eval", code],
      {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
        env: childEnvironment(
          "postgresql://test@127.0.0.1/radiohub_test",
          3101,
          3101,
          3102,
        ),
      },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stderr, /SMOKE_BLOCKED_EXTERNAL/);
  }
});

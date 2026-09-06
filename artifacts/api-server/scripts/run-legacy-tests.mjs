import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Explicit compatibility lane: retained Mongo-model mocks / legacy source
// contracts remain visible and runnable. This does not exclude them from the
// default complete test suite, nor substitute for native PostgreSQL tests.
const apiRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tests = path.join(apiRoot, "tests");
const files = readdirSync(tests)
  .filter(
    (name) =>
      name.endsWith(".test.ts") &&
      !name.startsWith("postgres-") &&
      /@workspace\/legacy-migration\/mongo-schemas|from ['"]mongoose['"]|mongodb-memory-server/.test(
        readFileSync(path.join(tests, name), "utf8"),
      ),
  )
  .sort();
if (!files.length)
  throw new Error("Legacy regression test inventory is unexpectedly empty");
console.log(
  "Legacy Mongo compatibility tests (not a production-readiness gate):\n" +
    files.join("\n"),
);
const require = createRequire(path.join(apiRoot, "package.json"));
const child = spawn(
  process.execPath,
  [
    require.resolve("tsx/cli"),
    "--experimental-test-module-mocks",
    "--test",
    "--test-timeout=90000",
    ...files.map((name) => path.join(tests, name)),
  ],
  { cwd: apiRoot, stdio: "inherit", env: process.env },
);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

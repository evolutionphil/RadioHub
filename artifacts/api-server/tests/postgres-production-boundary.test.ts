import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { build } from "esbuild";
import {
  isLegacyDatabaseImport,
  assertProductionMetafile,
  productionDatabaseBoundaryPlugin,
  inspectProductionDependencyGraph,
} from "../scripts/production-database-boundary.mjs";

const apiRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repository = path.resolve(apiRoot, "../..");

test("cold installs explicitly deny the optional core-js hook without weakening build security", () => {
  const workspace = readFileSync(
    path.join(repository, "pnpm-workspace.yaml"),
    "utf8",
  );
  const allowBuilds = workspace.match(
    /^allowBuilds:\r?\n((?:[ \t]+[^\r\n]*\r?\n|\r?\n)*)/m,
  )?.[1];
  assert.ok(allowBuilds, "Dependency lifecycle decisions must remain explicit");
  assert.match(allowBuilds, /^  core-js: false[ \t]*\r?$/m);
  assert.doesNotMatch(workspace, /^strictDepBuilds:\s*false\b/m);
  assert.doesNotMatch(workspace, /^dangerouslyAllowAllBuilds:\s*true\b/m);
  assert.match(workspace, /^minimumReleaseAge: 1440[ \t]*\r?$/m);
});

test("production boundary rejects Mongo drivers, archived adapters and pnpm paths", () => {
  for (const forbidden of [
    "mongoose",
    "mongoose/lib/model.js",
    "mongodb",
    "mongodb/lib/bson.js",
    "mongodb-client-encryption",
    "connect-mongo",
    "@workspace/legacy-migration/mongo-schemas",
    "../db-mongo",
    "../data/legacy-document-codec.ts",
    "C:\\repo\\node_modules\\.pnpm\\mongoose@9.6.1\\node_modules\\mongoose\\lib\\index.js",
  ]) {
    assert.equal(isLegacyDatabaseImport(forbidden), true, forbidden);
  }
  for (const allowed of [
    "pg",
    "@workspace/db-shared/schema",
    "../postgres-runtime",
    "../data/postgres-catalog-store.ts",
  ])
    assert.equal(isLegacyDatabaseImport(allowed), false, allowed);
});

test("production boundary validates external imports as well as bundled modules", () => {
  assert.throws(
    () =>
      assertProductionMetafile({
        inputs: { "src/index.ts": { imports: [] } },
        outputs: {
          "dist/index.mjs": { imports: [{ path: "mongoose", external: true }] },
        },
      }),
    /forbidden/,
  );
  assert.throws(
    () =>
      assertProductionMetafile({
        inputs: { "node_modules/mongodb/lib/index.js": { imports: [] } },
        outputs: {},
      }),
    /forbidden/,
  );
  assert.deepEqual(
    assertProductionMetafile({
      inputs: { "src/index.ts": { imports: [] } },
      outputs: {},
    }),
    { inputFiles: 1, mongoDependencies: 0 },
  );
});

test("esbuild fails closed on a Mongo import before producing a bundle", async () => {
  await assert.rejects(
    build({
      stdin: {
        contents: 'import x from "mongoose"; console.log(x);',
        resolveDir: apiRoot,
      },
      bundle: true,
      write: false,
      platform: "node",
      logLevel: "silent",
      plugins: [productionDatabaseBoundaryPlugin()],
    }),
    /forbidden in production/,
  );
});

test("API and web installed production manifest graphs have no Mongo dependencies", () => {
  const report = inspectProductionDependencyGraph([
    path.join(apiRoot, "package.json"),
    path.join(repository, "artifacts/megaradio/package.json"),
  ]);
  assert.equal(report.mongoDependencies, 0);
  assert.ok(report.packageCount > 100);
  assert.ok(report.packages.some((name: string) => name.startsWith("pg@")));
  assert.ok(
    !report.packages.some((name: string) => name.includes("legacy-migration")),
  );
});

test("API manifest has no direct Mongo dependency even in development", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(apiRoot, "package.json"), "utf8"),
  );
  for (const group of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const forbidden = Object.keys(manifest[group] || {}).filter((name) =>
      /^(?:mongoose|mongodb(?:-|$)|connect-mongo$|bson$)/.test(name),
    );
    assert.deepEqual(
      forbidden,
      [],
      group + " must keep Mongo tooling in the offline package",
    );
  }
});

test("all production sources and operational CLIs are free of Mongo imports", () => {
  const violations: string[] = [];
  function walk(directory: string) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, item.name);
      if (item.isDirectory()) {
        walk(filename);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(item.name)) continue;
      const source = ts.createSourceFile(
        filename,
        readFileSync(filename, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node: ts.Node) {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          isLegacyDatabaseImport(node.moduleSpecifier.text)
        )
          violations.push(filename + ": " + node.moduleSpecifier.text);
        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              node.expression.text === "require"))
        ) {
          const argument = node.arguments[0];
          if (
            argument &&
            ts.isStringLiteral(argument) &&
            isLegacyDatabaseImport(argument.text)
          )
            violations.push(filename + ": " + argument.text);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  walk(path.join(apiRoot, "src"));
  walk(path.join(repository, "artifacts/megaradio/src"));
  walk(path.join(repository, "lib/db-shared/src"));
  assert.deepEqual(violations, []);
});

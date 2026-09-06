import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";
import { isLegacyDatabaseImport } from "../scripts/production-database-boundary.mjs";

const apiRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repository = path.resolve(apiRoot, "../..");

/** Inspect syntax, not Mongo-name strings used by the boundary verifiers. */
function violations(text: string, filename = "fixture.ts"): string[] {
  const source = ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const bad: string[] = [];
  const processCalls = new Set([
    "spawn",
    "spawnSync",
    "exec",
    "execSync",
    "execFile",
    "execFileSync",
  ]);
  const bindings = new Map<string, ts.Expression>();
  const firstPass = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    )
      bindings.set(node.name.text, node.initializer);
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /^(node:)?child_process$/.test(node.moduleSpecifier.text)
    ) {
      const imported = node.importClause?.namedBindings;
      if (imported && ts.isNamedImports(imported))
        for (const entry of imported.elements) {
          if (processCalls.has(entry.propertyName?.text || entry.name.text))
            processCalls.add(entry.name.text);
        }
    }
    ts.forEachChild(node, firstPass);
  };
  firstPass(source);
  function hasMongoShell(node: ts.Node, seen = new Set<string>()): boolean {
    if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      /\bmongosh(?:\.exe)?\b/i.test(node.text)
    )
      return true;
    if (
      ts.isIdentifier(node) &&
      bindings.has(node.text) &&
      !seen.has(node.text)
    ) {
      seen.add(node.text);
      if (hasMongoShell(bindings.get(node.text)!, seen)) return true;
    }
    return !!ts.forEachChild(
      node,
      (child) => hasMongoShell(child, new Set(seen)) || undefined,
    );
  }
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      isLegacyDatabaseImport(node.moduleSpecifier.text)
    )
      bad.push("legacy import: " + node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : "";
      const isImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        name === "require" ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "require" &&
          name === "resolve");
      const module = node.arguments[0];
      if (
        isImport &&
        module &&
        ts.isStringLiteralLike(module) &&
        isLegacyDatabaseImport(module.text)
      )
        bad.push("legacy import: " + module.text);
      if (
        processCalls.has(name) &&
        node.arguments.some((argument) => hasMongoShell(argument))
      )
        bad.push("mongosh process invocation");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bad;
}

test("operational script guard rejects Mongo imports and direct/aliased shell execution", () => {
  for (const source of [
    `import mongoose from 'mongoose';`,
    `export {MongoClient} from 'mongodb';`,
    `const driver=await import('mongodb');`,
    "const driver=require(`mongoose`);",
    `require.resolve('mongoose');`,
    `spawn('mongosh',['script.js']);`,
    'exec(`mongosh "${process.env.MONGODB_URI}" script.js`);',
    `import {execFile as run} from 'node:child_process'; const command='mongosh.exe'; run(command,['script.js']);`,
    `childProcess.spawn('sh',['-c','mongosh "$MONGODB_URI" script.js']);`,
  ])
    assert.ok(violations(source).length, source);
});

test("operational script guard permits verifier literals and explicit offline migration wrappers", () => {
  assert.deepEqual(
    violations(
      `const forbidden=['mongoose','mongodb','mongosh']; assert.equal(forbidden.length,3);`,
    ),
    [],
  );
  assert.deepEqual(
    violations(
      `spawn('pnpm',['--filter','@workspace/legacy-migration','verify']);`,
    ),
    [],
  );
  assert.deepEqual(
    violations(`import pg from 'pg'; const db=new pg.Pool();`),
    [],
  );
});

test("active API operator scripts contain no Mongo import or mongosh invocation", () => {
  const bad: string[] = [];
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      else if (/\.[cm]?[jt]s$/.test(entry.name))
        for (const issue of violations(
          readFileSync(filename, "utf8"),
          filename,
        ))
          bad.push(path.relative(apiRoot, filename) + ": " + issue);
    }
  }
  walk(path.join(apiRoot, "scripts"));
  walk(path.join(apiRoot, "src/scripts"));
  assert.deepEqual(bad, []);
  const manifest = JSON.parse(
    readFileSync(path.join(apiRoot, "package.json"), "utf8"),
  );
  const offlineWrappers = new Map([
    [
      "db:migrate:postgres",
      "pnpm --filter @workspace/legacy-migration migrate",
    ],
    ["db:verify:postgres", "pnpm --filter @workspace/legacy-migration verify"],
  ]);
  for (const [name, command] of Object.entries(manifest.scripts) as Array<
    [string, string]
  >) {
    assert.doesNotMatch(command, /\bmongosh(?:\.exe)?\b/i, name);
    if (command.includes("@workspace/legacy-migration"))
      assert.equal(
        command,
        offlineWrappers.get(name),
        "Only reviewed offline wrappers may use legacy migration tooling",
      );
  }
});

test("historical entitlement cleanup scripts exist only in the isolated migration archive", () => {
  for (const name of [
    "cleanup-test-user-2026.js",
    "cleanup-test-user-2026.mjs",
  ]) {
    assert.equal(existsSync(path.join(apiRoot, "scripts", name)), false);
    assert.equal(
      existsSync(path.join(repository, "lib/legacy-migration/archive", name)),
      true,
    );
  }
});

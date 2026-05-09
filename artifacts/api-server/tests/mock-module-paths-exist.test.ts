/**
 * Regression guard: every node:test module-mock call in the test suite must
 * reference a real on-disk file or a resolvable workspace package.
 *
 * Background: when `src/shared/mongo-schemas.ts` was relocated to the shared
 * `@workspace/db-shared/mongo-schemas` package, two test files
 * (`country-language-mappings-audit.test.ts` and
 * `translation-admin-merge-into-winner.test.ts`) silently broke because they
 * still pointed their mock at `../src/shared/mongo-schemas.ts` — a path that
 * no longer existed. Node's mocker just no-ops on a missing specifier, so
 * the guards those tests were supposed to enforce went dead for months
 * without anyone noticing.
 *
 * This test scans every test file under `tests/` for module-mock specifiers
 * and verifies that:
 *   - `new URL('../relative/path.ts', import.meta.url).href` specifiers
 *     resolve to an existing file on disk.
 *   - `@workspace/<pkg>/<entry>` specifiers resolve through the workspace's
 *     `package.json` exports map.
 *
 * Bare third-party specifiers (e.g. `@sendgrid/mail`) are skipped — they
 * aren't the bug class this guard targets.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, '../../..');

function listTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface MockCall {
  file: string;
  line: number;
  specifier: string;
  kind: 'url' | 'workspace' | 'bare';
}

const URL_RE =
  /mock\.module\(\s*new\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)\s*\.href/g;
const STRING_RE = /mock\.module\(\s*(['"])([^'"]+)\1/g;

function extractMockCalls(file: string): MockCall[] {
  const src = readFileSync(file, 'utf8');
  const calls: MockCall[] = [];
  const seen = new Set<number>();

  const lineOf = (idx: number) => src.slice(0, idx).split('\n').length;

  for (const m of src.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    seen.add(idx);
    calls.push({ file, line: lineOf(idx), specifier: m[2], kind: 'url' });
  }
  for (const m of src.matchAll(STRING_RE)) {
    const idx = m.index ?? 0;
    if (seen.has(idx)) continue;
    const spec = m[2];
    const kind: MockCall['kind'] = spec.startsWith('@workspace/')
      ? 'workspace'
      : 'bare';
    calls.push({ file, line: lineOf(idx), specifier: spec, kind });
  }

  return calls;
}

function resolveWorkspaceSpecifier(specifier: string): string | null {
  // e.g. "@workspace/db-shared/mongo-schemas" -> lib/db-shared
  const match = /^@workspace\/([^/]+)(?:\/(.+))?$/.exec(specifier);
  if (!match) return null;
  const pkgName = match[1];
  const subpath = match[2] ? `./${match[2]}` : '.';

  // Look in lib/, artifacts/, scripts/
  const candidates = [
    path.join(REPO_ROOT, 'lib', pkgName, 'package.json'),
    path.join(REPO_ROOT, 'artifacts', pkgName, 'package.json'),
    path.join(REPO_ROOT, 'scripts', 'package.json'),
  ];
  for (const pkgJsonPath of candidates) {
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    if (pkg.name !== `@workspace/${pkgName}`) continue;
    const exports = pkg.exports;
    if (!exports) return null;
    const entry = exports[subpath];
    if (!entry) return null;
    const target =
      typeof entry === 'string'
        ? entry
        : entry.import ?? entry.default ?? entry.types ?? null;
    if (!target) return null;
    return path.resolve(path.dirname(pkgJsonPath), target);
  }
  return null;
}

describe('mock.module specifiers point at real files', () => {
  const allCalls = listTestFiles(TESTS_DIR).flatMap(extractMockCalls);

  it('finds at least one mock.module call (sanity check)', () => {
    assert.ok(
      allCalls.length > 0,
      'expected to find mock.module calls in the test suite',
    );
  });

  for (const call of allCalls) {
    const rel = path.relative(REPO_ROOT, call.file);
    const label = `${rel}:${call.line} mock.module(${
      call.kind === 'url' ? `new URL('${call.specifier}')` : `'${call.specifier}'`
    })`;

    if (call.kind === 'bare') {
      // Skip third-party packages — out of scope for this guard.
      continue;
    }

    it(label, () => {
      let resolved: string | null;
      if (call.kind === 'url') {
        resolved = path.resolve(path.dirname(call.file), call.specifier);
      } else {
        resolved = resolveWorkspaceSpecifier(call.specifier);
        assert.ok(
          resolved,
          `could not resolve workspace specifier '${call.specifier}' through any package.json exports map`,
        );
      }

      assert.ok(
        existsSync(resolved!) && statSync(resolved!).isFile(),
        `mock.module specifier resolves to '${resolved}', which does not exist on disk. ` +
          `Update the test to reference the new location (or remove the dead mock).`,
      );
    });
  }
});

#!/usr/bin/env tsx
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');
const testsDir = resolve(repoRoot, 'tests');

function findTestFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...findTestFiles(full));
    } else if (st.isFile() && /\.test\.(ts|tsx|js|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = findTestFiles(testsDir).sort();

if (files.length === 0) {
  console.log('No test files found under tests/. Nothing to run.');
  process.exit(0);
}

console.log(`Running ${files.length} test file(s):\n`);

let failed = 0;
for (const file of files) {
  const rel = file.replace(repoRoot + '/', '');
  console.log(`\n▶ ${rel}`);
  const result = spawnSync('npx', ['tsx', file], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
  });
  if (result.status !== 0) {
    failed++;
    console.error(`✘ ${rel} exited with status ${result.status}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${files.length} test file(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${files.length} test file(s) passed.`);
process.exit(0);

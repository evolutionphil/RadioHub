import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outdir = path.join(root, 'lib/legacy-migration/dist');
await mkdir(outdir, { recursive: true });
// This is an OPERATOR artifact, never an API/web entrypoint or dependency.
// Splitting preserves the offline CLI's import.meta.url invocation guard when
// the bootstrap dynamically loads it after checking the durable PG state.
const result = await build({
  entryPoints: { bootstrap: path.join(root, 'lib/legacy-migration/src/auto-bootstrap-postgres.ts') },
  outdir,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  bundle: true,
  splitting: true,
  outExtension: { '.js': '.mjs' },
  external: ['pg', 'mongodb', 'pg-native'],
  metafile: true,
  logLevel: 'info',
});
await writeFile(path.join(outdir, 'bootstrap-build-report.json'), JSON.stringify(result.metafile, null, 2));

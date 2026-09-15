import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

test('production build contexts include the frontend manifest that owns the workspace patch', () => {
  const workspace = read('pnpm-workspace.yaml');
  const frontend = JSON.parse(read('artifacts/megaradio/package.json'));
  assert.match(workspace, /patchedDependencies:\s+['"]?@radix-ui\/react-select@/);
  assert.ok(frontend.devDependencies['@radix-ui/react-select']);

  for (const service of ['api', 'web', 'proxy']) {
    const docker = read(`Dockerfile.${service}`);
    const install = docker.search(/^RUN pnpm install --frozen-lockfile\b/m);
    assert.ok(install >= 0, `${service} must install from the frozen workspace lockfile`);
    const context = docker.slice(0, install);
    assert.match(context, /^COPY patches \.\/patches\s*$/m);
    assert.match(
      context,
      /^COPY artifacts\/megaradio\/package\.json\s+\.\/artifacts\/megaradio\/\s*$/m,
      `${service} legacy deploy needs the frontend manifest to resolve the Radix patch`,
    );
  }
});

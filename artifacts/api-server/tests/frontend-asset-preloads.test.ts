import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPublicRoutePreloads } from '../src/seo/frontend-asset-preloads';

const manifest = {
  'src/pages/radio-frontend.tsx': { file: 'assets/home-123.js', imports: ['shared'], dynamicImports: ['admin'], css: ['assets/carousel-123.css'] },
  'src/pages/about.tsx': { file: 'assets/about-123.js', imports: ['shared'] },
  'src/components/layout/radio-header.tsx': { file: 'assets/header-123.js', imports: ['shared'] },
  shared: { file: 'assets/shared-123.js', imports: ['cycle'] },
  cycle: { file: 'assets/cycle-123.js', imports: ['shared'] },
  admin: { file: 'assets/admin-123.js' },
};
test('preloads only selected public route and static imports, never dynamic admin code', () => {
  const hints = buildPublicRoutePreloads(manifest);
  assert.match(hints.home, /home-123\.js/);
  assert.match(hints.home, /header-123\.js/);
  assert.match(hints.home, /rel="preload" as="style" crossorigin href="\/assets\/carousel-123.css"/);
  assert.doesNotMatch(hints.home, /about-123|admin-123/);
  assert.doesNotMatch(hints.about, /home-123|carousel-123|admin-123/);
  assert.equal(hints.admin, undefined);
});
test('handles cycles and deduplicates already requested entry/shared assets', () => {
  const hints = buildPublicRoutePreloads(manifest, '<script src="/assets/shared-123.js"></script>').home;
  assert.doesNotMatch(hints, /shared-123/);
  assert.equal(hints.match(/cycle-123/g)?.length, 1);
});
test('empty/missing manifests need no route hint and unsafe asset paths are rejected', () => {
  assert.deepEqual(buildPublicRoutePreloads({}), {});
  for (const file of ['https://evil.example/x.js','../secret.js','assets/../secret.js','assets/"onload="x.js']) {
    const hints = buildPublicRoutePreloads({'src/pages/about.tsx':{file}});
    assert.equal(hints.about, '');
  }
});

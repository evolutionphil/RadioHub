type Chunk = { file?: string; imports?: string[]; dynamicImports?: string[]; css?: string[] };
export type FrontendManifest = Record<string, Chunk>;

// Only unambiguous public routes: never download admin/profile pages, or all
// dynamic imports. Region/genre variants keep their existing lazy selection.
const publicEntries: Record<string, string> = {
  home: 'src/pages/radio-frontend.tsx', station: 'src/pages/stations/[id].tsx',
  stations: 'src/pages/radios.tsx', about: 'src/pages/about.tsx',
  contact: 'src/pages/contact.tsx', terms: 'src/pages/terms-and-conditions.tsx',
  privacy: 'src/pages/privacy-policy.tsx', recommendations: 'src/pages/recommendations.tsx',
};

/** Start the current route's static dependency chain with the HTML, instead of
 * waiting for entry JS → React → lazy route → carousel CSS/JS. Preloading does
 * not execute modules or alter styles; Vite still owns their application. */
export function buildPublicRoutePreloads(manifest: FrontendManifest, existingTags = ''): Record<string, string> {
  const existing = new Set([...existingTags.matchAll(/(?:src|href)="\/([^"<>]+)"/g)].map(match => match[1]));
  const result: Record<string, string> = {};
  for (const [pageType, entry] of Object.entries(publicEntries)) {
    if (!manifest[entry]) continue;
    const visited = new Set<string>();
    const files = new Set<string>(existing);
    const hints: string[] = [];
    const hint = (file: string | undefined, type: 'script' | 'style') => {
      if (!file || files.has(file) || !/^assets\/[A-Za-z0-9_./-]+\.(?:js|css)$/.test(file) || file.includes('..')) return;
      files.add(file);
      hints.push(type === 'script'
        ? `<link rel="modulepreload" crossorigin href="/${file}">`
        : `<link rel="preload" as="style" crossorigin href="/${file}">`);
    };
    const visit = (key: string) => {
      if (visited.has(key) || visited.size >= 64) return;
      visited.add(key);
      const chunk = manifest[key];
      if (!chunk || typeof chunk !== 'object') return;
      hint(chunk.file, 'script');
      if (Array.isArray(chunk.css)) chunk.css.forEach(css => hint(css, 'style'));
      if (Array.isArray(chunk.imports)) chunk.imports.forEach(visit);
    };
    visit(entry);
    visit('src/components/layout/radio-header.tsx');
    result[pageType] = hints.join('\n    ');
  }
  return result;
}

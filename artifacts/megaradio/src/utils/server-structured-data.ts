export interface ServerStructuredData {
  global: Record<string, unknown>[];
  page: Record<string, unknown>[];
}

const selector = 'script[type="application/ld+json"][data-managed="seo-structured-data"]';

export function clearPageStructuredData() {
  document.querySelectorAll(`${selector}[data-schema-scope="page"]`).forEach(script => script.remove());
}

/** Apply only server-owned JSON-LD; preserve organization/site nodes and any third-party markup. */
export function applyServerStructuredData(data: ServerStructuredData) {
  if (!Array.isArray(data?.global) || !Array.isArray(data?.page)) return;
  const isSchema = (schema: unknown): schema is Record<string, unknown> =>
    !!schema && typeof schema === 'object' && !Array.isArray(schema);
  if (![...data.global, ...data.page].every(isSchema)) return;

  const append = (schema: Record<string, unknown>, scope: 'global' | 'page') => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.managed = 'seo-structured-data';
    script.dataset.schemaScope = scope;
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
  };

  // Reuse the same global nodes while updating localized descriptions/search
  // URLs on a language change. Do not delete unrelated global entities.
  for (const schema of data.global) {
    const existing = [...document.querySelectorAll(`${selector}[data-schema-scope="global"]`)].find(script => {
      try { return schema['@id'] && JSON.parse(script.textContent || '{}')['@id'] === schema['@id']; }
      catch { return false; }
    });
    if (existing) existing.textContent = JSON.stringify(schema);
    else append(schema, 'global');
  }
  clearPageStructuredData();
  data.page.forEach(schema => append(schema, 'page'));
}

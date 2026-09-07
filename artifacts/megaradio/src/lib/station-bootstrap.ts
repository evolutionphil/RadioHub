/** Placeholder data belongs to this observer only: never seed the shared
 * complete-station cache with a partial, locale-specific SSR payload. */
export function readStationBootstrap(identifier: string | undefined, language: string, doc: Document = document): any | undefined {
  if (!identifier) return undefined;
  const text = doc.getElementById('station-bootstrap')?.textContent;
  if (!text) return undefined;
  try {
    const payload = JSON.parse(text);
    const station = payload?.station;
    if (payload.language !== language || !station?._id || !station.name || !station.url
      || ![String(station._id), station.slug].includes(identifier)) return undefined;
    return station;
  } catch { return undefined; }
}

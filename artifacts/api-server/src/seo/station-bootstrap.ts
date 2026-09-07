// Observer-only bootstrap: selected public fields, not the archived source or
// all fourteen articles. The normal station API remains authoritative.
const publicFields = ['_id','stationuuid','name','slug','url','urlResolved','homepage','favicon','localImagePath',
  'country','countryCode','state','language','tags','codec','bitrate','votes','clickCount','clickTrend',
  'sslError','lastCheckOk','lastCheckTime','lastCheckOkTime','lastLocalCheckTime','clickTimestamp',
  'geoLat','geoLong','averageRating','totalRatings','hasExtendedInfo','iso31662'] as const;

export function renderStationBootstrap(station: any, language: string): string {
  if (!station?._id || !station.name || !station.slug || !station.url) return '';
  const data: Record<string, unknown> = {};
  for (const key of publicFields) {
    const value = station[key];
    if (['string','number','boolean'].includes(typeof value)) data[key] = value;
  }
  data._id = String(station._id);
  if (station.logoAssets && typeof station.logoAssets === 'object') {
    data.logoAssets = Object.fromEntries(['folder','status','webp48','webp96','webp256']
      .filter(key => typeof station.logoAssets[key] === 'string').map(key => [key, station.logoAssets[key]]));
  }
  const descriptions: Record<string, string> = {};
  for (const lang of new Set([language,'en'])) {
    const entry = station.descriptions?.[lang];
    const full = typeof entry === 'string' ? entry : entry?.full;
    if (typeof full === 'string') descriptions[lang] = full;
  }
  data.descriptions = descriptions;
  const json = JSON.stringify({language,station:data}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return `<script id="station-bootstrap" type="application/json">${json}</script>`;
}

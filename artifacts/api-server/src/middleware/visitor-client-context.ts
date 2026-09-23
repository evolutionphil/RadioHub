export const VISITOR_PLATFORMS = ['web', 'ios', 'android', 'tizen', 'webos', 'tvos', 'androidtv', 'desktop', 'unknown'] as const;
export type VisitorPlatform = typeof VISITOR_PLATFORMS[number];
export type VisitorContext = {
  countryCode: string | null;
  channel: 'web' | 'app' | 'tv' | 'unknown';
  platform: VisitorPlatform;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'tv' | 'unknown';
  os: string | null;
  browser: string | null;
  contextSource: 'client-header' | 'user-agent' | 'unknown';
};

// ISO 3166-1 alpha-2 only: Cloudflare's XX (unknown) / T1 (Tor), regions and
// arbitrary header contents must not become invented countries in reports.
const COUNTRIES = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));

export function normalizeVisitorCountry(value: unknown): string | null {
  if (typeof value !== 'string' || value.length !== 2) return null;
  const code = value.toUpperCase();
  return COUNTRIES.has(code) ? code : null;
}

/** Coarse, best-effort client classification. Headers/UA are client-reported,
 * never identity or authorization. No fingerprint, UA storage or GeoIP call.
 * The caller must establish country-header provenance before passing it here. */
export function classifyVisitorContext(input: {
  userAgent?: unknown;
  platformHeader?: unknown;
  countryCode?: unknown;
}): VisitorContext {
  const ua = typeof input.userAgent === 'string' ? input.userAgent.slice(0, 2048) : '';
  const countryCode = normalizeVisitorCountry(input.countryCode);
  const android = /Android|Dalvik/i.test(ua);
  const ios = /iPhone|iPad|iPod|\biOS\b/i.test(ua);
  const tablet = /iPad|Tablet|Kindle|Silk\//i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua) && !/Dalvik/i.test(ua));
  const tv = /SMART[ -]?TV|SmartTV|\bTV\b|AppleTV|tvOS|AndroidTV|GoogleTV|BRAVIA|\bAFT\w+\b/i.test(ua);
  const inferredTv: VisitorPlatform = tv && /Tizen/i.test(ua) ? 'tizen'
    : tv && /Web[0O]S/i.test(ua) ? 'webos'
    : /AppleTV|tvOS/i.test(ua) ? 'tvos'
    : tv && (android || /AndroidTV|GoogleTV|BRAVIA|\bAFT\w+\b/i.test(ua)) ? 'androidtv' : 'unknown';
  let os: string | null = inferredTv === 'tizen' ? 'Tizen' : inferredTv === 'webos' ? 'webOS'
    : inferredTv === 'tvos' ? 'tvOS' : inferredTv === 'androidtv' ? 'Android TV'
    : ios ? 'iOS' : android ? 'Android' : /Windows/i.test(ua) ? 'Windows'
    : /CrOS/i.test(ua) ? 'ChromeOS' : /Macintosh|Mac OS X|macOS/i.test(ua) ? 'macOS'
    : /Tizen/i.test(ua) ? 'Tizen' : /Linux/i.test(ua) ? 'Linux' : null;
  const browser: string | null = /Edg(?:e|A|iOS)?\//i.test(ua) ? 'Edge'
    : /OPR\/|Opera|OPiOS\//i.test(ua) ? 'Opera'
    : /SamsungBrowser\//i.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//i.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//i.test(ua) ? 'Chrome'
    : /Safari\//i.test(ua) ? 'Safari' : null;
  let deviceType: VisitorContext['deviceType'] = tv ? 'tv' : tablet ? 'tablet'
    : ios || android || /Mobile|Windows Phone/i.test(ua) ? 'mobile'
    : /Windows NT|Macintosh|Mac OS X|CrOS|X11|Linux x86_64/i.test(ua) ? 'desktop' : 'unknown';
  const declared = typeof input.platformHeader === 'string' && input.platformHeader.length <= 16
    ? input.platformHeader.toLowerCase() : '';
  if (VISITOR_PLATFORMS.includes(declared as VisitorPlatform) && declared !== 'unknown') {
    const platform = declared as VisitorPlatform;
    const isTv = ['tizen', 'webos', 'tvos', 'androidtv'].includes(platform);
    if (isTv) deviceType = 'tv';
    else if (platform === 'desktop') deviceType = 'desktop';
    else if (platform === 'ios' || platform === 'android') deviceType = tablet ? 'tablet' : 'mobile';
    const explicitOs: Partial<Record<VisitorPlatform, string>> = {
      ios: 'iOS', android: 'Android', tizen: 'Tizen', webos: 'webOS', tvos: 'tvOS', androidtv: 'Android TV',
    };
    os = explicitOs[platform] ?? os;
    return { countryCode, channel: isTv ? 'tv' : platform === 'web' ? 'web' : 'app',
      platform, deviceType, os, browser, contextSource: 'client-header' };
  }
  // Tizen/WebOS app WebViews can use exactly the same UA as the TV browser.
  // Report the TV platform, not a falsely verified installed app.
  if (tv) return { countryCode, channel: 'tv', platform: inferredTv, deviceType: 'tv', os, browser, contextSource: 'user-agent' };
  if (/Electron\//i.test(ua)) return { countryCode, channel: 'app', platform: 'desktop', deviceType: 'desktop', os, browser, contextSource: 'user-agent' };
  const native = /okhttp\/|Dalvik\/|CFNetwork\/|(?:;\s*wv\))/i.test(ua);
  if (native) return { countryCode, channel: 'app', platform: ios ? 'ios' : android ? 'android' : 'unknown',
    deviceType, os, browser, contextSource: 'user-agent' };
  if (browser) return { countryCode, channel: 'web', platform: 'web', deviceType, os, browser, contextSource: 'user-agent' };
  return { countryCode, channel: 'unknown', platform: 'unknown', deviceType, os, browser,
    contextSource: os || deviceType !== 'unknown' ? 'user-agent' : 'unknown' };
}

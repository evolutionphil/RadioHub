import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyVisitorContext as classify, normalizeVisitorCountry } from '../src/middleware/visitor-client-context';

const cases = [
  ['Windows browser', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0', 'web', 'web', 'desktop', 'Windows', 'Edge'],
  ['Mac browser', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', 'web', 'web', 'desktop', 'macOS', 'Safari'],
  ['iPhone browser', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 'web', 'web', 'mobile', 'iOS', 'Safari'],
  ['iPad browser', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1', 'web', 'web', 'tablet', 'iOS', 'Safari'],
  ['Samsung phone is not TV', 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36', 'web', 'web', 'mobile', 'Android', 'Samsung Internet'],
  ['Android tablet browser', 'Mozilla/5.0 (Linux; Android 14; SM-X610) AppleWebKit/537.36 Chrome/122.0 Safari/537.36', 'web', 'web', 'tablet', 'Android', 'Chrome'],
  ['Samsung Tizen TV', 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 Chrome/85.0.4183.93 TV Safari/537.36', 'tv', 'tizen', 'tv', 'Tizen', 'Samsung Internet'],
  ['LG Web0S TV', 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/120.0.6099.270 Safari/537.36 WebAppManager', 'tv', 'webos', 'tv', 'webOS', 'Chrome'],
  ['LG alternate spelling', 'Mozilla/5.0 (webOS; Linux/SmartTV) Chrome/94.0 Safari/537.36', 'tv', 'webos', 'tv', 'webOS', 'Chrome'],
  ['Android TV', 'Mozilla/5.0 (Linux; Android 10; BRAVIA 4K) Chrome/94.0 Safari/537.36', 'tv', 'androidtv', 'tv', 'Android TV', 'Chrome'],
  ['Apple TV', 'MegaRadio/2 (AppleTV; tvOS 18.0) CFNetwork/1492 Darwin/23', 'tv', 'tvos', 'tv', 'tvOS', null],
  ['unknown TV brand', 'Mozilla/5.0 (SMART-TV) Chrome/90.0 Safari/537.36', 'tv', 'unknown', 'tv', null, 'Chrome'],
  ['Electron desktop', 'Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Electron/30.0 Safari/537.36', 'app', 'desktop', 'desktop', 'Windows', 'Chrome'],
  ['Android native', 'Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8)', 'app', 'android', 'mobile', 'Android', null],
  ['Android WebView', 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Version/4.0 Chrome/128.0 Mobile Safari/537.36', 'app', 'android', 'mobile', 'Android', 'Chrome'],
  ['iOS native', 'MegaRadio/2 (iPhone; iOS 18.0) CFNetwork/1492 Darwin/23', 'app', 'ios', 'mobile', 'iOS', null],
  ['okhttp alone cannot prove Android', 'okhttp/4.12.0', 'app', 'unknown', 'unknown', null, null],
  ['Darwin alone cannot prove iOS', 'MegaRadio/2 CFNetwork/1492 Darwin/23', 'app', 'unknown', 'unknown', null, null],
  ['unrecognized client stays unknown', 'custom-client/1', 'unknown', 'unknown', 'unknown', null, null],
] as const;

for (const [name, userAgent, channel, platform, deviceType, os, browser] of cases) {
  test(name, () => {
    const result = classify({ userAgent });
    assert.deepEqual({ channel: result.channel, platform: result.platform, deviceType: result.deviceType, os: result.os, browser: result.browser },
      { channel, platform, deviceType, os, browser });
    assert.equal(result.countryCode, null);
    assert.ok(!JSON.stringify(result).includes(userAgent));
  });
}

test('explicit client platform resolves ambiguous native UAs and is labeled as reported', () => {
  for (const platform of ['ios', 'android', 'tizen', 'webos', 'tvos', 'androidtv', 'desktop', 'web']) {
    const result = classify({ userAgent: 'okhttp/4.12.0', platformHeader: platform, countryCode: 'DE' });
    assert.equal(result.platform, platform);
    assert.equal(result.contextSource, 'client-header');
    assert.equal(result.countryCode, 'DE');
    assert.equal(result.channel, platform === 'web' ? 'web' : ['ios', 'android', 'desktop'].includes(platform) ? 'app' : 'tv');
  }
  assert.equal(classify({ platformHeader: 'IOS' }).platform, 'ios');
  assert.equal(classify({ userAgent: 'iPad', platformHeader: 'ios' }).deviceType, 'tablet');
});

test('malformed, duplicate, oversized or unknown platform declarations fall back to bounded UA classification', () => {
  for (const platformHeader of [null, ['ios', 'android'], 'ios, android', 'unknown', ' tv ', 'ios\n', 'a'.repeat(100_000), '<script>']) {
    const result = classify({ platformHeader, userAgent: cases[0][1] });
    assert.equal(result.platform, 'web');
    assert.equal(result.contextSource, 'user-agent');
  }
  assert.equal(classify({ userAgent: 'x'.repeat(2048) + ' SMART-TV Tizen' }).platform, 'unknown');
  assert.equal(classify({ userAgent: ['bad', 'SMART-TV'] }).platform, 'unknown');
});

test('country data uses real ISO2 codes and unknown/special Cloudflare codes remain unknown', () => {
  for (const value of ['DE', 'AT', 'TR', 'US', 'AX', 'GB', 'RE', 'de']) assert.equal(normalizeVisitorCountry(value), value.toUpperCase());
  for (const value of ['XX', 'T1', 'ZZ', 'EU', 'UK', 'Germany', ' DE', ['DE'], null, '', 'D']) assert.equal(normalizeVisitorCountry(value), null);
});

test('Tizen mobile browser is not mislabeled Samsung Smart TV', () => {
  const result = classify({ userAgent: 'Mozilla/5.0 (Linux; Tizen 2.4; SAMSUNG SM-Z300H) SamsungBrowser/1.0 Mobile Safari/537.36' });
  assert.equal(result.channel, 'web');
  assert.equal(result.deviceType, 'mobile');
  assert.equal(result.platform, 'web');
});

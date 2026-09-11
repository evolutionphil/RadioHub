import assert from 'node:assert/strict';
import { it } from 'node:test';
import { validateSubscriptionPlanUpdate, validateTvVersionUpdate } from '../src/utils/admin-account-validation';

it('validates only supplied billing fields, including free prices and explicit clearing', () => {
  assert.deepEqual(validateSubscriptionPlanUpdate({ paddlePriceId: ' pri_abc123 ', amount: 0, currency: ' EUR ', isActive: false }).value,
    { paddlePriceId: 'pri_abc123', amount: 0, currency: 'eur', isActive: false });
  assert.deepEqual(validateSubscriptionPlanUpdate({ stripePriceId: '', paddlePriceId: '' }).value, { stripePriceId: '', paddlePriceId: '' });
  for (const body of [null, [], {}, { amount: -1 }, { amount: 1.1 }, { amount: Infinity }, { amount: '100' }, { currency: 'junk' }, { isActive: 'false' }, { paddlePriceId: 'price_123' }, { label: 12 }]) {
    assert.ok(validateSubscriptionPlanUpdate(body).error, JSON.stringify(body));
  }
});
it('validates bounded manifest maps without dropping other languages or supported store schemes', () => {
  const result = validateTvVersionUpdate({ latest: { ios: ' 5.4.3 ', desktop: '1.0.0-beta.2' }, minimum: { ios: '' },
    releaseNotes: { de: 'Deutsch', tr: 'Türkçe', ja: '日本語' }, storeUrl: { ios: 'itms-apps://apps.apple.com/app/id123', android: 'https://play.google.com/store/apps/details?id=app' } });
  assert.equal(result.error, undefined); assert.equal(result.value?.latest.ios, '5.4.3'); assert.equal(result.value?.releaseNotes.ja, '日本語');
  for (const body of [null, { latest: [] }, { latest: {}, minimum: null }, { latest: { ios: 123 } }, { latest: { ios: 'not a version' } }, { latest: {}, storeUrl: { web: 'javascript:alert(1)' } }, { latest: {}, storeUrl: { web: 'https://user:pass@example.invalid' } }, { latest: {}, releaseNotes: { constructor: 'unsafe' } }]) {
    assert.ok(validateTvVersionUpdate(body).error, JSON.stringify(body));
  }
});

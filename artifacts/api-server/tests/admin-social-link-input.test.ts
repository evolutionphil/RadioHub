import { test } from 'node:test';
import assert from 'node:assert/strict';
import { socialLinkInput } from '../src/admin-social-link-input';
test('social links accept supported HTTP(S) destinations and preserve partial writes', () => {
  assert.deepEqual(socialLinkInput({ platform: 'facebook', url: ' https://facebook.com/example ' }), { platform: 'facebook', url: 'https://facebook.com/example', position: 0, isActive: true });
  assert.deepEqual(socialLinkInput({ isActive: false }, true), { isActive: false });
  assert.deepEqual(socialLinkInput({ position: 2, _id: 'ignored' }, true), { position: 2 });
});
test('social links reject invalid fields before writing', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '/relative', 'https://user:password@example.com']) assert.throws(() => socialLinkInput({ platform: 'facebook', url }));
  for (const value of [null, [], {}, { platform: 'invalid' }, { position: -1 }, { position: 1.5 }, { isActive: 'false' }, { position: Infinity }]) assert.throws(() => socialLinkInput(value, true));
});

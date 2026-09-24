import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyVisitorReferral, sanitizeVisitorPagePath } from '@workspace/seo-shared/visitor-activity';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { observedVisitorAction } from '../src/middleware/visitor-activity';

test('page paths strip query/hash, normalize all14 locales, and are idempotent',()=>{
  for(const lang of ['en','es','fr','de','pt','it','ru','ar','zh','tr','ja','ko','hi','he']) {
    const input=`/${lang}/${URL_TRANSLATIONS[lang]?.station??'station'}/radio-berlin?token=secret#password`;
    const safe=sanitizeVisitorPagePath(input);
    assert.equal(safe,`/${lang}/station/radio-berlin`);assert.equal(sanitizeVisitorPagePath(safe),safe);
  }
  for(const [input,expected] of [['/de/regionen/europa/deutschland','/de/regions/:region/:country'],
    ['/en/regions/europe/germany/berlin/stations','/en/regions/:region/:country/:city/stations'],
    ['/de/profil/einstellungen','/de/profile/settings'],['/de/profil/nachrichten/secret-user','/de/profile/messages/:redacted'],
    ['/en/profile/messages/secret-user','/en/profile/messages/:redacted'],['/en/users/secret-id','/en/users/:redacted'],
    ['/messages/secret-thread','/messages/:redacted'],['/en','/en'],['/','/'],['/en/search?q=private','/en/search']]){
    assert.equal(sanitizeVisitorPagePath(input),expected);assert.equal(sanitizeVisitorPagePath(expected),expected);
  }
});
test('unknown/admin/auth/assets and unsafe encodings never preserve arbitrary private paths',()=>{
  for(const path of ['/api/users/secret','/admin/users','/de/admin','/en/login','/de/passwort-vergessen',
    '/en/profile/secret/unknown','/unknown/secret','https://example.com/en','//example.com/en','/en\\station\\secret',
    '/en/station/a%2fsecret','/en/station/a%252fsecret','/en/station/..','/en/%00/station','/en/station/a b',
    '/assets/main.js','/en/station/a?'.repeat(100)]) assert.equal(sanitizeVisitorPagePath(path),null,path);
});
test('referral classification emits enum only and respects domain boundaries',()=>{
  for(const [input,expected] of [['https://www.google.de/search?q=private','google'],['https://duckduckgo.com/?q=secret','search'],
    ['https://m.facebook.com/profile/secret','social'],['https://themegaradio.com/en/private','internal'],
    ['https://google.com.attacker.test/','other-referral'],['https://attacker-google.com/','other-referral'],
    ['https://themegaradio.com.attacker.test/','other-referral'],['https://unlisted.test/private','other-referral'],
    ['javascript:alert(1)','direct-or-unknown'],['','direct-or-unknown'],['garbage','direct-or-unknown']])
    assert.equal(classifyVisitorReferral(input),expected);
});
test('actions distinguish confirmed route success from data polling; never copy dynamic IDs or comments',()=>{
  assert.equal(observedVisitorAction('/api/station/my-station','GET',{}),null);
  assert.deepEqual(observedVisitorAction('/api/recently-played','POST',{stationId:'station-id'}),{path:'/api/recently-played',action:'play-request'});
  assert.equal(observedVisitorAction('/api/recently-played','POST',{stationId:'secret?query'}),null);
  assert.deepEqual(observedVisitorAction('/api/stations/123/click','POST',{}),{path:'/api/stations/:station/click',action:'play-request'});
  assert.deepEqual(observedVisitorAction('/api/user-engagement/stations/123/rate','POST',{review:'private'}),{path:'/api/stations/:station/rate',action:'rating-submit'});
  assert.deepEqual(observedVisitorAction('/api/user-engagement/stations/123/favorite','POST',{action:'remove',token:'secret'}),{path:'/api/user-engagement/stations/:station/favorite',action:'favorite-remove'});
  assert.equal(observedVisitorAction('/api/user-engagement/stations/123/favorite','POST',{action:'secret'}),null);
});

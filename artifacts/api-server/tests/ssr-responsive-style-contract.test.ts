import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {CRITICAL_TRANSLATION_KEYS} from '@workspace/seo-shared/critical-translation-keys';

test('production SSR cannot override responsive hero/container geometry after React mounts', () => {
 const web=readFileSync(new URL('../src/index-web.ts',import.meta.url),'utf8');
 const styles=[...web.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
 assert.doesNotMatch(styles,/\.hero-container\s*\{|\.container\s*\{/);
 assert.match(styles,/body\s*\{\s*font-family: 'Ubuntu', system-ui, sans-serif/);
 const css=readFileSync(new URL('../../megaradio/src/index.css',import.meta.url),'utf8');
 assert.match(css,/\.hero-container\s*\{[^}]*h-\[255px\][^}]*md:h-\[380px\][^}]*lg:h-\[447px\]/);
});
test('the station LCP paragraph receives its inline read-more label in the initial locale', () => {
 for(const key of ['general_more','station_about_station','station_logo_alt'])assert.ok(CRITICAL_TRANSLATION_KEYS.includes(key));
});

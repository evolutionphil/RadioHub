import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {renderTranslationBootstrap} from '../src/seo/translation-bootstrap';
test('production SSR sends current-language hero/header strings without the full dictionary or executable content',()=>{
 const html=renderTranslationBootstrap('de',{hero_worlds_best_radio:'Deutsches Radio',nav_add_your_station:'Sender hinzufügen',
 hero_search_placeholder:'</script><script>bad</script>',not_critical:'excluded'});
 assert.equal((html.match(/<script/g)||[]).length,1);assert.ok(!html.includes('excluded'));
 const context={window:{}} as any;vm.runInNewContext(html.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,''),context);
 assert.equal(context.window.__INITIAL_LANGUAGE__,'de');
 assert.equal(context.window.__INITIAL_TRANSLATIONS__.hero_worlds_best_radio,'Deutsches Radio');
 assert.equal(context.window.__INITIAL_TRANSLATIONS__.hero_search_placeholder,'</script><script>bad</script>');
 assert.equal(context.window.__PRELOADED__,true);
});

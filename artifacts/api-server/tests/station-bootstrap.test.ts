import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderStationBootstrap} from '../src/seo/station-bootstrap';
test('station bootstrap exposes only public initial content and the current/fallback articles',()=>{
 const html=renderStationBootstrap({_id:'one',name:'One',slug:'one',url:'https://radio.example/live',
   source:{secret:'never'},privateNotes:'never',descriptions:{de:{full:'Deutsch </script><script>bad'},en:'English',tr:'Türkçe'},
   logoAssets:{folder:'one',status:'completed',webp256:'https://s3.example/one.webp',privateKey:'never'}},'de');
 assert.ok(!html.includes('never')); assert.ok(!html.includes('Türkçe'));
 assert.equal((html.match(/<script/g)||[]).length,1);
 const payload=JSON.parse(html.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,''));
 assert.equal(payload.station.descriptions.de,'Deutsch </script><script>bad');
 assert.deepEqual(Object.keys(payload.station.descriptions),['de','en']);
 assert.equal(payload.station.logoAssets.webp256,'https://s3.example/one.webp');
});
test('missing or unplayable station data cannot masquerade as a complete bootstrap',()=>{
 assert.equal(renderStationBootstrap(null,'en'),'');
 assert.equal(renderStationBootstrap({_id:'one',name:'One',slug:'one'},'en'),'');
});

test('offline station bootstrap retains its rich public content and explicit false availability',()=>{
 const html=renderStationBootstrap({_id:'offline',name:'Offline FM',slug:'offline-fm',url:'https://radio.example/live',lastCheckOk:false,
   descriptions:{de:{full:'Bestehende Senderbeschreibung'},en:{full:'Existing station description'}}},'de');
 const payload=JSON.parse(html.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,''));
 assert.equal(payload.station.lastCheckOk,false);
 assert.equal(payload.station.descriptions.de,'Bestehende Senderbeschreibung');
 assert.equal(payload.station.url,'https://radio.example/live');
});

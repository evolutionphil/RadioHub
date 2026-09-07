import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoundedValueCache } from '../src/utils/bounded-value-cache';

test('byte and entry budgets evict least recently used values, not recently accessed ones', () => {
  const cache = new BoundedValueCache(10,8,3);
  cache.set('a','A',4,60); cache.set('b','B',4,60);
  assert.equal(cache.get('a'),'A');
  cache.set('c','C',4,60);
  assert.equal(cache.get('b'),undefined);
  assert.equal(cache.get('a'),'A');
  assert.equal(cache.stats().estimatedBytes,8);
  const byEntries = new BoundedValueCache(100,100,1);
  byEntries.set('a',1,1,60); byEntries.set('b',2,1,60);
  assert.equal(byEntries.get('a'),undefined);
});
test('replacement, expiry, pattern invalidation and rejected payloads release byte accounting', () => {
  let now=1000;
  const cache = new BoundedValueCache(100,50,3,() => now);
  cache.set('x:a',1,20,10); cache.set('x:a',2,30,20);
  assert.equal(cache.stats().estimatedBytes,30);
  now+=11000;
  assert.equal(cache.get('x:a'),2);
  assert.equal(cache.getTtl('x:a'),21000);
  assert.equal(cache.set('x:a',3,51,10),false);
  assert.equal(cache.get('x:a'),undefined);
  cache.set('x:b',4,10,1); now+=1000;
  assert.equal(cache.get('x:b'),undefined);
  cache.set('x:c',5,10,60); cache.set('other',6,10,60);
  cache.clearByPattern('x:');
  assert.equal(cache.stats().estimatedBytes,10);
  cache.delete('other'); cache.delete('missing');
  assert.equal(cache.stats().estimatedBytes,0);
  for (const size of [NaN,Infinity,-1,0]) assert.equal(cache.set('bad',{},size,60),false);
});

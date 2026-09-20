import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateJunkStation, getIndexableLanguagesForStation } from '../src/seo/junk-station-rules';

const station = (name: string) => ({ name, slug: 'cai-tiao-ce-shi-1', url: 'https://example.invalid/live', countryCode: 'CN' });

test('exact Chinese color-bar test names remain excluded despite a valid stream and indexed flag', () => {
  for (const name of ['彩条测试', '彩条测试1', '彩条测试123', ' \t彩条测试１２３\u3000']) {
    const row = { ...station(name), noIndex: false, lastCheckOk: true };
    assert.deepEqual(evaluateJunkStation(row), { isJunk: true, reason: 'test-feed:color-bar' }, name);
    assert.deepEqual(getIndexableLanguagesForStation(row, ['en', 'zh']), [], name);
  }
});

test('Chinese radio names and names containing the generic test word are not excluded', () => {
  for (const name of ['中国之声', '北京新闻广播（测试）', '测试广播电台', '彩条测试广播', '彩条测试1广播']) {
    const row = station(name);
    assert.deepEqual(evaluateJunkStation(row), { isJunk: false }, name);
    assert.ok(getIndexableLanguagesForStation(row, ['en', 'zh']).includes('zh'), name);
  }
});

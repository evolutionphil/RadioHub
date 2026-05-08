/**
 * Task #190 — unit coverage for the sitemap-diff IndexNow helpers.
 *
 * Pure-function tests for the diff + URL-builder logic so a regression in
 * the canonical URL shape (or a botched diff) trips this guard before the
 * nightly job ships duplicate or empty IndexNow submissions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffUrlSets,
  computeMainSitemapUrls,
} from '../src/services/sitemap-diff-indexnow';

test('diffUrlSets returns sorted additions only', () => {
  const previous = ['https://example.com/a', 'https://example.com/b'];
  const current = [
    'https://example.com/b',
    'https://example.com/c',
    'https://example.com/a',
    'https://example.com/d',
  ];
  const additions = diffUrlSets(previous, current);
  assert.deepEqual(additions, ['https://example.com/c', 'https://example.com/d']);
});

test('diffUrlSets returns empty array when nothing new', () => {
  const previous = ['x', 'y', 'z'];
  const current = ['y', 'x'];
  assert.deepEqual(diffUrlSets(previous, current), []);
});

test('computeMainSitemapUrls covers all static pages plus top-country pairs', () => {
  const translations = new Map<string, string>();
  const urls = computeMainSitemapUrls({
    language: 'en',
    topCountries: [
      { regionSlug: 'europe', countrySlug: 'germany' },
      { regionSlug: 'asia', countrySlug: 'japan' },
    ],
    translations,
    baseUrl: 'https://example.com',
  });

  // 16 static pages + 2 top-country region pages = 18.
  assert.equal(urls.length, 18);
  assert.ok(urls.includes('https://example.com/en'));
  assert.ok(urls.includes('https://example.com/en/regions/europe/germany'));
  assert.ok(urls.includes('https://example.com/en/regions/asia/japan'));
  assert.ok(urls.includes('https://example.com/en/faq'));

  // Sorted output for deterministic snapshots/diffs.
  const sorted = [...urls].sort();
  assert.deepEqual(urls, sorted);
});

test('computeMainSitemapUrls + diffUrlSets surfaces newly-added top-country pair', () => {
  const translations = new Map<string, string>();
  const previousTop = [{ regionSlug: 'europe', countrySlug: 'germany' }];
  const currentTop = [
    { regionSlug: 'europe', countrySlug: 'germany' },
    { regionSlug: 'europe', countrySlug: 'spain' },
  ];
  const previousUrls = computeMainSitemapUrls({
    language: 'en',
    topCountries: previousTop,
    translations,
    baseUrl: 'https://example.com',
  });
  const currentUrls = computeMainSitemapUrls({
    language: 'en',
    topCountries: currentTop,
    translations,
    baseUrl: 'https://example.com',
  });
  const additions = diffUrlSets(previousUrls, currentUrls);
  assert.deepEqual(additions, ['https://example.com/en/regions/europe/spain']);
});

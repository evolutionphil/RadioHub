import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRecommendationPool, MOOD_GENRES, recommendationPoolKey, recommendationSections, rotateRecommendations } from '../src/lib/recommendation-pool';

const pool = Array.from({ length: 100 }, (_, index) => ({ _id: `station-${index}`, votes: 1000 - index, isListVisible: true }));
afterEach(() => vi.unstubAllGlobals());
describe('For You visit rotation', () => {
  it('keeps ordering stable during a visit, rotates for the next visit and never mutates cached rows', () => {
    const original = [...pool];
    expect(rotateRecommendations(pool, 'visit-a')).toEqual(rotateRecommendations(pool, 'visit-a'));
    expect(rotateRecommendations(pool, 'visit-a').slice(0, 6)).not.toEqual(rotateRecommendations(pool, 'visit-b').slice(0, 6));
    expect(pool).toEqual(original);
  });
  it('excludes explicit offline stations, missing identities and duplicates', () => {
    expect(rotateRecommendations([{ _id: 'a' }, { _id: 'a' }, { _id: 'b', isListVisible: false }, {}], 'test')).toEqual([{ _id: 'a' }]);
  });
  it('keeps sections distinct and only uses preferred genres for taste sections', () => {
    const preferred = pool.slice(50, 80);
    const sections = recommendationSections(pool, preferred, 'visit-a', true);
    const ids = Object.values(sections).flat().map(station => station._id);
    expect(new Set(ids).size).toBe(24);
    expect([...sections.personalized, ...sections.genres].every(station => preferred.includes(station))).toBe(true);
    expect(sections.trending.every(station => pool.slice(0, 30).includes(station))).toBe(true);
    expect(recommendationSections(pool, [], 'visit-a', false).personalized).toEqual([]);
  });
  it('isolates country and genre query caches without visit seeds', () => {
    expect(recommendationPoolKey('Austria', ['Soft Rock', 'jazz', 'Jazz'])).toEqual(['/api/recommendations/pool', 'Austria', 'jazz,soft-rock']);
    expect(recommendationPoolKey('Austria')).not.toEqual(recommendationPoolKey('Germany'));
    expect(recommendationPoolKey('Global')).toEqual(recommendationPoolKey('all'));
    expect(MOOD_GENRES.focused).not.toContain('rock');
  });
  it('sends country/genres and abort signal, filtering explicit offline rows', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stations: [...pool, { _id: 'offline', isListVisible: false }] }) });
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    expect(await fetchRecommendationPool('Austria', ['jazz', 'rock'], controller.signal)).toHaveLength(100);
    expect(fetcher).toHaveBeenCalledWith('/api/recommendations/pool?country=Austria&genres=jazz%2Crock', { signal: controller.signal });
  });
  it('does not disguise service failures as an empty recommendation pool', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(fetchRecommendationPool('Austria')).rejects.toThrow('Failed to fetch recommendations');
  });
});

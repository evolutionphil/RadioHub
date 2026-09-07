import { describe, expect, it } from 'vitest';
import { generateRadioStationData } from '../src/utils/structured-data';
import { generateRadioStationSchema } from '@workspace/seo-shared/structured-data';

// Property domains checked against schema.org, 2026-09-07:
// RadioBroadcastService / category / isAccessibleForFree / additionalProperty /
// keywords / BroadcastFrequencySpecification / geo.
describe('radio service schema uses the applicable property domains', () => {
  it('shared generator uses category/areaServed and a Place for coordinates', () => {
    const schema = generateRadioStationSchema({
      name: 'Test Radio', slug: 'test', country: 'Germany', countryCode: 'DE',
      tags: 'news, AM 1030', bitrate: 128, codec: 'MP3', geoLat: '48.2', geoLong: '16.4',
    }, 'themegaradio.com', 'de', '/de/sender/test', 'Deutsche Beschreibung');
    expect(schema.category).toEqual(['news', 'AM 1030']);
    expect(schema.areaServed).toEqual({ '@type': 'Country', name: 'Germany' });
    expect(schema.broadcaster.geo).toBeUndefined();
    expect(schema.broadcaster.location.geo.latitude).toBe(48.2);
    expect(schema.broadcastFrequency.broadcastFrequencyValue).toEqual({
      '@type': 'QuantitativeValue', value: 1030, unitText: 'kHz',
    });
    for (const key of ['keywords', 'area', 'additionalProperty', 'isAccessibleForFree']) expect(schema).not.toHaveProperty(key);
    expect(schema.broadcastFrequency).not.toHaveProperty('frequencyUnit');
  });

  it('fallback client helper cannot fabricate stars from popularity counts', () => {
    const schema = generateRadioStationData({
      _id: 'test', name: 'Test Radio', tags: ['news'], votes: 100_000, clickCount: 500_000, country: 'Germany',
    }, 'https://themegaradio.com/en/station/test');
    expect(schema.category).toEqual(['news']);
    expect(schema.areaServed).toEqual({ '@type': 'Country', name: 'Germany' });
    for (const key of ['aggregateRating', 'keywords', 'area', 'additionalProperty', 'isAccessibleForFree']) expect(schema).not.toHaveProperty(key);
  });
});

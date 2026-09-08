import { describe, expect, it } from 'vitest';
import { getGenrePageLabels } from '../src/utils/genre-page-labels';

const languages = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];

describe('genre page labels', () => {
  it.each(languages)('%s has all nine same-language fallback labels', language => {
    const labels = getGenrePageLabels(language);
    expect(Object.keys(labels)).toHaveLength(9);
    for (const value of Object.values(labels)) expect(value.trim().length).toBeGreaterThan(0);
    // "Genres"/"stations" are legitimately shared by several languages; do
    // not classify these valid words as untranslated English.
    if (language !== 'en') {
      for (const key of ['loading', 'error', 'emptyGenres', 'emptyStations', 'retry'] as const) {
        expect(labels[key]).not.toBe(getGenrePageLabels('en')[key]);
      }
    }
  });

  it('preserves current-locale custom copy for every existing key', () => {
    const labels = getGenrePageLabels('tr', {
      genres: 'Müzik türleri', stations: 'radyolar', loading: 'Liste yükleniyor',
      error: 'Listeye ulaşılamadı', no_genres_found: 'Aramanızla eşleşen tür yok',
      no_stations_found: 'Aramanızla eşleşen radyo yok', try_again: 'Yeniden dene',
      previous: 'Geri', next: 'İleri',
    });
    expect(labels).toEqual({
      genres: 'Müzik türleri', stations: 'radyolar', loading: 'Liste yükleniyor',
      error: 'Listeye ulaşılamadı', emptyGenres: 'Aramanızla eşleşen tür yok',
      emptyStations: 'Aramanızla eşleşen radyo yok', retry: 'Yeniden dene',
      previous: 'Geri', next: 'İleri',
    });
  });

  it('keeps missing non-English keys localized without overriding valid admin copy', () => {
    const labels = getGenrePageLabels('de', { genres: 'Musikauswahl', error: 'Editorial custom error' });
    expect(labels).toEqual({ ...getGenrePageLabels('de'), genres: 'Musikauswahl', error: 'Editorial custom error' });
    expect(labels.emptyStations).toBe('Keine Sender gefunden.');
  });

  it.each(['', ' ', 'genres', ' genres ', 'Title', 'Subtitle', 'titel', 'subtitel', 'Homepage Title', ' homepage genres '])('rejects missing/key-echo or known corrupt marker %j', value => {
    expect(getGenrePageLabels('tr', { genres: value })).toEqual(getGenrePageLabels('tr'));
  });

  it.each([['de-AT', 'de'], ['PT_br', 'pt'], [' ZH-Hans-CN ', 'zh'], ['TR', 'tr']])('normalizes language %s', (language, expected) => {
    expect(getGenrePageLabels(language)).toEqual(getGenrePageLabels(expected));
  });

  it('falls back to English for unsupported/empty languages but retains current custom labels', () => {
    expect(getGenrePageLabels('')).toEqual(getGenrePageLabels('en'));
    expect(getGenrePageLabels('unsupported')).toEqual(getGenrePageLabels('en'));
    expect(getGenrePageLabels('unsupported', { genres: 'Custom genres' }).genres).toBe('Custom genres');
  });
});

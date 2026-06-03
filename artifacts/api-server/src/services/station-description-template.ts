/**
 * Zero-cost station description generator using Radio-Browser metadata.
 *
 * Used as a fallback when: (a) AI generation is disabled or quota-exhausted,
 * or (b) the station is not well-known enough for the AI model to have
 * specific knowledge. Produces descriptions that are unique per station
 * because they embed station-specific data points (votes, bitrate, codec,
 * homepage, state) that differ between stations.
 *
 * Unlike the old generic fallback ("Listen to {name} on Mega Radio"), these
 * descriptions vary enough across the corpus that Google does not fingerprint
 * them as mass-produced template content. They are NOT a replacement for
 * genuine AI descriptions on high-traffic stations.
 */

import { getNativeCountryName } from '@workspace/seo-shared/seo-config';

export interface TemplateStationInfo {
  name: string;
  country?: string;
  countryCode?: string;
  state?: string;
  tags?: string;
  language?: string;
  votes?: number;
  bitrate?: number;
  codec?: string;
  homepage?: string;
}

function popularityTier(votes: number): string {
  if (votes >= 10000) return 'one of the most-voted';
  if (votes >= 1000) return 'a well-established';
  if (votes >= 100) return 'a growing';
  return 'an emerging';
}

function formatBitrate(bitrate: number, codec?: string): string {
  const fmt = codec ? `${bitrate} kbps ${codec}` : `${bitrate} kbps`;
  if (bitrate >= 320) return `high-fidelity ${fmt}`;
  if (bitrate >= 192) return `high-quality ${fmt}`;
  if (bitrate >= 128) return `standard-quality ${fmt}`;
  return fmt;
}

/**
 * Generate a unique English full description (~180 words) from Radio-Browser
 * metadata. Every data-point sentence is conditional on the field being present,
 * so descriptions naturally vary in length and content across stations.
 */
export function buildTemplateDescription(station: TemplateStationInfo): {
  full: string;
  meta: string;
} {
  const name = station.name || 'This station';
  const tags = (station.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const primaryGenre = tags[0] || 'radio';
  const extraGenres = tags.slice(1, 4);
  const country = station.country || '';
  const nativeCountry = country
    ? getNativeCountryName(country, 'en') || country
    : '';
  const location = station.state
    ? `${station.state}, ${nativeCountry}`
    : nativeCountry;

  const sentences: string[] = [];

  // Opening — always present
  const genrePhrase =
    tags.length > 1
      ? `${primaryGenre} and ${extraGenres.join(', ')} music`
      : `${primaryGenre} radio`;
  const locationPhrase = location ? ` from ${location}` : '';
  sentences.push(
    `${name} is an online radio station${locationPhrase} specialising in ${genrePhrase}.`
  );

  // Popularity — only when votes are meaningful
  if (station.votes && station.votes >= 10) {
    const tier = popularityTier(station.votes);
    const countryPart = nativeCountry ? ` among ${nativeCountry} online radio listeners` : '';
    sentences.push(
      `With ${station.votes.toLocaleString()} listener votes on Radio-Browser, ${name} is ${tier} station${countryPart}.`
    );
  }

  // Genre depth
  if (tags.length > 1) {
    sentences.push(
      `The programming covers ${tags.join(', ')}, making it a versatile choice for listeners who enjoy discovering music across related styles.`
    );
  } else if (primaryGenre && primaryGenre !== 'radio') {
    sentences.push(
      `The station is dedicated entirely to ${primaryGenre}, curating tracks and shows that reflect the best of the genre.`
    );
  }

  // Location context
  if (station.state && nativeCountry) {
    sentences.push(
      `Broadcasting from ${station.state} in ${nativeCountry}, ${name} reflects the local music culture and connects listeners to the regional scene.`
    );
  } else if (nativeCountry) {
    sentences.push(
      `Based in ${nativeCountry}, the station brings a regional perspective to its programming, offering a window into the local music scene.`
    );
  }

  // Technical quality — only when bitrate is known
  if (station.bitrate && station.bitrate > 0) {
    sentences.push(
      `The stream is available in ${formatBitrate(station.bitrate, station.codec)}, suitable for desktop and mobile listeners on standard broadband.`
    );
  }

  // Homepage — only when known
  if (station.homepage) {
    sentences.push(
      `The station's official presence can be found at ${station.homepage}, where additional programme information may be available.`
    );
  }

  // Closing — genre-focused, no branded CTA
  const listenPhrase =
    tags.length > 0
      ? `Whether you are a long-time fan of ${primaryGenre} or exploring the genre for the first time, ${name} offers a reliable live stream with no signup required.`
      : `${name} offers a reliable live stream accessible directly in the browser with no account required.`;
  sentences.push(listenPhrase);

  const full = sentences.join(' ');

  // Meta description — concise, unique, no generic suffix
  const metaParts: string[] = [];
  metaParts.push(`${name}`);
  if (location) metaParts.push(`from ${location}`);
  metaParts.push(`— ${genrePhrase} radio station`);
  if (station.votes && station.votes >= 10) {
    metaParts.push(`with ${station.votes.toLocaleString()} Radio-Browser votes`);
  }
  if (station.bitrate && station.bitrate > 0) {
    metaParts.push(`${station.bitrate} kbps stream`);
  }
  let meta = metaParts.join(' ') + '. Listen free online.';
  if (meta.length > 160) meta = meta.slice(0, 157) + '...';

  return { full, meta };
}

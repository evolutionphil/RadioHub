/**
 * Genre slug whitelist — gates which `/genres/:slug` URLs MegaRadio publishes
 * to search engines.
 *
 * Background (task #104, Agent C investigation §3.2 + §4.1):
 * The historical genre URL set was built from raw station `tags`, which
 * produced ~8,824 slugs per language — ~80% of them were FM frequencies
 * (`/genres/100-1-fm`), city names (`/genres/berkshire`), station/brand names
 * (`/genres/tagesschau24`) or random tag noise (`/genres/0`, `/genres/00`).
 * A 25-URL random sample showed 19/25 (76%) were thin (<600 words, 0 <h2>,
 * no popular-stations grid) — Google was rightly classifying the entire
 * /genres/ template as low quality.
 *
 * This module defines a curated set of real music + talk genre slugs used
 * across the radio industry. URLs whose slug is NOT in `GENRE_WHITELIST` are:
 *   - dropped from sitemaps (sitemap-manifest-builder.ts)
 *   - 301-redirected to the closest real genre when listed in `GENRE_ALIASES`
 *   - otherwise served with `<meta name="robots" content="noindex, follow">`
 *     so Google can stop reporting them as soft-404s
 *
 * In addition, even whitelisted genres are suppressed (noindex + dropped from
 * sitemap) when fewer than `MIN_STATIONS_FOR_GENRE_INDEX` indexable stations
 * back them — a thin genre page is still a thin genre page.
 */

/** Minimum number of indexable popular stations required for a genre page
 * to be eligible for indexing / sitemap inclusion. Backed by Agent C §0:
 * pages with no popular-stations grid are reliably soft-404'd by Google. */
export const MIN_STATIONS_FOR_GENRE_INDEX = 6;

/**
 * Canonical genre slugs we are willing to publish. ~360 entries covering:
 *   - mainstream music genres (pop, rock, jazz, country, classical, …)
 *   - electronic sub-genres (house, techno, trance, drum-and-bass, …)
 *   - regional / world music (k-pop, j-pop, latin, reggaeton, fado, flamenco, …)
 *   - era buckets that have meaningful search demand (60s, 70s, 80s, 90s, 2000s, oldies)
 *   - talk / non-music formats radio listeners actually search for
 *     (news, sports, talk, comedy, christian, gospel, public-radio, …)
 *
 * NOT included: FM frequencies, city/region names, individual station/show
 * names, artist names, language names (those have their own templates), and
 * obviously broken transliterations.
 *
 * All entries are lowercase, hyphen-separated. Comparisons must lowercase
 * the input slug — see `isWhitelistedGenreSlug`.
 */
export const GENRE_WHITELIST: ReadonlySet<string> = new Set<string>([
  // ── Mainstream / broad ───────────────────────────────────────────────
  'pop', 'rock', 'jazz', 'blues', 'country', 'classical', 'electronic',
  'dance', 'hip-hop', 'rap', 'r-and-b', 'rnb', 'soul', 'funk', 'reggae',
  'ska', 'metal', 'punk', 'indie', 'alternative', 'folk', 'latin', 'world',
  'ambient', 'chill', 'lounge', 'easy-listening', 'oldies', 'classics',
  'top-40', 'hits', 'adult-contemporary', 'contemporary', 'mainstream',
  'variety', 'mixed', 'eclectic', 'instrumental', 'acoustic', 'vocal',
  'a-cappella', 'experimental', 'avant-garde', 'soundtrack', 'film-score',
  'video-game', 'broadway', 'musical', 'cover-songs', 'tribute',

  // ── Eras ─────────────────────────────────────────────────────────────
  '50s', '60s', '70s', '80s', '90s', '2000s', '2010s', '2020s',
  'fifties', 'sixties', 'seventies', 'eighties', 'nineties',
  'classic-hits', 'classic-rock', 'classic-pop', 'retro',

  // ── Rock sub-genres ──────────────────────────────────────────────────
  'hard-rock', 'soft-rock', 'progressive-rock', 'psychedelic-rock',
  'garage-rock', 'surf-rock', 'glam-rock', 'art-rock', 'pop-rock',
  'folk-rock', 'country-rock', 'southern-rock', 'blues-rock', 'jazz-rock',
  'post-rock', 'post-punk', 'new-wave', 'shoegaze', 'grunge', 'emo',
  'pop-punk', 'hardcore-punk', 'metalcore', 'thrash-metal', 'death-metal',
  'black-metal', 'doom-metal', 'power-metal', 'heavy-metal', 'nu-metal',
  'progressive-metal', 'symphonic-metal', 'gothic-metal', 'speed-metal',
  'industrial', 'industrial-rock', 'gothic', 'goth-rock', 'rockabilly',
  'rock-and-roll', 'stoner-rock',

  // ── Pop sub-genres ───────────────────────────────────────────────────
  'dance-pop', 'electropop', 'synth-pop', 'synthpop', 'indie-pop',
  'dream-pop', 'bubblegum-pop', 'teen-pop', 'art-pop', 'baroque-pop',
  'power-pop',

  // ── Electronic / dance ───────────────────────────────────────────────
  'edm', 'house', 'deep-house', 'tech-house', 'progressive-house',
  'electro-house', 'tropical-house', 'future-house', 'acid-house',
  'techno', 'minimal-techno', 'detroit-techno', 'trance', 'progressive-trance',
  'psytrance', 'goa-trance', 'vocal-trance', 'dubstep', 'brostep', 'dub',
  'drum-and-bass', 'dnb', 'jungle', 'breakbeat', 'breaks', 'hardstyle',
  'hardcore', 'gabber', 'trap', 'future-bass', 'glitch', 'idm',
  'downtempo', 'trip-hop', 'electronica', 'electro', 'electroclash',
  'big-beat', 'nu-disco', 'disco', 'italo-disco', 'eurodance', 'eurobeat',
  'freestyle', 'garage', 'uk-garage', '2-step', 'grime', 'bass',
  'bassline', 'lo-fi', 'lofi', 'lo-fi-hip-hop', 'chillhop', 'chillout',
  'synthwave', 'vaporwave', 'retrowave', 'darkwave', 'witch-house',
  'amapiano', 'afro-house',

  // ── Hip-hop / urban ──────────────────────────────────────────────────
  'old-school-hip-hop', 'gangsta-rap', 'east-coast-hip-hop',
  'west-coast-hip-hop', 'southern-hip-hop', 'underground-hip-hop',
  'conscious-hip-hop', 'boom-bap', 'crunk', 'drill', 'mumble-rap',
  'urban', 'urban-contemporary', 'neo-soul', 'contemporary-rnb',

  // ── R&B / soul / funk ────────────────────────────────────────────────
  'classic-soul', 'motown', 'doo-wop', 'gospel', 'gospel-blues',
  'quiet-storm', 'smooth-soul', 'p-funk', 'g-funk',

  // ── Jazz sub-genres ──────────────────────────────────────────────────
  'smooth-jazz', 'cool-jazz', 'hard-bop', 'bebop', 'big-band', 'swing',
  'free-jazz', 'jazz-fusion', 'latin-jazz', 'vocal-jazz', 'gypsy-jazz',
  'manouche', 'modern-jazz', 'contemporary-jazz', 'nu-jazz', 'acid-jazz',

  // ── Blues sub-genres ─────────────────────────────────────────────────
  'delta-blues', 'chicago-blues', 'electric-blues', 'country-blues',
  'rhythm-and-blues',

  // ── Country / Americana ──────────────────────────────────────────────
  'classic-country', 'modern-country', 'country-pop', 'alt-country',
  'outlaw-country', 'honky-tonk', 'bluegrass', 'americana', 'western',
  'western-swing', 'cowboy',

  // ── Folk / acoustic ──────────────────────────────────────────────────
  'folk-music', 'traditional-folk', 'contemporary-folk', 'singer-songwriter',
  'celtic', 'irish', 'scottish', 'gaelic', 'sea-shanty',

  // ── Classical / orchestral ───────────────────────────────────────────
  'baroque', 'romantic', 'modern-classical', 'contemporary-classical',
  'minimalism', 'opera', 'choral', 'symphony', 'orchestra', 'chamber',
  'chamber-music', 'piano', 'violin', 'cello', 'guitar', 'organ',
  'harpsichord', 'sacred-classical',

  // ── Religious / spiritual ────────────────────────────────────────────
  'christian', 'christian-rock', 'christian-pop', 'contemporary-christian',
  'ccm', 'worship', 'praise', 'hymns', 'sacred', 'spiritual', 'religious',
  'islamic', 'quran', 'nasheed', 'jewish', 'hebrew', 'buddhist', 'hindu',
  'devotional', 'kirtan', 'sufi', 'qawwali', 'gospel-music',

  // ── World / regional ─────────────────────────────────────────────────
  'world-music', 'world-fusion', 'ethnic', 'tribal', 'middle-eastern',
  'oriental', 'arabic', 'arabic-pop', 'rai', 'chaabi', 'kabyle',
  'turkish-pop', 'turkish-folk', 'arabesk', 'anatolian-rock', 'halk',
  'persian', 'iranian', 'greek', 'laiko', 'rebetiko', 'fado', 'flamenco',
  'tango', 'milonga', 'klezmer', 'balkan', 'romani', 'bhangra',
  'bollywood', 'classical-indian', 'carnatic', 'hindustani', 'ghazal',
  'african', 'afrobeat', 'afro-pop', 'afroswing', 'highlife', 'soukous',
  'makossa', 'kwaito', 'gqom', 'kuduro', 'zouk', 'kompa', 'mizik-rasin',
  'reggaeton', 'salsa', 'bachata', 'merengue', 'cumbia', 'mariachi',
  'ranchera', 'banda', 'norteno', 'tejano', 'conjunto', 'latin-pop',
  'latin-rock', 'latin-jazz', 'tropical', 'bossa-nova', 'samba', 'mpb',
  'sertanejo', 'forro', 'pagode', 'axe', 'baile-funk', 'funk-carioca',
  'capoeira', 'soca', 'calypso', 'mento', 'dancehall', 'lovers-rock',
  'roots-reggae', 'ragga', 'k-pop', 'kpop', 'j-pop', 'jpop', 'j-rock',
  'anime', 'mandopop', 'cantopop', 'c-pop', 'enka', 'kayokyoku',
  'thai-pop', 'v-pop', 'vietnamese', 'pinoy', 'opm', 'malay-pop',
  'schlager', 'volksmusik', 'chanson', 'french-pop', 'italo-pop',
  'canzone', 'german-pop', 'deutschrap', 'russian-pop', 'shanson',

  // ── Mood / activity ──────────────────────────────────────────────────
  'workout', 'fitness', 'running', 'yoga', 'meditation', 'sleep',
  'relaxation', 'relax', 'study', 'focus', 'productivity', 'party',
  'dance-party', 'romantic', 'love-songs', 'background', 'wedding',
  'cafe', 'dinner', 'morning', 'night', 'driving',

  // ── Nature / atmospheric ─────────────────────────────────────────────
  'nature', 'ocean', 'rain', 'white-noise', 'ambient-electronic',
  'space-music', 'new-age',

  // ── Holiday / seasonal ───────────────────────────────────────────────
  'christmas', 'holiday', 'halloween', 'easter', 'valentines',
  'christmas-music',

  // ── Kids / family ────────────────────────────────────────────────────
  'kids', 'children', 'family', 'lullaby', 'nursery-rhymes', 'storytelling',

  // ── Talk / news / sports / spoken ────────────────────────────────────
  'news', 'news-talk', 'talk', 'talk-radio', 'public-radio', 'npr', 'bbc',
  'current-affairs', 'politics', 'business', 'finance', 'economy',
  'technology', 'science', 'education', 'history', 'culture', 'art',
  'literature', 'poetry', 'audiobook', 'audiobooks', 'drama',
  'true-crime', 'comedy', 'stand-up', 'satire', 'health', 'lifestyle',
  'self-help', 'motivational', 'spirituality', 'philosophy', 'religion',
  'weather', 'traffic', 'community', 'college', 'college-radio',
  'sports', 'sports-talk', 'soccer', 'football', 'basketball', 'baseball',
  'hockey', 'cricket', 'rugby', 'golf', 'tennis', 'motorsport', 'racing',
  'esports', 'wrestling', 'boxing', 'mma',
]);

/**
 * Common close-match aliases. When a request comes in for a non-whitelisted
 * slug whose canonical form IS in the whitelist, we 301 redirect instead of
 * dropping the URL. Keep this list conservative — these must be obvious,
 * lossless redirects.
 */
export const GENRE_ALIASES: ReadonlyMap<string, string> = new Map<string, string>([
  // Spelling / punctuation variants
  ['hiphop', 'hip-hop'],
  ['hip-hop-rap', 'hip-hop'],
  ['rap-hip-hop', 'hip-hop'],
  ['r-b', 'r-and-b'],
  ['rb', 'r-and-b'],
  ['randb', 'r-and-b'],
  ['r-n-b', 'r-and-b'],
  ['rock-n-roll', 'rock-and-roll'],
  ['rock-roll', 'rock-and-roll'],
  ['drum-bass', 'drum-and-bass'],
  ['drum-n-bass', 'drum-and-bass'],
  ['dnb', 'drum-and-bass'],
  ['d-n-b', 'drum-and-bass'],
  ['lofi-hip-hop', 'lo-fi-hip-hop'],
  ['lo-fi-hiphop', 'lo-fi-hip-hop'],
  ['lofi', 'lo-fi'],
  ['chill-out', 'chillout'],
  ['easy', 'easy-listening'],
  ['easy-listning', 'easy-listening'],
  ['eazy-listening', 'easy-listening'],
  ['top40', 'top-40'],
  ['top-fourty', 'top-40'],
  ['adult-contempo', 'adult-contemporary'],
  ['ac', 'adult-contemporary'],

  // Era variants
  ['50-s', '50s'],
  ['60-s', '60s'],
  ['70-s', '70s'],
  ['80-s', '80s'],
  ['90-s', '90s'],
  ['00s', '2000s'],
  ['00-s', '2000s'],
  ['10s', '2010s'],
  ['20s', '2020s'],
  ['oldie', 'oldies'],
  ['golden-oldies', 'oldies'],

  // Genre family roll-ups
  ['hip-hop-and-rap', 'hip-hop'],
  ['rap-and-hip-hop', 'hip-hop'],
  ['rnb-soul', 'r-and-b'],
  ['soul-r-and-b', 'soul'],
  ['rock-pop', 'pop-rock'],
  ['pop-and-rock', 'pop-rock'],
  ['indie-rock', 'indie'],
  ['indie-alternative', 'alternative'],
  ['alt-rock', 'alternative'],
  ['alternative-rock', 'alternative'],
  ['classic-rock-and-roll', 'classic-rock'],
  ['heavy-rock', 'hard-rock'],
  ['heavy', 'heavy-metal'],
  ['metal-rock', 'metal'],
  ['nu-metal-metal', 'nu-metal'],
  ['punk-rock', 'punk'],
  ['post-hardcore', 'hardcore-punk'],

  // Electronic
  ['electronica-dance', 'electronic'],
  ['electronic-dance', 'edm'],
  ['dance-electronic', 'edm'],
  ['progressive', 'progressive-house'],
  ['psy-trance', 'psytrance'],
  ['drum-bass-jungle', 'drum-and-bass'],
  ['lo-fi-beats', 'lo-fi-hip-hop'],
  ['ambient-chill', 'ambient'],
  ['chill-lounge', 'lounge'],

  // Latin
  ['latino', 'latin'],
  ['musica-latina', 'latin'],
  ['salsa-merengue', 'salsa'],
  ['bachata-merengue', 'bachata'],
  ['regional-mexican', 'banda'],
  ['mariachi-ranchera', 'mariachi'],
  ['samba-bossa-nova', 'samba'],
  ['mpb-bossa', 'mpb'],

  // Talk / news / religious
  ['news-and-talk', 'news-talk'],
  ['news-talk-info', 'news-talk'],
  ['talk-show', 'talk'],
  ['public', 'public-radio'],
  ['college-radio-station', 'college-radio'],
  ['kids-and-family', 'kids'],
  ['kid', 'kids'],
  ['childrens', 'children'],
  ['holiday-music', 'holiday'],
  ['xmas', 'christmas'],
  ['xmas-music', 'christmas-music'],
  ['contemporary-christian-music', 'contemporary-christian'],
  ['christian-contemporary', 'contemporary-christian'],
  ['praise-and-worship', 'worship'],

  // Sports
  ['sport', 'sports'],
  ['sports-and-talk', 'sports-talk'],
  ['football-soccer', 'soccer'],
  ['american-football', 'football'],
  ['basketball-nba', 'basketball'],
  ['baseball-mlb', 'baseball'],
  ['hockey-nhl', 'hockey'],

  // World / regional roll-ups (keep narrow — lots of "city" tags should stay
  // dropped, not aliased)
  ['j-pop-anime', 'j-pop'],
  ['k-pop-korean', 'k-pop'],
  ['korean-pop', 'k-pop'],
  ['japanese-pop', 'j-pop'],
  ['mandarin-pop', 'mandopop'],
  ['cantonese-pop', 'cantopop'],
  ['arabic-music', 'arabic'],
  ['turkish', 'turkish-pop'],
  ['turkce-pop', 'turkish-pop'],
  ['halk-muzigi', 'halk'],
  ['flamenco-spanish', 'flamenco'],
  ['tango-milonga', 'tango'],
]);

/** Returns true when `slug` (case-insensitive) is on the genre whitelist. */
export function isWhitelistedGenreSlug(slug: string | undefined | null): boolean {
  if (!slug) return false;
  return GENRE_WHITELIST.has(slug.toLowerCase());
}

/**
 * Resolve a request slug to its canonical whitelisted slug.
 *   - Whitelisted slug → returned as-is (lowercased)
 *   - Aliased slug → returns the canonical whitelisted target
 *   - Otherwise → undefined (caller should noindex / drop from sitemap)
 */
export function getCanonicalGenreSlug(slug: string | undefined | null): string | undefined {
  if (!slug) return undefined;
  const lower = slug.toLowerCase();
  if (GENRE_WHITELIST.has(lower)) return lower;
  const aliased = GENRE_ALIASES.get(lower);
  if (aliased && GENRE_WHITELIST.has(aliased)) return aliased;
  return undefined;
}

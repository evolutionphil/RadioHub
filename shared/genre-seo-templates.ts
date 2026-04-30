/**
 * Multilingual SEO templates for genre detail pages (e.g. /tr/turler/pop, /de/genres/pop).
 *
 * Each language entry returns a natural, idiomatic title/description/keywords for a given genre.
 * Falls back to English when the language is not yet covered.
 *
 * NOTE: Used by server/seo-renderer.ts in the `pageType === 'genres' && additionalData.genreName` branch.
 * Database translation keys (`seo_radio_stations`, `seo_listen_live_online`, etc.) take precedence when
 * present — this file is the multilingual fallback for the very common case where those keys are missing
 * from the Translation collection (which is the current production state for all 57 languages).
 */

export interface GenreSeoTemplate {
  title: (genre: string) => string;
  description: (genre: string) => string;
  keywords: (genre: string) => string;
}

// Top 15 languages — natural, locale-aware phrasing.
// All other languages fall back to English.
export const GENRE_SEO_TEMPLATES: Record<string, GenreSeoTemplate> = {
  en: {
    title: (g) => `${g} Radio Stations - Listen Live Online | Mega Radio`,
    description: (g) => `Listen to live ${g} radio online. Discover the best ${g} music stations and shows on Mega Radio — free and unlimited.`,
    keywords: (g) => `${g} radio, ${g} music, ${g} stations, live ${g}, online ${g} radio`,
  },
  tr: {
    title: (g) => `${g} Radyo İstasyonları - Canlı Dinle | Mega Radio`,
    description: (g) => `${g} türünde canlı radyo dinleyin. Mega Radio'da en iyi ${g} müzik istasyonlarını ve programlarını ücretsiz keşfedin.`,
    keywords: (g) => `${g} radyo, ${g} müzik, ${g} istasyonları, canlı ${g}, online ${g} radyo`,
  },
  de: {
    title: (g) => `${g} Radiosender - Live online hören | Mega Radio`,
    description: (g) => `Höre kostenlos Live-Radio im Genre ${g}. Entdecke die besten ${g}-Musiksender und Sendungen auf Mega Radio.`,
    keywords: (g) => `${g} Radio, ${g} Musik, ${g} Sender, Live-${g}, ${g} Radiosender`,
  },
  es: {
    title: (g) => `Emisoras de Radio ${g} - Escucha en Vivo Online | Mega Radio`,
    description: (g) => `Escucha radio ${g} en vivo y gratis. Descubre las mejores emisoras y programas de música ${g} en Mega Radio.`,
    keywords: (g) => `radio ${g}, música ${g}, emisoras ${g}, ${g} en vivo, ${g} online`,
  },
  fr: {
    title: (g) => `Stations Radio ${g} - Écoute en Direct en Ligne | Mega Radio`,
    description: (g) => `Écoutez la radio ${g} en direct et gratuitement. Découvrez les meilleures stations et émissions de musique ${g} sur Mega Radio.`,
    keywords: (g) => `radio ${g}, musique ${g}, stations ${g}, ${g} en direct, ${g} en ligne`,
  },
  it: {
    title: (g) => `Radio ${g} - Ascolta in Diretta Online | Mega Radio`,
    description: (g) => `Ascolta radio ${g} in diretta gratis. Scopri le migliori stazioni e programmi musicali ${g} su Mega Radio.`,
    keywords: (g) => `radio ${g}, musica ${g}, stazioni ${g}, ${g} in diretta, ${g} online`,
  },
  pt: {
    title: (g) => `Rádios ${g} - Ouça Ao Vivo Online | Mega Radio`,
    description: (g) => `Ouça rádio ${g} ao vivo e grátis. Descubra as melhores estações e programas de música ${g} na Mega Radio.`,
    keywords: (g) => `rádio ${g}, música ${g}, estações ${g}, ${g} ao vivo, ${g} online`,
  },
  ru: {
    title: (g) => `${g} Радиостанции - Слушать Онлайн в Прямом Эфире | Mega Radio`,
    description: (g) => `Слушайте ${g} радио онлайн бесплатно. Откройте лучшие ${g} музыкальные станции и шоу на Mega Radio.`,
    keywords: (g) => `${g} радио, ${g} музыка, ${g} станции, ${g} онлайн, ${g} прямой эфир`,
  },
  ar: {
    title: (g) => `محطات راديو ${g} - استمع مباشر عبر الإنترنت | Mega Radio`,
    description: (g) => `استمع إلى راديو ${g} مباشرة ومجاناً. اكتشف أفضل محطات وبرامج موسيقى ${g} على Mega Radio.`,
    keywords: (g) => `راديو ${g}, موسيقى ${g}, محطات ${g}, ${g} مباشر, ${g} اونلاين`,
  },
  nl: {
    title: (g) => `${g} Radiostations - Luister Live Online | Mega Radio`,
    description: (g) => `Luister gratis live naar ${g} radio. Ontdek de beste ${g} muziekzenders en programma's op Mega Radio.`,
    keywords: (g) => `${g} radio, ${g} muziek, ${g} zenders, live ${g}, ${g} online`,
  },
  pl: {
    title: (g) => `Stacje Radiowe ${g} - Słuchaj Na Żywo Online | Mega Radio`,
    description: (g) => `Słuchaj radia ${g} na żywo za darmo. Odkryj najlepsze stacje i programy muzyczne ${g} w Mega Radio.`,
    keywords: (g) => `${g} radio, ${g} muzyka, ${g} stacje, ${g} na żywo, ${g} online`,
  },
  zh: {
    title: (g) => `${g} 电台 - 在线直播收听 | Mega Radio`,
    description: (g) => `免费在线收听 ${g} 电台直播。在 Mega Radio 上发现最好的 ${g} 音乐和节目。`,
    keywords: (g) => `${g} 电台, ${g} 音乐, ${g} 节目, 在线 ${g}, ${g} 直播`,
  },
  ja: {
    title: (g) => `${g} ラジオ局 - ライブで聴くオンライン | Mega Radio`,
    description: (g) => `${g} のラジオを無料でライブ視聴。Mega Radio で最高の ${g} 音楽と番組を発見しましょう。`,
    keywords: (g) => `${g} ラジオ, ${g} 音楽, ${g} 番組, ${g} オンライン, ${g} ライブ`,
  },
  ko: {
    title: (g) => `${g} 라디오 방송국 - 실시간 온라인 청취 | Mega Radio`,
    description: (g) => `${g} 라디오를 실시간으로 무료로 들어보세요. Mega Radio에서 최고의 ${g} 음악과 프로그램을 만나보세요.`,
    keywords: (g) => `${g} 라디오, ${g} 음악, ${g} 방송, ${g} 온라인, ${g} 실시간`,
  },
  hi: {
    title: (g) => `${g} रेडियो स्टेशन - ऑनलाइन लाइव सुनें | Mega Radio`,
    description: (g) => `${g} रेडियो ऑनलाइन मुफ्त में लाइव सुनें। Mega Radio पर सबसे अच्छे ${g} संगीत स्टेशन और शो खोजें।`,
    keywords: (g) => `${g} रेडियो, ${g} संगीत, ${g} स्टेशन, ${g} ऑनलाइन, ${g} लाइव`,
  },
};

/**
 * Returns a multilingual SEO template for the requested language, falling back to English.
 */
export function getGenreSeoTemplate(language: string): GenreSeoTemplate {
  return GENRE_SEO_TEMPLATES[language] || GENRE_SEO_TEMPLATES.en;
}

/**
 * Builds title/description/keywords for a genre detail page in the given language.
 * If `dbTranslations` provides any of the legacy SEO keys, they win — but the description
 * stays in the chosen language (no English-template padding).
 */
export function buildGenreSeo(
  genreName: string,
  language: string,
  dbTranslations?: Record<string, string>,
): { title: string; description: string; keywords: string } {
  const tpl = getGenreSeoTemplate(language);

  // DB override path — only use it when ALL three legacy keys are filled in the requested
  // language; otherwise we'd mix English fragments into a Turkish/German sentence.
  const radioStations = dbTranslations?.seo_radio_stations?.trim();
  const listenLive = dbTranslations?.seo_listen_live_online?.trim();
  const listenFrom = dbTranslations?.seo_listen_to_live_radio_from?.trim();
  const discoverLocal = dbTranslations?.seo_discover_local?.trim();
  const musicAndShows = dbTranslations?.seo_music_and_shows?.trim();

  const title =
    radioStations && listenLive
      ? `${genreName} ${radioStations} - ${listenLive} | Mega Radio`
      : tpl.title(genreName);

  const description =
    listenFrom && discoverLocal && musicAndShows
      ? `${listenFrom} ${genreName}. ${discoverLocal} ${genreName} ${musicAndShows}.`
      : tpl.description(genreName);

  const keywords = tpl.keywords(genreName);

  return { title, description, keywords };
}

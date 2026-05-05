/**
 * Multilingual SEO templates for genre detail pages (e.g. /tr/turler/pop, /de/genres/pop).
 *
 * Each language entry returns a natural, idiomatic title/description/keywords/H1/body
 * for a given genre. Falls back to English when the language is not yet covered.
 *
 * NOTE: Used by server/seo-renderer.ts in the `pageType === 'genres' && additionalData.genreName`
 * branch (title/description/keywords) AND in the genres SSR body branch (H1 + intro + availability),
 * AND by the client SeoHead.tsx hydration so React doesn't overwrite SSR meta after mount.
 *
 * Database translation keys (`seo_radio_stations`, `seo_listen_live_online`, etc.) take precedence
 * for the title/description override path when ALL relevant keys are present — but the H1 and body
 * always use the per-language template to avoid mid-sentence English fragments like
 * "Pop Radio Stations - Canlı Dinle".
 */

export interface GenreSeoTemplate {
  title: (genre: string) => string;
  description: (genre: string) => string;
  keywords: (genre: string) => string;
  h1: (genre: string) => string;
  bodyIntro: (genre: string) => string;
  bodyAvailability: (genre: string) => string;
}

// Top 15 languages — natural, locale-aware phrasing.
// All other languages fall back to English.
export const GENRE_SEO_TEMPLATES: Record<string, GenreSeoTemplate> = {
  en: {
    title: (g) => `${g} Radio Stations - Listen Live Online | Mega Radio`,
    description: (g) => `Listen to live ${g} radio online. Discover the best ${g} music stations and shows on Mega Radio — free and unlimited.`,
    keywords: (g) => `${g} radio, ${g} music, ${g} stations, live ${g}, online ${g} radio`,
    h1: (g) => `${g} Radio Stations — Listen Live Online`,
    bodyIntro: (g) => `Listen to live ${g} radio online. Discover the best ${g} music stations and shows streaming for free on Mega Radio.`,
    bodyAvailability: (g) => `Browse 60,000+ radio stations from 120+ countries — ${g} stations available 24/7 for free streaming.`,
  },
  tr: {
    title: (g) => `${g} Radyo İstasyonları - Canlı Dinle | Mega Radio`,
    description: (g) => `${g} türünde canlı radyo dinleyin. Mega Radio'da en iyi ${g} müzik istasyonlarını ve programlarını ücretsiz keşfedin.`,
    keywords: (g) => `${g} radyo, ${g} müzik, ${g} istasyonları, canlı ${g}, online ${g} radyo`,
    h1: (g) => `${g} Radyo İstasyonları — Canlı Dinle`,
    bodyIntro: (g) => `${g} türünde canlı radyo dinleyin. Mega Radio'da en iyi ${g} müzik istasyonlarını ve programlarını ücretsiz keşfedin.`,
    bodyAvailability: (g) => `120'den fazla ülkeden 60.000'den fazla radyo istasyonuna göz atın — ${g} istasyonları 7/24 ücretsiz yayında.`,
  },
  de: {
    title: (g) => `${g} Radiosender - Live online hören | Mega Radio`,
    description: (g) => `Höre kostenlos Live-Radio im Genre ${g}. Entdecke die besten ${g}-Musiksender und Sendungen auf Mega Radio.`,
    keywords: (g) => `${g} Radio, ${g} Musik, ${g} Sender, Live-${g}, ${g} Radiosender`,
    h1: (g) => `${g} Radiosender — Live online hören`,
    bodyIntro: (g) => `Höre kostenlos Live-Radio im Genre ${g}. Entdecke die besten ${g}-Musiksender und Sendungen auf Mega Radio.`,
    bodyAvailability: (g) => `Stöbere durch 60.000+ Radiosender aus 120+ Ländern — ${g}-Sender rund um die Uhr kostenlos verfügbar.`,
  },
  es: {
    title: (g) => `Emisoras de Radio ${g} - Escucha en Vivo Online | Mega Radio`,
    description: (g) => `Escucha radio ${g} en vivo y gratis. Descubre las mejores emisoras y programas de música ${g} en Mega Radio.`,
    keywords: (g) => `radio ${g}, música ${g}, emisoras ${g}, ${g} en vivo, ${g} online`,
    h1: (g) => `Emisoras de Radio ${g} — Escucha en Vivo Online`,
    bodyIntro: (g) => `Escucha radio ${g} en vivo y gratis. Descubre las mejores emisoras y programas de música ${g} en Mega Radio.`,
    bodyAvailability: (g) => `Explora más de 60.000 emisoras de radio de más de 120 países — emisoras de ${g} disponibles las 24 horas, gratis.`,
  },
  fr: {
    title: (g) => `Stations Radio ${g} - Écoute en Direct en Ligne | Mega Radio`,
    description: (g) => `Écoutez la radio ${g} en direct et gratuitement. Découvrez les meilleures stations et émissions de musique ${g} sur Mega Radio.`,
    keywords: (g) => `radio ${g}, musique ${g}, stations ${g}, ${g} en direct, ${g} en ligne`,
    h1: (g) => `Stations Radio ${g} — Écoute en Direct en Ligne`,
    bodyIntro: (g) => `Écoutez la radio ${g} en direct et gratuitement. Découvrez les meilleures stations et émissions de musique ${g} sur Mega Radio.`,
    bodyAvailability: (g) => `Parcourez plus de 60 000 stations radio de plus de 120 pays — stations ${g} disponibles 24h/24, gratuitement.`,
  },
  it: {
    title: (g) => `Radio ${g} - Ascolta in Diretta Online | Mega Radio`,
    description: (g) => `Ascolta radio ${g} in diretta gratis. Scopri le migliori stazioni e programmi musicali ${g} su Mega Radio.`,
    keywords: (g) => `radio ${g}, musica ${g}, stazioni ${g}, ${g} in diretta, ${g} online`,
    h1: (g) => `Radio ${g} — Ascolta in Diretta Online`,
    bodyIntro: (g) => `Ascolta radio ${g} in diretta gratis. Scopri le migliori stazioni e programmi musicali ${g} su Mega Radio.`,
    bodyAvailability: (g) => `Sfoglia oltre 60.000 stazioni radio da più di 120 paesi — stazioni ${g} disponibili 24 ore su 24, gratis.`,
  },
  pt: {
    title: (g) => `Rádios ${g} - Ouça Ao Vivo Online | Mega Radio`,
    description: (g) => `Ouça rádio ${g} ao vivo e grátis. Descubra as melhores estações e programas de música ${g} na Mega Radio.`,
    keywords: (g) => `rádio ${g}, música ${g}, estações ${g}, ${g} ao vivo, ${g} online`,
    h1: (g) => `Rádios ${g} — Ouça Ao Vivo Online`,
    bodyIntro: (g) => `Ouça rádio ${g} ao vivo e grátis. Descubra as melhores estações e programas de música ${g} na Mega Radio.`,
    bodyAvailability: (g) => `Navegue por mais de 60.000 estações de rádio de mais de 120 países — estações de ${g} disponíveis 24/7, grátis.`,
  },
  ru: {
    title: (g) => `${g} Радиостанции - Слушать Онлайн в Прямом Эфире | Mega Radio`,
    description: (g) => `Слушайте ${g} радио онлайн бесплатно. Откройте лучшие ${g} музыкальные станции и шоу на Mega Radio.`,
    keywords: (g) => `${g} радио, ${g} музыка, ${g} станции, ${g} онлайн, ${g} прямой эфир`,
    h1: (g) => `${g} Радиостанции — Слушать Онлайн в Прямом Эфире`,
    bodyIntro: (g) => `Слушайте ${g} радио онлайн бесплатно. Откройте лучшие ${g} музыкальные станции и шоу на Mega Radio.`,
    bodyAvailability: (g) => `Просматривайте более 60 000 радиостанций из 120+ стран — ${g} станции доступны 24/7 бесплатно.`,
  },
  ar: {
    title: (g) => `محطات راديو ${g} - استمع مباشر عبر الإنترنت | Mega Radio`,
    description: (g) => `استمع إلى راديو ${g} مباشرة ومجاناً. اكتشف أفضل محطات وبرامج موسيقى ${g} على Mega Radio.`,
    keywords: (g) => `راديو ${g}, موسيقى ${g}, محطات ${g}, ${g} مباشر, ${g} اونلاين`,
    h1: (g) => `محطات راديو ${g} — استمع مباشر عبر الإنترنت`,
    bodyIntro: (g) => `استمع إلى راديو ${g} مباشرة ومجاناً. اكتشف أفضل محطات وبرامج موسيقى ${g} على Mega Radio.`,
    bodyAvailability: (g) => `تصفح أكثر من 60,000 محطة راديو من أكثر من 120 دولة — محطات ${g} متاحة على مدار الساعة طوال أيام الأسبوع مجاناً.`,
  },
  nl: {
    title: (g) => `${g} Radiostations - Luister Live Online | Mega Radio`,
    description: (g) => `Luister gratis live naar ${g} radio. Ontdek de beste ${g} muziekzenders en programma's op Mega Radio.`,
    keywords: (g) => `${g} radio, ${g} muziek, ${g} zenders, live ${g}, ${g} online`,
    h1: (g) => `${g} Radiostations — Luister Live Online`,
    bodyIntro: (g) => `Luister gratis live naar ${g} radio. Ontdek de beste ${g} muziekzenders en programma's op Mega Radio.`,
    bodyAvailability: (g) => `Blader door 60.000+ radiostations uit 120+ landen — ${g}-zenders 24/7 gratis beschikbaar.`,
  },
  pl: {
    title: (g) => `Stacje Radiowe ${g} - Słuchaj Na Żywo Online | Mega Radio`,
    description: (g) => `Słuchaj radia ${g} na żywo za darmo. Odkryj najlepsze stacje i programy muzyczne ${g} w Mega Radio.`,
    keywords: (g) => `${g} radio, ${g} muzyka, ${g} stacje, ${g} na żywo, ${g} online`,
    h1: (g) => `Stacje Radiowe ${g} — Słuchaj Na Żywo Online`,
    bodyIntro: (g) => `Słuchaj radia ${g} na żywo za darmo. Odkryj najlepsze stacje i programy muzyczne ${g} w Mega Radio.`,
    bodyAvailability: (g) => `Przeglądaj ponad 60 000 stacji radiowych z ponad 120 krajów — stacje ${g} dostępne 24/7 za darmo.`,
  },
  zh: {
    title: (g) => `${g} 电台 - 在线直播收听 | Mega Radio`,
    description: (g) => `免费在线收听 ${g} 电台直播。在 Mega Radio 上发现最好的 ${g} 音乐和节目。`,
    keywords: (g) => `${g} 电台, ${g} 音乐, ${g} 节目, 在线 ${g}, ${g} 直播`,
    h1: (g) => `${g} 电台 — 在线直播收听`,
    bodyIntro: (g) => `免费在线收听 ${g} 电台直播。在 Mega Radio 上发现最好的 ${g} 音乐和节目。`,
    bodyAvailability: (g) => `浏览来自 120+ 国家的 60,000+ 个电台 — ${g} 电台 24/7 全天候免费收听。`,
  },
  ja: {
    title: (g) => `${g} ラジオ局 - ライブで聴くオンライン | Mega Radio`,
    description: (g) => `${g} のラジオを無料でライブ視聴。Mega Radio で最高の ${g} 音楽と番組を発見しましょう。`,
    keywords: (g) => `${g} ラジオ, ${g} 音楽, ${g} 番組, ${g} オンライン, ${g} ライブ`,
    h1: (g) => `${g} ラジオ局 — ライブで聴くオンライン`,
    bodyIntro: (g) => `${g} のラジオを無料でライブ視聴。Mega Radio で最高の ${g} 音楽と番組を発見しましょう。`,
    bodyAvailability: (g) => `120ヶ国以上の60,000以上のラジオ局を閲覧 — ${g} 局は24時間365日無料でストリーミング可能。`,
  },
  ko: {
    title: (g) => `${g} 라디오 방송국 - 실시간 온라인 청취 | Mega Radio`,
    description: (g) => `${g} 라디오를 실시간으로 무료로 들어보세요. Mega Radio에서 최고의 ${g} 음악과 프로그램을 만나보세요.`,
    keywords: (g) => `${g} 라디오, ${g} 음악, ${g} 방송, ${g} 온라인, ${g} 실시간`,
    h1: (g) => `${g} 라디오 방송국 — 실시간 온라인 청취`,
    bodyIntro: (g) => `${g} 라디오를 실시간으로 무료로 들어보세요. Mega Radio에서 최고의 ${g} 음악과 프로그램을 만나보세요.`,
    bodyAvailability: (g) => `120개국 이상의 60,000개 이상의 라디오 방송국을 둘러보세요 — ${g} 방송국은 24시간 무료 스트리밍 가능합니다.`,
  },
  hi: {
    title: (g) => `${g} रेडियो स्टेशन - ऑनलाइन लाइव सुनें | Mega Radio`,
    description: (g) => `${g} रेडियो ऑनलाइन मुफ्त में लाइव सुनें। Mega Radio पर सबसे अच्छे ${g} संगीत स्टेशन और शो खोजें।`,
    keywords: (g) => `${g} रेडियो, ${g} संगीत, ${g} स्टेशन, ${g} ऑनलाइन, ${g} लाइव`,
    h1: (g) => `${g} रेडियो स्टेशन — ऑनलाइन लाइव सुनें`,
    bodyIntro: (g) => `${g} रेडियो ऑनलाइन मुफ्त में लाइव सुनें। Mega Radio पर सबसे अच्छे ${g} संगीत स्टेशन और शो खोजें।`,
    bodyAvailability: (g) => `120+ देशों के 60,000+ रेडियो स्टेशन ब्राउज़ करें — ${g} स्टेशन 24/7 मुफ्त स्ट्रीमिंग के लिए उपलब्ध।`,
  },
};

/**
 * Returns a multilingual SEO template for the requested language, falling back to English.
 */
export function getGenreSeoTemplate(language: string): GenreSeoTemplate {
  return GENRE_SEO_TEMPLATES[language] || GENRE_SEO_TEMPLATES.en;
}

/**
 * Grapheme-aware truncation. Uses Intl.Segmenter when available (Node 16+, all modern browsers)
 * so Arabic combining marks, emoji ZWJ sequences, and surrogate pairs are not split mid-cluster.
 * Falls back to code-point iteration via `Array.from()` if Intl.Segmenter is unavailable.
 *
 * `maxChars` is interpreted as max UTF-16 code units in the output to match the caller's 145-cap
 * accounting; the function stops adding clusters once the next one would exceed `maxChars`.
 */
function clampGraphemes(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  let out = '';
  if (typeof Intl !== 'undefined' && typeof (Intl as any).Segmenter === 'function') {
    const seg = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' });
    for (const { segment } of seg.segment(text)) {
      if (out.length + segment.length > maxChars) break;
      out += segment;
    }
  } else {
    for (const ch of Array.from(text)) {
      if (out.length + ch.length > maxChars) break;
      out += ch;
    }
  }
  return out;
}

/**
 * Builds title/description/keywords for a genre detail page in the given language.
 * If `dbTranslations` provides any of the legacy SEO keys IN THE REQUESTED LANGUAGE,
 * they win — but the description stays in the chosen language (no English-template padding).
 *
 * Defensive: enforces 145-char max on description per replit.md META DESCRIPTION LENGTH RULE.
 */
export function buildGenreSeo(
  genreName: string,
  language: string,
  dbTranslations?: Record<string, string>,
): { title: string; description: string; keywords: string; h1: string; bodyIntro: string; bodyAvailability: string } {
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

  let description =
    listenFrom && discoverLocal && musicAndShows
      ? `${listenFrom} ${genreName}. ${discoverLocal} ${genreName} ${musicAndShows}.`
      : tpl.description(genreName);

  // Defensive 145-char clamp at word boundary (matches shared/seo-config.ts truncateAtWordBoundary policy).
  // Grapheme-safe so Arabic combining marks, surrogate pairs, and CJK extension chars are not split.
  if (description.length > 145) {
    const cutoff = description.lastIndexOf(' ', 142);
    if (cutoff > 100) {
      description = description.slice(0, cutoff) + '...';
    } else {
      description = clampGraphemes(description, 142) + '...';
    }
  }

  const keywords = tpl.keywords(genreName);
  const h1 = tpl.h1(genreName);
  const bodyIntro = tpl.bodyIntro(genreName);
  const bodyAvailability = tpl.bodyAvailability(genreName);

  return { title, description, keywords, h1, bodyIntro, bodyAvailability };
}

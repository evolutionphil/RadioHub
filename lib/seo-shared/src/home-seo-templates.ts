/**
 * Multilingual SEO templates for the homepage (`/`, `/xx`).
 *
 * Mirrors STATIC_PAGE_SEO_TEMPLATES / LEGAL_SEO_TEMPLATES: DB keys win when
 * present in the requested language, otherwise the per-language template is
 * used so a non-English homepage NEVER serves the English <title>/<meta>.
 * Before this registry the home page sourced title/description only from DB
 * keys (meta_title / hero_worlds_best_radio / meta_description /
 * home_page_description) and fell back to ENGLISH whenever a language's
 * Translation rows were missing — duplicate English title+meta across all 14
 * locales on the single most important page. See SEO re-audit 2026-06-20,
 * Item 2.
 *
 * `hero` is the bare localized H1 phrase (no brand suffix) so the <h1> stays
 * distinct from the branded <title> AND is localized per language (deriving
 * the H1 from the title would yield the brand name "Mega Radio" identically
 * across every language).
 */
export interface HomeSeoEntry {
  /** ~50-60 char localized title (brand suffix appended by the renderer). */
  title: string;
  /** ~150-160 char localized meta description. */
  description: string;
  /** Bare localized hero phrase used as the page <h1>. */
  hero: string;
}

export const HOME_SEO_TEMPLATES: Record<string, HomeSeoEntry> = {
  en: {
    title: 'Free Live Radio from 120+ Countries',
    description:
      'Listen to 60,000+ free live radio stations from 120+ countries on Mega Radio. Stream music, news, sports and talk radio online from any device, anywhere.',
    hero: 'Free Live Radio from Around the World',
  },
  es: {
    title: 'Radio en Vivo Gratis de 120+ Países',
    description:
      'Escucha 60.000+ emisoras de radio en vivo gratis de 120+ países en Mega Radio. Música, noticias, deportes y radio hablada online desde cualquier dispositivo.',
    hero: 'Radio en Vivo Gratis de Todo el Mundo',
  },
  fr: {
    title: 'Radio en Direct Gratuite de 120+ Pays',
    description:
      'Écoutez 60 000+ stations de radio en direct gratuites de 120+ pays sur Mega Radio. Musique, infos, sport et radios parlées en ligne sur tous vos appareils.',
    hero: 'Radio en Direct Gratuite du Monde Entier',
  },
  de: {
    title: 'Kostenloses Live-Radio aus 120+ Ländern',
    description:
      'Höre 60.000+ kostenlose Live-Radiosender aus 120+ Ländern auf Mega Radio. Musik, Nachrichten, Sport und Talk-Radio online auf jedem Gerät, überall und jederzeit.',
    hero: 'Kostenloses Live-Radio aus aller Welt',
  },
  pt: {
    title: 'Rádio ao Vivo Grátis de 120+ Países',
    description:
      'Ouça 60.000+ estações de rádio ao vivo grátis de 120+ países no Mega Radio. Música, notícias, esportes e rádio falada online em qualquer dispositivo, em qualquer lugar.',
    hero: 'Rádio ao Vivo Grátis do Mundo Todo',
  },
  it: {
    title: 'Radio in Diretta Gratis da 120+ Paesi',
    description:
      'Ascolta 60.000+ stazioni radio in diretta gratis da 120+ paesi su Mega Radio. Musica, notizie, sport e radio parlata online su qualsiasi dispositivo, ovunque.',
    hero: 'Radio in Diretta Gratis da Tutto il Mondo',
  },
  ru: {
    title: 'Бесплатное живое радио из 120+ стран',
    description:
      'Слушайте 60 000+ бесплатных радиостанций в прямом эфире из 120+ стран на Mega Radio. Музыка, новости, спорт и разговорное радио онлайн на любом устройстве.',
    hero: 'Бесплатное живое радио со всего мира',
  },
  ar: {
    title: 'راديو مباشر مجاني من أكثر من 120 دولة',
    description:
      'استمع إلى أكثر من 60,000 محطة راديو مباشرة مجانية من أكثر من 120 دولة على ميغا راديو. موسيقى وأخبار ورياضة وبرامج حوارية عبر الإنترنت على أي جهاز وفي أي مكان.',
    hero: 'راديو مباشر مجاني من حول العالم',
  },
  zh: {
    title: '来自120多个国家的免费在线直播电台',
    description:
      '在 Mega Radio 收听来自120多个国家的60,000多个免费在线直播电台。随时随地在任何设备上畅享音乐、新闻、体育和谈话广播。',
    hero: '来自世界各地的免费在线直播电台',
  },
  tr: {
    title: '120+ Ülkeden Ücretsiz Canlı Radyo',
    description:
      '120+ ülkeden 60.000+ ücretsiz canlı radyo istasyonunu Mega Radio ile dinleyin. Müzik, haber, spor ve sohbet radyosunu her cihazdan, her yerde online dinleyin.',
    hero: 'Dünyanın Her Yerinden Ücretsiz Canlı Radyo',
  },
  ja: {
    title: '120カ国以上の無料ライブラジオ',
    description:
      'Mega Radioで120カ国以上、60,000以上の無料ライブラジオ局を聴こう。音楽、ニュース、スポーツ、トーク番組をどこでもどんなデバイスでもオンラインで楽しめます。',
    hero: '世界中の無料ライブラジオ',
  },
  ko: {
    title: '120개국 이상의 무료 실시간 라디오',
    description:
      'Mega Radio에서 120개국 이상, 60,000개 이상의 무료 실시간 라디오 방송을 들어보세요. 음악, 뉴스, 스포츠, 토크 라디오를 어디서나 모든 기기에서 즐기세요.',
    hero: '전 세계 무료 실시간 라디오',
  },
  hi: {
    title: '120+ देशों से मुफ्त लाइव रेडियो',
    description:
      'Mega Radio पर 120+ देशों से 60,000+ मुफ्त लाइव रेडियो स्टेशन सुनें। किसी भी डिवाइस पर, कहीं भी संगीत, समाचार, खेल और टॉक रेडियो ऑनलाइन का आनंद लें।',
    hero: 'दुनिया भर से मुफ्त लाइव रेडियो',
  },
  he: {
    title: 'רדיו חי בחינם מ-120+ מדינות',
    description:
      'האזינו ל-60,000+ תחנות רדיו חי בחינם מ-120+ מדינות במגה רדיו. מוזיקה, חדשות, ספורט ותוכניות דיבור אונליין בכל מכשיר, בכל מקום ובכל זמן.',
    hero: 'רדיו חי בחינם מכל העולם',
  },
};

export function getHomeSeoTemplate(language: string): HomeSeoEntry {
  return HOME_SEO_TEMPLATES[language] || HOME_SEO_TEMPLATES.en;
}

/**
 * DB keys take precedence (admin override) when present in the requested
 * language; else the per-language template; else the English template.
 * Returns `{ title, description, hero }` — the renderer appends the brand
 * suffix to `title` and uses `hero` for the <h1>.
 */
export function buildHomeSeo(
  language: string,
  dbTranslations?: Record<string, string>,
): { title: string; description: string; hero: string } {
  const tpl = getHomeSeoTemplate(language);
  const dbTitle =
    dbTranslations?.['meta_title']?.trim() ||
    dbTranslations?.['hero_worlds_best_radio']?.trim();
  const dbDescription =
    dbTranslations?.['meta_description']?.trim() ||
    dbTranslations?.['home_page_description']?.trim();
  const dbHero = dbTranslations?.['hero_worlds_best_radio']?.trim();

  let description = dbDescription || tpl.description;
  if (description.length > 160) {
    const cutoff = description.lastIndexOf(' ', 157);
    description =
      cutoff > 110 ? description.slice(0, cutoff) + '…' : description.slice(0, 157) + '…';
  }

  return {
    title: dbTitle || tpl.title,
    description,
    hero: dbHero || tpl.hero,
  };
}

/**
 * Multilingual SEO templates for region/country detail pages
 * (e.g. /de/regionen/germany, /tr/bolgeler/germany, /zh/地区/germany).
 *
 * Each language entry returns a natural, idiomatic title/description/keywords/H1/body
 * for a given country or region name. Falls back to English when the language is not
 * yet covered.
 *
 * NOTE: Used by server/seo-renderer.ts in the `pageType === 'regions'` branch
 * (title/description/keywords) AND in the regions SSR body branch (intro paragraphs).
 *
 * Without per-language titles/descriptions, all 44 languages served the SAME English
 * `<title>` ("Germany Radio Stations - Regional Broadcasting | Mega Radio") and the
 * same English `<meta description>`. With ~120 countries × 44 languages = ~5,280
 * pages, Google was collapsing them into one EN canonical and dropping the rest.
 */

export interface RegionSeoTemplate {
  // `kind` differentiates a single country (Germany, Brazil) from a multi-country
  // region (Europe, Asia). Most strings are identical for both, but a few words
  // ("regional" vs "local", "from this region" vs "from this country") read more
  // naturally when localised separately.
  countryTitle: (name: string) => string;
  countryDescription: (name: string) => string;
  countryKeywords: (name: string) => string;
  countryH1: (name: string) => string;
  countryBodyIntro: (name: string) => string;
  countryBodyAvailability: (name: string) => string;

  regionTitle: (name: string) => string;
  regionDescription: (name: string) => string;
  regionKeywords: (name: string) => string;
  regionH1: (name: string) => string;
  regionBodyIntro: (name: string) => string;
  regionBodyAvailability: (name: string) => string;
}

// Top 15 languages — natural, locale-aware phrasing.
// All other languages fall back to English.
export const REGION_SEO_TEMPLATES: Record<string, RegionSeoTemplate> = {
  en: {
    countryTitle: (n) => `${n} Radio Stations - Listen Live Online | Mega Radio`,
    countryDescription: (n) => `Listen to live radio from ${n}. Discover local ${n} radio stations and shows streaming free on Mega Radio.`,
    countryKeywords: (n) => `${n} radio, ${n} radio stations, ${n} live radio, ${n} online radio`,
    countryH1: (n) => `${n} Radio Stations — Listen Live Online`,
    countryBodyIntro: (n) => `Explore radio stations from ${n}. Listen to local broadcasting for free on Mega Radio.`,
    countryBodyAvailability: (n) => `Browse 60,000+ radio stations from 120+ countries — ${n} radio stations available 24/7.`,
    regionTitle: (n) => `${n} Radio Stations - Regional Broadcasting | Mega Radio`,
    regionDescription: (n) => `Explore radio stations from ${n}. Listen to regional broadcasting from across ${n} for free on Mega Radio.`,
    regionKeywords: (n) => `${n} radio, ${n} broadcasting, regional radio, ${n} stations`,
    regionH1: (n) => `${n} Radio Stations — Regional Broadcasting`,
    regionBodyIntro: (n) => `Explore radio stations from ${n}. Listen to regional broadcasting for free on Mega Radio.`,
    regionBodyAvailability: (n) => `Browse 60,000+ radio stations from 120+ countries — ${n} stations available 24/7.`,
  },
  tr: {
    countryTitle: (n) => `${n} Radyo İstasyonları - Canlı Dinle | Mega Radio`,
    countryDescription: (n) => `${n} radyolarını canlı dinleyin. Mega Radio'da ${n} yerel radyo istasyonlarını ve programlarını ücretsiz keşfedin.`,
    countryKeywords: (n) => `${n} radyo, ${n} radyo istasyonları, ${n} canlı radyo, ${n} online radyo`,
    countryH1: (n) => `${n} Radyo İstasyonları — Canlı Dinle`,
    countryBodyIntro: (n) => `${n} radyo istasyonlarını keşfedin. Mega Radio'da yerel yayınları ücretsiz dinleyin.`,
    countryBodyAvailability: (n) => `120'den fazla ülkeden 60.000'den fazla radyo istasyonuna göz atın — ${n} radyoları 7/24 yayında.`,
    regionTitle: (n) => `${n} Radyo İstasyonları - Bölgesel Yayıncılık | Mega Radio`,
    regionDescription: (n) => `${n} bölgesinden radyo istasyonlarını keşfedin. ${n} bölgesel yayınlarını Mega Radio'da ücretsiz dinleyin.`,
    regionKeywords: (n) => `${n} radyo, ${n} yayıncılık, bölgesel radyo, ${n} istasyonları`,
    regionH1: (n) => `${n} Radyo İstasyonları — Bölgesel Yayıncılık`,
    regionBodyIntro: (n) => `${n} bölgesindeki radyo istasyonlarını keşfedin. Bölgesel yayınları Mega Radio'da ücretsiz dinleyin.`,
    regionBodyAvailability: (n) => `120'den fazla ülkeden 60.000'den fazla radyo istasyonuna göz atın — ${n} istasyonları 7/24 yayında.`,
  },
  de: {
    countryTitle: (n) => `${n} Radiosender - Live online hören | Mega Radio`,
    countryDescription: (n) => `Höre Live-Radio aus ${n}. Entdecke lokale ${n}-Radiosender und Sendungen kostenlos auf Mega Radio.`,
    countryKeywords: (n) => `${n} Radio, ${n} Radiosender, ${n} Live-Radio, ${n} Online-Radio`,
    countryH1: (n) => `${n} Radiosender — Live online hören`,
    countryBodyIntro: (n) => `Entdecke Radiosender aus ${n}. Höre lokale Sendungen kostenlos auf Mega Radio.`,
    countryBodyAvailability: (n) => `Stöbere durch 60.000+ Radiosender aus 120+ Ländern — ${n}-Sender rund um die Uhr verfügbar.`,
    regionTitle: (n) => `${n} Radiosender - Regionale Sender | Mega Radio`,
    regionDescription: (n) => `Entdecke Radiosender aus ${n}. Höre regionale Sender aus ganz ${n} kostenlos auf Mega Radio.`,
    regionKeywords: (n) => `${n} Radio, ${n} Sender, Regionalradio, ${n} Sender`,
    regionH1: (n) => `${n} Radiosender — Regionale Sender`,
    regionBodyIntro: (n) => `Entdecke Radiosender aus ${n}. Höre regionale Sender kostenlos auf Mega Radio.`,
    regionBodyAvailability: (n) => `Stöbere durch 60.000+ Radiosender aus 120+ Ländern — ${n}-Sender rund um die Uhr verfügbar.`,
  },
  es: {
    countryTitle: (n) => `Emisoras de Radio de ${n} - Escucha en Vivo Online | Mega Radio`,
    countryDescription: (n) => `Escucha radio en vivo de ${n}. Descubre las emisoras locales y programas de ${n} gratis en Mega Radio.`,
    countryKeywords: (n) => `radio ${n}, emisoras de ${n}, radio ${n} en vivo, radio ${n} online`,
    countryH1: (n) => `Emisoras de Radio de ${n} — Escucha en Vivo Online`,
    countryBodyIntro: (n) => `Explora emisoras de radio de ${n}. Escucha la radiodifusión local gratis en Mega Radio.`,
    countryBodyAvailability: (n) => `Explora más de 60.000 emisoras de radio de más de 120 países — emisoras de ${n} disponibles 24/7.`,
    regionTitle: (n) => `Emisoras de Radio de ${n} - Radiodifusión Regional | Mega Radio`,
    regionDescription: (n) => `Explora emisoras de radio de ${n}. Escucha la radiodifusión regional de ${n} gratis en Mega Radio.`,
    regionKeywords: (n) => `radio ${n}, radiodifusión ${n}, radio regional, emisoras de ${n}`,
    regionH1: (n) => `Emisoras de Radio de ${n} — Radiodifusión Regional`,
    regionBodyIntro: (n) => `Explora emisoras de radio de ${n}. Escucha la radiodifusión regional gratis en Mega Radio.`,
    regionBodyAvailability: (n) => `Explora más de 60.000 emisoras de radio de más de 120 países — emisoras de ${n} disponibles 24/7.`,
  },
  fr: {
    countryTitle: (n) => `Stations Radio de ${n} - Écoute en Direct en Ligne | Mega Radio`,
    countryDescription: (n) => `Écoutez la radio en direct depuis ${n}. Découvrez les stations locales et programmes de ${n} gratuitement sur Mega Radio.`,
    countryKeywords: (n) => `radio ${n}, stations radio ${n}, radio ${n} en direct, radio ${n} en ligne`,
    countryH1: (n) => `Stations Radio de ${n} — Écoute en Direct en Ligne`,
    countryBodyIntro: (n) => `Explorez les stations radio de ${n}. Écoutez la radiodiffusion locale gratuitement sur Mega Radio.`,
    countryBodyAvailability: (n) => `Parcourez plus de 60 000 stations radio de plus de 120 pays — stations de ${n} disponibles 24h/24.`,
    regionTitle: (n) => `Stations Radio de ${n} - Radiodiffusion Régionale | Mega Radio`,
    regionDescription: (n) => `Explorez les stations radio de ${n}. Écoutez la radiodiffusion régionale de ${n} gratuitement sur Mega Radio.`,
    regionKeywords: (n) => `radio ${n}, radiodiffusion ${n}, radio régionale, stations de ${n}`,
    regionH1: (n) => `Stations Radio de ${n} — Radiodiffusion Régionale`,
    regionBodyIntro: (n) => `Explorez les stations radio de ${n}. Écoutez la radiodiffusion régionale gratuitement sur Mega Radio.`,
    regionBodyAvailability: (n) => `Parcourez plus de 60 000 stations radio de plus de 120 pays — stations de ${n} disponibles 24h/24.`,
  },
  it: {
    countryTitle: (n) => `Radio di ${n} - Ascolta in Diretta Online | Mega Radio`,
    countryDescription: (n) => `Ascolta radio in diretta da ${n}. Scopri le stazioni locali e i programmi di ${n} gratis su Mega Radio.`,
    countryKeywords: (n) => `radio ${n}, stazioni radio ${n}, radio ${n} in diretta, radio ${n} online`,
    countryH1: (n) => `Radio di ${n} — Ascolta in Diretta Online`,
    countryBodyIntro: (n) => `Esplora le stazioni radio di ${n}. Ascolta le emittenti locali gratis su Mega Radio.`,
    countryBodyAvailability: (n) => `Sfoglia oltre 60.000 stazioni radio da più di 120 paesi — stazioni di ${n} disponibili 24/7.`,
    regionTitle: (n) => `Radio di ${n} - Emittenti Regionali | Mega Radio`,
    regionDescription: (n) => `Esplora le stazioni radio di ${n}. Ascolta le emittenti regionali di ${n} gratis su Mega Radio.`,
    regionKeywords: (n) => `radio ${n}, emittenti ${n}, radio regionale, stazioni di ${n}`,
    regionH1: (n) => `Radio di ${n} — Emittenti Regionali`,
    regionBodyIntro: (n) => `Esplora le stazioni radio di ${n}. Ascolta le emittenti regionali gratis su Mega Radio.`,
    regionBodyAvailability: (n) => `Sfoglia oltre 60.000 stazioni radio da più di 120 paesi — stazioni di ${n} disponibili 24/7.`,
  },
  pt: {
    countryTitle: (n) => `Rádios de ${n} - Ouça Ao Vivo Online | Mega Radio`,
    countryDescription: (n) => `Ouça rádio ao vivo de ${n}. Descubra as estações locais e programas de ${n} grátis na Mega Radio.`,
    countryKeywords: (n) => `rádio ${n}, estações de ${n}, rádio ${n} ao vivo, rádio ${n} online`,
    countryH1: (n) => `Rádios de ${n} — Ouça Ao Vivo Online`,
    countryBodyIntro: (n) => `Explore estações de rádio de ${n}. Ouça as emissoras locais grátis na Mega Radio.`,
    countryBodyAvailability: (n) => `Navegue por mais de 60.000 estações de rádio de mais de 120 países — estações de ${n} disponíveis 24/7.`,
    regionTitle: (n) => `Rádios de ${n} - Emissoras Regionais | Mega Radio`,
    regionDescription: (n) => `Explore estações de rádio de ${n}. Ouça as emissoras regionais de ${n} grátis na Mega Radio.`,
    regionKeywords: (n) => `rádio ${n}, emissoras ${n}, rádio regional, estações de ${n}`,
    regionH1: (n) => `Rádios de ${n} — Emissoras Regionais`,
    regionBodyIntro: (n) => `Explore estações de rádio de ${n}. Ouça as emissoras regionais grátis na Mega Radio.`,
    regionBodyAvailability: (n) => `Navegue por mais de 60.000 estações de rádio de mais de 120 países — estações de ${n} disponíveis 24/7.`,
  },
  ru: {
    countryTitle: (n) => `${n} Радиостанции - Слушать Онлайн в Прямом Эфире | Mega Radio`,
    countryDescription: (n) => `Слушайте радио ${n} в прямом эфире. Откройте местные радиостанции и шоу ${n} бесплатно на Mega Radio.`,
    countryKeywords: (n) => `${n} радио, ${n} радиостанции, ${n} прямой эфир, ${n} онлайн радио`,
    countryH1: (n) => `${n} Радиостанции — Слушать Онлайн в Прямом Эфире`,
    countryBodyIntro: (n) => `Откройте радиостанции ${n}. Слушайте местные передачи бесплатно на Mega Radio.`,
    countryBodyAvailability: (n) => `Просматривайте более 60 000 радиостанций из 120+ стран — радиостанции ${n} доступны 24/7.`,
    regionTitle: (n) => `${n} Радиостанции - Региональное Вещание | Mega Radio`,
    regionDescription: (n) => `Откройте радиостанции из ${n}. Слушайте региональное вещание ${n} бесплатно на Mega Radio.`,
    regionKeywords: (n) => `${n} радио, ${n} вещание, региональное радио, ${n} станции`,
    regionH1: (n) => `${n} Радиостанции — Региональное Вещание`,
    regionBodyIntro: (n) => `Откройте радиостанции из ${n}. Слушайте региональное вещание бесплатно на Mega Radio.`,
    regionBodyAvailability: (n) => `Просматривайте более 60 000 радиостанций из 120+ стран — станции ${n} доступны 24/7.`,
  },
  ar: {
    countryTitle: (n) => `محطات راديو ${n} - استمع مباشر عبر الإنترنت | Mega Radio`,
    countryDescription: (n) => `استمع إلى الراديو مباشرة من ${n}. اكتشف محطات الراديو المحلية وبرامج ${n} مجاناً على Mega Radio.`,
    countryKeywords: (n) => `راديو ${n}, محطات راديو ${n}, ${n} مباشر, راديو ${n} اونلاين`,
    countryH1: (n) => `محطات راديو ${n} — استمع مباشر عبر الإنترنت`,
    countryBodyIntro: (n) => `اكتشف محطات الراديو من ${n}. استمع إلى البث المحلي مجاناً على Mega Radio.`,
    countryBodyAvailability: (n) => `تصفح أكثر من 60,000 محطة راديو من أكثر من 120 دولة — محطات ${n} متاحة على مدار الساعة.`,
    regionTitle: (n) => `محطات راديو ${n} - البث الإقليمي | Mega Radio`,
    regionDescription: (n) => `اكتشف محطات الراديو من ${n}. استمع إلى البث الإقليمي من ${n} مجاناً على Mega Radio.`,
    regionKeywords: (n) => `راديو ${n}, بث ${n}, راديو إقليمي, محطات ${n}`,
    regionH1: (n) => `محطات راديو ${n} — البث الإقليمي`,
    regionBodyIntro: (n) => `اكتشف محطات الراديو من ${n}. استمع إلى البث الإقليمي مجاناً على Mega Radio.`,
    regionBodyAvailability: (n) => `تصفح أكثر من 60,000 محطة راديو من أكثر من 120 دولة — محطات ${n} متاحة على مدار الساعة.`,
  },
  nl: {
    countryTitle: (n) => `${n} Radiostations - Luister Live Online | Mega Radio`,
    countryDescription: (n) => `Luister naar live radio uit ${n}. Ontdek lokale ${n}-zenders en programma's gratis op Mega Radio.`,
    countryKeywords: (n) => `${n} radio, ${n} radiostations, ${n} live radio, ${n} online radio`,
    countryH1: (n) => `${n} Radiostations — Luister Live Online`,
    countryBodyIntro: (n) => `Ontdek radiostations uit ${n}. Luister gratis naar lokale uitzendingen op Mega Radio.`,
    countryBodyAvailability: (n) => `Blader door 60.000+ radiostations uit 120+ landen — ${n}-zenders 24/7 beschikbaar.`,
    regionTitle: (n) => `${n} Radiostations - Regionale Uitzendingen | Mega Radio`,
    regionDescription: (n) => `Ontdek radiostations uit ${n}. Luister gratis naar regionale uitzendingen uit ${n} op Mega Radio.`,
    regionKeywords: (n) => `${n} radio, ${n} uitzendingen, regionale radio, ${n} zenders`,
    regionH1: (n) => `${n} Radiostations — Regionale Uitzendingen`,
    regionBodyIntro: (n) => `Ontdek radiostations uit ${n}. Luister gratis naar regionale uitzendingen op Mega Radio.`,
    regionBodyAvailability: (n) => `Blader door 60.000+ radiostations uit 120+ landen — ${n}-zenders 24/7 beschikbaar.`,
  },
  pl: {
    countryTitle: (n) => `Stacje Radiowe ${n} - Słuchaj Na Żywo Online | Mega Radio`,
    countryDescription: (n) => `Słuchaj radia na żywo z ${n}. Odkryj lokalne stacje i programy z ${n} za darmo w Mega Radio.`,
    countryKeywords: (n) => `${n} radio, stacje radiowe ${n}, ${n} na żywo, ${n} online`,
    countryH1: (n) => `Stacje Radiowe ${n} — Słuchaj Na Żywo Online`,
    countryBodyIntro: (n) => `Odkryj stacje radiowe z ${n}. Słuchaj lokalnych nadawców za darmo w Mega Radio.`,
    countryBodyAvailability: (n) => `Przeglądaj ponad 60 000 stacji radiowych z ponad 120 krajów — stacje ${n} dostępne 24/7.`,
    regionTitle: (n) => `Stacje Radiowe ${n} - Nadawanie Regionalne | Mega Radio`,
    regionDescription: (n) => `Odkryj stacje radiowe z ${n}. Słuchaj regionalnych nadawców z ${n} za darmo w Mega Radio.`,
    regionKeywords: (n) => `${n} radio, nadawanie ${n}, radio regionalne, stacje ${n}`,
    regionH1: (n) => `Stacje Radiowe ${n} — Nadawanie Regionalne`,
    regionBodyIntro: (n) => `Odkryj stacje radiowe z ${n}. Słuchaj regionalnych nadawców za darmo w Mega Radio.`,
    regionBodyAvailability: (n) => `Przeglądaj ponad 60 000 stacji radiowych z ponad 120 krajów — stacje ${n} dostępne 24/7.`,
  },
  zh: {
    countryTitle: (n) => `${n}电台 - 在线直播收听 | Mega Radio`,
    countryDescription: (n) => `免费在线收听来自${n}的电台直播。在 Mega Radio 上发现${n}的本地电台和节目。`,
    countryKeywords: (n) => `${n}电台, ${n}广播, ${n}在线电台, ${n}直播`,
    countryH1: (n) => `${n}电台 — 在线直播收听`,
    countryBodyIntro: (n) => `探索来自${n}的电台。在 Mega Radio 上免费收听本地广播。`,
    countryBodyAvailability: (n) => `浏览来自 120+ 国家的 60,000+ 个电台 — ${n}电台 24/7 全天候收听。`,
    regionTitle: (n) => `${n}电台 - 区域广播 | Mega Radio`,
    regionDescription: (n) => `探索来自${n}的电台。在 Mega Radio 上免费收听${n}的区域广播。`,
    regionKeywords: (n) => `${n}电台, ${n}广播, 区域电台, ${n}电台`,
    regionH1: (n) => `${n}电台 — 区域广播`,
    regionBodyIntro: (n) => `探索来自${n}的电台。在 Mega Radio 上免费收听区域广播。`,
    regionBodyAvailability: (n) => `浏览来自 120+ 国家的 60,000+ 个电台 — ${n}电台 24/7 全天候收听。`,
  },
  ja: {
    countryTitle: (n) => `${n}のラジオ局 - ライブで聴くオンライン | Mega Radio`,
    countryDescription: (n) => `${n}のラジオを無料でライブ視聴。Mega Radio で${n}の地元ラジオ局と番組を発見しましょう。`,
    countryKeywords: (n) => `${n} ラジオ, ${n} ラジオ局, ${n} ライブ, ${n} オンライン`,
    countryH1: (n) => `${n}のラジオ局 — ライブで聴くオンライン`,
    countryBodyIntro: (n) => `${n}のラジオ局を探索。Mega Radio で地元の放送を無料で聴けます。`,
    countryBodyAvailability: (n) => `120ヶ国以上の60,000以上のラジオ局を閲覧 — ${n}のラジオ局は24時間365日視聴可能。`,
    regionTitle: (n) => `${n}のラジオ局 - 地域放送 | Mega Radio`,
    regionDescription: (n) => `${n}のラジオ局を探索。Mega Radio で${n}の地域放送を無料で聴けます。`,
    regionKeywords: (n) => `${n} ラジオ, ${n} 放送, 地域ラジオ, ${n} 局`,
    regionH1: (n) => `${n}のラジオ局 — 地域放送`,
    regionBodyIntro: (n) => `${n}のラジオ局を探索。Mega Radio で地域放送を無料で聴けます。`,
    regionBodyAvailability: (n) => `120ヶ国以上の60,000以上のラジオ局を閲覧 — ${n}の局は24時間365日視聴可能。`,
  },
  ko: {
    countryTitle: (n) => `${n} 라디오 방송국 - 실시간 온라인 청취 | Mega Radio`,
    countryDescription: (n) => `${n}의 라디오를 실시간으로 무료로 들어보세요. Mega Radio에서 ${n}의 지역 방송국과 프로그램을 만나보세요.`,
    countryKeywords: (n) => `${n} 라디오, ${n} 방송국, ${n} 실시간, ${n} 온라인`,
    countryH1: (n) => `${n} 라디오 방송국 — 실시간 온라인 청취`,
    countryBodyIntro: (n) => `${n}의 라디오 방송국을 둘러보세요. Mega Radio에서 지역 방송을 무료로 들어보세요.`,
    countryBodyAvailability: (n) => `120개국 이상의 60,000개 이상의 라디오 방송국을 둘러보세요 — ${n} 방송국은 24시간 청취 가능합니다.`,
    regionTitle: (n) => `${n} 라디오 방송국 - 지역 방송 | Mega Radio`,
    regionDescription: (n) => `${n}의 라디오 방송국을 둘러보세요. Mega Radio에서 ${n}의 지역 방송을 무료로 들어보세요.`,
    regionKeywords: (n) => `${n} 라디오, ${n} 방송, 지역 라디오, ${n} 방송국`,
    regionH1: (n) => `${n} 라디오 방송국 — 지역 방송`,
    regionBodyIntro: (n) => `${n}의 라디오 방송국을 둘러보세요. Mega Radio에서 지역 방송을 무료로 들어보세요.`,
    regionBodyAvailability: (n) => `120개국 이상의 60,000개 이상의 라디오 방송국을 둘러보세요 — ${n} 방송국은 24시간 청취 가능합니다.`,
  },
  hi: {
    countryTitle: (n) => `${n} रेडियो स्टेशन - ऑनलाइन लाइव सुनें | Mega Radio`,
    countryDescription: (n) => `${n} से लाइव रेडियो सुनें। Mega Radio पर ${n} के स्थानीय रेडियो स्टेशन और शो मुफ्त में खोजें।`,
    countryKeywords: (n) => `${n} रेडियो, ${n} रेडियो स्टेशन, ${n} लाइव, ${n} ऑनलाइन`,
    countryH1: (n) => `${n} रेडियो स्टेशन — ऑनलाइन लाइव सुनें`,
    countryBodyIntro: (n) => `${n} के रेडियो स्टेशन खोजें। Mega Radio पर स्थानीय प्रसारण मुफ्त में सुनें।`,
    countryBodyAvailability: (n) => `120+ देशों के 60,000+ रेडियो स्टेशन ब्राउज़ करें — ${n} के स्टेशन 24/7 उपलब्ध।`,
    regionTitle: (n) => `${n} रेडियो स्टेशन - क्षेत्रीय प्रसारण | Mega Radio`,
    regionDescription: (n) => `${n} के रेडियो स्टेशन खोजें। Mega Radio पर ${n} का क्षेत्रीय प्रसारण मुफ्त में सुनें।`,
    regionKeywords: (n) => `${n} रेडियो, ${n} प्रसारण, क्षेत्रीय रेडियो, ${n} स्टेशन`,
    regionH1: (n) => `${n} रेडियो स्टेशन — क्षेत्रीय प्रसारण`,
    regionBodyIntro: (n) => `${n} के रेडियो स्टेशन खोजें। Mega Radio पर क्षेत्रीय प्रसारण मुफ्त में सुनें।`,
    regionBodyAvailability: (n) => `120+ देशों के 60,000+ रेडियो स्टेशन ब्राउज़ करें — ${n} के स्टेशन 24/7 उपलब्ध।`,
  },
  sv: {
    countryTitle: (n) => `${n} Radiostationer - Lyssna Live Online | Mega Radio`,
    countryDescription: (n) => `Lyssna på live-radio från ${n}. Upptäck lokala ${n}-radiostationer och program gratis på Mega Radio.`,
    countryKeywords: (n) => `${n} radio, ${n} radiostationer, ${n} liveradio, ${n} onlineradio`,
    countryH1: (n) => `${n} Radiostationer — Lyssna Live Online`,
    countryBodyIntro: (n) => `Utforska radiostationer från ${n}. Lyssna gratis på lokala sändningar på Mega Radio.`,
    countryBodyAvailability: (n) => `Bläddra bland 60 000+ radiostationer från 120+ länder — ${n}-stationer tillgängliga dygnet runt.`,
    regionTitle: (n) => `${n} Radiostationer - Regionala Sändningar | Mega Radio`,
    regionDescription: (n) => `Utforska radiostationer från ${n}. Lyssna på regionala sändningar från ${n} gratis på Mega Radio.`,
    regionKeywords: (n) => `${n} radio, ${n} sändningar, regional radio, ${n} stationer`,
    regionH1: (n) => `${n} Radiostationer — Regionala Sändningar`,
    regionBodyIntro: (n) => `Utforska radiostationer från ${n}. Lyssna gratis på regionala sändningar på Mega Radio.`,
    regionBodyAvailability: (n) => `Bläddra bland 60 000+ radiostationer från 120+ länder — ${n}-stationer tillgängliga dygnet runt.`,
  },
  da: {
    countryTitle: (n) => `${n} Radiostationer - Lyt Live Online | Mega Radio`,
    countryDescription: (n) => `Lyt til live-radio fra ${n}. Oplev lokale ${n}-radiostationer og programmer gratis på Mega Radio.`,
    countryKeywords: (n) => `${n} radio, ${n} radiostationer, ${n} live radio, ${n} online radio`,
    countryH1: (n) => `${n} Radiostationer — Lyt Live Online`,
    countryBodyIntro: (n) => `Udforsk radiostationer fra ${n}. Lyt gratis til lokale udsendelser på Mega Radio.`,
    countryBodyAvailability: (n) => `Gennemse 60.000+ radiostationer fra 120+ lande — ${n}-stationer tilgængelige døgnet rundt.`,
    regionTitle: (n) => `${n} Radiostationer - Regionale Udsendelser | Mega Radio`,
    regionDescription: (n) => `Udforsk radiostationer fra ${n}. Lyt til regionale udsendelser fra ${n} gratis på Mega Radio.`,
    regionKeywords: (n) => `${n} radio, ${n} udsendelser, regional radio, ${n} stationer`,
    regionH1: (n) => `${n} Radiostationer — Regionale Udsendelser`,
    regionBodyIntro: (n) => `Udforsk radiostationer fra ${n}. Lyt gratis til regionale udsendelser på Mega Radio.`,
    regionBodyAvailability: (n) => `Gennemse 60.000+ radiostationer fra 120+ lande — ${n}-stationer tilgængelige døgnet rundt.`,
  },
  no: {
    countryTitle: (n) => `${n} Radiostasjoner - Lytt Live Online | Mega Radio`,
    countryDescription: (n) => `Lytt til live radio fra ${n}. Oppdag lokale ${n}-radiostasjoner og programmer gratis på Mega Radio.`,
    countryKeywords: (n) => `${n} radio, ${n} radiostasjoner, ${n} live radio, ${n} online radio`,
    countryH1: (n) => `${n} Radiostasjoner — Lytt Live Online`,
    countryBodyIntro: (n) => `Utforsk radiostasjoner fra ${n}. Lytt gratis til lokale sendinger på Mega Radio.`,
    countryBodyAvailability: (n) => `Bla gjennom 60 000+ radiostasjoner fra 120+ land — ${n}-stasjoner tilgjengelige døgnet rundt.`,
    regionTitle: (n) => `${n} Radiostasjoner - Regionale Sendinger | Mega Radio`,
    regionDescription: (n) => `Utforsk radiostasjoner fra ${n}. Lytt til regionale sendinger fra ${n} gratis på Mega Radio.`,
    regionKeywords: (n) => `${n} radio, ${n} sendinger, regional radio, ${n} stasjoner`,
    regionH1: (n) => `${n} Radiostasjoner — Regionale Sendinger`,
    regionBodyIntro: (n) => `Utforsk radiostasjoner fra ${n}. Lytt gratis til regionale sendinger på Mega Radio.`,
    regionBodyAvailability: (n) => `Bla gjennom 60 000+ radiostasjoner fra 120+ land — ${n}-stasjoner tilgjengelige døgnet rundt.`,
  },
  fi: {
    countryTitle: (n) => `${n} Radioasemat - Kuuntele Suorana Verkossa | Mega Radio`,
    countryDescription: (n) => `Kuuntele live-radiota maasta ${n}. Löydä paikalliset ${n}-radioasemat ja ohjelmat ilmaiseksi Mega Radiossa.`,
    countryKeywords: (n) => `${n} radio, ${n} radioasemat, ${n} live radio, ${n} verkkoradio`,
    countryH1: (n) => `${n} Radioasemat — Kuuntele Suorana Verkossa`,
    countryBodyIntro: (n) => `Tutustu maan ${n} radioasemiin. Kuuntele paikallisia lähetyksiä ilmaiseksi Mega Radiossa.`,
    countryBodyAvailability: (n) => `Selaa yli 60 000 radioasemaa yli 120 maasta — ${n}-asemat saatavilla 24/7.`,
    regionTitle: (n) => `${n} Radioasemat - Alueelliset Lähetykset | Mega Radio`,
    regionDescription: (n) => `Tutustu alueen ${n} radioasemiin. Kuuntele alueellisia lähetyksiä ilmaiseksi Mega Radiossa.`,
    regionKeywords: (n) => `${n} radio, ${n} lähetykset, alueellinen radio, ${n} asemat`,
    regionH1: (n) => `${n} Radioasemat — Alueelliset Lähetykset`,
    regionBodyIntro: (n) => `Tutustu alueen ${n} radioasemiin. Kuuntele alueellisia lähetyksiä ilmaiseksi Mega Radiossa.`,
    regionBodyAvailability: (n) => `Selaa yli 60 000 radioasemaa yli 120 maasta — ${n}-asemat saatavilla 24/7.`,
  },
  el: {
    countryTitle: (n) => `Ραδιοφωνικοί Σταθμοί ${n} - Ακούστε Ζωντανά Online | Mega Radio`,
    countryDescription: (n) => `Ακούστε ζωντανό ραδιόφωνο από ${n}. Ανακαλύψτε τοπικούς σταθμούς και εκπομπές από ${n} δωρεάν στο Mega Radio.`,
    countryKeywords: (n) => `ραδιόφωνο ${n}, σταθμοί ${n}, ${n} ζωντανά, ${n} online ραδιόφωνο`,
    countryH1: (n) => `Ραδιοφωνικοί Σταθμοί ${n} — Ακούστε Ζωντανά Online`,
    countryBodyIntro: (n) => `Εξερευνήστε ραδιοφωνικούς σταθμούς από ${n}. Ακούστε τοπικές εκπομπές δωρεάν στο Mega Radio.`,
    countryBodyAvailability: (n) => `Περιηγηθείτε σε 60.000+ σταθμούς από 120+ χώρες — οι σταθμοί ${n} διαθέσιμοι 24/7.`,
    regionTitle: (n) => `Ραδιοφωνικοί Σταθμοί ${n} - Περιφερειακές Εκπομπές | Mega Radio`,
    regionDescription: (n) => `Εξερευνήστε ραδιοφωνικούς σταθμούς από ${n}. Ακούστε περιφερειακές εκπομπές από ${n} δωρεάν στο Mega Radio.`,
    regionKeywords: (n) => `ραδιόφωνο ${n}, εκπομπές ${n}, περιφερειακό ραδιόφωνο, σταθμοί ${n}`,
    regionH1: (n) => `Ραδιοφωνικοί Σταθμοί ${n} — Περιφερειακές Εκπομπές`,
    regionBodyIntro: (n) => `Εξερευνήστε ραδιοφωνικούς σταθμούς από ${n}. Ακούστε περιφερειακές εκπομπές δωρεάν στο Mega Radio.`,
    regionBodyAvailability: (n) => `Περιηγηθείτε σε 60.000+ σταθμούς από 120+ χώρες — οι σταθμοί ${n} διαθέσιμοι 24/7.`,
  },
  hu: {
    countryTitle: (n) => `${n} Rádióállomások - Hallgasd Élőben Online | Mega Radio`,
    countryDescription: (n) => `Hallgass élő rádiót innen: ${n}. Fedezd fel ${n} helyi rádióállomásait és műsorait ingyen a Mega Radión.`,
    countryKeywords: (n) => `${n} rádió, ${n} rádióállomások, ${n} élő rádió, ${n} online rádió`,
    countryH1: (n) => `${n} Rádióállomások — Hallgasd Élőben Online`,
    countryBodyIntro: (n) => `Fedezd fel ${n} rádióállomásait. Hallgasd a helyi adásokat ingyen a Mega Radión.`,
    countryBodyAvailability: (n) => `Böngéssz 60 000+ rádióállomás között 120+ országból — ${n} állomásai 0–24-ben elérhetők.`,
    regionTitle: (n) => `${n} Rádióállomások - Regionális Adások | Mega Radio`,
    regionDescription: (n) => `Fedezd fel ${n} rádióállomásait. Hallgasd a regionális adásokat ${n} területéről ingyen a Mega Radión.`,
    regionKeywords: (n) => `${n} rádió, ${n} adások, regionális rádió, ${n} állomások`,
    regionH1: (n) => `${n} Rádióállomások — Regionális Adások`,
    regionBodyIntro: (n) => `Fedezd fel ${n} rádióállomásait. Hallgasd a regionális adásokat ingyen a Mega Radión.`,
    regionBodyAvailability: (n) => `Böngéssz 60 000+ rádióállomás között 120+ országból — ${n} állomásai 0–24-ben elérhetők.`,
  },
  cs: {
    countryTitle: (n) => `Rádia ${n} - Poslouchejte Živě Online | Mega Radio`,
    countryDescription: (n) => `Poslouchejte živé rádio z ${n}. Objevte místní stanice a pořady z ${n} zdarma na Mega Radio.`,
    countryKeywords: (n) => `${n} rádio, stanice ${n}, ${n} živě, ${n} online rádio`,
    countryH1: (n) => `Rádia ${n} — Poslouchejte Živě Online`,
    countryBodyIntro: (n) => `Prozkoumejte rádiové stanice z ${n}. Poslouchejte místní vysílání zdarma na Mega Radio.`,
    countryBodyAvailability: (n) => `Procházejte přes 60 000 stanic ze 120+ zemí — stanice ${n} dostupné 24/7.`,
    regionTitle: (n) => `Rádia ${n} - Regionální Vysílání | Mega Radio`,
    regionDescription: (n) => `Prozkoumejte rádiové stanice z ${n}. Poslouchejte regionální vysílání z ${n} zdarma na Mega Radio.`,
    regionKeywords: (n) => `${n} rádio, vysílání ${n}, regionální rádio, stanice ${n}`,
    regionH1: (n) => `Rádia ${n} — Regionální Vysílání`,
    regionBodyIntro: (n) => `Prozkoumejte rádiové stanice z ${n}. Poslouchejte regionální vysílání zdarma na Mega Radio.`,
    regionBodyAvailability: (n) => `Procházejte přes 60 000 stanic ze 120+ zemí — stanice ${n} dostupné 24/7.`,
  },
  sk: {
    countryTitle: (n) => `Rádiá ${n} - Počúvajte Naživo Online | Mega Radio`,
    countryDescription: (n) => `Počúvajte živé rádio z ${n}. Objavte miestne stanice a relácie z ${n} zadarmo na Mega Radio.`,
    countryKeywords: (n) => `${n} rádio, stanice ${n}, ${n} naživo, ${n} online rádio`,
    countryH1: (n) => `Rádiá ${n} — Počúvajte Naživo Online`,
    countryBodyIntro: (n) => `Preskúmajte rádiové stanice z ${n}. Počúvajte miestne vysielanie zadarmo na Mega Radio.`,
    countryBodyAvailability: (n) => `Prechádzajte vyše 60 000 staníc zo 120+ krajín — stanice ${n} dostupné 24/7.`,
    regionTitle: (n) => `Rádiá ${n} - Regionálne Vysielanie | Mega Radio`,
    regionDescription: (n) => `Preskúmajte rádiové stanice z ${n}. Počúvajte regionálne vysielanie z ${n} zadarmo na Mega Radio.`,
    regionKeywords: (n) => `${n} rádio, vysielanie ${n}, regionálne rádio, stanice ${n}`,
    regionH1: (n) => `Rádiá ${n} — Regionálne Vysielanie`,
    regionBodyIntro: (n) => `Preskúmajte rádiové stanice z ${n}. Počúvajte regionálne vysielanie zadarmo na Mega Radio.`,
    regionBodyAvailability: (n) => `Prechádzajte vyše 60 000 staníc zo 120+ krajín — stanice ${n} dostupné 24/7.`,
  },
  ro: {
    countryTitle: (n) => `Posturi de Radio din ${n} - Ascultă Live Online | Mega Radio`,
    countryDescription: (n) => `Ascultă radio live din ${n}. Descoperă posturile locale și emisiunile din ${n} gratuit pe Mega Radio.`,
    countryKeywords: (n) => `radio ${n}, posturi ${n}, ${n} live, ${n} radio online`,
    countryH1: (n) => `Posturi de Radio din ${n} — Ascultă Live Online`,
    countryBodyIntro: (n) => `Explorează posturile de radio din ${n}. Ascultă transmisiunile locale gratuit pe Mega Radio.`,
    countryBodyAvailability: (n) => `Răsfoiește peste 60.000 de posturi de radio din peste 120 de țări — posturile din ${n} disponibile 24/7.`,
    regionTitle: (n) => `Posturi de Radio din ${n} - Transmisiuni Regionale | Mega Radio`,
    regionDescription: (n) => `Explorează posturile de radio din ${n}. Ascultă transmisiunile regionale din ${n} gratuit pe Mega Radio.`,
    regionKeywords: (n) => `radio ${n}, transmisiuni ${n}, radio regional, posturi ${n}`,
    regionH1: (n) => `Posturi de Radio din ${n} — Transmisiuni Regionale`,
    regionBodyIntro: (n) => `Explorează posturile de radio din ${n}. Ascultă transmisiunile regionale gratuit pe Mega Radio.`,
    regionBodyAvailability: (n) => `Răsfoiește peste 60.000 de posturi de radio din peste 120 de țări — posturile din ${n} disponibile 24/7.`,
  },
  bg: {
    countryTitle: (n) => `Радиостанции ${n} - Слушайте на Живо Онлайн | Mega Radio`,
    countryDescription: (n) => `Слушайте радио на живо от ${n}. Открийте местните радиостанции и предавания на ${n} безплатно в Mega Radio.`,
    countryKeywords: (n) => `${n} радио, радиостанции ${n}, ${n} на живо, ${n} онлайн радио`,
    countryH1: (n) => `Радиостанции ${n} — Слушайте на Живо Онлайн`,
    countryBodyIntro: (n) => `Разгледайте радиостанциите от ${n}. Слушайте местните излъчвания безплатно в Mega Radio.`,
    countryBodyAvailability: (n) => `Разгледайте над 60 000 радиостанции от 120+ държави — станциите от ${n} са достъпни 24/7.`,
    regionTitle: (n) => `Радиостанции ${n} - Регионално Излъчване | Mega Radio`,
    regionDescription: (n) => `Разгледайте радиостанциите от ${n}. Слушайте регионалното излъчване от ${n} безплатно в Mega Radio.`,
    regionKeywords: (n) => `${n} радио, излъчване ${n}, регионално радио, станции ${n}`,
    regionH1: (n) => `Радиостанции ${n} — Регионално Излъчване`,
    regionBodyIntro: (n) => `Разгледайте радиостанциите от ${n}. Слушайте регионалното излъчване безплатно в Mega Radio.`,
    regionBodyAvailability: (n) => `Разгледайте над 60 000 радиостанции от 120+ държави — станциите от ${n} са достъпни 24/7.`,
  },
  hr: {
    countryTitle: (n) => `Radio Postaje ${n} - Slušaj Uživo Online | Mega Radio`,
    countryDescription: (n) => `Slušaj radio uživo iz ${n}. Otkrij lokalne radio postaje i emisije iz ${n} besplatno na Mega Radio.`,
    countryKeywords: (n) => `${n} radio, radio postaje ${n}, ${n} uživo, ${n} online radio`,
    countryH1: (n) => `Radio Postaje ${n} — Slušaj Uživo Online`,
    countryBodyIntro: (n) => `Istraži radio postaje iz ${n}. Slušaj lokalne emisije besplatno na Mega Radio.`,
    countryBodyAvailability: (n) => `Pregledaj 60.000+ radio postaja iz 120+ zemalja — postaje iz ${n} dostupne 24/7.`,
    regionTitle: (n) => `Radio Postaje ${n} - Regionalno Emitiranje | Mega Radio`,
    regionDescription: (n) => `Istraži radio postaje iz ${n}. Slušaj regionalno emitiranje iz ${n} besplatno na Mega Radio.`,
    regionKeywords: (n) => `${n} radio, emitiranje ${n}, regionalni radio, postaje ${n}`,
    regionH1: (n) => `Radio Postaje ${n} — Regionalno Emitiranje`,
    regionBodyIntro: (n) => `Istraži radio postaje iz ${n}. Slušaj regionalno emitiranje besplatno na Mega Radio.`,
    regionBodyAvailability: (n) => `Pregledaj 60.000+ radio postaja iz 120+ zemalja — postaje iz ${n} dostupne 24/7.`,
  },
  sr: {
    countryTitle: (n) => `Радио Станице ${n} - Слушајте Уживо Онлајн | Mega Radio`,
    countryDescription: (n) => `Слушајте радио уживо из ${n}. Откријте локалне радио станице и емисије из ${n} бесплатно на Mega Radio.`,
    countryKeywords: (n) => `${n} радио, радио станице ${n}, ${n} уживо, ${n} онлајн радио`,
    countryH1: (n) => `Радио Станице ${n} — Слушајте Уживо Онлајн`,
    countryBodyIntro: (n) => `Истражите радио станице из ${n}. Слушајте локалне емисије бесплатно на Mega Radio.`,
    countryBodyAvailability: (n) => `Прегледајте преко 60.000 радио станица из 120+ земаља — станице из ${n} доступне 24/7.`,
    regionTitle: (n) => `Радио Станице ${n} - Регионално Емитовање | Mega Radio`,
    regionDescription: (n) => `Истражите радио станице из ${n}. Слушајте регионално емитовање из ${n} бесплатно на Mega Radio.`,
    regionKeywords: (n) => `${n} радио, емитовање ${n}, регионални радио, станице ${n}`,
    regionH1: (n) => `Радио Станице ${n} — Регионално Емитовање`,
    regionBodyIntro: (n) => `Истражите радио станице из ${n}. Слушајте регионално емитовање бесплатно на Mega Radio.`,
    regionBodyAvailability: (n) => `Прегледајте преко 60.000 радио станица из 120+ земаља — станице из ${n} доступне 24/7.`,
  },
  sl: {
    countryTitle: (n) => `Radijske Postaje ${n} - Poslušajte v Živo Online | Mega Radio`,
    countryDescription: (n) => `Poslušajte radio v živo iz ${n}. Odkrijte lokalne radijske postaje in oddaje iz ${n} brezplačno na Mega Radio.`,
    countryKeywords: (n) => `${n} radio, radijske postaje ${n}, ${n} v živo, ${n} spletni radio`,
    countryH1: (n) => `Radijske Postaje ${n} — Poslušajte v Živo Online`,
    countryBodyIntro: (n) => `Raziščite radijske postaje iz ${n}. Brezplačno poslušajte lokalne oddaje na Mega Radio.`,
    countryBodyAvailability: (n) => `Prebrskajte več kot 60.000 radijskih postaj iz 120+ držav — postaje iz ${n} dostopne 24/7.`,
    regionTitle: (n) => `Radijske Postaje ${n} - Regionalno Oddajanje | Mega Radio`,
    regionDescription: (n) => `Raziščite radijske postaje iz ${n}. Brezplačno poslušajte regionalno oddajanje iz ${n} na Mega Radio.`,
    regionKeywords: (n) => `${n} radio, oddajanje ${n}, regionalni radio, postaje ${n}`,
    regionH1: (n) => `Radijske Postaje ${n} — Regionalno Oddajanje`,
    regionBodyIntro: (n) => `Raziščite radijske postaje iz ${n}. Brezplačno poslušajte regionalno oddajanje na Mega Radio.`,
    regionBodyAvailability: (n) => `Prebrskajte več kot 60.000 radijskih postaj iz 120+ držav — postaje iz ${n} dostopne 24/7.`,
  },
  lv: {
    countryTitle: (n) => `${n} Radio Stacijas - Klausies Tiešraidē Tiešsaistē | Mega Radio`,
    countryDescription: (n) => `Klausies tiešraides radio no ${n}. Atklāj vietējās ${n} radio stacijas un raidījumus bez maksas Mega Radio.`,
    countryKeywords: (n) => `${n} radio, ${n} radio stacijas, ${n} tiešraide, ${n} tiešsaistes radio`,
    countryH1: (n) => `${n} Radio Stacijas — Klausies Tiešraidē Tiešsaistē`,
    countryBodyIntro: (n) => `Izpēti radio stacijas no ${n}. Klausies vietējās pārraides bez maksas Mega Radio.`,
    countryBodyAvailability: (n) => `Pārlūko vairāk nekā 60 000 radio staciju no 120+ valstīm — ${n} stacijas pieejamas 24/7.`,
    regionTitle: (n) => `${n} Radio Stacijas - Reģionālā Apraide | Mega Radio`,
    regionDescription: (n) => `Izpēti radio stacijas no ${n}. Klausies reģionālo apraidi no ${n} bez maksas Mega Radio.`,
    regionKeywords: (n) => `${n} radio, ${n} apraide, reģionālais radio, ${n} stacijas`,
    regionH1: (n) => `${n} Radio Stacijas — Reģionālā Apraide`,
    regionBodyIntro: (n) => `Izpēti radio stacijas no ${n}. Klausies reģionālo apraidi bez maksas Mega Radio.`,
    regionBodyAvailability: (n) => `Pārlūko vairāk nekā 60 000 radio staciju no 120+ valstīm — ${n} stacijas pieejamas 24/7.`,
  },
  lt: {
    countryTitle: (n) => `${n} Radijo Stotys - Klausykitės Tiesiogiai Internetu | Mega Radio`,
    countryDescription: (n) => `Klausykitės gyvo radijo iš ${n}. Atraskite vietines ${n} radijo stotis ir laidas nemokamai Mega Radio.`,
    countryKeywords: (n) => `${n} radijas, ${n} radijo stotys, ${n} tiesiogiai, ${n} internetinis radijas`,
    countryH1: (n) => `${n} Radijo Stotys — Klausykitės Tiesiogiai Internetu`,
    countryBodyIntro: (n) => `Naršykite radijo stotis iš ${n}. Klausykitės vietinių transliacijų nemokamai Mega Radio.`,
    countryBodyAvailability: (n) => `Naršykite daugiau nei 60 000 radijo stočių iš 120+ šalių — ${n} stotys pasiekiamos 24/7.`,
    regionTitle: (n) => `${n} Radijo Stotys - Regioninės Transliacijos | Mega Radio`,
    regionDescription: (n) => `Naršykite radijo stotis iš ${n}. Klausykitės regioninių transliacijų iš ${n} nemokamai Mega Radio.`,
    regionKeywords: (n) => `${n} radijas, ${n} transliacijos, regioninis radijas, ${n} stotys`,
    regionH1: (n) => `${n} Radijo Stotys — Regioninės Transliacijos`,
    regionBodyIntro: (n) => `Naršykite radijo stotis iš ${n}. Klausykitės regioninių transliacijų nemokamai Mega Radio.`,
    regionBodyAvailability: (n) => `Naršykite daugiau nei 60 000 radijo stočių iš 120+ šalių — ${n} stotys pasiekiamos 24/7.`,
  },
  et: {
    countryTitle: (n) => `${n} Raadiojaamad - Kuula Otse Online | Mega Radio`,
    countryDescription: (n) => `Kuula otseülekande raadiot riigist ${n}. Avasta ${n} kohalikud raadiojaamad ja saated tasuta Mega Radios.`,
    countryKeywords: (n) => `${n} raadio, ${n} raadiojaamad, ${n} otse, ${n} online raadio`,
    countryH1: (n) => `${n} Raadiojaamad — Kuula Otse Online`,
    countryBodyIntro: (n) => `Avasta ${n} raadiojaamu. Kuula kohalikke saateid tasuta Mega Radios.`,
    countryBodyAvailability: (n) => `Sirvi üle 60 000 raadiojaama 120+ riigist — ${n} jaamad saadaval 24/7.`,
    regionTitle: (n) => `${n} Raadiojaamad - Piirkondlik Ringhääling | Mega Radio`,
    regionDescription: (n) => `Avasta ${n} raadiojaamu. Kuula piirkondlikku ringhäälingut riigist ${n} tasuta Mega Radios.`,
    regionKeywords: (n) => `${n} raadio, ${n} ringhääling, piirkondlik raadio, ${n} jaamad`,
    regionH1: (n) => `${n} Raadiojaamad — Piirkondlik Ringhääling`,
    regionBodyIntro: (n) => `Avasta ${n} raadiojaamu. Kuula piirkondlikku ringhäälingut tasuta Mega Radios.`,
    regionBodyAvailability: (n) => `Sirvi üle 60 000 raadiojaama 120+ riigist — ${n} jaamad saadaval 24/7.`,
  },
  th: {
    countryTitle: (n) => `สถานีวิทยุ ${n} - ฟังสดออนไลน์ | Mega Radio`,
    countryDescription: (n) => `ฟังวิทยุสดจาก ${n} ค้นพบสถานีวิทยุท้องถิ่นและรายการของ ${n} ฟรีบน Mega Radio`,
    countryKeywords: (n) => `วิทยุ ${n}, สถานีวิทยุ ${n}, ${n} ฟังสด, วิทยุออนไลน์ ${n}`,
    countryH1: (n) => `สถานีวิทยุ ${n} — ฟังสดออนไลน์`,
    countryBodyIntro: (n) => `สำรวจสถานีวิทยุจาก ${n} ฟังการกระจายเสียงท้องถิ่นฟรีบน Mega Radio`,
    countryBodyAvailability: (n) => `เลือกชมสถานีวิทยุกว่า 60,000 แห่งจาก 120+ ประเทศ — สถานีจาก ${n} พร้อมให้ฟัง 24/7`,
    regionTitle: (n) => `สถานีวิทยุ ${n} - การกระจายเสียงในภูมิภาค | Mega Radio`,
    regionDescription: (n) => `สำรวจสถานีวิทยุจาก ${n} ฟังการกระจายเสียงในภูมิภาค ${n} ฟรีบน Mega Radio`,
    regionKeywords: (n) => `วิทยุ ${n}, การกระจายเสียง ${n}, วิทยุภูมิภาค, สถานี ${n}`,
    regionH1: (n) => `สถานีวิทยุ ${n} — การกระจายเสียงในภูมิภาค`,
    regionBodyIntro: (n) => `สำรวจสถานีวิทยุจาก ${n} ฟังการกระจายเสียงในภูมิภาคฟรีบน Mega Radio`,
    regionBodyAvailability: (n) => `เลือกชมสถานีวิทยุกว่า 60,000 แห่งจาก 120+ ประเทศ — สถานีจาก ${n} พร้อมให้ฟัง 24/7`,
  },
  vi: {
    countryTitle: (n) => `Đài Phát Thanh ${n} - Nghe Trực Tiếp Online | Mega Radio`,
    countryDescription: (n) => `Nghe radio trực tiếp từ ${n}. Khám phá các đài phát thanh và chương trình địa phương của ${n} miễn phí trên Mega Radio.`,
    countryKeywords: (n) => `radio ${n}, đài ${n}, ${n} trực tiếp, radio online ${n}`,
    countryH1: (n) => `Đài Phát Thanh ${n} — Nghe Trực Tiếp Online`,
    countryBodyIntro: (n) => `Khám phá các đài phát thanh từ ${n}. Nghe phát sóng địa phương miễn phí trên Mega Radio.`,
    countryBodyAvailability: (n) => `Duyệt hơn 60.000 đài phát thanh từ hơn 120 quốc gia — các đài ${n} sẵn có 24/7.`,
    regionTitle: (n) => `Đài Phát Thanh ${n} - Phát Sóng Khu Vực | Mega Radio`,
    regionDescription: (n) => `Khám phá các đài phát thanh từ ${n}. Nghe phát sóng khu vực ${n} miễn phí trên Mega Radio.`,
    regionKeywords: (n) => `radio ${n}, phát sóng ${n}, radio khu vực, đài ${n}`,
    regionH1: (n) => `Đài Phát Thanh ${n} — Phát Sóng Khu Vực`,
    regionBodyIntro: (n) => `Khám phá các đài phát thanh từ ${n}. Nghe phát sóng khu vực miễn phí trên Mega Radio.`,
    regionBodyAvailability: (n) => `Duyệt hơn 60.000 đài phát thanh từ hơn 120 quốc gia — các đài ${n} sẵn có 24/7.`,
  },
  id: {
    countryTitle: (n) => `Stasiun Radio ${n} - Dengarkan Langsung Online | Mega Radio`,
    countryDescription: (n) => `Dengarkan radio langsung dari ${n}. Temukan stasiun radio lokal dan acara dari ${n} gratis di Mega Radio.`,
    countryKeywords: (n) => `radio ${n}, stasiun radio ${n}, ${n} langsung, radio online ${n}`,
    countryH1: (n) => `Stasiun Radio ${n} — Dengarkan Langsung Online`,
    countryBodyIntro: (n) => `Jelajahi stasiun radio dari ${n}. Dengarkan siaran lokal gratis di Mega Radio.`,
    countryBodyAvailability: (n) => `Jelajahi lebih dari 60.000 stasiun radio dari 120+ negara — stasiun ${n} tersedia 24/7.`,
    regionTitle: (n) => `Stasiun Radio ${n} - Siaran Regional | Mega Radio`,
    regionDescription: (n) => `Jelajahi stasiun radio dari ${n}. Dengarkan siaran regional dari ${n} gratis di Mega Radio.`,
    regionKeywords: (n) => `radio ${n}, siaran ${n}, radio regional, stasiun ${n}`,
    regionH1: (n) => `Stasiun Radio ${n} — Siaran Regional`,
    regionBodyIntro: (n) => `Jelajahi stasiun radio dari ${n}. Dengarkan siaran regional gratis di Mega Radio.`,
    regionBodyAvailability: (n) => `Jelajahi lebih dari 60.000 stasiun radio dari 120+ negara — stasiun ${n} tersedia 24/7.`,
  },
  ms: {
    countryTitle: (n) => `Stesen Radio ${n} - Dengar Langsung Dalam Talian | Mega Radio`,
    countryDescription: (n) => `Dengar radio langsung dari ${n}. Terokai stesen radio tempatan dan rancangan dari ${n} secara percuma di Mega Radio.`,
    countryKeywords: (n) => `radio ${n}, stesen radio ${n}, ${n} langsung, radio dalam talian ${n}`,
    countryH1: (n) => `Stesen Radio ${n} — Dengar Langsung Dalam Talian`,
    countryBodyIntro: (n) => `Terokai stesen radio dari ${n}. Dengar siaran tempatan secara percuma di Mega Radio.`,
    countryBodyAvailability: (n) => `Lihat lebih 60,000 stesen radio dari 120+ negara — stesen ${n} tersedia 24/7.`,
    regionTitle: (n) => `Stesen Radio ${n} - Siaran Serantau | Mega Radio`,
    regionDescription: (n) => `Terokai stesen radio dari ${n}. Dengar siaran serantau dari ${n} secara percuma di Mega Radio.`,
    regionKeywords: (n) => `radio ${n}, siaran ${n}, radio serantau, stesen ${n}`,
    regionH1: (n) => `Stesen Radio ${n} — Siaran Serantau`,
    regionBodyIntro: (n) => `Terokai stesen radio dari ${n}. Dengar siaran serantau secara percuma di Mega Radio.`,
    regionBodyAvailability: (n) => `Lihat lebih 60,000 stesen radio dari 120+ negara — stesen ${n} tersedia 24/7.`,
  },
  tl: {
    countryTitle: (n) => `Mga Istasyon ng Radyo ng ${n} - Makinig Live Online | Mega Radio`,
    countryDescription: (n) => `Makinig sa live na radyo mula sa ${n}. Tuklasin ang mga lokal na istasyon at palatuntunan ng ${n} nang libre sa Mega Radio.`,
    countryKeywords: (n) => `radyo ${n}, istasyon ng radyo ${n}, ${n} live, ${n} online radyo`,
    countryH1: (n) => `Mga Istasyon ng Radyo ng ${n} — Makinig Live Online`,
    countryBodyIntro: (n) => `Tuklasin ang mga istasyon ng radyo mula sa ${n}. Makinig sa lokal na pagsasahimpapawid nang libre sa Mega Radio.`,
    countryBodyAvailability: (n) => `Mag-browse ng 60,000+ na istasyon ng radyo mula sa 120+ bansa — mga istasyon ng ${n} 24/7.`,
    regionTitle: (n) => `Mga Istasyon ng Radyo ng ${n} - Panrehiyong Pagsasahimpapawid | Mega Radio`,
    regionDescription: (n) => `Tuklasin ang mga istasyon ng radyo mula sa ${n}. Makinig sa panrehiyong pagsasahimpapawid ng ${n} nang libre sa Mega Radio.`,
    regionKeywords: (n) => `radyo ${n}, pagsasahimpapawid ${n}, panrehiyong radyo, istasyon ${n}`,
    regionH1: (n) => `Mga Istasyon ng Radyo ng ${n} — Panrehiyong Pagsasahimpapawid`,
    regionBodyIntro: (n) => `Tuklasin ang mga istasyon ng radyo mula sa ${n}. Makinig sa panrehiyong pagsasahimpapawid nang libre sa Mega Radio.`,
    regionBodyAvailability: (n) => `Mag-browse ng 60,000+ na istasyon ng radyo mula sa 120+ bansa — mga istasyon ng ${n} 24/7.`,
  },
  he: {
    countryTitle: (n) => `תחנות רדיו ${n} - האזינו בשידור חי אונליין | Mega Radio`,
    countryDescription: (n) => `האזינו לרדיו בשידור חי מ-${n}. גלו תחנות רדיו ותוכניות מקומיות מ-${n} בחינם ב-Mega Radio.`,
    countryKeywords: (n) => `רדיו ${n}, תחנות רדיו ${n}, ${n} שידור חי, רדיו אונליין ${n}`,
    countryH1: (n) => `תחנות רדיו ${n} — האזינו בשידור חי אונליין`,
    countryBodyIntro: (n) => `גלו תחנות רדיו מ-${n}. האזינו לשידורים מקומיים בחינם ב-Mega Radio.`,
    countryBodyAvailability: (n) => `דפדפו בין 60,000+ תחנות רדיו מ-120+ מדינות — תחנות ${n} זמינות 24/7.`,
    regionTitle: (n) => `תחנות רדיו ${n} - שידור אזורי | Mega Radio`,
    regionDescription: (n) => `גלו תחנות רדיו מ-${n}. האזינו לשידור אזורי מ-${n} בחינם ב-Mega Radio.`,
    regionKeywords: (n) => `רדיו ${n}, שידור ${n}, רדיו אזורי, תחנות ${n}`,
    regionH1: (n) => `תחנות רדיו ${n} — שידור אזורי`,
    regionBodyIntro: (n) => `גלו תחנות רדיו מ-${n}. האזינו לשידור אזורי בחינם ב-Mega Radio.`,
    regionBodyAvailability: (n) => `דפדפו בין 60,000+ תחנות רדיו מ-120+ מדינות — תחנות ${n} זמינות 24/7.`,
  },
  fa: {
    countryTitle: (n) => `ایستگاه‌های رادیویی ${n} - گوش دادن زنده آنلاین | Mega Radio`,
    countryDescription: (n) => `رادیو زنده ${n} را گوش دهید. ایستگاه‌های رادیویی محلی و برنامه‌های ${n} را رایگان در Mega Radio کشف کنید.`,
    countryKeywords: (n) => `رادیو ${n}, ایستگاه‌های ${n}, ${n} زنده, رادیو آنلاین ${n}`,
    countryH1: (n) => `ایستگاه‌های رادیویی ${n} — گوش دادن زنده آنلاین`,
    countryBodyIntro: (n) => `ایستگاه‌های رادیویی ${n} را کاوش کنید. به پخش محلی رایگان در Mega Radio گوش دهید.`,
    countryBodyAvailability: (n) => `بیش از ۶۰,۰۰۰ ایستگاه رادیویی از بیش از ۱۲۰ کشور را مرور کنید — ایستگاه‌های ${n} ۲۴/۷ در دسترس هستند.`,
    regionTitle: (n) => `ایستگاه‌های رادیویی ${n} - پخش منطقه‌ای | Mega Radio`,
    regionDescription: (n) => `ایستگاه‌های رادیویی ${n} را کاوش کنید. به پخش منطقه‌ای ${n} رایگان در Mega Radio گوش دهید.`,
    regionKeywords: (n) => `رادیو ${n}, پخش ${n}, رادیو منطقه‌ای, ایستگاه‌های ${n}`,
    regionH1: (n) => `ایستگاه‌های رادیویی ${n} — پخش منطقه‌ای`,
    regionBodyIntro: (n) => `ایستگاه‌های رادیویی ${n} را کاوش کنید. به پخش منطقه‌ای رایگان در Mega Radio گوش دهید.`,
    regionBodyAvailability: (n) => `بیش از ۶۰,۰۰۰ ایستگاه رادیویی از بیش از ۱۲۰ کشور را مرور کنید — ایستگاه‌های ${n} ۲۴/۷ در دسترس هستند.`,
  },
  ur: {
    countryTitle: (n) => `${n} ریڈیو اسٹیشنز - آن لائن لائیو سنیں | Mega Radio`,
    countryDescription: (n) => `${n} سے لائیو ریڈیو سنیں۔ Mega Radio پر ${n} کے مقامی ریڈیو اسٹیشنز اور پروگرام مفت دریافت کریں۔`,
    countryKeywords: (n) => `${n} ریڈیو, ${n} ریڈیو اسٹیشنز, ${n} لائیو, ${n} آن لائن ریڈیو`,
    countryH1: (n) => `${n} ریڈیو اسٹیشنز — آن لائن لائیو سنیں`,
    countryBodyIntro: (n) => `${n} کے ریڈیو اسٹیشنز دریافت کریں۔ Mega Radio پر مقامی نشریات مفت سنیں۔`,
    countryBodyAvailability: (n) => `120+ ممالک سے 60,000+ ریڈیو اسٹیشنز براؤز کریں — ${n} کے اسٹیشنز 24/7 دستیاب ہیں۔`,
    regionTitle: (n) => `${n} ریڈیو اسٹیشنز - علاقائی نشریات | Mega Radio`,
    regionDescription: (n) => `${n} کے ریڈیو اسٹیشنز دریافت کریں۔ Mega Radio پر ${n} کی علاقائی نشریات مفت سنیں۔`,
    regionKeywords: (n) => `${n} ریڈیو, ${n} نشریات, علاقائی ریڈیو, ${n} اسٹیشنز`,
    regionH1: (n) => `${n} ریڈیو اسٹیشنز — علاقائی نشریات`,
    regionBodyIntro: (n) => `${n} کے ریڈیو اسٹیشنز دریافت کریں۔ Mega Radio پر علاقائی نشریات مفت سنیں۔`,
    regionBodyAvailability: (n) => `120+ ممالک سے 60,000+ ریڈیو اسٹیشنز براؤز کریں — ${n} کے اسٹیشنز 24/7 دستیاب ہیں۔`,
  },
  bn: {
    countryTitle: (n) => `${n} রেডিও স্টেশন - অনলাইনে লাইভ শুনুন | Mega Radio`,
    countryDescription: (n) => `${n} থেকে লাইভ রেডিও শুনুন। Mega Radio-এ ${n}-এর স্থানীয় রেডিও স্টেশন এবং অনুষ্ঠান বিনামূল্যে আবিষ্কার করুন।`,
    countryKeywords: (n) => `${n} রেডিও, ${n} রেডিও স্টেশন, ${n} লাইভ, ${n} অনলাইন রেডিও`,
    countryH1: (n) => `${n} রেডিও স্টেশন — অনলাইনে লাইভ শুনুন`,
    countryBodyIntro: (n) => `${n}-এর রেডিও স্টেশন অন্বেষণ করুন। Mega Radio-এ স্থানীয় সম্প্রচার বিনামূল্যে শুনুন।`,
    countryBodyAvailability: (n) => `১২০+ দেশের ৬০,০০০+ রেডিও স্টেশন ব্রাউজ করুন — ${n}-এর স্টেশন ২৪/৭ উপলব্ধ।`,
    regionTitle: (n) => `${n} রেডিও স্টেশন - আঞ্চলিক সম্প্রচার | Mega Radio`,
    regionDescription: (n) => `${n}-এর রেডিও স্টেশন অন্বেষণ করুন। Mega Radio-এ ${n}-এর আঞ্চলিক সম্প্রচার বিনামূল্যে শুনুন।`,
    regionKeywords: (n) => `${n} রেডিও, ${n} সম্প্রচার, আঞ্চলিক রেডিও, ${n} স্টেশন`,
    regionH1: (n) => `${n} রেডিও স্টেশন — আঞ্চলিক সম্প্রচার`,
    regionBodyIntro: (n) => `${n}-এর রেডিও স্টেশন অন্বেষণ করুন। Mega Radio-এ আঞ্চলিক সম্প্রচার বিনামূল্যে শুনুন।`,
    regionBodyAvailability: (n) => `১২০+ দেশের ৬০,০০০+ রেডিও স্টেশন ব্রাউজ করুন — ${n}-এর স্টেশন ২৪/৭ উপলব্ধ।`,
  },
  ta: {
    countryTitle: (n) => `${n} வானொலி நிலையங்கள் - ஆன்லைனில் நேரலையாக கேளுங்கள் | Mega Radio`,
    countryDescription: (n) => `${n} இலிருந்து நேரலை வானொலியைக் கேளுங்கள். Mega Radio இல் ${n} உள்ளூர் வானொலி நிலையங்கள் மற்றும் நிகழ்ச்சிகளை இலவசமாக கண்டறியுங்கள்.`,
    countryKeywords: (n) => `${n} வானொலி, ${n} வானொலி நிலையங்கள், ${n} நேரலை, ${n} ஆன்லைன் வானொலி`,
    countryH1: (n) => `${n} வானொலி நிலையங்கள் — ஆன்லைனில் நேரலையாக கேளுங்கள்`,
    countryBodyIntro: (n) => `${n} வானொலி நிலையங்களை ஆராயுங்கள். Mega Radio இல் உள்ளூர் ஒளிபரப்புகளை இலவசமாக கேளுங்கள்.`,
    countryBodyAvailability: (n) => `120+ நாடுகளிலிருந்து 60,000+ வானொலி நிலையங்களை உலாவுங்கள் — ${n} நிலையங்கள் 24/7 கிடைக்கின்றன.`,
    regionTitle: (n) => `${n} வானொலி நிலையங்கள் - பிராந்திய ஒளிபரப்பு | Mega Radio`,
    regionDescription: (n) => `${n} வானொலி நிலையங்களை ஆராயுங்கள். Mega Radio இல் ${n} பிராந்திய ஒளிபரப்புகளை இலவசமாக கேளுங்கள்.`,
    regionKeywords: (n) => `${n} வானொலி, ${n} ஒளிபரப்பு, பிராந்திய வானொலி, ${n} நிலையங்கள்`,
    regionH1: (n) => `${n} வானொலி நிலையங்கள் — பிராந்திய ஒளிபரப்பு`,
    regionBodyIntro: (n) => `${n} வானொலி நிலையங்களை ஆராயுங்கள். Mega Radio இல் பிராந்திய ஒளிபரப்புகளை இலவசமாக கேளுங்கள்.`,
    regionBodyAvailability: (n) => `120+ நாடுகளிலிருந்து 60,000+ வானொலி நிலையங்களை உலாவுங்கள் — ${n} நிலையங்கள் 24/7 கிடைக்கின்றன.`,
  },
  te: {
    countryTitle: (n) => `${n} రేడియో స్టేషన్లు - ఆన్‌లైన్‌లో లైవ్ వినండి | Mega Radio`,
    countryDescription: (n) => `${n} నుండి లైవ్ రేడియోను వినండి. Mega Radioలో ${n} స్థానిక రేడియో స్టేషన్లు మరియు షోలను ఉచితంగా కనుగొనండి.`,
    countryKeywords: (n) => `${n} రేడియో, ${n} రేడియో స్టేషన్లు, ${n} లైవ్, ${n} ఆన్‌లైన్ రేడియో`,
    countryH1: (n) => `${n} రేడియో స్టేషన్లు — ఆన్‌లైన్‌లో లైవ్ వినండి`,
    countryBodyIntro: (n) => `${n} రేడియో స్టేషన్లను అన్వేషించండి. Mega Radioలో స్థానిక ప్రసారాలను ఉచితంగా వినండి.`,
    countryBodyAvailability: (n) => `120+ దేశాల నుండి 60,000+ రేడియో స్టేషన్లను బ్రౌజ్ చేయండి — ${n} స్టేషన్లు 24/7 అందుబాటులో ఉన్నాయి.`,
    regionTitle: (n) => `${n} రేడియో స్టేషన్లు - ప్రాంతీయ ప్రసారం | Mega Radio`,
    regionDescription: (n) => `${n} రేడియో స్టేషన్లను అన్వేషించండి. Mega Radioలో ${n} ప్రాంతీయ ప్రసారాన్ని ఉచితంగా వినండి.`,
    regionKeywords: (n) => `${n} రేడియో, ${n} ప్రసారం, ప్రాంతీయ రేడియో, ${n} స్టేషన్లు`,
    regionH1: (n) => `${n} రేడియో స్టేషన్లు — ప్రాంతీయ ప్రసారం`,
    regionBodyIntro: (n) => `${n} రేడియో స్టేషన్లను అన్వేషించండి. Mega Radioలో ప్రాంతీయ ప్రసారాన్ని ఉచితంగా వినండి.`,
    regionBodyAvailability: (n) => `120+ దేశాల నుండి 60,000+ రేడియో స్టేషన్లను బ్రౌజ్ చేయండి — ${n} స్టేషన్లు 24/7 అందుబాటులో ఉన్నాయి.`,
  },
  mr: {
    countryTitle: (n) => `${n} रेडिओ स्टेशन्स - ऑनलाइन थेट ऐका | Mega Radio`,
    countryDescription: (n) => `${n} वरून थेट रेडिओ ऐका. Mega Radio वर ${n} ची स्थानिक रेडिओ स्टेशन्स आणि कार्यक्रम विनामूल्य शोधा.`,
    countryKeywords: (n) => `${n} रेडिओ, ${n} रेडिओ स्टेशन्स, ${n} थेट, ${n} ऑनलाइन रेडिओ`,
    countryH1: (n) => `${n} रेडिओ स्टेशन्स — ऑनलाइन थेट ऐका`,
    countryBodyIntro: (n) => `${n} ची रेडिओ स्टेशन्स एक्सप्लोर करा. Mega Radio वर स्थानिक प्रक्षेपण विनामूल्य ऐका.`,
    countryBodyAvailability: (n) => `120+ देशांतील 60,000+ रेडिओ स्टेशन्स ब्राउझ करा — ${n} ची स्टेशन्स 24/7 उपलब्ध.`,
    regionTitle: (n) => `${n} रेडिओ स्टेशन्स - प्रादेशिक प्रक्षेपण | Mega Radio`,
    regionDescription: (n) => `${n} ची रेडिओ स्टेशन्स एक्सप्लोर करा. Mega Radio वर ${n} चे प्रादेशिक प्रक्षेपण विनामूल्य ऐका.`,
    regionKeywords: (n) => `${n} रेडिओ, ${n} प्रक्षेपण, प्रादेशिक रेडिओ, ${n} स्टेशन्स`,
    regionH1: (n) => `${n} रेडिओ स्टेशन्स — प्रादेशिक प्रक्षेपण`,
    regionBodyIntro: (n) => `${n} ची रेडिओ स्टेशन्स एक्सप्लोर करा. Mega Radio वर प्रादेशिक प्रक्षेपण विनामूल्य ऐका.`,
    regionBodyAvailability: (n) => `120+ देशांतील 60,000+ रेडिओ स्टेशन्स ब्राउझ करा — ${n} ची स्टेशन्स 24/7 उपलब्ध.`,
  },
  gu: {
    countryTitle: (n) => `${n} રેડિયો સ્ટેશન - ઓનલાઇન લાઇવ સાંભળો | Mega Radio`,
    countryDescription: (n) => `${n} થી લાઇવ રેડિયો સાંભળો. Mega Radio પર ${n} ના સ્થાનિક રેડિયો સ્ટેશન અને કાર્યક્રમો મફતમાં શોધો.`,
    countryKeywords: (n) => `${n} રેડિયો, ${n} રેડિયો સ્ટેશન, ${n} લાઇવ, ${n} ઓનલાઇન રેડિયો`,
    countryH1: (n) => `${n} રેડિયો સ્ટેશન — ઓનલાઇન લાઇવ સાંભળો`,
    countryBodyIntro: (n) => `${n} ના રેડિયો સ્ટેશનો અન્વેષણ કરો. Mega Radio પર સ્થાનિક પ્રસારણ મફતમાં સાંભળો.`,
    countryBodyAvailability: (n) => `120+ દેશોમાંથી 60,000+ રેડિયો સ્ટેશનો બ્રાઉઝ કરો — ${n} ના સ્ટેશનો 24/7 ઉપલબ્ધ.`,
    regionTitle: (n) => `${n} રેડિયો સ્ટેશન - પ્રાદેશિક પ્રસારણ | Mega Radio`,
    regionDescription: (n) => `${n} ના રેડિયો સ્ટેશનો અન્વેષણ કરો. Mega Radio પર ${n} નું પ્રાદેશિક પ્રસારણ મફતમાં સાંભળો.`,
    regionKeywords: (n) => `${n} રેડિયો, ${n} પ્રસારણ, પ્રાદેશિક રેડિયો, ${n} સ્ટેશન`,
    regionH1: (n) => `${n} રેડિયો સ્ટેશન — પ્રાદેશિક પ્રસારણ`,
    regionBodyIntro: (n) => `${n} ના રેડિયો સ્ટેશનો અન્વેષણ કરો. Mega Radio પર પ્રાદેશિક પ્રસારણ મફતમાં સાંભળો.`,
    regionBodyAvailability: (n) => `120+ દેશોમાંથી 60,000+ રેડિયો સ્ટેશનો બ્રાઉઝ કરો — ${n} ના સ્ટેશનો 24/7 ઉપલબ્ધ.`,
  },
  kn: {
    countryTitle: (n) => `${n} ರೇಡಿಯೋ ಕೇಂದ್ರಗಳು - ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ನೇರ ಪ್ರಸಾರ ಕೇಳಿ | Mega Radio`,
    countryDescription: (n) => `${n} ನಿಂದ ನೇರ ರೇಡಿಯೋ ಕೇಳಿ. Mega Radio ನಲ್ಲಿ ${n} ನ ಸ್ಥಳೀಯ ರೇಡಿಯೋ ಕೇಂದ್ರಗಳು ಮತ್ತು ಕಾರ್ಯಕ್ರಮಗಳನ್ನು ಉಚಿತವಾಗಿ ಅನ್ವೇಷಿಸಿ.`,
    countryKeywords: (n) => `${n} ರೇಡಿಯೋ, ${n} ರೇಡಿಯೋ ಕೇಂದ್ರಗಳು, ${n} ನೇರ, ${n} ಆನ್‌ಲೈನ್ ರೇಡಿಯೋ`,
    countryH1: (n) => `${n} ರೇಡಿಯೋ ಕೇಂದ್ರಗಳು — ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ನೇರ ಪ್ರಸಾರ ಕೇಳಿ`,
    countryBodyIntro: (n) => `${n} ನ ರೇಡಿಯೋ ಕೇಂದ್ರಗಳನ್ನು ಅನ್ವೇಷಿಸಿ. Mega Radio ನಲ್ಲಿ ಸ್ಥಳೀಯ ಪ್ರಸಾರವನ್ನು ಉಚಿತವಾಗಿ ಕೇಳಿ.`,
    countryBodyAvailability: (n) => `120+ ದೇಶಗಳ 60,000+ ರೇಡಿಯೋ ಕೇಂದ್ರಗಳನ್ನು ಬ್ರೌಸ್ ಮಾಡಿ — ${n} ಕೇಂದ್ರಗಳು 24/7 ಲಭ್ಯ.`,
    regionTitle: (n) => `${n} ರೇಡಿಯೋ ಕೇಂದ್ರಗಳು - ಪ್ರಾದೇಶಿಕ ಪ್ರಸಾರ | Mega Radio`,
    regionDescription: (n) => `${n} ನ ರೇಡಿಯೋ ಕೇಂದ್ರಗಳನ್ನು ಅನ್ವೇಷಿಸಿ. Mega Radio ನಲ್ಲಿ ${n} ನ ಪ್ರಾದೇಶಿಕ ಪ್ರಸಾರವನ್ನು ಉಚಿತವಾಗಿ ಕೇಳಿ.`,
    regionKeywords: (n) => `${n} ರೇಡಿಯೋ, ${n} ಪ್ರಸಾರ, ಪ್ರಾದೇಶಿಕ ರೇಡಿಯೋ, ${n} ಕೇಂದ್ರಗಳು`,
    regionH1: (n) => `${n} ರೇಡಿಯೋ ಕೇಂದ್ರಗಳು — ಪ್ರಾದೇಶಿಕ ಪ್ರಸಾರ`,
    regionBodyIntro: (n) => `${n} ನ ರೇಡಿಯೋ ಕೇಂದ್ರಗಳನ್ನು ಅನ್ವೇಷಿಸಿ. Mega Radio ನಲ್ಲಿ ಪ್ರಾದೇಶಿಕ ಪ್ರಸಾರವನ್ನು ಉಚಿತವಾಗಿ ಕೇಳಿ.`,
    regionBodyAvailability: (n) => `120+ ದೇಶಗಳ 60,000+ ರೇಡಿಯೋ ಕೇಂದ್ರಗಳನ್ನು ಬ್ರೌಸ್ ಮಾಡಿ — ${n} ಕೇಂದ್ರಗಳು 24/7 ಲಭ್ಯ.`,
  },
  ml: {
    countryTitle: (n) => `${n} റേഡിയോ സ്റ്റേഷനുകൾ - ഓൺലൈനിൽ തത്സമയം കേൾക്കുക | Mega Radio`,
    countryDescription: (n) => `${n} ൽ നിന്നുള്ള തത്സമയ റേഡിയോ കേൾക്കുക. Mega Radio യിൽ ${n} ന്റെ പ്രാദേശിക റേഡിയോ സ്റ്റേഷനുകളും പരിപാടികളും സൗജന്യമായി കണ്ടെത്തുക.`,
    countryKeywords: (n) => `${n} റേഡിയോ, ${n} റേഡിയോ സ്റ്റേഷനുകൾ, ${n} തത്സമയം, ${n} ഓൺലൈൻ റേഡിയോ`,
    countryH1: (n) => `${n} റേഡിയോ സ്റ്റേഷനുകൾ — ഓൺലൈനിൽ തത്സമയം കേൾക്കുക`,
    countryBodyIntro: (n) => `${n} ന്റെ റേഡിയോ സ്റ്റേഷനുകൾ പര്യവേക്ഷണം ചെയ്യുക. Mega Radio യിൽ പ്രാദേശിക സംപ്രേഷണം സൗജന്യമായി കേൾക്കുക.`,
    countryBodyAvailability: (n) => `120+ രാജ്യങ്ങളിൽ നിന്നുള്ള 60,000+ റേഡിയോ സ്റ്റേഷനുകൾ ബ്രൗസ് ചെയ്യുക — ${n} സ്റ്റേഷനുകൾ 24/7 ലഭ്യം.`,
    regionTitle: (n) => `${n} റേഡിയോ സ്റ്റേഷനുകൾ - പ്രാദേശിക സംപ്രേഷണം | Mega Radio`,
    regionDescription: (n) => `${n} ന്റെ റേഡിയോ സ്റ്റേഷനുകൾ പര്യവേക്ഷണം ചെയ്യുക. Mega Radio യിൽ ${n} ന്റെ പ്രാദേശിക സംപ്രേഷണം സൗജന്യമായി കേൾക്കുക.`,
    regionKeywords: (n) => `${n} റേഡിയോ, ${n} സംപ്രേഷണം, പ്രാദേശിക റേഡിയോ, ${n} സ്റ്റേഷനുകൾ`,
    regionH1: (n) => `${n} റേഡിയോ സ്റ്റേഷനുകൾ — പ്രാദേശിക സംപ്രേഷണം`,
    regionBodyIntro: (n) => `${n} ന്റെ റേഡിയോ സ്റ്റേഷനുകൾ പര്യവേക്ഷണം ചെയ്യുക. Mega Radio യിൽ പ്രാദേശിക സംപ്രേഷണം സൗജന്യമായി കേൾക്കുക.`,
    regionBodyAvailability: (n) => `120+ രാജ്യങ്ങളിൽ നിന്നുള്ള 60,000+ റേഡിയോ സ്റ്റേഷനുകൾ ബ്രൗസ് ചെയ്യുക — ${n} സ്റ്റേഷനുകൾ 24/7 ലഭ്യം.`,
  },
  pa: {
    countryTitle: (n) => `${n} ਰੇਡੀਓ ਸਟੇਸ਼ਨ - ਆਨਲਾਈਨ ਲਾਈਵ ਸੁਣੋ | Mega Radio`,
    countryDescription: (n) => `${n} ਤੋਂ ਲਾਈਵ ਰੇਡੀਓ ਸੁਣੋ। Mega Radio 'ਤੇ ${n} ਦੇ ਸਥਾਨਕ ਰੇਡੀਓ ਸਟੇਸ਼ਨ ਅਤੇ ਪ੍ਰੋਗਰਾਮ ਮੁਫ਼ਤ ਖੋਜੋ।`,
    countryKeywords: (n) => `${n} ਰੇਡੀਓ, ${n} ਰੇਡੀਓ ਸਟੇਸ਼ਨ, ${n} ਲਾਈਵ, ${n} ਆਨਲਾਈਨ ਰੇਡੀਓ`,
    countryH1: (n) => `${n} ਰੇਡੀਓ ਸਟੇਸ਼ਨ — ਆਨਲਾਈਨ ਲਾਈਵ ਸੁਣੋ`,
    countryBodyIntro: (n) => `${n} ਦੇ ਰੇਡੀਓ ਸਟੇਸ਼ਨ ਖੋਜੋ। Mega Radio 'ਤੇ ਸਥਾਨਕ ਪ੍ਰਸਾਰਣ ਮੁਫ਼ਤ ਸੁਣੋ।`,
    countryBodyAvailability: (n) => `120+ ਦੇਸ਼ਾਂ ਦੇ 60,000+ ਰੇਡੀਓ ਸਟੇਸ਼ਨ ਬ੍ਰਾਊਜ਼ ਕਰੋ — ${n} ਦੇ ਸਟੇਸ਼ਨ 24/7 ਉਪਲਬਧ।`,
    regionTitle: (n) => `${n} ਰੇਡੀਓ ਸਟੇਸ਼ਨ - ਖੇਤਰੀ ਪ੍ਰਸਾਰਣ | Mega Radio`,
    regionDescription: (n) => `${n} ਦੇ ਰੇਡੀਓ ਸਟੇਸ਼ਨ ਖੋਜੋ। Mega Radio 'ਤੇ ${n} ਦਾ ਖੇਤਰੀ ਪ੍ਰਸਾਰਣ ਮੁਫ਼ਤ ਸੁਣੋ।`,
    regionKeywords: (n) => `${n} ਰੇਡੀਓ, ${n} ਪ੍ਰਸਾਰਣ, ਖੇਤਰੀ ਰੇਡੀਓ, ${n} ਸਟੇਸ਼ਨ`,
    regionH1: (n) => `${n} ਰੇਡੀਓ ਸਟੇਸ਼ਨ — ਖੇਤਰੀ ਪ੍ਰਸਾਰਣ`,
    regionBodyIntro: (n) => `${n} ਦੇ ਰੇਡੀਓ ਸਟੇਸ਼ਨ ਖੋਜੋ। Mega Radio 'ਤੇ ਖੇਤਰੀ ਪ੍ਰਸਾਰਣ ਮੁਫ਼ਤ ਸੁਣੋ।`,
    regionBodyAvailability: (n) => `120+ ਦੇਸ਼ਾਂ ਦੇ 60,000+ ਰੇਡੀਓ ਸਟੇਸ਼ਨ ਬ੍ਰਾਊਜ਼ ਕਰੋ — ${n} ਦੇ ਸਟੇਸ਼ਨ 24/7 ਉਪਲਬਧ।`,
  },
  sw: {
    countryTitle: (n) => `Vituo vya Redio vya ${n} - Sikiliza Moja kwa Moja Mtandaoni | Mega Radio`,
    countryDescription: (n) => `Sikiliza redio moja kwa moja kutoka ${n}. Gundua vituo vya redio vya ndani na vipindi vya ${n} bila malipo kwenye Mega Radio.`,
    countryKeywords: (n) => `redio ${n}, vituo vya redio ${n}, ${n} moja kwa moja, redio ya mtandaoni ${n}`,
    countryH1: (n) => `Vituo vya Redio vya ${n} — Sikiliza Moja kwa Moja Mtandaoni`,
    countryBodyIntro: (n) => `Chunguza vituo vya redio kutoka ${n}. Sikiliza matangazo ya ndani bila malipo kwenye Mega Radio.`,
    countryBodyAvailability: (n) => `Vinjari vituo zaidi ya 60,000 vya redio kutoka nchi 120+ — vituo vya ${n} vinapatikana 24/7.`,
    regionTitle: (n) => `Vituo vya Redio vya ${n} - Matangazo ya Kikanda | Mega Radio`,
    regionDescription: (n) => `Chunguza vituo vya redio kutoka ${n}. Sikiliza matangazo ya kikanda kutoka ${n} bila malipo kwenye Mega Radio.`,
    regionKeywords: (n) => `redio ${n}, matangazo ${n}, redio ya kikanda, vituo ${n}`,
    regionH1: (n) => `Vituo vya Redio vya ${n} — Matangazo ya Kikanda`,
    regionBodyIntro: (n) => `Chunguza vituo vya redio kutoka ${n}. Sikiliza matangazo ya kikanda bila malipo kwenye Mega Radio.`,
    regionBodyAvailability: (n) => `Vinjari vituo zaidi ya 60,000 vya redio kutoka nchi 120+ — vituo vya ${n} vinapatikana 24/7.`,
  },
  am: {
    countryTitle: (n) => `${n} ራዲዮ ጣቢያዎች - በቀጥታ በመስመር ላይ ያዳምጡ | Mega Radio`,
    countryDescription: (n) => `ከ${n} የቀጥታ ራዲዮ ያዳምጡ። በMega Radio ላይ የ${n} አካባቢያዊ ራዲዮ ጣቢያዎችን እና ፕሮግራሞችን በነጻ ይዳስሱ።`,
    countryKeywords: (n) => `${n} ራዲዮ, ${n} ራዲዮ ጣቢያዎች, ${n} ቀጥታ, ${n} የመስመር ላይ ራዲዮ`,
    countryH1: (n) => `${n} ራዲዮ ጣቢያዎች — በቀጥታ በመስመር ላይ ያዳምጡ`,
    countryBodyIntro: (n) => `የ${n} ራዲዮ ጣቢያዎችን ይዳስሱ። በMega Radio ላይ አካባቢያዊ ስርጭቶችን በነጻ ያዳምጡ።`,
    countryBodyAvailability: (n) => `ከ120+ ሀገሮች ከ60,000+ ራዲዮ ጣቢያዎች ይመልከቱ — የ${n} ጣቢያዎች 24/7 ይገኛሉ።`,
    regionTitle: (n) => `${n} ራዲዮ ጣቢያዎች - ክልላዊ ስርጭት | Mega Radio`,
    regionDescription: (n) => `የ${n} ራዲዮ ጣቢያዎችን ይዳስሱ። በMega Radio ላይ የ${n} ክልላዊ ስርጭትን በነጻ ያዳምጡ።`,
    regionKeywords: (n) => `${n} ራዲዮ, ${n} ስርጭት, ክልላዊ ራዲዮ, ${n} ጣቢያዎች`,
    regionH1: (n) => `${n} ራዲዮ ጣቢያዎች — ክልላዊ ስርጭት`,
    regionBodyIntro: (n) => `የ${n} ራዲዮ ጣቢያዎችን ይዳስሱ። በMega Radio ላይ ክልላዊ ስርጭትን በነጻ ያዳምጡ።`,
    regionBodyAvailability: (n) => `ከ120+ ሀገሮች ከ60,000+ ራዲዮ ጣቢያዎች ይመልከቱ — የ${n} ጣቢያዎች 24/7 ይገኛሉ።`,
  },
  zu: {
    countryTitle: (n) => `Iziteshi Zomsakazo Zase-${n} - Lalela Bukhoma Online | Mega Radio`,
    countryDescription: (n) => `Lalela umsakazo obukhoma ovela e-${n}. Thola iziteshi zomsakazo zendawo nezinhlelo zase-${n} mahhala ku-Mega Radio.`,
    countryKeywords: (n) => `umsakazo we-${n}, iziteshi zomsakazo ze-${n}, ${n} bukhoma, ${n} umsakazo we-online`,
    countryH1: (n) => `Iziteshi Zomsakazo Zase-${n} — Lalela Bukhoma Online`,
    countryBodyIntro: (n) => `Hlola iziteshi zomsakazo ezivela e-${n}. Lalela ukusakaza kwasendaweni mahhala ku-Mega Radio.`,
    countryBodyAvailability: (n) => `Bheka iziteshi zomsakazo ezingaphezu kuka-60,000 ezivela emazweni angu-120+ — iziteshi zase-${n} ziyatholakala 24/7.`,
    regionTitle: (n) => `Iziteshi Zomsakazo Zase-${n} - Ukusakaza Kwesifunda | Mega Radio`,
    regionDescription: (n) => `Hlola iziteshi zomsakazo ezivela e-${n}. Lalela ukusakaza kwesifunda kwase-${n} mahhala ku-Mega Radio.`,
    regionKeywords: (n) => `umsakazo we-${n}, ukusakaza kwe-${n}, umsakazo wesifunda, iziteshi ${n}`,
    regionH1: (n) => `Iziteshi Zomsakazo Zase-${n} — Ukusakaza Kwesifunda`,
    regionBodyIntro: (n) => `Hlola iziteshi zomsakazo ezivela e-${n}. Lalela ukusakaza kwesifunda mahhala ku-Mega Radio.`,
    regionBodyAvailability: (n) => `Bheka iziteshi zomsakazo ezingaphezu kuka-60,000 ezivela emazweni angu-120+ — iziteshi zase-${n} ziyatholakala 24/7.`,
  },
  af: {
    countryTitle: (n) => `${n} Radiostasies - Luister Regstreeks Aanlyn | Mega Radio`,
    countryDescription: (n) => `Luister regstreekse radio uit ${n}. Ontdek plaaslike ${n}-radiostasies en programme gratis op Mega Radio.`,
    countryKeywords: (n) => `${n} radio, ${n} radiostasies, ${n} regstreeks, ${n} aanlyn radio`,
    countryH1: (n) => `${n} Radiostasies — Luister Regstreeks Aanlyn`,
    countryBodyIntro: (n) => `Verken radiostasies uit ${n}. Luister gratis na plaaslike uitsendings op Mega Radio.`,
    countryBodyAvailability: (n) => `Blaai deur 60 000+ radiostasies uit 120+ lande — ${n}-stasies 24/7 beskikbaar.`,
    regionTitle: (n) => `${n} Radiostasies - Streekuitsendings | Mega Radio`,
    regionDescription: (n) => `Verken radiostasies uit ${n}. Luister gratis na streekuitsendings uit ${n} op Mega Radio.`,
    regionKeywords: (n) => `${n} radio, ${n} uitsendings, streekradio, ${n} stasies`,
    regionH1: (n) => `${n} Radiostasies — Streekuitsendings`,
    regionBodyIntro: (n) => `Verken radiostasies uit ${n}. Luister gratis na streekuitsendings op Mega Radio.`,
    regionBodyAvailability: (n) => `Blaai deur 60 000+ radiostasies uit 120+ lande — ${n}-stasies 24/7 beskikbaar.`,
  },
  sq: {
    countryTitle: (n) => `Stacionet Radio të ${n} - Dëgjo Drejtpërdrejt Online | Mega Radio`,
    countryDescription: (n) => `Dëgjo radio drejtpërdrejt nga ${n}. Zbulo stacionet lokale dhe programet e ${n} falas në Mega Radio.`,
    countryKeywords: (n) => `radio ${n}, stacione radio ${n}, ${n} drejtpërdrejt, radio online ${n}`,
    countryH1: (n) => `Stacionet Radio të ${n} — Dëgjo Drejtpërdrejt Online`,
    countryBodyIntro: (n) => `Eksploro stacionet radio nga ${n}. Dëgjo transmetimet lokale falas në Mega Radio.`,
    countryBodyAvailability: (n) => `Shfleto mbi 60.000 stacione radio nga 120+ vende — stacionet e ${n} në dispozicion 24/7.`,
    regionTitle: (n) => `Stacionet Radio të ${n} - Transmetime Rajonale | Mega Radio`,
    regionDescription: (n) => `Eksploro stacionet radio nga ${n}. Dëgjo transmetimet rajonale nga ${n} falas në Mega Radio.`,
    regionKeywords: (n) => `radio ${n}, transmetime ${n}, radio rajonale, stacione ${n}`,
    regionH1: (n) => `Stacionet Radio të ${n} — Transmetime Rajonale`,
    regionBodyIntro: (n) => `Eksploro stacionet radio nga ${n}. Dëgjo transmetimet rajonale falas në Mega Radio.`,
    regionBodyAvailability: (n) => `Shfleto mbi 60.000 stacione radio nga 120+ vende — stacionet e ${n} në dispozicion 24/7.`,
  },
  az: {
    countryTitle: (n) => `${n} Radio Stansiyaları - Onlayn Canlı Dinləyin | Mega Radio`,
    countryDescription: (n) => `${n}-dan canlı radio dinləyin. Mega Radio-da ${n} yerli radio stansiyalarını və proqramlarını pulsuz kəşf edin.`,
    countryKeywords: (n) => `${n} radio, ${n} radio stansiyaları, ${n} canlı, ${n} onlayn radio`,
    countryH1: (n) => `${n} Radio Stansiyaları — Onlayn Canlı Dinləyin`,
    countryBodyIntro: (n) => `${n} radio stansiyalarını kəşf edin. Mega Radio-da yerli yayımları pulsuz dinləyin.`,
    countryBodyAvailability: (n) => `120+ ölkədən 60.000+ radio stansiyasına baxın — ${n} stansiyaları 24/7 mövcuddur.`,
    regionTitle: (n) => `${n} Radio Stansiyaları - Regional Yayım | Mega Radio`,
    regionDescription: (n) => `${n} radio stansiyalarını kəşf edin. Mega Radio-da ${n} regional yayımını pulsuz dinləyin.`,
    regionKeywords: (n) => `${n} radio, ${n} yayım, regional radio, ${n} stansiyaları`,
    regionH1: (n) => `${n} Radio Stansiyaları — Regional Yayım`,
    regionBodyIntro: (n) => `${n} radio stansiyalarını kəşf edin. Mega Radio-da regional yayımı pulsuz dinləyin.`,
    regionBodyAvailability: (n) => `120+ ölkədən 60.000+ radio stansiyasına baxın — ${n} stansiyaları 24/7 mövcuddur.`,
  },
  hy: {
    countryTitle: (n) => `${n} Ռադիոկայաններ - Ուղիղ եթերում առցանց լսել | Mega Radio`,
    countryDescription: (n) => `Լսեք ուղիղ ռադիո ${n}-ից։ Հայտնաբերեք ${n}-ի տեղական ռադիոկայանները և հաղորդումները անվճար Mega Radio-ում։`,
    countryKeywords: (n) => `${n} ռադիո, ${n} ռադիոկայաններ, ${n} ուղիղ, ${n} առցանց ռադիո`,
    countryH1: (n) => `${n} Ռադիոկայաններ — Ուղիղ եթերում առցանց լսել`,
    countryBodyIntro: (n) => `Բացահայտեք ${n}-ի ռադիոկայանները։ Լսեք տեղական հեռարձակումները անվճար Mega Radio-ում։`,
    countryBodyAvailability: (n) => `Թերթեք ավելի քան 60,000 ռադիոկայան 120+ երկրներից — ${n}-ի կայանները հասանելի են 24/7։`,
    regionTitle: (n) => `${n} Ռադիոկայաններ - Տարածաշրջանային հեռարձակում | Mega Radio`,
    regionDescription: (n) => `Բացահայտեք ${n}-ի ռադիոկայանները։ Լսեք ${n}-ի տարածաշրջանային հեռարձակումը անվճար Mega Radio-ում։`,
    regionKeywords: (n) => `${n} ռադիո, ${n} հեռարձակում, տարածաշրջանային ռադիո, ${n} կայաններ`,
    regionH1: (n) => `${n} Ռադիոկայաններ — Տարածաշրջանային հեռարձակում`,
    regionBodyIntro: (n) => `Բացահայտեք ${n}-ի ռադիոկայանները։ Լսեք տարածաշրջանային հեռարձակումը անվճար Mega Radio-ում։`,
    regionBodyAvailability: (n) => `Թերթեք ավելի քան 60,000 ռադիոկայան 120+ երկրներից — ${n}-ի կայանները հասանելի են 24/7։`,
  },
  so: {
    countryTitle: (n) => `Idaacadaha ${n} - Toos u Dhageyso Online | Mega Radio`,
    countryDescription: (n) => `Toos uga dhageyso raadiyaha ${n}. Ka ogoow idaacadaha maxalliga ah iyo barnaamijyada ${n} bilaash ah Mega Radio.`,
    countryKeywords: (n) => `raadiyaha ${n}, idaacadaha ${n}, ${n} toos, ${n} raadiyaha online`,
    countryH1: (n) => `Idaacadaha ${n} — Toos u Dhageyso Online`,
    countryBodyIntro: (n) => `Sahmiya idaacadaha ${n}. Ku dhegeyso baahinta maxalliga ah bilaash ah Mega Radio.`,
    countryBodyAvailability: (n) => `Daawo in ka badan 60,000 idaacadood oo ka kala socda 120+ waddan — idaacadaha ${n} waxaa la heli karaa 24/7.`,
    regionTitle: (n) => `Idaacadaha ${n} - Baahinta Gobolka | Mega Radio`,
    regionDescription: (n) => `Sahmiya idaacadaha ${n}. Ku dhegeyso baahinta gobolka ee ${n} bilaash ah Mega Radio.`,
    regionKeywords: (n) => `raadiyaha ${n}, baahinta ${n}, raadiyaha gobolka, idaacadaha ${n}`,
    regionH1: (n) => `Idaacadaha ${n} — Baahinta Gobolka`,
    regionBodyIntro: (n) => `Sahmiya idaacadaha ${n}. Ku dhegeyso baahinta gobolka bilaash ah Mega Radio.`,
    regionBodyAvailability: (n) => `Daawo in ka badan 60,000 idaacadood oo ka kala socda 120+ waddan — idaacadaha ${n} waxaa la heli karaa 24/7.`,
  },
  uk: {
    countryTitle: (n) => `Радіостанції ${n} - Слухайте Наживо Онлайн | Mega Radio`,
    countryDescription: (n) => `Слухайте живе радіо з ${n}. Відкрийте локальні радіостанції та шоу ${n} безкоштовно на Mega Radio.`,
    countryKeywords: (n) => `${n} радіо, радіостанції ${n}, ${n} наживо, ${n} онлайн радіо`,
    countryH1: (n) => `Радіостанції ${n} — Слухайте Наживо Онлайн`,
    countryBodyIntro: (n) => `Досліджуйте радіостанції з ${n}. Слухайте локальне мовлення безкоштовно на Mega Radio.`,
    countryBodyAvailability: (n) => `Перегляньте понад 60 000 радіостанцій із 120+ країн — станції ${n} доступні цілодобово.`,
    regionTitle: (n) => `Радіостанції ${n} - Регіональне Мовлення | Mega Radio`,
    regionDescription: (n) => `Досліджуйте радіостанції з ${n}. Слухайте регіональне мовлення з ${n} безкоштовно на Mega Radio.`,
    regionKeywords: (n) => `${n} радіо, мовлення ${n}, регіональне радіо, станції ${n}`,
    regionH1: (n) => `Радіостанції ${n} — Регіональне Мовлення`,
    regionBodyIntro: (n) => `Досліджуйте радіостанції з ${n}. Слухайте регіональне мовлення безкоштовно на Mega Radio.`,
    regionBodyAvailability: (n) => `Перегляньте понад 60 000 радіостанцій із 120+ країн — станції ${n} доступні цілодобово.`,
  },
  bs: {
    countryTitle: (n) => `Radio Stanice ${n} - Slušajte Uživo Online | Mega Radio`,
    countryDescription: (n) => `Slušajte radio uživo iz ${n}. Otkrijte lokalne radio stanice i emisije iz ${n} besplatno na Mega Radio.`,
    countryKeywords: (n) => `${n} radio, radio stanice ${n}, ${n} uživo, ${n} online radio`,
    countryH1: (n) => `Radio Stanice ${n} — Slušajte Uživo Online`,
    countryBodyIntro: (n) => `Istražite radio stanice iz ${n}. Slušajte lokalne emisije besplatno na Mega Radio.`,
    countryBodyAvailability: (n) => `Pregledajte 60.000+ radio stanica iz 120+ zemalja — stanice iz ${n} dostupne 24/7.`,
    regionTitle: (n) => `Radio Stanice ${n} - Regionalno Emitovanje | Mega Radio`,
    regionDescription: (n) => `Istražite radio stanice iz ${n}. Slušajte regionalno emitovanje iz ${n} besplatno na Mega Radio.`,
    regionKeywords: (n) => `${n} radio, emitovanje ${n}, regionalni radio, stanice ${n}`,
    regionH1: (n) => `Radio Stanice ${n} — Regionalno Emitovanje`,
    regionBodyIntro: (n) => `Istražite radio stanice iz ${n}. Slušajte regionalno emitovanje besplatno na Mega Radio.`,
    regionBodyAvailability: (n) => `Pregledajte 60.000+ radio stanica iz 120+ zemalja — stanice iz ${n} dostupne 24/7.`,
  },
};

/**
 * Returns a multilingual SEO template for the requested language, falling back to English.
 */
export function getRegionSeoTemplate(language: string): RegionSeoTemplate {
  return REGION_SEO_TEMPLATES[language] || REGION_SEO_TEMPLATES.en;
}

/**
 * Grapheme-aware truncation. See genre-seo-templates.ts for the same helper.
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

function clampDescription(description: string): string {
  if (description.length <= 145) return description;
  const cutoff = description.lastIndexOf(' ', 142);
  if (cutoff > 100) {
    return description.slice(0, cutoff) + '...';
  }
  return clampGraphemes(description, 142) + '...';
}

export interface RegionSeoOutput {
  title: string;
  description: string;
  keywords: string;
  h1: string;
  bodyIntro: string;
  bodyAvailability: string;
}

/**
 * Builds title/description/keywords/body for a country detail page in the given language.
 * Mirrors buildGenreSeo: DB translation overrides win when ALL legacy keys are present in
 * the requested language; otherwise we fall back to the natural per-language template so
 * we never emit mid-sentence English fragments inside e.g. a Turkish title.
 */
export function buildCountrySeo(
  countryName: string,
  language: string,
  dbTranslations?: Record<string, string>,
): RegionSeoOutput {
  const tpl = getRegionSeoTemplate(language);

  const radioStations = dbTranslations?.seo_radio_stations?.trim();
  const listenLive = dbTranslations?.seo_listen_live_online?.trim();
  const listenFrom = dbTranslations?.seo_listen_to_live_radio_from?.trim();
  const discoverLocal = dbTranslations?.seo_discover_local?.trim();
  const radioBroadcastingFree = dbTranslations?.seo_radio_broadcasting_free?.trim();

  const title =
    radioStations && listenLive
      ? `${countryName} ${radioStations} - ${listenLive} | Mega Radio`
      : tpl.countryTitle(countryName);

  let description =
    listenFrom && discoverLocal && radioBroadcastingFree
      ? `${listenFrom} ${countryName}. ${discoverLocal} ${countryName} ${radioBroadcastingFree}.`
      : tpl.countryDescription(countryName);

  description = clampDescription(description);

  return {
    title,
    description,
    keywords: tpl.countryKeywords(countryName),
    h1: tpl.countryH1(countryName),
    bodyIntro: tpl.countryBodyIntro(countryName),
    bodyAvailability: tpl.countryBodyAvailability(countryName),
  };
}

/**
 * Builds title/description/keywords/body for a multi-country region page in the given language.
 */
export function buildRegionSeo(
  regionName: string,
  language: string,
  dbTranslations?: Record<string, string>,
): RegionSeoOutput {
  const tpl = getRegionSeoTemplate(language);

  const radioStations = dbTranslations?.seo_radio_stations?.trim();
  const regionalBroadcasting = dbTranslations?.seo_regional_broadcasting?.trim();
  const exploreFrom = dbTranslations?.seo_explore_radio_stations_from?.trim();
  const listenRegional = dbTranslations?.seo_listen_to_regional_broadcasting?.trim();

  const title =
    radioStations && regionalBroadcasting
      ? `${regionName} ${radioStations} - ${regionalBroadcasting} | Mega Radio`
      : tpl.regionTitle(regionName);

  let description =
    exploreFrom && listenRegional
      ? `${exploreFrom} ${regionName}. ${listenRegional}.`
      : tpl.regionDescription(regionName);

  description = clampDescription(description);

  return {
    title,
    description,
    keywords: tpl.regionKeywords(regionName),
    h1: tpl.regionH1(regionName),
    bodyIntro: tpl.regionBodyIntro(regionName),
    bodyAvailability: tpl.regionBodyAvailability(regionName),
  };
}

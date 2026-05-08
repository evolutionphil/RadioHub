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

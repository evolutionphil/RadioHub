export type DirectoryIndexKind = 'genres' | 'regions';
type Entry = { h1: string; title: string; description: string };

/** Index pages need their own localized copy, not genre/country detail copy.
 * These describe the directory only; no station counts or facts are invented.
 */
export const DIRECTORY_INDEX_SEO: Record<string, Record<DirectoryIndexKind, Entry>> = {
  en: {
    genres: { h1: 'Radio Genres', title: 'Radio Genres — Browse All Music Genres | Mega Radio', description: 'Explore every radio genre on Mega Radio: pop, rock, jazz, classical, hip hop, electronic, country, news, sports and talk. Listen to free live radio stations by genre.' },
    regions: { h1: 'Radio by Region', title: 'Radio by Region — Browse Stations by Region | Mega Radio', description: 'Discover radio stations from every region and country. Listen to local and international radio from Europe, Asia, Africa, Americas, and Oceania for free on Mega Radio.' },
  },
  de: {
    genres: { h1: 'Radios nach Musikrichtung', title: 'Radios nach Musikrichtung — Genres entdecken | Mega Radio', description: 'Entdecke Radiosender nach Genre: Pop, Rock, Jazz, Klassik, elektronische Musik, Nachrichten und Sport. Höre auf Mega Radio kostenlos live.' },
    regions: { h1: 'Radio nach Region', title: 'Radio nach Region — Sender weltweit entdecken | Mega Radio', description: 'Entdecke lokale und internationale Radiosender nach Land und Region. Höre auf Mega Radio kostenlos Musik, Nachrichten und Sendungen aus aller Welt.' },
  },
  tr: {
    genres: { h1: 'Müzik Türlerine Göre Radyolar', title: 'Müzik Türlerine Göre Radyolar — Türleri Keşfet | Mega Radio', description: 'Pop, rock, caz, klasik, elektronik müzik, haber ve spor radyolarını türlerine göre keşfet. Mega Radio ile sevdiğin radyo yayınlarını ücretsiz canlı dinle.' },
    regions: { h1: 'Bölgelere Göre Radyolar', title: 'Bölgelere Göre Radyolar — Dünyadan İstasyonlar | Mega Radio', description: 'Ülke ve bölgelere göre yerel ve uluslararası radyo istasyonlarını keşfet. Mega Radio ile dünyanın dört bir yanından müzik ve haberleri ücretsiz dinle.' },
  },
  es: {
    genres: { h1: 'Radio por Género', title: 'Radio por Género — Explora Estilos Musicales | Mega Radio', description: 'Descubre emisoras por género: pop, rock, jazz, clásica, electrónica, noticias y deportes. Escucha tus programas favoritos en directo y gratis en Mega Radio.' },
    regions: { h1: 'Radio por Región', title: 'Radio por Región — Descubre Emisoras del Mundo | Mega Radio', description: 'Explora emisoras locales e internacionales por país y región. Escucha música, noticias y programas de todo el mundo en directo y gratis en Mega Radio.' },
  },
  fr: {
    genres: { h1: 'Radios par Genre', title: 'Radios par Genre — Découvrez les Styles Musicaux | Mega Radio', description: 'Découvrez les radios par genre : pop, rock, jazz, classique, électro, actualités et sport. Écoutez gratuitement vos émissions en direct sur Mega Radio.' },
    regions: { h1: 'Radios par Région', title: 'Radios par Région — Explorez les Stations du Monde | Mega Radio', description: 'Explorez les radios locales et internationales par pays et région. Écoutez gratuitement musique, actualités et émissions du monde entier sur Mega Radio.' },
  },
  pt: {
    genres: { h1: 'Rádios por Género', title: 'Rádios por Género — Explore Estilos Musicais | Mega Radio', description: 'Descubra rádios por género: pop, rock, jazz, clássica, eletrónica, notícias e desporto. Ouça as suas emissões favoritas ao vivo e grátis no Mega Radio.' },
    regions: { h1: 'Rádios por Região', title: 'Rádios por Região — Descubra Estações do Mundo | Mega Radio', description: 'Explore rádios locais e internacionais por país e região. Ouça música, notícias e programas de todo o mundo ao vivo e gratuitamente no Mega Radio.' },
  },
  it: {
    genres: { h1: 'Radio per Genere', title: 'Radio per Genere — Esplora gli Stili Musicali | Mega Radio', description: 'Scopri le radio per genere: pop, rock, jazz, classica, elettronica, notizie e sport. Ascolta gratis le tue trasmissioni preferite in diretta su Mega Radio.' },
    regions: { h1: 'Radio per Regione', title: 'Radio per Regione — Scopri le Emittenti del Mondo | Mega Radio', description: 'Esplora le radio locali e internazionali per paese e regione. Ascolta gratis musica, notizie e programmi da tutto il mondo in diretta su Mega Radio.' },
  },
  ru: {
    genres: { h1: 'Радио по жанрам', title: 'Радио по жанрам — Откройте музыкальные стили | Mega Radio', description: 'Находите радио по жанрам: поп, рок, джаз, классика, электроника, новости и спорт. Слушайте любимые передачи бесплатно в прямом эфире на Mega Radio.' },
    regions: { h1: 'Радио по регионам', title: 'Радио по регионам — Станции со всего мира | Mega Radio', description: 'Откройте местные и международные радиостанции по странам и регионам. Слушайте музыку, новости и передачи со всего мира бесплатно на Mega Radio.' },
  },
  ar: {
    genres: { h1: 'الإذاعات حسب النوع', title: 'الإذاعات حسب النوع — اكتشف أنماط الموسيقى | Mega Radio', description: 'اكتشف إذاعات البوب والروك والجاز والموسيقى الكلاسيكية والإلكترونية والأخبار والرياضة. استمع إلى برامجك المفضلة مباشرة ومجانًا على Mega Radio.' },
    regions: { h1: 'الإذاعات حسب المنطقة', title: 'الإذاعات حسب المنطقة — محطات من حول العالم | Mega Radio', description: 'تصفح الإذاعات المحلية والعالمية حسب البلد والمنطقة. استمع إلى الموسيقى والأخبار والبرامج من أنحاء العالم مباشرة ومجانًا على Mega Radio.' },
  },
  zh: {
    genres: { h1: '按类型收听电台', title: '按类型收听电台 — 探索不同音乐风格 | Mega Radio', description: '按类型探索流行、摇滚、爵士、古典、电子音乐、新闻和体育电台。在 Mega Radio 免费收听喜爱的直播节目，发现适合你的音乐风格。' },
    regions: { h1: '按地区收听电台', title: '按地区收听电台 — 探索世界各地的广播 | Mega Radio', description: '按国家和地区浏览本地及国际电台。在 Mega Radio 免费收听来自世界各地的音乐、新闻和直播节目，发现不同地区的广播。' },
  },
  ja: {
    genres: { h1: 'ジャンル別ラジオ', title: 'ジャンル別ラジオ — さまざまな音楽を探す | Mega Radio', description: 'ポップ、ロック、ジャズ、クラシック、電子音楽、ニュース、スポーツのラジオをジャンル別に探せます。Mega Radioでお気に入りの番組を無料でライブ視聴しましょう。' },
    regions: { h1: '地域別ラジオ', title: '地域別ラジオ — 世界の放送局を探す | Mega Radio', description: '国や地域から地元や海外のラジオ局を探せます。Mega Radioで世界各地の音楽、ニュース、番組を無料で聴き、新しいライブ放送に出会いましょう。' },
  },
  ko: {
    genres: { h1: '장르별 라디오', title: '장르별 라디오 — 다양한 음악 스타일 찾기 | Mega Radio', description: '팝, 록, 재즈, 클래식, 전자 음악, 뉴스와 스포츠 라디오를 장르별로 찾아보세요. Mega Radio에서 좋아하는 프로그램을 무료로 실시간 청취하세요.' },
    regions: { h1: '지역별 라디오', title: '지역별 라디오 — 전 세계 방송국 찾기 | Mega Radio', description: '국가와 지역별로 현지 및 해외 라디오 방송국을 둘러보세요. Mega Radio에서 전 세계의 음악, 뉴스와 프로그램을 무료로 실시간 청취하세요.' },
  },
  hi: {
    genres: { h1: 'शैली के अनुसार रेडियो', title: 'शैली के अनुसार रेडियो — संगीत की शैलियाँ खोजें | Mega Radio', description: 'पॉप, रॉक, जैज़, शास्त्रीय, इलेक्ट्रॉनिक संगीत, समाचार और खेल के रेडियो स्टेशन खोजें। Mega Radio पर अपने पसंदीदा कार्यक्रम मुफ्त लाइव सुनें।' },
    regions: { h1: 'क्षेत्र के अनुसार रेडियो', title: 'क्षेत्र के अनुसार रेडियो — दुनिया के स्टेशन खोजें | Mega Radio', description: 'देश और क्षेत्र के अनुसार स्थानीय और अंतरराष्ट्रीय रेडियो स्टेशन खोजें। Mega Radio पर दुनिया भर का संगीत, समाचार और कार्यक्रम मुफ्त लाइव सुनें।' },
  },
  he: {
    genres: { h1: 'רדיו לפי סוגה', title: 'רדיו לפי סוגה — גלו סגנונות מוזיקה | Mega Radio', description: 'גלו תחנות רדיו לפי סוגה: פופ, רוק, ג׳אז, מוזיקה קלאסית ואלקטרונית, חדשות וספורט. האזינו לתוכניות האהובות בשידור חי ובחינם ב-Mega Radio.' },
    regions: { h1: 'רדיו לפי אזור', title: 'רדיו לפי אזור — גלו תחנות מרחבי העולם | Mega Radio', description: 'גלו תחנות רדיו מקומיות ובינלאומיות לפי מדינה ואזור. האזינו למוזיקה, לחדשות ולתוכניות מרחבי העולם בשידור חי ובחינם ב-Mega Radio.' },
  },
};

export function buildDirectoryIndexSeo(kind: DirectoryIndexKind, language: string, translations: Record<string, string> = {}): Entry {
  const template = (DIRECTORY_INDEX_SEO[language] || DIRECTORY_INDEX_SEO.en)[kind];
  const english = DIRECTORY_INDEX_SEO.en[kind];
  const choose = (field: keyof Entry): string | undefined => {
    const key = `${kind}_page_${field}`;
    const value = typeof translations[key] === 'string' ? translations[key].trim() : '';
    if (!value || value === key) return undefined;
    // Ignore only an exact known English seed, never arbitrary custom copy.
    const normalized = (text: string) => text.replace(/\s+/g, ' ').trim();
    if (language !== 'en' && normalized(value) === normalized(english[field])) return undefined;
    return value;
  };
  const title = choose('title');
  const derivedH1 = title?.split(' — ')[0].replace(/\s*\|\s*Mega\s+Radio\s*$/i, '').trim();
  return { title: title || template.title, description: choose('description') || template.description,
    h1: choose('h1') || derivedH1 || template.h1 };
}

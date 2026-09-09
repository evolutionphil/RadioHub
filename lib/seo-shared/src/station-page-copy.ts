import { getHomeSeoTemplate } from './home-seo-templates';

const COPY: Record<string, readonly [string, string, string, string]> = {
  en: ['About the station', 'Station information', 'Official website', 'Listen to {station_name} live on Mega Radio.'],
  es: ['Acerca de la emisora', 'Información de la emisora', 'Sitio web oficial', 'Escucha {station_name} en directo en Mega Radio.'],
  fr: ['À propos de la station', 'Informations sur la station', 'Site officiel', 'Écoutez {station_name} en direct sur Mega Radio.'],
  de: ['Über den Sender', 'Senderinformationen', 'Offizielle Website', 'Höre {station_name} live auf Mega Radio.'],
  pt: ['Sobre a estação', 'Informações da estação', 'Site oficial', 'Ouça {station_name} ao vivo no Mega Radio.'],
  it: ['Informazioni sulla stazione', 'Dettagli della stazione', 'Sito ufficiale', 'Ascolta {station_name} in diretta su Mega Radio.'],
  ru: ['О радиостанции', 'Информация о радиостанции', 'Официальный сайт', 'Слушайте {station_name} в прямом эфире на Mega Radio.'],
  ar: ['عن المحطة', 'معلومات المحطة', 'الموقع الرسمي', 'استمع إلى {station_name} مباشرة على Mega Radio.'],
  zh: ['关于电台', '电台信息', '官方网站', '在 Mega Radio 收听 {station_name} 的直播。'],
  tr: ['İstasyon hakkında', 'İstasyon bilgileri', 'Resmî web sitesi', '{station_name} istasyonunu Mega Radio’da canlı dinleyin.'],
  ja: ['ラジオ局について', 'ラジオ局情報', '公式サイト', 'Mega Radio で {station_name} のライブ放送を聴こう。'],
  ko: ['방송국 소개', '방송국 정보', '공식 웹사이트', 'Mega Radio에서 {station_name}의 실시간 방송을 들어보세요.'],
  hi: ['स्टेशन के बारे में', 'स्टेशन की जानकारी', 'आधिकारिक वेबसाइट', 'Mega Radio पर {station_name} को लाइव सुनें।'],
  he: ['על התחנה', 'מידע על התחנה', 'האתר הרשמי', 'האזינו ל-{station_name} בשידור חי ב-Mega Radio.'],
};

const LISTENER_RATING: Record<string, string> = {
  en: 'Listener rating', es: 'Valoración de los oyentes', fr: 'Note des auditeurs',
  de: 'Hörerbewertung', pt: 'Avaliação dos ouvintes', it: 'Valutazione degli ascoltatori',
  ru: 'Оценка слушателей', ar: 'تقييم المستمعين', zh: '听众评分', tr: 'Dinleyici puanı',
  ja: 'リスナー評価', ko: '청취자 평점', hi: 'श्रोताओं की रेटिंग', he: 'דירוג המאזינים',
};

const STREAM_UNAVAILABLE: Record<string, string> = {
  en: 'This station’s stream is temporarily unavailable. Please try again later.',
  es: 'La transmisión de esta emisora no está disponible temporalmente. Inténtalo de nuevo más tarde.',
  fr: 'Le flux de cette station est temporairement indisponible. Veuillez réessayer plus tard.',
  de: 'Der Stream dieses Senders ist vorübergehend nicht verfügbar. Bitte versuche es später erneut.',
  pt: 'A transmissão desta estação está temporariamente indisponível. Tente novamente mais tarde.',
  it: 'Lo streaming di questa stazione è temporaneamente non disponibile. Riprova più tardi.',
  ru: 'Трансляция этой радиостанции временно недоступна. Попробуйте позже.',
  ar: 'بث هذه المحطة غير متاح مؤقتًا. يُرجى المحاولة مرة أخرى لاحقًا.',
  zh: '此电台的直播暂时不可用，请稍后重试。',
  tr: 'Bu istasyonun yayını geçici olarak kullanılamıyor. Lütfen daha sonra tekrar deneyin.',
  ja: 'この放送局のストリームは一時的に利用できません。しばらくしてからもう一度お試しください。',
  ko: '이 방송국의 스트리밍을 일시적으로 이용할 수 없습니다. 나중에 다시 시도해 주세요.',
  hi: 'इस स्टेशन का प्रसारण अस्थायी रूप से उपलब्ध नहीं है। कृपया बाद में फिर से प्रयास करें।',
  he: 'השידור של תחנה זו אינו זמין זמנית. יש לנסות שוב מאוחר יותר.',
};

/** Identical public copy for server-rendered pages and the interactive player. */
export function getStationStreamUnavailableNotice(language: string): string {
  return STREAM_UNAVAILABLE[language.trim().toLowerCase().split(/[-_]/)[0]] || STREAM_UNAVAILABLE.en;
}

export function getStationPageCopy(language: string, translations: Record<string, string> = {}) {
  const [about, information, website, intro] = COPY[language] || COPY.en;
  const locale = language.toLowerCase().split(/[-_]/)[0];
  const ratingOverride = translations.listener_rating?.trim();
  // A missing key or inherited English seed is not a localized override.
  const localizedRatingOverride = ratingOverride && ratingOverride !== 'listener_rating'
    && (locale === 'en' || ratingOverride.toLowerCase() !== LISTENER_RATING.en.toLowerCase());
  return {
    about: translations.station_about_station || translations.about_station || about,
    information: translations.station_information || information,
    website: translations.website || website,
    intro: translations.seo_station_intro_sentence || translations.default_station_about || intro,
    outro: translations.seo_station_outro_sentence || translations.station_additional_info || getHomeSeoTemplate(language).description,
    listenerRating: localizedRatingOverride ? ratingOverride : LISTENER_RATING[locale] || LISTENER_RATING.en,
  };
}

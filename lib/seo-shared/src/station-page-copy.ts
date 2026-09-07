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

export function getStationPageCopy(language: string, translations: Record<string, string> = {}) {
  const [about, information, website, intro] = COPY[language] || COPY.en;
  return {
    about: translations.station_about_station || translations.about_station || about,
    information: translations.station_information || information,
    website: translations.website || website,
    intro: translations.seo_station_intro_sentence || translations.default_station_about || intro,
    outro: translations.seo_station_outro_sentence || translations.station_additional_info || getHomeSeoTemplate(language).description,
  };
}

export type StorePlatform = 'ios' | 'tvos' | 'macos' | 'android' | 'androidtv';

/** Only the matching platform's configured app listing is a download target.
 * Missing Apple listings must not fall back to Android, a marketing home page,
 * or an unrelated desktop release labelled as a Play Store download. */
export function applicationStoreUrl(manifest: unknown, platform: StorePlatform): string | undefined {
  const value = (manifest as { storeUrl?: Record<string, unknown> } | null)?.storeUrl?.[platform];
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
    if (platform === 'android' || platform === 'androidtv') {
      if (url.hostname !== 'play.google.com' || url.pathname !== '/store/apps/details' || !url.searchParams.get('id')) return undefined;
    } else if (!['apps.apple.com', 'itunes.apple.com'].includes(url.hostname) || !/\/id\d+(?:\/|$)/.test(url.pathname)) {
      return undefined;
    }
    return url.href;
  } catch { return undefined; }
}

const COPY: Record<string, [string, string, string]> = {
  en: ['Download on the', 'Get it on', 'Download link unavailable'],
  de: ['Laden im', 'Jetzt bei', 'Download-Link nicht verfügbar'],
  tr: ['Şuradan indirin', 'Şurada edinin', 'İndirme bağlantısı mevcut değil'],
  es: ['Descargar en', 'Disponible en', 'Enlace de descarga no disponible'],
  fr: ['Télécharger dans', 'Disponible sur', 'Lien de téléchargement indisponible'],
  pt: ['Baixar na', 'Disponível no', 'Link de download indisponível'],
  it: ['Scarica su', 'Disponibile su', 'Link per il download non disponibile'],
  ru: ['Загрузите в', 'Доступно в', 'Ссылка для скачивания недоступна'],
  ar: ['تنزيل من', 'متوفر على', 'رابط التنزيل غير متاح'],
  zh: ['下载自', '获取应用', '下载链接暂不可用'],
  ja: ['ダウンロード', '入手先', 'ダウンロードリンクは利用できません'],
  ko: ['다운로드', '다운로드 위치', '다운로드 링크를 사용할 수 없습니다'],
  hi: ['यहाँ से डाउनलोड करें', 'यहाँ उपलब्ध', 'डाउनलोड लिंक उपलब्ध नहीं है'],
  he: ['להורדה דרך', 'זמין דרך', 'קישור ההורדה אינו זמין'],
};

export function applicationDownloadCopy(language: string) {
  const [appStore, playStore, unavailable] = COPY[language] || COPY.en;
  return { appStore, playStore, unavailable };
}

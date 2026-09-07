export interface StationControlLabels {
  play: string; stop: string; previous: string; next: string;
  share: string; vote: string; close: string;
}

// Small same-language defaults for missing dictionary keys. Callers pass their
// existing current-locale dictionary; controls must not create query observers
// or let an English fallback dictionary override these localized defaults.
const fallbackLabels: Record<string, readonly string[]> = {
  en: ['Play station', 'Stop station', 'Previous station', 'Next station', 'Share station', 'Vote for this station', 'Close'],
  de: ['Sender abspielen', 'Sender stoppen', 'Vorheriger Sender', 'Nächster Sender', 'Sender teilen', 'Für diesen Sender abstimmen', 'Schließen'],
  tr: ['İstasyonu çal', 'Durdur', 'Önceki istasyon', 'Sonraki istasyon', 'İstasyonu paylaş', 'Bu istasyona oy ver', 'Kapat'],
  ar: ['تشغيل المحطة', 'إيقاف المحطة', 'المحطة السابقة', 'المحطة التالية', 'مشاركة المحطة', 'التصويت لهذه المحطة', 'إغلاق'],
  es: ['Reproducir emisora', 'Detener emisora', 'Emisora anterior', 'Emisora siguiente', 'Compartir emisora', 'Votar por esta emisora', 'Cerrar'],
  fr: ['Écouter la station', 'Arrêter la station', 'Station précédente', 'Station suivante', 'Partager la station', 'Voter pour cette station', 'Fermer'],
  he: ['הפעלת התחנה', 'עצירת התחנה', 'התחנה הקודמת', 'התחנה הבאה', 'שיתוף התחנה', 'הצבעה לתחנה זו', 'סגירה'],
  hi: ['स्टेशन चलाएँ', 'प्लेबैक रोकें', 'पिछला स्टेशन', 'अगला स्टेशन', 'स्टेशन साझा करें', 'इस स्टेशन को वोट दें', 'बंद करें'],
  it: ['Riproduci la stazione', 'Ferma la stazione', 'Stazione precedente', 'Stazione successiva', 'Condividi la stazione', 'Vota questa stazione', 'Chiudi'],
  ja: ['放送局を再生', '再生を停止', '前の放送局', '次の放送局', '放送局を共有', 'この放送局に投票', '閉じる'],
  ko: ['라디오 재생', '재생 중지', '이전 방송국', '다음 방송국', '방송국 공유', '이 방송국에 투표', '닫기'],
  pt: ['Reproduzir estação', 'Parar estação', 'Estação anterior', 'Estação seguinte', 'Compartilhar estação', 'Votar nesta estação', 'Fechar'],
  ru: ['Включить станцию', 'Остановить станцию', 'Предыдущая станция', 'Следующая станция', 'Поделиться станцией', 'Проголосовать за эту станцию', 'Закрыть'],
  zh: ['播放电台', '停止播放', '上一个电台', '下一个电台', '分享电台', '为此电台投票', '关闭'],
};

export function getStationControlLabels(language = 'en', localeTranslations?: Readonly<Record<string, string>>): StationControlLabels {
  const fallback = fallbackLabels[language] || fallbackLabels.en;
  const keys = ['player_play_station', 'player_stop', 'previous', 'next', 'button_share_station', 'station_vote', 'general_close'];
  const [play, stop, previous, next, share, vote, close] = keys.map((key, index) => {
    const value = localeTranslations?.[key];
    return typeof value === 'string' && value.trim() && value !== key &&
      !value.startsWith('Homepage ') && !['Title', 'Subtitle', 'titel', 'subtitel'].includes(value)
      ? value : fallback[index];
  });
  return { play, stop, previous, next, share, vote, close };
}

// This interaction loads before remote dictionaries may finish; keep all public
// locales usable offline too. Result labels use the shared t().
const copy: Record<string, { title: string; hint: string; close: string; selectHint: string; dismissHint: string }> = {
  en: { title: 'Search', hint: 'Find your next station. Stay in the moment.', close: 'Close search', selectHint: 'to select', dismissHint: 'to close' },
  de: { title: 'Suche', hint: 'Entdecke deinen nächsten Sender. Bleib im Moment.', close: 'Suche schließen', selectHint: 'auswählen', dismissHint: 'schließen' },
  tr: { title: 'Arama', hint: 'Sıradaki radyonu keşfet. Müziğin kesilmesin.', close: 'Aramayı kapat', selectHint: 'seçmek için', dismissHint: 'kapatmak için' },
  es: { title: 'Búsqueda', hint: 'Descubre tu próxima emisora sin perder el ritmo.', close: 'Cerrar búsqueda', selectHint: 'seleccionar', dismissHint: 'cerrar' },
  fr: { title: 'Recherche', hint: 'Découvrez votre prochaine radio sans perdre le fil.', close: 'Fermer la recherche', selectHint: 'sélectionner', dismissHint: 'fermer' },
  pt: { title: 'Pesquisa', hint: 'Descubra sua próxima estação sem perder o ritmo.', close: 'Fechar pesquisa', selectHint: 'selecionar', dismissHint: 'fechar' },
  it: { title: 'Ricerca', hint: 'Scopri la tua prossima radio senza perdere il ritmo.', close: 'Chiudi ricerca', selectHint: 'selezionare', dismissHint: 'chiudere' },
  ru: { title: 'Поиск', hint: 'Найдите новую станцию, оставаясь в ритме.', close: 'Закрыть поиск', selectHint: 'выбрать', dismissHint: 'закрыть' },
  ar: { title: 'بحث', hint: 'اكتشف محطتك القادمة دون أن تفقد الإيقاع.', close: 'إغلاق البحث', selectHint: 'للاختيار', dismissHint: 'للإغلاق' },
  zh: { title: '搜索', hint: '发现下一站精彩，不打断此刻的旋律。', close: '关闭搜索', selectHint: '选择', dismissHint: '关闭' },
  ja: { title: '検索', hint: '今の音楽を楽しみながら、次のラジオを探そう。', close: '検索を閉じる', selectHint: '選択', dismissHint: '閉じる' },
  ko: { title: '검색', hint: '지금의 음악을 즐기며 다음 방송을 찾아보세요.', close: '검색 닫기', selectHint: '선택', dismissHint: '닫기' },
  hi: { title: 'खोज', hint: 'संगीत का आनंद लेते हुए अगला स्टेशन खोजें।', close: 'खोज बंद करें', selectHint: 'चुनें', dismissHint: 'बंद करें' },
  he: { title: 'חיפוש', hint: 'גלו את התחנה הבאה בלי לאבד את הקצב.', close: 'סגירת החיפוש', selectHint: 'לבחירה', dismissHint: 'לסגירה' },
};
export const getQuickSearchCopy = (language: string) => copy[language] || copy.en;

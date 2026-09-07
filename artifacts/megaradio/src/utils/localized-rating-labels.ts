// Only the new widget accessibility/status strings need explicit same-locale
// fallbacks. Existing review copy still uses the application's translator.
const defaults: Record<string, readonly string[]> = {
  en: ['Rate {rating} out of 5', 'Loading ratings…', 'Ratings unavailable', 'Saving rating…', 'Rating could not be saved. Please try again.'],
  de: ['Mit {rating} von 5 bewerten', 'Bewertungen werden geladen…', 'Bewertungen nicht verfügbar', 'Bewertung wird gespeichert…', 'Bewertung konnte nicht gespeichert werden. Bitte erneut versuchen.'],
  tr: ['5 üzerinden {rating} puan ver', 'Puanlar yükleniyor…', 'Puanlar kullanılamıyor', 'Puan kaydediliyor…', 'Puan kaydedilemedi. Lütfen tekrar deneyin.'],
  ar: ['قيّم بـ {rating} من 5', 'جارٍ تحميل التقييمات…', 'التقييمات غير متاحة', 'جارٍ حفظ التقييم…', 'تعذر حفظ التقييم. يرجى المحاولة مجددًا.'],
  es: ['Puntuar {rating} de 5', 'Cargando valoraciones…', 'Valoraciones no disponibles', 'Guardando valoración…', 'No se pudo guardar la valoración. Inténtalo de nuevo.'],
  fr: ['Noter {rating} sur 5', 'Chargement des évaluations…', 'Évaluations indisponibles', 'Enregistrement de l’évaluation…', 'Impossible d’enregistrer l’évaluation. Veuillez réessayer.'],
  he: ['דירוג {rating} מתוך 5', 'הדירוגים נטענים…', 'הדירוגים אינם זמינים', 'הדירוג נשמר…', 'לא ניתן לשמור את הדירוג. נא לנסות שוב.'],
  hi: ['5 में से {rating} रेटिंग दें', 'रेटिंग लोड हो रही हैं…', 'रेटिंग उपलब्ध नहीं हैं', 'रेटिंग सहेजी जा रही है…', 'रेटिंग सहेजी नहीं जा सकी। कृपया फिर से प्रयास करें।'],
  it: ['Valuta {rating} su 5', 'Caricamento delle valutazioni…', 'Valutazioni non disponibili', 'Salvataggio della valutazione…', 'Impossibile salvare la valutazione. Riprova.'],
  ja: ['5段階で{rating}と評価', '評価を読み込み中…', '評価を取得できません', '評価を保存中…', '評価を保存できませんでした。もう一度お試しください。'],
  ko: ['5점 만점에 {rating}점 평가', '평가 불러오는 중…', '평가를 불러올 수 없습니다', '평가 저장 중…', '평가를 저장하지 못했습니다. 다시 시도해 주세요.'],
  pt: ['Avaliar com {rating} de 5', 'Carregando avaliações…', 'Avaliações indisponíveis', 'Salvando avaliação…', 'Não foi possível salvar a avaliação. Tente novamente.'],
  ru: ['Оценить на {rating} из 5', 'Загрузка оценок…', 'Оценки недоступны', 'Сохранение оценки…', 'Не удалось сохранить оценку. Попробуйте ещё раз.'],
  zh: ['评分：{rating}/5', '正在加载评分…', '评分暂不可用', '正在保存评分…', '无法保存评分，请重试。'],
};

export function getLocalizedRatingLabels(language: string, dictionary?: Readonly<Record<string, string>>) {
  const locale = (language || 'en').toLowerCase().split(/[-_]/)[0];
  const fallback = defaults[locale] || defaults.en;
  const keys = ['rating_star_label', 'rating_loading', 'rating_unavailable', 'rating_saving', 'rating_save_failed'];
  const [star, loading, unavailable, saving, failed] = keys.map((key, index) => {
    const value = dictionary?.[key];
    return typeof value === 'string' && value.trim() && value !== key &&
      !value.startsWith('Homepage ') && !['Title', 'Subtitle', 'titel', 'subtitel'].includes(value)
      ? value : fallback[index];
  });
  return { star: (rating: number) => star.replace(/\{rating\}/g, String(rating)), loading, unavailable, saving, failed };
}

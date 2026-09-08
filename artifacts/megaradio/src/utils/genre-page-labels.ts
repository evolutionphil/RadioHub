export interface GenrePageLabels {
  genres: string;
  stations: string;
  loading: string;
  error: string;
  emptyGenres: string;
  emptyStations: string;
  retry: string;
  previous: string;
  next: string;
}

type LabelValues = readonly [string, string, string, string, string, string, string, string, string];

// Use only the caller's current-locale dictionary, never the merged English
// fallback dictionary. Missing keys must not turn a localized error state English.
const defaults: Record<string, LabelValues> = {
  en: ['Genres', 'stations', 'Loading…', 'Unable to load this content.', 'No genres found.', 'No stations found.', 'Try again', 'Previous', 'Next'],
  es: ['Géneros', 'emisoras', 'Cargando…', 'No se pudo cargar este contenido.', 'No se encontraron géneros.', 'No se encontraron emisoras.', 'Volver a intentar', 'Anterior', 'Siguiente'],
  fr: ['Genres', 'stations', 'Chargement…', 'Impossible de charger ce contenu.', 'Aucun genre trouvé.', 'Aucune station trouvée.', 'Réessayer', 'Précédent', 'Suivant'],
  de: ['Genres', 'Sender', 'Wird geladen…', 'Dieser Inhalt konnte nicht geladen werden.', 'Keine Genres gefunden.', 'Keine Sender gefunden.', 'Erneut versuchen', 'Zurück', 'Weiter'],
  pt: ['Gêneros', 'estações', 'Carregando…', 'Não foi possível carregar este conteúdo.', 'Nenhum gênero encontrado.', 'Nenhuma estação encontrada.', 'Tentar novamente', 'Anterior', 'Próximo'],
  it: ['Generi', 'stazioni', 'Caricamento…', 'Impossibile caricare questo contenuto.', 'Nessun genere trovato.', 'Nessuna stazione trovata.', 'Riprova', 'Precedente', 'Successivo'],
  ru: ['Жанры', 'радиостанции', 'Загрузка…', 'Не удалось загрузить содержимое.', 'Жанры не найдены.', 'Радиостанции не найдены.', 'Повторить', 'Назад', 'Далее'],
  ar: ['الأنواع', 'محطات', 'جارٍ التحميل…', 'تعذر تحميل هذا المحتوى.', 'لم يتم العثور على أنواع.', 'لم يتم العثور على محطات.', 'المحاولة مجددًا', 'السابق', 'التالي'],
  zh: ['类型', '电台', '正在加载…', '无法加载此内容。', '未找到类型。', '未找到电台。', '重试', '上一页', '下一页'],
  tr: ['Türler', 'istasyonlar', 'Yükleniyor…', 'Bu içerik yüklenemedi.', 'Tür bulunamadı.', 'İstasyon bulunamadı.', 'Tekrar dene', 'Önceki', 'Sonraki'],
  ja: ['ジャンル', '放送局', '読み込み中…', 'コンテンツを読み込めませんでした。', 'ジャンルが見つかりません。', '放送局が見つかりません。', '再試行', '前へ', '次へ'],
  ko: ['장르', '방송국', '불러오는 중…', '콘텐츠를 불러올 수 없습니다.', '장르를 찾을 수 없습니다.', '방송국을 찾을 수 없습니다.', '다시 시도', '이전', '다음'],
  hi: ['शैलियाँ', 'स्टेशन', 'लोड हो रहा है…', 'यह सामग्री लोड नहीं हो सकी।', 'कोई शैली नहीं मिली।', 'कोई स्टेशन नहीं मिला।', 'फिर से प्रयास करें', 'पिछला', 'अगला'],
  he: ["ז'אנרים", 'תחנות', 'בטעינה…', 'לא ניתן לטעון את התוכן.', "לא נמצאו ז'אנרים.", 'לא נמצאו תחנות.', 'ניסיון נוסף', 'הקודם', 'הבא'],
};

const dictionaryKeys = [
  'genres', 'stations', 'loading', 'error', 'no_genres_found',
  'no_stations_found', 'try_again', 'previous', 'next',
] as const;

export function getGenrePageLabels(
  language = 'en',
  localeTranslations?: Readonly<Record<string, string>>,
): GenrePageLabels {
  const locale = language.trim().toLowerCase().split(/[-_]/)[0];
  const fallback = defaults[locale] || defaults.en;
  const [genres, stations, loading, error, emptyGenres, emptyStations, retry, previous, next] = dictionaryKeys.map((key, index) => {
    const value = localeTranslations?.[key];
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed && trimmed !== key && !/^homepage(?:\s|$)/i.test(trimmed) &&
      !/^(?:title|subtitle|titel|subtitel)$/i.test(trimmed)
      ? value! : fallback[index];
  });
  return { genres, stations, loading, error, emptyGenres, emptyStations, retry, previous, next };
}

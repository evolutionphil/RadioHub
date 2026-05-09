/**
 * Backfill seeder for search-page (`search_*`) UI translations.
 *
 * Background: task #298 added `tests/search-translations-db-coverage.test.ts`
 * which fails the build whenever any `t("search_*", "...")` call inside
 * `artifacts/megaradio/src/pages/search.tsx` doesn't have a non-empty
 * Translation row in the runtime DB for every SEO_LANGUAGES code. Without
 * those rows the SPA silently falls back to English for ~57 non-English
 * languages.
 *
 * This module owns:
 *   1. The canonical English defaults for every search-page key (matched
 *      to the inline fallbacks inside search.tsx so the in-DB English copy
 *      doesn't drift from the rendered fallback).
 *   2. Hand-translated values for every other code in SEO_LANGUAGES.
 *   3. An idempotent boot-time seeder (`seedSearchPageTranslations`) that
 *      upserts both `TranslationKey` and per-language `Translation` rows.
 *
 * The seeder is invoked from `routes.ts` next to `seedSeoTranslationKeys()`
 * so the data is guaranteed to be present in any environment that runs the
 * api-server, including production after a normal deploy. Adding a new
 * language to SEO_LANGUAGES that has no entry in TRANSLATIONS below will
 * be caught by the build-time guard, not silently fallen back.
 */

import {
  Translation,
  TranslationKey,
} from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';

interface SearchKeyDef {
  key: string;
  defaultValue: string;
  description: string;
}

/**
 * The list + English defaults must match the `t("search_*", "<fallback>")`
 * calls in `artifacts/megaradio/src/pages/search.tsx`. The build-time guard
 * extracts the keys from the source; we mirror the fallbacks here so the
 * in-DB English copy and the inline fallback render identical text.
 */
const SEARCH_KEYS: SearchKeyDef[] = [
  {
    key: 'search_page_h1',
    defaultValue: 'Search Live Radio Stations',
    description: 'Search results page H1 heading',
  },
  {
    key: 'search_page_intro',
    defaultValue:
      "Search Mega Radio's catalogue of 60,000+ live radio stations from 120+ countries. Type a station name, music genre, language, or country to start streaming free online radio instantly.",
    description: 'Search results page intro paragraph below H1',
  },
  {
    key: 'search_placeholder',
    defaultValue: 'Search stations, genres, countries…',
    description: 'Search input placeholder on the search page',
  },
  {
    key: 'search_no_results',
    defaultValue: 'No stations, genres or countries match your search.',
    description: 'Empty-state message when no search hits are found',
  },
  {
    key: 'search_min_chars_hint',
    defaultValue: 'Type at least 2 characters to start searching.',
    description: 'Hint shown when the query is too short to trigger a search',
  },
  {
    key: 'search_section_genres',
    defaultValue: 'Genres',
    description: 'Section heading for genre matches in search results',
  },
  {
    key: 'search_section_countries',
    defaultValue: 'Countries',
    description: 'Section heading for country matches in search results',
  },
  {
    key: 'search_section_stations',
    defaultValue: 'Stations',
    description: 'Section heading for station matches in search results',
  },
  {
    key: 'search_paging_hint_prefix',
    defaultValue: 'Tip: press',
    description: 'Leading text of the keyboard paging hint',
  },
  {
    key: 'search_paging_hint_or',
    defaultValue: 'or',
    description: 'Connector between the two key chips in the paging hint',
  },
  {
    key: 'search_paging_hint_suffix',
    defaultValue: 'to jump a page through the results.',
    description: 'Trailing text of the keyboard paging hint',
  },
  {
    key: 'search_esc_clear_hint_prefix',
    defaultValue: 'Press',
    description: 'Leading text of the Esc-to-clear hint',
  },
  {
    key: 'search_esc_clear_hint_suffix',
    defaultValue: 'to clear the highlighted result before closing search.',
    description: 'Trailing text of the Esc-to-clear hint',
  },
  {
    key: 'search_esc_hint_clear',
    defaultValue: 'Esc to clear',
    description: 'Inline hint shown beside the search input when a query is typed',
  },
  {
    key: 'search_esc_hint_close',
    defaultValue: 'Esc',
    description: 'Inline hint shown beside the search input when empty',
  },
  {
    key: 'search_esc_hint_clear_title',
    defaultValue: 'Press Esc to clear',
    description: 'Tooltip on the Esc hint chip when a query is typed',
  },
  {
    key: 'search_esc_hint_close_title',
    defaultValue: 'Press Esc to close search',
    description: 'Tooltip on the Esc hint chip when the input is empty',
  },
  {
    key: 'search_key_pageup',
    defaultValue: 'PageUp',
    description: 'Keyboard key chip label — kept Latin in every language',
  },
  {
    key: 'search_key_pagedown',
    defaultValue: 'PageDown',
    description: 'Keyboard key chip label — kept Latin in every language',
  },
  {
    key: 'search_key_esc',
    defaultValue: 'Esc',
    description: 'Keyboard key chip label — kept Latin in every language',
  },
];

type Lang = string;

/**
 * Per-language translations for every key in SEARCH_KEYS. Coverage matches
 * SEO_LANGUAGES (lib/seo-shared/src/seo-config.ts) — the build-time guard
 * fails immediately if a (language, key) pair is missing.
 *
 * Keyboard key chips (`search_key_pageup` / `pagedown` / `esc`) are kept
 * as their Latin abbreviations across all locales — that's how physical
 * keyboards label them globally and translating them would mis-cue users.
 */
const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  en: {
    search_page_h1: 'Search Live Radio Stations',
    search_page_intro:
      "Search Mega Radio's catalogue of 60,000+ live radio stations from 120+ countries. Type a station name, music genre, language, or country to start streaming free online radio instantly.",
    search_placeholder: 'Search stations, genres, countries…',
    search_no_results: 'No stations, genres or countries match your search.',
    search_min_chars_hint: 'Type at least 2 characters to start searching.',
    search_section_genres: 'Genres',
    search_section_countries: 'Countries',
    search_section_stations: 'Stations',
    search_paging_hint_prefix: 'Tip: press',
    search_paging_hint_or: 'or',
    search_paging_hint_suffix: 'to jump a page through the results.',
    search_esc_clear_hint_prefix: 'Press',
    search_esc_clear_hint_suffix:
      'to clear the highlighted result before closing search.',
    search_esc_hint_clear: 'Esc to clear',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Press Esc to clear',
    search_esc_hint_close_title: 'Press Esc to close search',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  tr: {
    search_page_h1: 'Canlı Radyo İstasyonları Ara',
    search_page_intro:
      "Mega Radio'nun 120'den fazla ülkeden 60.000'den fazla canlı radyo istasyonu kataloğunda arama yapın. Anında ücretsiz çevrimiçi radyo dinlemeye başlamak için bir istasyon adı, müzik türü, dil veya ülke yazın.",
    search_placeholder: 'İstasyon, tür, ülke ara…',
    search_no_results: 'Aramanızla eşleşen istasyon, tür veya ülke yok.',
    search_min_chars_hint: 'Aramaya başlamak için en az 2 karakter yazın.',
    search_section_genres: 'Türler',
    search_section_countries: 'Ülkeler',
    search_section_stations: 'İstasyonlar',
    search_paging_hint_prefix: 'İpucu: tuşuna basın',
    search_paging_hint_or: 'veya',
    search_paging_hint_suffix: 'sonuçlar arasında sayfa atlamak için.',
    search_esc_clear_hint_prefix: 'Basın',
    search_esc_clear_hint_suffix:
      'aramayı kapatmadan önce vurgulanan sonucu temizlemek için.',
    search_esc_hint_clear: 'Temizlemek için Esc',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Temizlemek için Esc tuşuna basın',
    search_esc_hint_close_title: 'Aramayı kapatmak için Esc tuşuna basın',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  es: {
    search_page_h1: 'Buscar emisoras de radio en vivo',
    search_page_intro:
      'Busca en el catálogo de Mega Radio con más de 60.000 emisoras de radio en vivo de más de 120 países. Escribe el nombre de una emisora, un género musical, un idioma o un país para empezar a escuchar radio en línea gratis al instante.',
    search_placeholder: 'Buscar emisoras, géneros, países…',
    search_no_results:
      'Ninguna emisora, género o país coincide con tu búsqueda.',
    search_min_chars_hint: 'Escribe al menos 2 caracteres para empezar a buscar.',
    search_section_genres: 'Géneros',
    search_section_countries: 'Países',
    search_section_stations: 'Emisoras',
    search_paging_hint_prefix: 'Consejo: pulsa',
    search_paging_hint_or: 'o',
    search_paging_hint_suffix: 'para saltar una página de resultados.',
    search_esc_clear_hint_prefix: 'Pulsa',
    search_esc_clear_hint_suffix:
      'para borrar el resultado resaltado antes de cerrar la búsqueda.',
    search_esc_hint_clear: 'Esc para borrar',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Pulsa Esc para borrar',
    search_esc_hint_close_title: 'Pulsa Esc para cerrar la búsqueda',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  fr: {
    search_page_h1: 'Rechercher des stations de radio en direct',
    search_page_intro:
      'Parcourez le catalogue de Mega Radio avec plus de 60 000 stations de radio en direct de plus de 120 pays. Saisissez un nom de station, un genre musical, une langue ou un pays pour écouter la radio en ligne gratuitement en un instant.',
    search_placeholder: 'Rechercher stations, genres, pays…',
    search_no_results:
      'Aucune station, aucun genre ou pays ne correspond à votre recherche.',
    search_min_chars_hint:
      'Saisissez au moins 2 caractères pour lancer la recherche.',
    search_section_genres: 'Genres',
    search_section_countries: 'Pays',
    search_section_stations: 'Stations',
    search_paging_hint_prefix: 'Astuce : appuyez sur',
    search_paging_hint_or: 'ou',
    search_paging_hint_suffix: 'pour parcourir les résultats page par page.',
    search_esc_clear_hint_prefix: 'Appuyez sur',
    search_esc_clear_hint_suffix:
      'pour effacer le résultat sélectionné avant de fermer la recherche.',
    search_esc_hint_clear: 'Esc pour effacer',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Appuyez sur Esc pour effacer',
    search_esc_hint_close_title: 'Appuyez sur Esc pour fermer la recherche',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  de: {
    search_page_h1: 'Live-Radiosender suchen',
    search_page_intro:
      'Durchsuchen Sie den Katalog von Mega Radio mit über 60.000 Live-Radiosendern aus mehr als 120 Ländern. Geben Sie einen Sendernamen, ein Musikgenre, eine Sprache oder ein Land ein, um sofort kostenloses Online-Radio zu streamen.',
    search_placeholder: 'Sender, Genres, Länder suchen…',
    search_no_results:
      'Keine Sender, Genres oder Länder passen zu Ihrer Suche.',
    search_min_chars_hint:
      'Geben Sie mindestens 2 Zeichen ein, um die Suche zu starten.',
    search_section_genres: 'Genres',
    search_section_countries: 'Länder',
    search_section_stations: 'Sender',
    search_paging_hint_prefix: 'Tipp: Drücken Sie',
    search_paging_hint_or: 'oder',
    search_paging_hint_suffix:
      'um seitenweise durch die Ergebnisse zu blättern.',
    search_esc_clear_hint_prefix: 'Drücken Sie',
    search_esc_clear_hint_suffix:
      'um das markierte Ergebnis zu löschen, bevor die Suche geschlossen wird.',
    search_esc_hint_clear: 'Esc zum Löschen',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Drücken Sie Esc zum Löschen',
    search_esc_hint_close_title: 'Drücken Sie Esc, um die Suche zu schließen',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  ar: {
    search_page_h1: 'ابحث عن محطات الراديو المباشرة',
    search_page_intro:
      'تصفح كتالوج Mega Radio الذي يضم أكثر من 60,000 محطة راديو مباشرة من أكثر من 120 دولة. اكتب اسم محطة أو نوعًا موسيقيًا أو لغة أو دولة لتبدأ بث الراديو عبر الإنترنت مجانًا على الفور.',
    search_placeholder: 'ابحث عن محطات أو أنواع أو دول…',
    search_no_results:
      'لا توجد محطات أو أنواع أو دول تطابق بحثك.',
    search_min_chars_hint:
      'اكتب حرفين على الأقل لبدء البحث.',
    search_section_genres: 'الأنواع',
    search_section_countries: 'الدول',
    search_section_stations: 'المحطات',
    search_paging_hint_prefix: 'نصيحة: اضغط',
    search_paging_hint_or: 'أو',
    search_paging_hint_suffix: 'للتنقل بين صفحات النتائج.',
    search_esc_clear_hint_prefix: 'اضغط',
    search_esc_clear_hint_suffix:
      'لمسح النتيجة المظللة قبل إغلاق البحث.',
    search_esc_hint_clear: 'Esc للمسح',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'اضغط Esc للمسح',
    search_esc_hint_close_title: 'اضغط Esc لإغلاق البحث',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  it: {
    search_page_h1: 'Cerca stazioni radio in diretta',
    search_page_intro:
      "Esplora il catalogo di Mega Radio con oltre 60.000 stazioni radio in diretta da più di 120 paesi. Digita il nome di una stazione, un genere musicale, una lingua o un paese per iniziare subito ad ascoltare la radio online gratis.",
    search_placeholder: 'Cerca stazioni, generi, paesi…',
    search_no_results:
      'Nessuna stazione, genere o paese corrisponde alla tua ricerca.',
    search_min_chars_hint:
      'Digita almeno 2 caratteri per avviare la ricerca.',
    search_section_genres: 'Generi',
    search_section_countries: 'Paesi',
    search_section_stations: 'Stazioni',
    search_paging_hint_prefix: 'Suggerimento: premi',
    search_paging_hint_or: 'o',
    search_paging_hint_suffix: 'per scorrere i risultati pagina per pagina.',
    search_esc_clear_hint_prefix: 'Premi',
    search_esc_clear_hint_suffix:
      'per cancellare il risultato evidenziato prima di chiudere la ricerca.',
    search_esc_hint_clear: 'Esc per cancellare',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Premi Esc per cancellare',
    search_esc_hint_close_title: 'Premi Esc per chiudere la ricerca',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  pt: {
    search_page_h1: 'Pesquisar estações de rádio ao vivo',
    search_page_intro:
      'Explore o catálogo da Mega Radio com mais de 60.000 estações de rádio ao vivo de mais de 120 países. Digite o nome de uma estação, gênero musical, idioma ou país para começar a ouvir rádio online grátis instantaneamente.',
    search_placeholder: 'Pesquisar estações, gêneros, países…',
    search_no_results:
      'Nenhuma estação, gênero ou país corresponde à sua pesquisa.',
    search_min_chars_hint:
      'Digite pelo menos 2 caracteres para iniciar a pesquisa.',
    search_section_genres: 'Gêneros',
    search_section_countries: 'Países',
    search_section_stations: 'Estações',
    search_paging_hint_prefix: 'Dica: pressione',
    search_paging_hint_or: 'ou',
    search_paging_hint_suffix: 'para avançar uma página nos resultados.',
    search_esc_clear_hint_prefix: 'Pressione',
    search_esc_clear_hint_suffix:
      'para limpar o resultado destacado antes de fechar a pesquisa.',
    search_esc_hint_clear: 'Esc para limpar',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Pressione Esc para limpar',
    search_esc_hint_close_title: 'Pressione Esc para fechar a pesquisa',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  nl: {
    search_page_h1: 'Zoek live radiostations',
    search_page_intro:
      "Doorzoek de catalogus van Mega Radio met meer dan 60.000 live radiostations uit meer dan 120 landen. Typ een stationsnaam, muziekgenre, taal of land om direct gratis online radio te luisteren.",
    search_placeholder: 'Zoek stations, genres, landen…',
    search_no_results:
      'Geen stations, genres of landen komen overeen met je zoekopdracht.',
    search_min_chars_hint: 'Typ minstens 2 tekens om te zoeken.',
    search_section_genres: 'Genres',
    search_section_countries: 'Landen',
    search_section_stations: 'Stations',
    search_paging_hint_prefix: 'Tip: druk op',
    search_paging_hint_or: 'of',
    search_paging_hint_suffix: 'om een pagina door de resultaten te bladeren.',
    search_esc_clear_hint_prefix: 'Druk op',
    search_esc_clear_hint_suffix:
      'om het gemarkeerde resultaat te wissen voordat je de zoekopdracht sluit.',
    search_esc_hint_clear: 'Esc om te wissen',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Druk op Esc om te wissen',
    search_esc_hint_close_title: 'Druk op Esc om de zoekopdracht te sluiten',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  ru: {
    search_page_h1: 'Поиск радиостанций в прямом эфире',
    search_page_intro:
      'Исследуйте каталог Mega Radio с более чем 60 000 радиостанций из более чем 120 стран. Введите название станции, музыкальный жанр, язык или страну, чтобы мгновенно начать слушать онлайн-радио бесплатно.',
    search_placeholder: 'Поиск станций, жанров, стран…',
    search_no_results:
      'Ни одна станция, жанр или страна не соответствуют вашему запросу.',
    search_min_chars_hint:
      'Введите не менее 2 символов, чтобы начать поиск.',
    search_section_genres: 'Жанры',
    search_section_countries: 'Страны',
    search_section_stations: 'Станции',
    search_paging_hint_prefix: 'Совет: нажмите',
    search_paging_hint_or: 'или',
    search_paging_hint_suffix:
      'чтобы перелистывать страницы результатов.',
    search_esc_clear_hint_prefix: 'Нажмите',
    search_esc_clear_hint_suffix:
      'чтобы снять выделение перед закрытием поиска.',
    search_esc_hint_clear: 'Esc — очистить',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Нажмите Esc, чтобы очистить',
    search_esc_hint_close_title: 'Нажмите Esc, чтобы закрыть поиск',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  pl: {
    search_page_h1: 'Wyszukaj stacje radiowe na żywo',
    search_page_intro:
      'Przeszukaj katalog Mega Radio zawierający ponad 60 000 stacji radiowych na żywo z ponad 120 krajów. Wpisz nazwę stacji, gatunek muzyczny, język lub kraj, aby natychmiast zacząć słuchać darmowego radia online.',
    search_placeholder: 'Szukaj stacji, gatunków, krajów…',
    search_no_results:
      'Żadna stacja, gatunek ani kraj nie pasują do Twojego wyszukiwania.',
    search_min_chars_hint:
      'Wpisz co najmniej 2 znaki, aby rozpocząć wyszukiwanie.',
    search_section_genres: 'Gatunki',
    search_section_countries: 'Kraje',
    search_section_stations: 'Stacje',
    search_paging_hint_prefix: 'Wskazówka: naciśnij',
    search_paging_hint_or: 'lub',
    search_paging_hint_suffix: 'aby przeskoczyć stronę wyników.',
    search_esc_clear_hint_prefix: 'Naciśnij',
    search_esc_clear_hint_suffix:
      'aby wyczyścić podświetlony wynik przed zamknięciem wyszukiwania.',
    search_esc_hint_clear: 'Esc, aby wyczyścić',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Naciśnij Esc, aby wyczyścić',
    search_esc_hint_close_title: 'Naciśnij Esc, aby zamknąć wyszukiwanie',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  sv: {
    search_page_h1: 'Sök liveradiostationer',
    search_page_intro:
      'Bläddra i Mega Radios katalog med över 60 000 liveradiostationer från fler än 120 länder. Skriv ett stationsnamn, en musikgenre, ett språk eller ett land för att börja lyssna på gratis onlineradio direkt.',
    search_placeholder: 'Sök stationer, genrer, länder…',
    search_no_results:
      'Inga stationer, genrer eller länder matchar din sökning.',
    search_min_chars_hint: 'Skriv minst 2 tecken för att starta sökningen.',
    search_section_genres: 'Genrer',
    search_section_countries: 'Länder',
    search_section_stations: 'Stationer',
    search_paging_hint_prefix: 'Tips: tryck på',
    search_paging_hint_or: 'eller',
    search_paging_hint_suffix: 'för att hoppa en sida i resultaten.',
    search_esc_clear_hint_prefix: 'Tryck på',
    search_esc_clear_hint_suffix:
      'för att rensa det markerade resultatet innan sökningen stängs.',
    search_esc_hint_clear: 'Esc för att rensa',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Tryck på Esc för att rensa',
    search_esc_hint_close_title: 'Tryck på Esc för att stänga sökningen',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  da: {
    search_page_h1: 'Søg liveradiostationer',
    search_page_intro:
      'Gennemse Mega Radios katalog med over 60.000 liveradiostationer fra mere end 120 lande. Skriv et stationsnavn, en musikgenre, et sprog eller et land for at begynde at lytte til gratis onlineradio med det samme.',
    search_placeholder: 'Søg stationer, genrer, lande…',
    search_no_results:
      'Ingen stationer, genrer eller lande matcher din søgning.',
    search_min_chars_hint: 'Skriv mindst 2 tegn for at starte søgningen.',
    search_section_genres: 'Genrer',
    search_section_countries: 'Lande',
    search_section_stations: 'Stationer',
    search_paging_hint_prefix: 'Tip: tryk på',
    search_paging_hint_or: 'eller',
    search_paging_hint_suffix: 'for at hoppe en side i resultaterne.',
    search_esc_clear_hint_prefix: 'Tryk på',
    search_esc_clear_hint_suffix:
      'for at rydde det fremhævede resultat, før søgningen lukkes.',
    search_esc_hint_clear: 'Esc for at rydde',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Tryk på Esc for at rydde',
    search_esc_hint_close_title: 'Tryk på Esc for at lukke søgningen',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  no: {
    search_page_h1: 'Søk i direktesendte radiostasjoner',
    search_page_intro:
      'Utforsk Mega Radios katalog med over 60 000 direktesendte radiostasjoner fra mer enn 120 land. Skriv inn navnet på en stasjon, en musikksjanger, et språk eller et land for å begynne å høre gratis nettradio med en gang.',
    search_placeholder: 'Søk etter stasjoner, sjangre, land…',
    search_no_results:
      'Ingen stasjoner, sjangre eller land samsvarer med søket ditt.',
    search_min_chars_hint: 'Skriv minst 2 tegn for å begynne å søke.',
    search_section_genres: 'Sjangre',
    search_section_countries: 'Land',
    search_section_stations: 'Stasjoner',
    search_paging_hint_prefix: 'Tips: trykk',
    search_paging_hint_or: 'eller',
    search_paging_hint_suffix: 'for å hoppe en side i resultatene.',
    search_esc_clear_hint_prefix: 'Trykk',
    search_esc_clear_hint_suffix:
      'for å fjerne det uthevede resultatet før søket lukkes.',
    search_esc_hint_clear: 'Esc for å tømme',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Trykk Esc for å tømme',
    search_esc_hint_close_title: 'Trykk Esc for å lukke søket',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  fi: {
    search_page_h1: 'Hae suoria radioasemia',
    search_page_intro:
      'Selaa Mega Radion katalogia, jossa on yli 60 000 suoraa radioasemaa yli 120 maasta. Kirjoita aseman nimi, musiikkityyli, kieli tai maa ja aloita ilmainen verkkoradion kuuntelu välittömästi.',
    search_placeholder: 'Hae asemia, genrejä, maita…',
    search_no_results: 'Hakuusi ei vastaa yksikään asema, genre tai maa.',
    search_min_chars_hint: 'Kirjoita vähintään 2 merkkiä aloittaaksesi haun.',
    search_section_genres: 'Genret',
    search_section_countries: 'Maat',
    search_section_stations: 'Asemat',
    search_paging_hint_prefix: 'Vinkki: paina',
    search_paging_hint_or: 'tai',
    search_paging_hint_suffix: 'siirtyäksesi sivun tuloksissa.',
    search_esc_clear_hint_prefix: 'Paina',
    search_esc_clear_hint_suffix:
      'tyhjentääksesi korostetun tuloksen ennen haun sulkemista.',
    search_esc_hint_clear: 'Esc tyhjentääksesi',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Paina Esc tyhjentääksesi',
    search_esc_hint_close_title: 'Paina Esc sulkeaksesi haun',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  el: {
    search_page_h1: 'Αναζήτηση ζωντανών ραδιοφωνικών σταθμών',
    search_page_intro:
      'Εξερευνήστε τον κατάλογο της Mega Radio με πάνω από 60.000 ζωντανούς ραδιοφωνικούς σταθμούς από περισσότερες από 120 χώρες. Πληκτρολογήστε όνομα σταθμού, μουσικό είδος, γλώσσα ή χώρα για να ακούσετε άμεσα δωρεάν διαδικτυακό ραδιόφωνο.',
    search_placeholder: 'Αναζήτηση σταθμών, ειδών, χωρών…',
    search_no_results:
      'Κανένας σταθμός, είδος ή χώρα δεν ταιριάζει με την αναζήτησή σας.',
    search_min_chars_hint:
      'Πληκτρολογήστε τουλάχιστον 2 χαρακτήρες για να ξεκινήσει η αναζήτηση.',
    search_section_genres: 'Είδη',
    search_section_countries: 'Χώρες',
    search_section_stations: 'Σταθμοί',
    search_paging_hint_prefix: 'Συμβουλή: πατήστε',
    search_paging_hint_or: 'ή',
    search_paging_hint_suffix: 'για να μεταβείτε μια σελίδα στα αποτελέσματα.',
    search_esc_clear_hint_prefix: 'Πατήστε',
    search_esc_clear_hint_suffix:
      'για να καθαρίσετε το επισημασμένο αποτέλεσμα πριν κλείσετε την αναζήτηση.',
    search_esc_hint_clear: 'Esc για εκκαθάριση',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Πατήστε Esc για εκκαθάριση',
    search_esc_hint_close_title: 'Πατήστε Esc για να κλείσετε την αναζήτηση',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  hu: {
    search_page_h1: 'Élő rádióállomások keresése',
    search_page_intro:
      'Böngéssz a Mega Radio katalógusában, amely több mint 60 000 élő rádióállomást tartalmaz több mint 120 országból. Írj be egy állomásnevet, zenei műfajt, nyelvet vagy országot, és kezdd el azonnal ingyenesen hallgatni az online rádiót.',
    search_placeholder: 'Állomások, műfajok, országok keresése…',
    search_no_results:
      'Egyetlen állomás, műfaj vagy ország sem egyezik a keresésével.',
    search_min_chars_hint:
      'A kereséshez legalább 2 karaktert írj be.',
    search_section_genres: 'Műfajok',
    search_section_countries: 'Országok',
    search_section_stations: 'Állomások',
    search_paging_hint_prefix: 'Tipp: nyomd meg a',
    search_paging_hint_or: 'vagy',
    search_paging_hint_suffix: 'gombot, hogy oldalt ugorj az eredmények között.',
    search_esc_clear_hint_prefix: 'Nyomd meg az',
    search_esc_clear_hint_suffix:
      'gombot a kiemelt eredmény törléséhez, mielőtt bezárod a keresést.',
    search_esc_hint_clear: 'Esc a törléshez',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Nyomd meg az Esc gombot a törléshez',
    search_esc_hint_close_title:
      'Nyomd meg az Esc gombot a keresés bezárásához',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  cs: {
    search_page_h1: 'Hledat živé rádiové stanice',
    search_page_intro:
      'Prohlédněte si katalog Mega Radio s více než 60 000 živými rádiovými stanicemi z více než 120 zemí. Zadejte název stanice, hudební žánr, jazyk nebo zemi a začněte okamžitě poslouchat bezplatné online rádio.',
    search_placeholder: 'Hledat stanice, žánry, země…',
    search_no_results:
      'Vašemu hledání neodpovídá žádná stanice, žánr ani země.',
    search_min_chars_hint:
      'Pro zahájení hledání zadejte alespoň 2 znaky.',
    search_section_genres: 'Žánry',
    search_section_countries: 'Země',
    search_section_stations: 'Stanice',
    search_paging_hint_prefix: 'Tip: stiskněte',
    search_paging_hint_or: 'nebo',
    search_paging_hint_suffix: 'pro posun o stránku ve výsledcích.',
    search_esc_clear_hint_prefix: 'Stiskněte',
    search_esc_clear_hint_suffix:
      'pro zrušení zvýrazněného výsledku před zavřením hledání.',
    search_esc_hint_clear: 'Esc pro vymazání',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Stiskněte Esc pro vymazání',
    search_esc_hint_close_title: 'Stiskněte Esc pro zavření hledání',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  sk: {
    search_page_h1: 'Hľadať živé rádiové stanice',
    search_page_intro:
      'Prezrite si katalóg Mega Radio s viac ako 60 000 živými rádiovými stanicami z viac ako 120 krajín. Zadajte názov stanice, hudobný žáner, jazyk alebo krajinu a okamžite začnite počúvať bezplatné online rádio.',
    search_placeholder: 'Hľadať stanice, žánre, krajiny…',
    search_no_results:
      'Vášmu hľadaniu nezodpovedá žiadna stanica, žáner ani krajina.',
    search_min_chars_hint:
      'Pre začatie hľadania zadajte aspoň 2 znaky.',
    search_section_genres: 'Žánre',
    search_section_countries: 'Krajiny',
    search_section_stations: 'Stanice',
    search_paging_hint_prefix: 'Tip: stlačte',
    search_paging_hint_or: 'alebo',
    search_paging_hint_suffix: 'pre posun o stránku vo výsledkoch.',
    search_esc_clear_hint_prefix: 'Stlačte',
    search_esc_clear_hint_suffix:
      'pre zrušenie zvýrazneného výsledku pred zatvorením hľadania.',
    search_esc_hint_clear: 'Esc na vymazanie',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Stlačte Esc na vymazanie',
    search_esc_hint_close_title: 'Stlačte Esc pre zatvorenie hľadania',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  ro: {
    search_page_h1: 'Caută posturi radio live',
    search_page_intro:
      'Explorează catalogul Mega Radio cu peste 60.000 de posturi radio live din peste 120 de țări. Tastează numele unui post, un gen muzical, o limbă sau o țară pentru a asculta radio online gratuit imediat.',
    search_placeholder: 'Caută posturi, genuri, țări…',
    search_no_results:
      'Niciun post, gen sau țară nu corespunde căutării tale.',
    search_min_chars_hint:
      'Tastează cel puțin 2 caractere pentru a începe căutarea.',
    search_section_genres: 'Genuri',
    search_section_countries: 'Țări',
    search_section_stations: 'Posturi',
    search_paging_hint_prefix: 'Sfat: apasă',
    search_paging_hint_or: 'sau',
    search_paging_hint_suffix: 'pentru a sări o pagină în rezultate.',
    search_esc_clear_hint_prefix: 'Apasă',
    search_esc_clear_hint_suffix:
      'pentru a șterge rezultatul evidențiat înainte de a închide căutarea.',
    search_esc_hint_clear: 'Esc pentru a șterge',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Apasă Esc pentru a șterge',
    search_esc_hint_close_title: 'Apasă Esc pentru a închide căutarea',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  bg: {
    search_page_h1: 'Търсене на радиостанции на живо',
    search_page_intro:
      'Разгледайте каталога на Mega Radio с над 60 000 радиостанции на живо от над 120 държави. Въведете име на станция, музикален жанр, език или държава, за да започнете да слушате безплатно онлайн радио веднага.',
    search_placeholder: 'Търсене на станции, жанрове, държави…',
    search_no_results:
      'Никоя станция, жанр или държава не съответства на търсенето ви.',
    search_min_chars_hint:
      'Въведете поне 2 символа, за да започнете търсенето.',
    search_section_genres: 'Жанрове',
    search_section_countries: 'Държави',
    search_section_stations: 'Станции',
    search_paging_hint_prefix: 'Съвет: натиснете',
    search_paging_hint_or: 'или',
    search_paging_hint_suffix:
      'за да преминете една страница в резултатите.',
    search_esc_clear_hint_prefix: 'Натиснете',
    search_esc_clear_hint_suffix:
      'за да изчистите осветения резултат преди да затворите търсенето.',
    search_esc_hint_clear: 'Esc за изчистване',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Натиснете Esc за изчистване',
    search_esc_hint_close_title: 'Натиснете Esc, за да затворите търсенето',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  hr: {
    search_page_h1: 'Pretraži radijske postaje uživo',
    search_page_intro:
      'Istražite katalog Mega Radija s više od 60.000 radijskih postaja uživo iz više od 120 zemalja. Upišite naziv postaje, glazbeni žanr, jezik ili zemlju i odmah započnite besplatno slušanje internetskog radija.',
    search_placeholder: 'Pretraži postaje, žanrove, zemlje…',
    search_no_results:
      'Nijedna postaja, žanr ili zemlja ne odgovara vašoj pretrazi.',
    search_min_chars_hint:
      'Upišite barem 2 znaka za početak pretraživanja.',
    search_section_genres: 'Žanrovi',
    search_section_countries: 'Zemlje',
    search_section_stations: 'Postaje',
    search_paging_hint_prefix: 'Savjet: pritisnite',
    search_paging_hint_or: 'ili',
    search_paging_hint_suffix: 'za prelazak na sljedeću stranicu rezultata.',
    search_esc_clear_hint_prefix: 'Pritisnite',
    search_esc_clear_hint_suffix:
      'za brisanje istaknutog rezultata prije zatvaranja pretrage.',
    search_esc_hint_clear: 'Esc za brisanje',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Pritisnite Esc za brisanje',
    search_esc_hint_close_title: 'Pritisnite Esc za zatvaranje pretrage',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  sr: {
    search_page_h1: 'Претражите радио станице уживо',
    search_page_intro:
      'Истражите каталог Mega Radio-а са преко 60.000 радио станица уживо из више од 120 земаља. Унесите име станице, музички жанр, језик или земљу да бисте одмах почели да слушате бесплатан онлајн радио.',
    search_placeholder: 'Претрага станица, жанрова, земаља…',
    search_no_results:
      'Ниједна станица, жанр или земља не одговара вашој претрази.',
    search_min_chars_hint:
      'Унесите бар 2 карактера да бисте започели претрагу.',
    search_section_genres: 'Жанрови',
    search_section_countries: 'Земље',
    search_section_stations: 'Станице',
    search_paging_hint_prefix: 'Савет: притисните',
    search_paging_hint_or: 'или',
    search_paging_hint_suffix: 'да бисте прескочили страницу резултата.',
    search_esc_clear_hint_prefix: 'Притисните',
    search_esc_clear_hint_suffix:
      'да бисте обрисали истакнути резултат пре затварања претраге.',
    search_esc_hint_clear: 'Esc за брисање',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Притисните Esc за брисање',
    search_esc_hint_close_title: 'Притисните Esc да затворите претрагу',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  sl: {
    search_page_h1: 'Iskanje radijskih postaj v živo',
    search_page_intro:
      'Raziščite katalog Mega Radia z več kot 60.000 radijskimi postajami v živo iz več kot 120 držav. Vnesite ime postaje, glasbeno zvrst, jezik ali državo in takoj začnite brezplačno poslušati spletni radio.',
    search_placeholder: 'Iskanje postaj, zvrsti, držav…',
    search_no_results:
      'Nobena postaja, zvrst ali država se ne ujema z vašim iskanjem.',
    search_min_chars_hint:
      'Za začetek iskanja vnesite vsaj 2 znaka.',
    search_section_genres: 'Zvrsti',
    search_section_countries: 'Države',
    search_section_stations: 'Postaje',
    search_paging_hint_prefix: 'Nasvet: pritisnite',
    search_paging_hint_or: 'ali',
    search_paging_hint_suffix: 'za pomik za stran med rezultati.',
    search_esc_clear_hint_prefix: 'Pritisnite',
    search_esc_clear_hint_suffix:
      'za brisanje označenega rezultata pred zaprtjem iskanja.',
    search_esc_hint_clear: 'Esc za brisanje',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Pritisnite Esc za brisanje',
    search_esc_hint_close_title: 'Pritisnite Esc za zaprtje iskanja',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  lv: {
    search_page_h1: 'Meklēt tiešraides radiostacijas',
    search_page_intro:
      'Pārlūkojiet Mega Radio katalogu ar vairāk nekā 60 000 tiešraides radiostaciju no vairāk nekā 120 valstīm. Ievadiet stacijas nosaukumu, mūzikas žanru, valodu vai valsti, lai uzreiz sāktu bez maksas klausīties tiešsaistes radio.',
    search_placeholder: 'Meklēt stacijas, žanrus, valstis…',
    search_no_results:
      'Jūsu meklējumam neatbilst neviena stacija, žanrs vai valsts.',
    search_min_chars_hint:
      'Ievadiet vismaz 2 rakstzīmes, lai sāktu meklēšanu.',
    search_section_genres: 'Žanri',
    search_section_countries: 'Valstis',
    search_section_stations: 'Stacijas',
    search_paging_hint_prefix: 'Padoms: nospiediet',
    search_paging_hint_or: 'vai',
    search_paging_hint_suffix: 'lai pārietu vienu lapu rezultātos.',
    search_esc_clear_hint_prefix: 'Nospiediet',
    search_esc_clear_hint_suffix:
      'lai notīrītu izcelto rezultātu pirms meklēšanas aizvēršanas.',
    search_esc_hint_clear: 'Esc, lai notīrītu',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Nospiediet Esc, lai notīrītu',
    search_esc_hint_close_title:
      'Nospiediet Esc, lai aizvērtu meklēšanu',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  lt: {
    search_page_h1: 'Ieškoti tiesioginių radijo stočių',
    search_page_intro:
      'Naršykite „Mega Radio“ katalogą su daugiau nei 60 000 tiesioginių radijo stočių iš daugiau nei 120 šalių. Įveskite stoties pavadinimą, muzikos žanrą, kalbą ar šalį ir iškart pradėkite nemokamai klausytis internetinio radijo.',
    search_placeholder: 'Ieškoti stočių, žanrų, šalių…',
    search_no_results:
      'Jūsų paieškai neatitinka jokia stotis, žanras ar šalis.',
    search_min_chars_hint:
      'Įveskite bent 2 simbolius, kad pradėtumėte paiešką.',
    search_section_genres: 'Žanrai',
    search_section_countries: 'Šalys',
    search_section_stations: 'Stotys',
    search_paging_hint_prefix: 'Patarimas: paspauskite',
    search_paging_hint_or: 'arba',
    search_paging_hint_suffix: 'kad peršoktumėte puslapį rezultatuose.',
    search_esc_clear_hint_prefix: 'Paspauskite',
    search_esc_clear_hint_suffix:
      'kad išvalytumėte pažymėtą rezultatą prieš uždarydami paiešką.',
    search_esc_hint_clear: 'Esc išvalyti',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Paspauskite Esc, kad išvalytumėte',
    search_esc_hint_close_title: 'Paspauskite Esc, kad uždarytumėte paiešką',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  et: {
    search_page_h1: 'Otsi otseülekande raadiojaamu',
    search_page_intro:
      'Sirvi Mega Radio kataloogi, mis sisaldab üle 60 000 otseülekande raadiojaama enam kui 120 riigist. Sisesta jaama nimi, muusikastiil, keel või riik ja alusta kohe tasuta veebiraadio kuulamist.',
    search_placeholder: 'Otsi jaamu, žanre, riike…',
    search_no_results:
      'Ükski jaam, žanr ega riik ei vasta sinu otsingule.',
    search_min_chars_hint:
      'Sisesta vähemalt 2 tähemärki, et otsingut alustada.',
    search_section_genres: 'Žanrid',
    search_section_countries: 'Riigid',
    search_section_stations: 'Jaamad',
    search_paging_hint_prefix: 'Vihje: vajuta',
    search_paging_hint_or: 'või',
    search_paging_hint_suffix: 'et liikuda tulemustes lehekülg edasi.',
    search_esc_clear_hint_prefix: 'Vajuta',
    search_esc_clear_hint_suffix:
      'et kustutada esiletõstetud tulemus enne otsingu sulgemist.',
    search_esc_hint_clear: 'Esc tühjendamiseks',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Vajuta Esc tühjendamiseks',
    search_esc_hint_close_title: 'Vajuta Esc otsingu sulgemiseks',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  zh: {
    search_page_h1: '搜索在线广播电台',
    search_page_intro:
      '在 Mega Radio 的目录中搜索来自 120 多个国家/地区的 60,000 多个在线广播电台。输入电台名称、音乐流派、语言或国家/地区,即可立即开始免费在线收听广播。',
    search_placeholder: '搜索电台、流派、国家/地区…',
    search_no_results: '没有匹配您搜索的电台、流派或国家/地区。',
    search_min_chars_hint: '请至少输入 2 个字符开始搜索。',
    search_section_genres: '流派',
    search_section_countries: '国家/地区',
    search_section_stations: '电台',
    search_paging_hint_prefix: '提示:按',
    search_paging_hint_or: '或',
    search_paging_hint_suffix: '可在结果中翻页。',
    search_esc_clear_hint_prefix: '按',
    search_esc_clear_hint_suffix: '可在关闭搜索前清除高亮显示的结果。',
    search_esc_hint_clear: '按 Esc 清除',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: '按 Esc 清除',
    search_esc_hint_close_title: '按 Esc 关闭搜索',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  ja: {
    search_page_h1: 'ライブラジオ局を検索',
    search_page_intro:
      'Mega Radio の 120 以上の国の 60,000 以上のライブラジオ局のカタログを検索しましょう。局名、音楽ジャンル、言語、国を入力すれば、すぐに無料でオンラインラジオを聴き始められます。',
    search_placeholder: '局、ジャンル、国を検索…',
    search_no_results: '検索に一致する局、ジャンル、国はありません。',
    search_min_chars_hint: '検索を開始するには 2 文字以上入力してください。',
    search_section_genres: 'ジャンル',
    search_section_countries: '国',
    search_section_stations: '局',
    search_paging_hint_prefix: 'ヒント:',
    search_paging_hint_or: 'または',
    search_paging_hint_suffix: 'を押すと結果を 1 ページ送れます。',
    search_esc_clear_hint_prefix: '次のキーを押してください:',
    search_esc_clear_hint_suffix:
      'を押すと、検索を閉じる前に強調表示された結果をクリアできます。',
    search_esc_hint_clear: 'Esc でクリア',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Esc を押してクリア',
    search_esc_hint_close_title: 'Esc を押して検索を閉じる',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  ko: {
    search_page_h1: '라이브 라디오 방송국 검색',
    search_page_intro:
      'Mega Radio의 120여 개국 60,000여 개 라이브 라디오 방송국 카탈로그를 검색하세요. 방송국 이름, 음악 장르, 언어 또는 국가를 입력하면 즉시 무료 온라인 라디오를 청취할 수 있습니다.',
    search_placeholder: '방송국, 장르, 국가 검색…',
    search_no_results: '검색과 일치하는 방송국, 장르 또는 국가가 없습니다.',
    search_min_chars_hint: '검색을 시작하려면 2자 이상 입력하세요.',
    search_section_genres: '장르',
    search_section_countries: '국가',
    search_section_stations: '방송국',
    search_paging_hint_prefix: '팁:',
    search_paging_hint_or: '또는',
    search_paging_hint_suffix: '키를 누르면 결과를 한 페이지씩 이동합니다.',
    search_esc_clear_hint_prefix: '다음 키를 누르세요:',
    search_esc_clear_hint_suffix:
      '키를 누르면 검색을 닫기 전에 강조 표시된 결과를 지웁니다.',
    search_esc_hint_clear: 'Esc로 지우기',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Esc를 눌러 지우기',
    search_esc_hint_close_title: 'Esc를 눌러 검색 닫기',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  hi: {
    search_page_h1: 'लाइव रेडियो स्टेशन खोजें',
    search_page_intro:
      'Mega Radio की कैटलॉग में 120+ देशों के 60,000+ लाइव रेडियो स्टेशन खोजें। स्टेशन का नाम, संगीत शैली, भाषा या देश टाइप करें और तुरंत मुफ्त ऑनलाइन रेडियो सुनना शुरू करें।',
    search_placeholder: 'स्टेशन, शैलियाँ, देश खोजें…',
    search_no_results:
      'आपकी खोज से मेल खाता कोई स्टेशन, शैली या देश नहीं मिला।',
    search_min_chars_hint:
      'खोज शुरू करने के लिए कम से कम 2 अक्षर टाइप करें।',
    search_section_genres: 'शैलियाँ',
    search_section_countries: 'देश',
    search_section_stations: 'स्टेशन',
    search_paging_hint_prefix: 'सुझाव: दबाएँ',
    search_paging_hint_or: 'या',
    search_paging_hint_suffix: 'परिणामों में एक पृष्ठ आगे जाने के लिए।',
    search_esc_clear_hint_prefix: 'दबाएँ',
    search_esc_clear_hint_suffix:
      'खोज बंद करने से पहले हाइलाइट किया गया परिणाम साफ़ करने के लिए।',
    search_esc_hint_clear: 'साफ़ करने के लिए Esc',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'साफ़ करने के लिए Esc दबाएँ',
    search_esc_hint_close_title: 'खोज बंद करने के लिए Esc दबाएँ',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  th: {
    search_page_h1: 'ค้นหาสถานีวิทยุสด',
    search_page_intro:
      'ค้นหาในแคตตาล็อกของ Mega Radio ที่มีสถานีวิทยุสดมากกว่า 60,000 สถานีจากกว่า 120 ประเทศ พิมพ์ชื่อสถานี แนวเพลง ภาษา หรือประเทศ เพื่อเริ่มฟังวิทยุออนไลน์ฟรีทันที',
    search_placeholder: 'ค้นหาสถานี แนว ประเทศ…',
    search_no_results:
      'ไม่มีสถานี แนวเพลง หรือประเทศใดที่ตรงกับการค้นหาของคุณ',
    search_min_chars_hint: 'พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อเริ่มค้นหา',
    search_section_genres: 'แนวเพลง',
    search_section_countries: 'ประเทศ',
    search_section_stations: 'สถานี',
    search_paging_hint_prefix: 'เคล็ดลับ: กด',
    search_paging_hint_or: 'หรือ',
    search_paging_hint_suffix: 'เพื่อข้ามหน้าในผลลัพธ์',
    search_esc_clear_hint_prefix: 'กด',
    search_esc_clear_hint_suffix:
      'เพื่อล้างผลลัพธ์ที่ไฮไลต์ก่อนปิดการค้นหา',
    search_esc_hint_clear: 'Esc เพื่อล้าง',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'กด Esc เพื่อล้าง',
    search_esc_hint_close_title: 'กด Esc เพื่อปิดการค้นหา',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  vi: {
    search_page_h1: 'Tìm kiếm đài radio trực tiếp',
    search_page_intro:
      'Khám phá danh mục của Mega Radio với hơn 60.000 đài radio trực tiếp từ hơn 120 quốc gia. Nhập tên đài, thể loại nhạc, ngôn ngữ hoặc quốc gia để bắt đầu nghe radio trực tuyến miễn phí ngay lập tức.',
    search_placeholder: 'Tìm đài, thể loại, quốc gia…',
    search_no_results:
      'Không có đài, thể loại hoặc quốc gia nào khớp với tìm kiếm của bạn.',
    search_min_chars_hint:
      'Nhập ít nhất 2 ký tự để bắt đầu tìm kiếm.',
    search_section_genres: 'Thể loại',
    search_section_countries: 'Quốc gia',
    search_section_stations: 'Đài',
    search_paging_hint_prefix: 'Mẹo: nhấn',
    search_paging_hint_or: 'hoặc',
    search_paging_hint_suffix: 'để chuyển một trang trong kết quả.',
    search_esc_clear_hint_prefix: 'Nhấn',
    search_esc_clear_hint_suffix:
      'để xóa kết quả được chọn trước khi đóng tìm kiếm.',
    search_esc_hint_clear: 'Esc để xóa',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Nhấn Esc để xóa',
    search_esc_hint_close_title: 'Nhấn Esc để đóng tìm kiếm',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  id: {
    search_page_h1: 'Cari stasiun radio langsung',
    search_page_intro:
      'Telusuri katalog Mega Radio dengan lebih dari 60.000 stasiun radio langsung dari lebih dari 120 negara. Ketik nama stasiun, genre musik, bahasa, atau negara untuk langsung mendengarkan radio online gratis.',
    search_placeholder: 'Cari stasiun, genre, negara…',
    search_no_results:
      'Tidak ada stasiun, genre, atau negara yang cocok dengan pencarian Anda.',
    search_min_chars_hint:
      'Ketik minimal 2 karakter untuk mulai mencari.',
    search_section_genres: 'Genre',
    search_section_countries: 'Negara',
    search_section_stations: 'Stasiun',
    search_paging_hint_prefix: 'Tips: tekan',
    search_paging_hint_or: 'atau',
    search_paging_hint_suffix: 'untuk melompat satu halaman di hasil.',
    search_esc_clear_hint_prefix: 'Tekan',
    search_esc_clear_hint_suffix:
      'untuk menghapus hasil yang disorot sebelum menutup pencarian.',
    search_esc_hint_clear: 'Esc untuk menghapus',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Tekan Esc untuk menghapus',
    search_esc_hint_close_title: 'Tekan Esc untuk menutup pencarian',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  ms: {
    search_page_h1: 'Cari stesen radio langsung',
    search_page_intro:
      'Terokai katalog Mega Radio dengan lebih daripada 60,000 stesen radio langsung dari lebih daripada 120 negara. Taipkan nama stesen, genre muzik, bahasa atau negara untuk mula mendengar radio dalam talian secara percuma serta-merta.',
    search_placeholder: 'Cari stesen, genre, negara…',
    search_no_results:
      'Tiada stesen, genre atau negara yang sepadan dengan carian anda.',
    search_min_chars_hint:
      'Taipkan sekurang-kurangnya 2 aksara untuk memulakan carian.',
    search_section_genres: 'Genre',
    search_section_countries: 'Negara',
    search_section_stations: 'Stesen',
    search_paging_hint_prefix: 'Petua: tekan',
    search_paging_hint_or: 'atau',
    search_paging_hint_suffix: 'untuk lompat satu halaman dalam hasil.',
    search_esc_clear_hint_prefix: 'Tekan',
    search_esc_clear_hint_suffix:
      'untuk mengosongkan hasil yang diserlahkan sebelum menutup carian.',
    search_esc_hint_clear: 'Esc untuk kosongkan',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Tekan Esc untuk kosongkan',
    search_esc_hint_close_title: 'Tekan Esc untuk menutup carian',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  tl: {
    search_page_h1: 'Maghanap ng live na radio station',
    search_page_intro:
      'I-explore ang katalogo ng Mega Radio na may higit sa 60,000 live na radio station mula sa mahigit 120 bansa. I-type ang pangalan ng station, genre ng musika, wika o bansa upang makinig agad sa libreng online radio.',
    search_placeholder: 'Maghanap ng station, genre, bansa…',
    search_no_results:
      'Walang station, genre o bansa na tumutugma sa iyong paghahanap.',
    search_min_chars_hint:
      'Mag-type ng kahit 2 karakter upang magsimulang maghanap.',
    search_section_genres: 'Mga genre',
    search_section_countries: 'Mga bansa',
    search_section_stations: 'Mga station',
    search_paging_hint_prefix: 'Tip: pindutin ang',
    search_paging_hint_or: 'o',
    search_paging_hint_suffix:
      'upang lumaktaw ng isang pahina sa mga resulta.',
    search_esc_clear_hint_prefix: 'Pindutin ang',
    search_esc_clear_hint_suffix:
      'upang tanggalin ang naka-highlight na resulta bago isara ang paghahanap.',
    search_esc_hint_clear: 'Esc upang i-clear',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Pindutin ang Esc upang i-clear',
    search_esc_hint_close_title: 'Pindutin ang Esc upang isara ang paghahanap',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  he: {
    search_page_h1: 'חיפוש תחנות רדיו בשידור חי',
    search_page_intro:
      'חפשו בקטלוג של Mega Radio עם יותר מ-60,000 תחנות רדיו בשידור חי מיותר מ-120 מדינות. הקלידו שם תחנה, ז\'אנר מוזיקלי, שפה או מדינה כדי להתחיל מיד להאזין לרדיו אונליין בחינם.',
    search_placeholder: 'חיפוש תחנות, ז\'אנרים, מדינות…',
    search_no_results:
      'אין תחנות, ז\'אנרים או מדינות שתואמים את החיפוש שלך.',
    search_min_chars_hint:
      'הקלד לפחות 2 תווים כדי להתחיל בחיפוש.',
    search_section_genres: 'ז\'אנרים',
    search_section_countries: 'מדינות',
    search_section_stations: 'תחנות',
    search_paging_hint_prefix: 'טיפ: לחץ',
    search_paging_hint_or: 'או',
    search_paging_hint_suffix: 'כדי לדפדף דף בתוצאות.',
    search_esc_clear_hint_prefix: 'לחץ',
    search_esc_clear_hint_suffix:
      'כדי למחוק את התוצאה המודגשת לפני סגירת החיפוש.',
    search_esc_hint_clear: 'Esc לניקוי',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'לחץ Esc לניקוי',
    search_esc_hint_close_title: 'לחץ Esc לסגירת החיפוש',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  fa: {
    search_page_h1: 'جستجوی ایستگاه‌های رادیویی زنده',
    search_page_intro:
      'در فهرست Mega Radio با بیش از ۶۰٬۰۰۰ ایستگاه رادیویی زنده از بیش از ۱۲۰ کشور جستجو کنید. نام ایستگاه، سبک موسیقی، زبان یا کشور را تایپ کنید تا فوراً به‌صورت رایگان رادیوی آنلاین گوش دهید.',
    search_placeholder: 'جستجوی ایستگاه‌ها، سبک‌ها، کشورها…',
    search_no_results:
      'هیچ ایستگاه، سبک یا کشوری با جستجوی شما مطابقت ندارد.',
    search_min_chars_hint:
      'برای شروع جستجو حداقل ۲ کاراکتر وارد کنید.',
    search_section_genres: 'سبک‌ها',
    search_section_countries: 'کشورها',
    search_section_stations: 'ایستگاه‌ها',
    search_paging_hint_prefix: 'نکته: فشار دهید',
    search_paging_hint_or: 'یا',
    search_paging_hint_suffix: 'تا یک صفحه در نتایج جابه‌جا شوید.',
    search_esc_clear_hint_prefix: 'فشار دهید',
    search_esc_clear_hint_suffix:
      'تا نتیجه‌ی برجسته‌شده پیش از بستن جستجو پاک شود.',
    search_esc_hint_clear: 'Esc برای پاک‌سازی',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'برای پاک‌سازی Esc را فشار دهید',
    search_esc_hint_close_title: 'برای بستن جستجو Esc را فشار دهید',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  ur: {
    search_page_h1: 'لائیو ریڈیو اسٹیشنز تلاش کریں',
    search_page_intro:
      'Mega Radio کے کیٹلاگ میں 120 سے زائد ممالک کے 60,000+ لائیو ریڈیو اسٹیشنز تلاش کریں۔ اسٹیشن کا نام، موسیقی کی صنف، زبان یا ملک لکھیں اور فوراً مفت آن لائن ریڈیو سننا شروع کریں۔',
    search_placeholder: 'اسٹیشنز، اصناف، ممالک تلاش کریں…',
    search_no_results:
      'آپ کی تلاش سے کوئی اسٹیشن، صنف یا ملک میل نہیں کھاتا۔',
    search_min_chars_hint:
      'تلاش شروع کرنے کے لیے کم از کم 2 حروف لکھیں۔',
    search_section_genres: 'اصناف',
    search_section_countries: 'ممالک',
    search_section_stations: 'اسٹیشنز',
    search_paging_hint_prefix: 'مشورہ: دبائیں',
    search_paging_hint_or: 'یا',
    search_paging_hint_suffix: 'نتائج میں ایک صفحہ آگے جانے کے لیے۔',
    search_esc_clear_hint_prefix: 'دبائیں',
    search_esc_clear_hint_suffix:
      'تلاش بند کرنے سے پہلے نمایاں نتیجہ صاف کرنے کے لیے۔',
    search_esc_hint_clear: 'صاف کرنے کے لیے Esc',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'صاف کرنے کے لیے Esc دبائیں',
    search_esc_hint_close_title: 'تلاش بند کرنے کے لیے Esc دبائیں',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  bn: {
    search_page_h1: 'লাইভ রেডিও স্টেশন খুঁজুন',
    search_page_intro:
      'Mega Radio-এর ১২০+ দেশের ৬০,০০০+ লাইভ রেডিও স্টেশনের ক্যাটালগে খুঁজুন। স্টেশনের নাম, সঙ্গীতের ধরন, ভাষা বা দেশ লিখুন এবং সঙ্গে সঙ্গে বিনামূল্যে অনলাইন রেডিও শুনতে শুরু করুন।',
    search_placeholder: 'স্টেশন, ধরন, দেশ খুঁজুন…',
    search_no_results:
      'আপনার অনুসন্ধানের সাথে কোনো স্টেশন, ধরন বা দেশ মেলেনি।',
    search_min_chars_hint:
      'অনুসন্ধান শুরু করতে কমপক্ষে ২টি অক্ষর লিখুন।',
    search_section_genres: 'ধরন',
    search_section_countries: 'দেশ',
    search_section_stations: 'স্টেশন',
    search_paging_hint_prefix: 'টিপ: চাপুন',
    search_paging_hint_or: 'অথবা',
    search_paging_hint_suffix: 'ফলাফলে এক পৃষ্ঠা এগোতে।',
    search_esc_clear_hint_prefix: 'চাপুন',
    search_esc_clear_hint_suffix:
      'অনুসন্ধান বন্ধ করার আগে হাইলাইট করা ফলাফল সাফ করতে।',
    search_esc_hint_clear: 'মুছতে Esc',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'মুছতে Esc চাপুন',
    search_esc_hint_close_title: 'অনুসন্ধান বন্ধ করতে Esc চাপুন',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  ta: {
    search_page_h1: 'நேரடி வானொலி நிலையங்களைத் தேடு',
    search_page_intro:
      'Mega Radio-வின் 120+ நாடுகளைச் சேர்ந்த 60,000+ நேரடி வானொலி நிலையங்களின் பட்டியலில் தேடுங்கள். நிலையப் பெயர், இசை வகை, மொழி அல்லது நாட்டை உள்ளிட்டு உடனடியாக இலவச ஆன்லைன் வானொலியைக் கேட்கத் தொடங்குங்கள்.',
    search_placeholder: 'நிலையங்கள், வகைகள், நாடுகளைத் தேடு…',
    search_no_results:
      'உங்கள் தேடலுக்கு எந்த நிலையமும், வகையும் அல்லது நாடும் பொருந்தவில்லை.',
    search_min_chars_hint:
      'தேடலைத் தொடங்க குறைந்தது 2 எழுத்துகளை உள்ளிடுங்கள்.',
    search_section_genres: 'வகைகள்',
    search_section_countries: 'நாடுகள்',
    search_section_stations: 'நிலையங்கள்',
    search_paging_hint_prefix: 'குறிப்பு: அழுத்து',
    search_paging_hint_or: 'அல்லது',
    search_paging_hint_suffix: 'முடிவுகளில் ஒரு பக்கத்தைத் தாண்ட.',
    search_esc_clear_hint_prefix: 'அழுத்து',
    search_esc_clear_hint_suffix:
      'தேடலை மூடுவதற்கு முன் முன்னிலைப்படுத்தப்பட்ட முடிவை அழிக்க.',
    search_esc_hint_clear: 'அழிக்க Esc',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'அழிக்க Esc-ஐ அழுத்து',
    search_esc_hint_close_title: 'தேடலை மூட Esc-ஐ அழுத்து',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  te: {
    search_page_h1: 'ప్రత్యక్ష రేడియో స్టేషన్లను శోధించండి',
    search_page_intro:
      'Mega Radio యొక్క 120+ దేశాల నుండి 60,000+ ప్రత్యక్ష రేడియో స్టేషన్ల కేటలాగ్‌లో శోధించండి. స్టేషన్ పేరు, సంగీత శైలి, భాష లేదా దేశాన్ని టైప్ చేయండి మరియు వెంటనే ఉచిత ఆన్‌లైన్ రేడియో వినడం ప్రారంభించండి.',
    search_placeholder: 'స్టేషన్లు, శైలులు, దేశాలను శోధించండి…',
    search_no_results:
      'మీ శోధనకు ఏ స్టేషన్, శైలి లేదా దేశం సరిపోలడం లేదు.',
    search_min_chars_hint:
      'శోధనను ప్రారంభించడానికి కనీసం 2 అక్షరాలు టైప్ చేయండి.',
    search_section_genres: 'శైలులు',
    search_section_countries: 'దేశాలు',
    search_section_stations: 'స్టేషన్లు',
    search_paging_hint_prefix: 'చిట్కా: నొక్కండి',
    search_paging_hint_or: 'లేదా',
    search_paging_hint_suffix: 'ఫలితాలలో ఒక పేజీ ముందుకి దాటడానికి.',
    search_esc_clear_hint_prefix: 'నొక్కండి',
    search_esc_clear_hint_suffix:
      'శోధనను మూసివేసే ముందు హైలైట్ చేసిన ఫలితాన్ని తొలగించడానికి.',
    search_esc_hint_clear: 'తొలగించడానికి Esc',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'తొలగించడానికి Esc నొక్కండి',
    search_esc_hint_close_title: 'శోధనను మూసివేయడానికి Esc నొక్కండి',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  mr: {
    search_page_h1: 'थेट रेडिओ स्टेशन शोधा',
    search_page_intro:
      'Mega Radio च्या 120+ देशांमधील 60,000+ थेट रेडिओ स्टेशनांच्या कॅटलॉगमध्ये शोधा. स्टेशनचे नाव, संगीत प्रकार, भाषा किंवा देश टाइप करा आणि लगेच विनामूल्य ऑनलाइन रेडिओ ऐकायला सुरुवात करा.',
    search_placeholder: 'स्टेशन, प्रकार, देश शोधा…',
    search_no_results:
      'तुमच्या शोधाशी जुळणारे कोणतेही स्टेशन, प्रकार किंवा देश नाही.',
    search_min_chars_hint:
      'शोध सुरू करण्यासाठी किमान 2 अक्षरे टाइप करा.',
    search_section_genres: 'प्रकार',
    search_section_countries: 'देश',
    search_section_stations: 'स्टेशन',
    search_paging_hint_prefix: 'टीप: दाबा',
    search_paging_hint_or: 'किंवा',
    search_paging_hint_suffix: 'निकालांमध्ये एक पृष्ठ पुढे जाण्यासाठी.',
    search_esc_clear_hint_prefix: 'दाबा',
    search_esc_clear_hint_suffix:
      'शोध बंद करण्यापूर्वी हायलाइट केलेला निकाल साफ करण्यासाठी.',
    search_esc_hint_clear: 'साफ करण्यासाठी Esc',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'साफ करण्यासाठी Esc दाबा',
    search_esc_hint_close_title: 'शोध बंद करण्यासाठी Esc दाबा',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  gu: {
    search_page_h1: 'જીવંત રેડિયો સ્ટેશનો શોધો',
    search_page_intro:
      'Mega Radio ની 120+ દેશોમાંથી 60,000+ જીવંત રેડિયો સ્ટેશનોની કેટલોગમાં શોધો. સ્ટેશનનું નામ, સંગીત શૈલી, ભાષા અથવા દેશ લખો અને તરત જ મફત ઓનલાઇન રેડિયો સાંભળવાનું શરૂ કરો.',
    search_placeholder: 'સ્ટેશનો, શૈલીઓ, દેશો શોધો…',
    search_no_results:
      'તમારી શોધ સાથે મેળ ખાતું કોઈ સ્ટેશન, શૈલી અથવા દેશ નથી.',
    search_min_chars_hint:
      'શોધ શરૂ કરવા માટે ઓછામાં ઓછા 2 અક્ષરો લખો.',
    search_section_genres: 'શૈલીઓ',
    search_section_countries: 'દેશો',
    search_section_stations: 'સ્ટેશનો',
    search_paging_hint_prefix: 'ટિપ: દબાવો',
    search_paging_hint_or: 'અથવા',
    search_paging_hint_suffix: 'પરિણામોમાં એક પૃષ્ઠ આગળ જવા માટે.',
    search_esc_clear_hint_prefix: 'દબાવો',
    search_esc_clear_hint_suffix:
      'શોધ બંધ કરતા પહેલા હાઇલાઇટ થયેલ પરિણામ સાફ કરવા માટે.',
    search_esc_hint_clear: 'સાફ કરવા માટે Esc',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'સાફ કરવા માટે Esc દબાવો',
    search_esc_hint_close_title: 'શોધ બંધ કરવા માટે Esc દબાવો',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  kn: {
    search_page_h1: 'ನೇರಪ್ರಸಾರ ರೇಡಿಯೋ ಕೇಂದ್ರಗಳನ್ನು ಹುಡುಕಿ',
    search_page_intro:
      'Mega Radio ನ 120+ ದೇಶಗಳ 60,000+ ನೇರಪ್ರಸಾರ ರೇಡಿಯೋ ಕೇಂದ್ರಗಳ ಪಟ್ಟಿಯಲ್ಲಿ ಹುಡುಕಿ. ಕೇಂದ್ರದ ಹೆಸರು, ಸಂಗೀತ ಪ್ರಕಾರ, ಭಾಷೆ ಅಥವಾ ದೇಶವನ್ನು ಟೈಪ್ ಮಾಡಿ ಮತ್ತು ತಕ್ಷಣ ಉಚಿತ ಆನ್‌ಲೈನ್ ರೇಡಿಯೋ ಕೇಳಲು ಆರಂಭಿಸಿ.',
    search_placeholder: 'ಕೇಂದ್ರಗಳು, ಪ್ರಕಾರಗಳು, ದೇಶಗಳನ್ನು ಹುಡುಕಿ…',
    search_no_results:
      'ನಿಮ್ಮ ಹುಡುಕಾಟಕ್ಕೆ ಯಾವುದೇ ಕೇಂದ್ರ, ಪ್ರಕಾರ ಅಥವಾ ದೇಶ ಹೊಂದಿಕೆಯಾಗುವುದಿಲ್ಲ.',
    search_min_chars_hint:
      'ಹುಡುಕಾಟ ಆರಂಭಿಸಲು ಕನಿಷ್ಠ 2 ಅಕ್ಷರಗಳನ್ನು ಟೈಪ್ ಮಾಡಿ.',
    search_section_genres: 'ಪ್ರಕಾರಗಳು',
    search_section_countries: 'ದೇಶಗಳು',
    search_section_stations: 'ಕೇಂದ್ರಗಳು',
    search_paging_hint_prefix: 'ಸಲಹೆ: ಒತ್ತಿರಿ',
    search_paging_hint_or: 'ಅಥವಾ',
    search_paging_hint_suffix:
      'ಫಲಿತಾಂಶಗಳಲ್ಲಿ ಒಂದು ಪುಟ ಮುಂದೆ ಹೋಗಲು.',
    search_esc_clear_hint_prefix: 'ಒತ್ತಿರಿ',
    search_esc_clear_hint_suffix:
      'ಹುಡುಕಾಟವನ್ನು ಮುಚ್ಚುವ ಮೊದಲು ಹೈಲೈಟ್ ಮಾಡಿದ ಫಲಿತಾಂಶವನ್ನು ತೆರವುಗೊಳಿಸಲು.',
    search_esc_hint_clear: 'ತೆರವುಗೊಳಿಸಲು Esc',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'ತೆರವುಗೊಳಿಸಲು Esc ಒತ್ತಿರಿ',
    search_esc_hint_close_title: 'ಹುಡುಕಾಟ ಮುಚ್ಚಲು Esc ಒತ್ತಿರಿ',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  ml: {
    search_page_h1: 'തത്സമയ റേഡിയോ സ്റ്റേഷനുകൾ തിരയുക',
    search_page_intro:
      'Mega Radio യുടെ 120+ രാജ്യങ്ങളിലെ 60,000+ തത്സമയ റേഡിയോ സ്റ്റേഷനുകളുടെ കാറ്റലോഗിൽ തിരയുക. സ്റ്റേഷന്റെ പേര്, സംഗീത ശൈലി, ഭാഷ അല്ലെങ്കിൽ രാജ്യം ടൈപ്പ് ചെയ്ത് ഉടനെ സൗജന്യ ഓൺലൈൻ റേഡിയോ കേൾക്കാൻ തുടങ്ങുക.',
    search_placeholder: 'സ്റ്റേഷനുകൾ, ശൈലികൾ, രാജ്യങ്ങൾ തിരയുക…',
    search_no_results:
      'നിങ്ങളുടെ തിരയലുമായി ഒത്തുപോകുന്ന ഒരു സ്റ്റേഷനോ ശൈലിയോ രാജ്യമോ ഇല്ല.',
    search_min_chars_hint:
      'തിരയൽ തുടങ്ങാൻ കുറഞ്ഞത് 2 പ്രതീകങ്ങൾ ടൈപ്പ് ചെയ്യുക.',
    search_section_genres: 'ശൈലികൾ',
    search_section_countries: 'രാജ്യങ്ങൾ',
    search_section_stations: 'സ്റ്റേഷനുകൾ',
    search_paging_hint_prefix: 'നുറുങ്ങ്: അമർത്തുക',
    search_paging_hint_or: 'അല്ലെങ്കിൽ',
    search_paging_hint_suffix:
      'ഫലങ്ങളിൽ ഒരു പേജ് മുന്നോട്ട് നീങ്ങാൻ.',
    search_esc_clear_hint_prefix: 'അമർത്തുക',
    search_esc_clear_hint_suffix:
      'തിരയൽ അടയ്ക്കുന്നതിന് മുമ്പ് ഹൈലൈറ്റ് ചെയ്ത ഫലം മായ്ക്കാൻ.',
    search_esc_hint_clear: 'മായ്ക്കാൻ Esc',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'മായ്ക്കാൻ Esc അമർത്തുക',
    search_esc_hint_close_title: 'തിരയൽ അടയ്ക്കാൻ Esc അമർത്തുക',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  pa: {
    search_page_h1: 'ਲਾਈਵ ਰੇਡੀਓ ਸਟੇਸ਼ਨ ਖੋਜੋ',
    search_page_intro:
      'Mega Radio ਦੇ 120+ ਦੇਸ਼ਾਂ ਦੇ 60,000+ ਲਾਈਵ ਰੇਡੀਓ ਸਟੇਸ਼ਨਾਂ ਦੀ ਸੂਚੀ ਵਿੱਚ ਖੋਜੋ। ਸਟੇਸ਼ਨ ਦਾ ਨਾਮ, ਸੰਗੀਤ ਸ਼ੈਲੀ, ਭਾਸ਼ਾ ਜਾਂ ਦੇਸ਼ ਟਾਈਪ ਕਰੋ ਅਤੇ ਤੁਰੰਤ ਮੁਫ਼ਤ ਆਨਲਾਈਨ ਰੇਡੀਓ ਸੁਣਨਾ ਸ਼ੁਰੂ ਕਰੋ।',
    search_placeholder: 'ਸਟੇਸ਼ਨ, ਸ਼ੈਲੀਆਂ, ਦੇਸ਼ ਖੋਜੋ…',
    search_no_results:
      'ਤੁਹਾਡੀ ਖੋਜ ਨਾਲ ਮੇਲ ਖਾਂਦਾ ਕੋਈ ਸਟੇਸ਼ਨ, ਸ਼ੈਲੀ ਜਾਂ ਦੇਸ਼ ਨਹੀਂ ਹੈ।',
    search_min_chars_hint:
      'ਖੋਜ ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਘੱਟੋ-ਘੱਟ 2 ਅੱਖਰ ਟਾਈਪ ਕਰੋ।',
    search_section_genres: 'ਸ਼ੈਲੀਆਂ',
    search_section_countries: 'ਦੇਸ਼',
    search_section_stations: 'ਸਟੇਸ਼ਨ',
    search_paging_hint_prefix: 'ਸੁਝਾਅ: ਦਬਾਓ',
    search_paging_hint_or: 'ਜਾਂ',
    search_paging_hint_suffix: 'ਨਤੀਜਿਆਂ ਵਿੱਚ ਇੱਕ ਪੰਨਾ ਅੱਗੇ ਜਾਣ ਲਈ।',
    search_esc_clear_hint_prefix: 'ਦਬਾਓ',
    search_esc_clear_hint_suffix:
      'ਖੋਜ ਬੰਦ ਕਰਨ ਤੋਂ ਪਹਿਲਾਂ ਉਜਾਗਰ ਕੀਤੇ ਨਤੀਜੇ ਨੂੰ ਸਾਫ਼ ਕਰਨ ਲਈ।',
    search_esc_hint_clear: 'ਸਾਫ਼ ਕਰਨ ਲਈ Esc',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'ਸਾਫ਼ ਕਰਨ ਲਈ Esc ਦਬਾਓ',
    search_esc_hint_close_title: 'ਖੋਜ ਬੰਦ ਕਰਨ ਲਈ Esc ਦਬਾਓ',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  sw: {
    search_page_h1: 'Tafuta vituo vya redio vya moja kwa moja',
    search_page_intro:
      'Vinjari katalogi ya Mega Radio yenye zaidi ya vituo 60,000 vya redio vya moja kwa moja kutoka zaidi ya nchi 120. Andika jina la kituo, aina ya muziki, lugha au nchi ili kuanza kusikiliza redio mtandaoni bure papo hapo.',
    search_placeholder: 'Tafuta vituo, aina, nchi…',
    search_no_results:
      'Hakuna kituo, aina au nchi inayolingana na utafutaji wako.',
    search_min_chars_hint:
      'Andika angalau herufi 2 ili kuanza kutafuta.',
    search_section_genres: 'Aina',
    search_section_countries: 'Nchi',
    search_section_stations: 'Vituo',
    search_paging_hint_prefix: 'Kidokezo: bonyeza',
    search_paging_hint_or: 'au',
    search_paging_hint_suffix: 'kuruka ukurasa katika matokeo.',
    search_esc_clear_hint_prefix: 'Bonyeza',
    search_esc_clear_hint_suffix:
      'kufuta tokeo lililoangaziwa kabla ya kufunga utafutaji.',
    search_esc_hint_clear: 'Esc kufuta',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Bonyeza Esc kufuta',
    search_esc_hint_close_title: 'Bonyeza Esc kufunga utafutaji',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  am: {
    search_page_h1: 'ቀጥታ የሬዲዮ ጣቢያዎችን ይፈልጉ',
    search_page_intro:
      'ከ120+ ሀገራት 60,000+ ቀጥታ የሬዲዮ ጣቢያዎች ያለበትን የMega Radio ካታሎግ ይፈልጉ። የጣቢያ ስም፣ የሙዚቃ ዓይነት፣ ቋንቋ ወይም ሀገር ይተይቡ እና ወዲያውኑ ነፃ የመስመር ላይ ሬዲዮ መስማት ይጀምሩ።',
    search_placeholder: 'ጣቢያዎችን፣ ዓይነቶችን፣ ሀገራትን ይፈልጉ…',
    search_no_results:
      'ከፍለጋዎ ጋር የሚዛመድ ምንም ጣቢያ፣ ዓይነት ወይም ሀገር የለም።',
    search_min_chars_hint:
      'ፍለጋ ለመጀመር ቢያንስ 2 ቁምፊዎችን ይተይቡ።',
    search_section_genres: 'ዓይነቶች',
    search_section_countries: 'ሀገራት',
    search_section_stations: 'ጣቢያዎች',
    search_paging_hint_prefix: 'ምክር: ይጫኑ',
    search_paging_hint_or: 'ወይም',
    search_paging_hint_suffix:
      'በውጤቶች ውስጥ አንድ ገጽ ለመዝለል።',
    search_esc_clear_hint_prefix: 'ይጫኑ',
    search_esc_clear_hint_suffix:
      'ፍለጋን ከመዝጋት በፊት የጎላውን ውጤት ለማጥራት።',
    search_esc_hint_clear: 'ለማጥራት Esc',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'ለማጥራት Esc ይጫኑ',
    search_esc_hint_close_title: 'ፍለጋን ለመዝጋት Esc ይጫኑ',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  zu: {
    search_page_h1: 'Sesha iziteshi zomsakazo bukhoma',
    search_page_intro:
      'Hlola ikhathalogi ye-Mega Radio enama-60,000+ eziteshi zomsakazo bukhoma ezivela emazweni angama-120+. Thayipha igama lesiteshi, uhlobo lomculo, ulimi noma izwe ukuze uqale ngokushesha ukulalela umsakazo we-inthanethi mahhala.',
    search_placeholder: 'Sesha iziteshi, izinhlobo, amazwe…',
    search_no_results:
      'Asikho isiteshi, uhlobo noma izwe okufana nokusesha kwakho.',
    search_min_chars_hint:
      'Thayipha okungenani izinhlamvu ezi-2 ukuze uqale ukusesha.',
    search_section_genres: 'Izinhlobo',
    search_section_countries: 'Amazwe',
    search_section_stations: 'Iziteshi',
    search_paging_hint_prefix: 'Ithiphu: cindezela',
    search_paging_hint_or: 'noma',
    search_paging_hint_suffix:
      'ukuze ugxume ikhasi emiphumeleni.',
    search_esc_clear_hint_prefix: 'Cindezela',
    search_esc_clear_hint_suffix:
      'ukuze ususe umphumela ogqanyisiwe ngaphambi kokuvala usesho.',
    search_esc_hint_clear: 'Esc ukuze usule',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Cindezela u-Esc ukuze usule',
    search_esc_hint_close_title: 'Cindezela u-Esc ukuze uvale usesho',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  af: {
    search_page_h1: 'Soek lewendige radiostasies',
    search_page_intro:
      "Blaai deur Mega Radio se katalogus met meer as 60 000 lewendige radiostasies uit meer as 120 lande. Tik 'n stasienaam, musiekgenre, taal of land in om dadelik gratis aanlyn-radio te luister.",
    search_placeholder: 'Soek stasies, genres, lande…',
    search_no_results:
      'Geen stasies, genres of lande pas by jou soektog nie.',
    search_min_chars_hint:
      "Tik ten minste 2 karakters om te begin soek.",
    search_section_genres: 'Genres',
    search_section_countries: 'Lande',
    search_section_stations: 'Stasies',
    search_paging_hint_prefix: 'Wenk: druk',
    search_paging_hint_or: 'of',
    search_paging_hint_suffix:
      "om 'n bladsy deur die resultate te spring.",
    search_esc_clear_hint_prefix: 'Druk',
    search_esc_clear_hint_suffix:
      'om die uitgelig resultaat skoon te maak voordat die soektog gesluit word.',
    search_esc_hint_clear: 'Esc om skoon te maak',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Druk Esc om skoon te maak',
    search_esc_hint_close_title: 'Druk Esc om die soektog te sluit',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  sq: {
    search_page_h1: 'Kërko stacione radio drejtpërdrejt',
    search_page_intro:
      'Eksploro katalogun e Mega Radio me mbi 60.000 stacione radio drejtpërdrejt nga më shumë se 120 vende. Shkruaj emrin e stacionit, zhanrin muzikor, gjuhën ose vendin për të nisur menjëherë dëgjimin falas të radios online.',
    search_placeholder: 'Kërko stacione, zhanre, vende…',
    search_no_results:
      'Asnjë stacion, zhanër ose vend nuk përputhet me kërkimin tënd.',
    search_min_chars_hint:
      'Shkruaj të paktën 2 karaktere për të nisur kërkimin.',
    search_section_genres: 'Zhanre',
    search_section_countries: 'Vende',
    search_section_stations: 'Stacione',
    search_paging_hint_prefix: 'Këshillë: shtyp',
    search_paging_hint_or: 'ose',
    search_paging_hint_suffix:
      'për të kaluar një faqe në rezultate.',
    search_esc_clear_hint_prefix: 'Shtyp',
    search_esc_clear_hint_suffix:
      'për të pastruar rezultatin e theksuar para mbylljes së kërkimit.',
    search_esc_hint_clear: 'Esc për të pastruar',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Shtyp Esc për të pastruar',
    search_esc_hint_close_title: 'Shtyp Esc për të mbyllur kërkimin',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  az: {
    search_page_h1: 'Canlı radio stansiyalarını axtar',
    search_page_intro:
      "Mega Radio-nun 120+ ölkədən 60.000+ canlı radio stansiyası olan kataloqunda axtarış edin. Stansiya adını, musiqi janrını, dili və ya ölkəni daxil edin və dərhal pulsuz onlayn radio dinləməyə başlayın.",
    search_placeholder: 'Stansiya, janr, ölkə axtar…',
    search_no_results:
      'Axtarışınıza uyğun heç bir stansiya, janr və ya ölkə yoxdur.',
    search_min_chars_hint:
      'Axtarışa başlamaq üçün ən azı 2 simvol daxil edin.',
    search_section_genres: 'Janrlar',
    search_section_countries: 'Ölkələr',
    search_section_stations: 'Stansiyalar',
    search_paging_hint_prefix: 'Məsləhət: basın',
    search_paging_hint_or: 'və ya',
    search_paging_hint_suffix:
      'nəticələrdə bir səhifə irəli keçmək üçün.',
    search_esc_clear_hint_prefix: 'Basın',
    search_esc_clear_hint_suffix:
      'axtarışı bağlamadan əvvəl seçilmiş nəticəni təmizləmək üçün.',
    search_esc_hint_clear: 'Təmizləmək üçün Esc',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Təmizləmək üçün Esc basın',
    search_esc_hint_close_title: 'Axtarışı bağlamaq üçün Esc basın',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  hy: {
    search_page_h1: 'Որոնեք ուղիղ ռադիոկայաններ',
    search_page_intro:
      'Փնտրեք Mega Radio-ի 120+ երկրների 60,000+ ուղիղ ռադիոկայանների կատալոգում: Մուտքագրեք կայանի անունը, երաժշտական ժանրը, լեզուն կամ երկիրը՝ անմիջապես անվճար առցանց ռադիո լսելու համար:',
    search_placeholder: 'Որոնել կայաններ, ժանրեր, երկրներ…',
    search_no_results:
      'Ոչ մի կայան, ժանր կամ երկիր չի համապատասխանում ձեր որոնմանը:',
    search_min_chars_hint:
      'Որոնումը սկսելու համար մուտքագրեք առնվազն 2 նիշ:',
    search_section_genres: 'Ժանրեր',
    search_section_countries: 'Երկրներ',
    search_section_stations: 'Կայաններ',
    search_paging_hint_prefix: 'Խորհուրդ՝ սեղմեք',
    search_paging_hint_or: 'կամ',
    search_paging_hint_suffix:
      'արդյունքներում մեկ էջ առաջ գնալու համար:',
    search_esc_clear_hint_prefix: 'Սեղմեք',
    search_esc_clear_hint_suffix:
      'որոնումը փակելուց առաջ ընդգծված արդյունքը մաքրելու համար:',
    search_esc_hint_clear: 'Esc՝ մաքրելու համար',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Սեղմեք Esc՝ մաքրելու համար',
    search_esc_hint_close_title: 'Սեղմեք Esc՝ որոնումը փակելու համար',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  so: {
    search_page_h1: 'Raadi xarumaha raadiyaha tooska ah',
    search_page_intro:
      'Ka raadi katalooga Mega Radio oo leh in ka badan 60,000 xarun raadiyo oo toos ah oo ka socda in ka badan 120 wadan. Ku qor magaca xarunta, nooca muusiga, luqadda ama wadanka si aad isla markiiba u dhageysato raadiyaha onlaynka ah oo bilaash ah.',
    search_placeholder: 'Raadi xarumo, noocyo, wadamo…',
    search_no_results:
      'Ma jirto xarun, nooc ama wadan u dhigma raadintaada.',
    search_min_chars_hint:
      'Ku qor ugu yaraan 2 xaraf si aad u bilowdo raadinta.',
    search_section_genres: 'Noocyada',
    search_section_countries: 'Wadamada',
    search_section_stations: 'Xarumaha',
    search_paging_hint_prefix: 'Talo: riix',
    search_paging_hint_or: 'ama',
    search_paging_hint_suffix:
      'si aad bog uga gudubto natiijooyinka.',
    search_esc_clear_hint_prefix: 'Riix',
    search_esc_clear_hint_suffix:
      'si aad u tirtirto natiijada xusan ka hor inta aanad xirin raadinta.',
    search_esc_hint_clear: 'Esc si aad u nadiifiso',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Riix Esc si aad u nadiifiso',
    search_esc_hint_close_title: 'Riix Esc si aad u xirto raadinta',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  uk: {
    search_page_h1: 'Пошук радіостанцій у прямому ефірі',
    search_page_intro:
      'Перегляньте каталог Mega Radio з понад 60 000 радіостанцій у прямому ефірі з понад 120 країн. Введіть назву станції, музичний жанр, мову або країну, щоб одразу почати безкоштовно слухати онлайн-радіо.',
    search_placeholder: 'Пошук станцій, жанрів, країн…',
    search_no_results:
      'Жодна станція, жанр чи країна не відповідає вашому запиту.',
    search_min_chars_hint:
      'Введіть щонайменше 2 символи, щоб почати пошук.',
    search_section_genres: 'Жанри',
    search_section_countries: 'Країни',
    search_section_stations: 'Станції',
    search_paging_hint_prefix: 'Підказка: натисніть',
    search_paging_hint_or: 'або',
    search_paging_hint_suffix:
      'щоб перегорнути сторінку результатів.',
    search_esc_clear_hint_prefix: 'Натисніть',
    search_esc_clear_hint_suffix:
      'щоб скасувати виділений результат перед закриттям пошуку.',
    search_esc_hint_clear: 'Esc, щоб очистити',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Натисніть Esc, щоб очистити',
    search_esc_hint_close_title: 'Натисніть Esc, щоб закрити пошук',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
  bs: {
    search_page_h1: 'Pretraži radio stanice uživo',
    search_page_intro:
      'Istražite katalog Mega Radija sa preko 60.000 radio stanica uživo iz više od 120 zemalja. Unesite naziv stanice, muzički žanr, jezik ili zemlju i odmah počnite besplatno slušati internet radio.',
    search_placeholder: 'Pretraži stanice, žanrove, zemlje…',
    search_no_results:
      'Nijedna stanica, žanr ili zemlja ne odgovara vašoj pretrazi.',
    search_min_chars_hint:
      'Unesite najmanje 2 znaka da biste započeli pretragu.',
    search_section_genres: 'Žanrovi',
    search_section_countries: 'Zemlje',
    search_section_stations: 'Stanice',
    search_paging_hint_prefix: 'Savjet: pritisnite',
    search_paging_hint_or: 'ili',
    search_paging_hint_suffix:
      'za prelazak na sljedeću stranicu rezultata.',
    search_esc_clear_hint_prefix: 'Pritisnite',
    search_esc_clear_hint_suffix:
      'da obrišete istaknuti rezultat prije zatvaranja pretrage.',
    search_esc_hint_clear: 'Esc za brisanje',
    search_esc_hint_close: 'Esc',
    search_esc_hint_clear_title: 'Pritisnite Esc za brisanje',
    search_esc_hint_close_title: 'Pritisnite Esc da zatvorite pretragu',
    search_key_pageup: 'PageUp',
    search_key_pagedown: 'PageDown',
    search_key_esc: 'Esc',
  },
};

/**
 * Idempotent boot-time seeder. Safe to call on every server boot:
 *   - `findOneAndUpdate({...}, {...}, { upsert: true })` for both
 *     TranslationKey and per-language Translation rows means existing
 *     rows are touched (lastModified bumped) but not duplicated.
 *   - We never overwrite a non-empty Translation row that's already
 *     correct — admin-edited values win, the seeder only fills gaps.
 *     This protects translations that were tweaked manually after the
 *     initial backfill.
 *   - Failures are logged but never thrown; a transient DB hiccup must
 *     not crash the server boot.
 */
export async function seedSearchPageTranslations(): Promise<void> {
  try {
    // Step 1: ensure every TranslationKey row exists. One bulk write
    // round-trip is dramatically faster than 20 sequential upserts and
    // matters at server boot where this runs alongside other warmups.
    const keyOps = SEARCH_KEYS.map((def) => ({
      updateOne: {
        filter: { key: def.key },
        update: {
          $setOnInsert: {
            key: def.key,
            defaultValue: def.defaultValue,
            description: def.description,
            category: 'search',
            createdAt: new Date(),
          },
          $set: { updatedAt: new Date() },
        },
        upsert: true,
      },
    }));
    if (keyOps.length > 0) {
      await TranslationKey.bulkWrite(keyOps, { ordered: false });
    }

    const keyDocs = await TranslationKey.find({
      key: { $in: SEARCH_KEYS.map((d) => d.key) },
    })
      .select({ _id: 1, key: 1 })
      .lean();
    const keyIdByKey = new Map<string, unknown>();
    for (const doc of keyDocs) keyIdByKey.set(doc.key, doc._id);

    // Step 2: read every existing search-page Translation row in one
    // shot so we can skip the ones that already have a non-empty value
    // (admin-edited copy must win over the seeded baseline). Then issue
    // a single bulkWrite for everything that's still missing.
    const existing = await Translation.find({
      keyId: { $in: keyDocs.map((d) => d._id) },
    })
      .select({ keyId: 1, language: 1, value: 1 })
      .lean();
    const populated = new Set<string>();
    for (const tx of existing) {
      if (typeof tx.value === 'string' && tx.value.trim().length > 0) {
        populated.add(`${String(tx.keyId)}::${tx.language}`);
      }
    }

    const txOps: Parameters<typeof Translation.bulkWrite>[0] = [];
    for (const [language, values] of Object.entries(TRANSLATIONS)) {
      for (const def of SEARCH_KEYS) {
        const keyId = keyIdByKey.get(def.key);
        if (!keyId) continue;
        const value = values[def.key];
        if (typeof value !== 'string' || value.trim().length === 0) {
          // Skip — the build-time guard will name this gap so it can
          // be added intentionally rather than silently filled with
          // the English fallback.
          continue;
        }
        if (populated.has(`${String(keyId)}::${language}`)) continue;
        txOps.push({
          updateOne: {
            filter: { keyId, language },
            update: {
              $set: {
                keyId,
                language,
                value,
                isCompleted: true,
                lastModified: new Date(),
              },
              $setOnInsert: { createdAt: new Date() },
            },
            upsert: true,
          },
        });
      }
    }

    if (txOps.length > 0) {
      // Mongo's bulkWrite has a per-batch document limit (currently
      // 100k, way above our ~1.1k ops) but chunking still keeps memory
      // and oplog pressure predictable.
      const CHUNK = 500;
      for (let i = 0; i < txOps.length; i += CHUNK) {
        await Translation.bulkWrite(txOps.slice(i, i + CHUNK), {
          ordered: false,
        });
      }
      logger.log(
        `✅ seedSearchPageTranslations: backfilled ${txOps.length} search_* translation rows ` +
          `across ${Object.keys(TRANSLATIONS).length} languages.`,
      );
    }
  } catch (err) {
    logger.error('seedSearchPageTranslations failed (non-fatal):', err);
  }
}

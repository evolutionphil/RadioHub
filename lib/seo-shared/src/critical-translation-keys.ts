// Essential translation keys needed for initial page render
// These load first (50-70ms), remaining keys load in background
export const CRITICAL_TRANSLATION_KEYS = [
  // Navigation and header
  'nav_home', 'nav_stations', 'nav_countries', 'nav_genres', 'nav_trending',
  'nav_about', 'nav_contact', 'nav_search', 'nav_logout', 'nav_login',
  'nav_menu', 'nav_close', 'nav_language', 'nav_view_all_notifications',
  
  // Common UI buttons and labels
  'btn_search', 'btn_play', 'btn_pause', 'btn_stop', 'btn_skip',
  'btn_like', 'btn_share', 'btn_favorite', 'btn_add', 'btn_delete',
  'btn_save', 'btn_cancel', 'btn_submit', 'btn_load_more',
  'btn_close', 'btn_back', 'btn_next', 'btn_previous',
  
  // Auth related
  'auth_login', 'auth_signup', 'auth_logout', 'auth_email_placeholder',
  'auth_password_placeholder', 'auth_continue_with',
  'auth_welcome_back', 'auth_create_account',
  
  // Common labels and placeholders
  'label_search', 'label_filter', 'label_sort', 'label_name',
  'label_country', 'label_language', 'label_genre',
  'placeholder_search_stations', 'placeholder_search',
  'search_countries_placeholder',
  
  // Common status/messages
  'loading', 'error', 'success', 'warning', 'info',
  'general_error', 'modal_error_try_again',
  'error_loading_stations', 'error_playback_error',
  
  // Pagination and list
  'pagination_page', 'pagination_of', 'pagination_next', 'pagination_prev',
  'results_showing', 'results_total', 'no_results_found',
  
  // Station related (common)
  'stations', 'station_name', 'station_country', 'station_language',
  'station_genre', 'station_listeners', 'station_votes',
  'station_bitrate', 'stations_total',
  
  // Homepage/landing
  'homepage_title', 'homepage_subtitle', 'homepage_see_all',
  'homepage_popular', 'homepage_trending', 'homepage_community_favorites',
  'homepage_stations_description',
  
  // Sort options
  'sort', 'sort_az', 'sort_za', 'sort_newest_first',
  'sort_by_name', 'sort_by_popularity', 'sort_by_votes',
  'regions.sort.by_name', 'regions.sort.by_stations',
  
  // Regions/Countries
  'regions', 'regions.search.no_results', 'regions.search.try_different',
  'regions.stats.stations', 'regions.view_all',
  
  // Modals
  'modal_success', 'modal_error', 'signup_modal_title',
  'signup_modal_description', 'modal_request_station_title',
  
  // Share
  'share', 'share_on', 'share_mega_radio', 'share_description',
  'copy_link',
  
  // FAQ/Help
  'faq_title', 'faq_seo_coverage_title',
  
  // Trending
  'trending_stations_count',
  
  // Not found/404
  '404_page_not_found', '404_description', '404_help_text',
  
  // Footer/Generic
  'footer_about', 'footer_contact', 'footer_privacy', 'footer_terms',
];

export function isCriticalKey(key: string): boolean {
  return CRITICAL_TRANSLATION_KEYS.includes(key);
}

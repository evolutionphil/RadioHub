import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import { getLanguageFromPath, getLanguageFromCode, COUNTRY_TO_CODE, COUNTRY_TO_LANGUAGE, SEO_LANGUAGES } from "@shared/seo-config";
import { CRITICAL_TRANSLATION_KEYS } from "@shared/critical-translation-keys";
import { logger } from '@/lib/logger';

// TypeScript declarations for server-preloaded translations
declare global {
  interface Window {
    __INITIAL_LANGUAGE__?: string;
    __INITIAL_TRANSLATIONS__?: Record<string, string>;
    __PRELOADED__?: boolean;
  }
}

// Helper function to extract language from path - browser compatible
const extractLanguageFromPath = (pathname: string): string => {
  const { language } = getLanguageFromPath(pathname);
  return language;
};

// Translation data type
interface Translation {
  key: string;
  language: string;
  value: string;
  isCompleted: boolean;
}

interface TranslationKey {
  _id: string;
  key: string;
  defaultValue: string;
  description: string;
  category: string;
  isPlural: boolean;
}

export function useTranslation() {
  // Initialize language with proper detection logic
  const [language, setLanguageState] = useState(() => {
    if (typeof window !== 'undefined') {
      // PRIORITY 1: Check for server-preloaded language (SSR)
      if (window.__INITIAL_LANGUAGE__) {
        localStorage.setItem('preferredLanguage', window.__INITIAL_LANGUAGE__);
        return window.__INITIAL_LANGUAGE__;
      }
      
      // PRIORITY 2: Try to get language from URL
      const urlLanguage = extractLanguageFromPath(window.location.pathname);
      
      // If URL has a specific language prefix (not default English), use it
      if (urlLanguage !== 'en' && window.location.pathname.match(/^\/[a-z]{2}(?:\/|$)/)) {
        localStorage.setItem('preferredLanguage', urlLanguage);
        return urlLanguage;
      }
      
      // PRIORITY 3: Check if user has a stored language preference
      const storedLang = localStorage.getItem('preferredLanguage');
      if (storedLang && storedLang !== 'en') {
        return storedLang;
      }
      
      // PRIORITY 4: Default to English if no preference
      return 'en';
    }
    return 'en';
  });

  const queryClient = useQueryClient();

  // Fetch user location for automatic language detection
  // OPTIMIZED: Defer this query to avoid blocking Main Thread during initial load
  const { data: locationData } = useQuery<{
    location: {
      country: string;
      countryCode: string;
      detected: boolean;
    };
  }>({
    queryKey: ["/api/location"],
    staleTime: 60 * 60 * 1000, // 1 hour - location doesn't change often
    // Defer this non-critical query to improve Main Thread performance
    enabled: typeof window !== 'undefined' && document.readyState === 'complete',
  });

  // Auto-detect language based on URL language code, country code, or location
  useEffect(() => {
    // Always check if URL has changed and should affect language
    const urlPath = window.location.pathname;
    const codeMatch = urlPath.match(/^\/([a-z]{2})(?:\/|$)/);
    
    if (codeMatch) {
      const urlCode = codeMatch[1];
      
      // CRITICAL FIX: Check LANGUAGE codes FIRST (priority over country codes)
      // This ensures /ar → Arabic, /de → German, /tr → Turkish work correctly
      // Previously checked country codes first which caused /ar to map to Argentina → English
      const isValidLanguage = SEO_LANGUAGES.find(lang => lang.code === urlCode && lang.enabled);
      
      if (isValidLanguage) {
        // It's a valid language code - use it directly
        if (urlCode !== language) {
          logger.log(`🌐 Language detected from URL: '${urlCode}'`);
          localStorage.setItem('preferredLanguage', urlCode);
          setLanguageState(urlCode);
        }
        return;
      }
      
      // Not a language code, check if it's a country code
      const languageFromCountry = COUNTRY_TO_LANGUAGE[urlCode];
      if (languageFromCountry && languageFromCountry !== language) {
        // URL country code maps to a language
        localStorage.setItem('preferredLanguage', languageFromCountry);
        setLanguageState(languageFromCountry);
        return;
      }
    } else {
      // CRITICAL: No code in URL = GLOBAL view = ALWAYS English
      // Global views must NEVER show translations, only English
      if (language !== 'en') {
        logger.log('🌍 Global view detected - forcing English language');
        localStorage.setItem('preferredLanguage', 'en');
        setLanguageState('en');
        return;
      }
    }
    
    // Fallback to location-based detection only if no URL code and no stored preference
    if (!codeMatch && locationData?.location && locationData.location.detected && 
        !localStorage.getItem('preferredLanguage') && 
        language === 'en') {
      
      const countryName = locationData.location.country;
      const countryCode = COUNTRY_TO_CODE[countryName];
      
      if (countryCode) {
        const detectedLanguage = COUNTRY_TO_LANGUAGE[countryCode];
        if (detectedLanguage && detectedLanguage !== 'en') {
          // Location-based detection
          localStorage.setItem('preferredLanguage', detectedLanguage);
          setLanguageState(detectedLanguage);
        }
      }
    }
  }, [locationData, language, window.location.pathname]);

  const hasPreloadedTranslations = typeof window !== 'undefined' && 
    window.__INITIAL_TRANSLATIONS__ && 
    Object.keys(window.__INITIAL_TRANSLATIONS__).length > 0 &&
    window.__INITIAL_LANGUAGE__ === language;
  
  // 🚀 LAZY LOADING: Fetch CRITICAL translations first (~100-120 keys, ~100-150ms)
  const { data: criticalTranslations } = useQuery<Record<string, string>>({
    queryKey: ["/api/translations", language, "critical"],
    enabled: !!language && !hasPreloadedTranslations, // Skip if server-preloaded
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes cache
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // 🚀 LAZY LOADING: Fetch FULL translations in background (~850ms but non-blocking)
  // Only fetch after critical translations are ready (200ms delay to prioritize critical)
  const { data: fullTranslations, isLoading: fullTranslationsLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/translations", language],
    enabled: !!language && !hasPreloadedTranslations && !!criticalTranslations, // Only fetch full after critical ready
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes cache
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Merge critical + full translations (critical loaded first, full merges in)
  const translations = hasPreloadedTranslations 
    ? window.__INITIAL_TRANSLATIONS__ 
    : { ...criticalTranslations, ...fullTranslations };

  // Loading indicator: true if using server-preloaded OR if critical translations not yet loaded
  const isLoading = !hasPreloadedTranslations && !criticalTranslations;

  // Refetch function for compatibility
  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/translations", language] });
  };
  

  // Translation loading state tracking

  // Force fresh data for Turkish translations
  useEffect(() => {
    if (language === 'tr') {
      // Force Turkish translations refresh to get latest data
      queryClient.invalidateQueries({ queryKey: ["/api/translations", "tr"] });
    }
  }, [language, queryClient]);

  // Fetch English translations as fallback for unsupported languages
  const { data: englishTranslations } = useQuery<Record<string, string>>({
    queryKey: ["/api/translations", "en"],
    enabled: language !== 'en', // Only fetch if current language is not English
    staleTime: 30 * 60 * 1000, // 30 minutes cache
    gcTime: 60 * 60 * 1000, // 1 hour cache
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Fetch current user to check admin status
  const { data: currentUser } = useQuery({
    queryKey: ["/api/auth/me"],
    retry: false
  });

  // Only fetch admin translation keys if user is authenticated and admin
  const { data: translationKeys } = useQuery<TranslationKey[]>({
    queryKey: ["/api/admin/translation-keys"],
    staleTime: 60 * 60 * 1000, // 1 hour - longer cache to prevent duplicates
    gcTime: 2 * 60 * 60 * 1000, // 2 hours - keep in memory longer
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1, // Reduce retries for performance
    enabled: !!(currentUser && (currentUser as any).user && (currentUser as any).user.isAdmin) // Only fetch if user is admin
  });

  // Global auth translation fallbacks - always available
  const GLOBAL_AUTH_FALLBACKS: Record<string, string> = {
    // Modal headers and descriptions
    'auth_welcome_back': 'Welcome Back',
    'auth_welcome_back_description': 'Sign in to your account to access favorites and more',
    'auth_create_account': 'Create Account',
    'auth_create_account_description': 'Create a new account to save your favorite stations',
    
    // Form buttons and actions
    'auth_login': 'Login',
    'auth_sign_up': 'Sign Up',
    'auth_login_button': 'Login',
    'auth_signup_button': 'Create Account',
    'auth_logging_in': 'Logging in...',
    'auth_signing_up': 'Creating Account...',
    
    // Form fields and labels
    'auth_email_label': 'Email Address',
    'auth_email_placeholder': 'Enter your email',
    'auth_password': 'Password',
    'auth_password_placeholder': 'Enter your password',
    'auth_confirm_password': 'Confirm Password',
    'auth_confirm_password_placeholder': 'Confirm your password',
    'auth_full_name': 'Full Name',
    'auth_full_name_placeholder': 'Enter your full name',
    
    // Social login
    'auth_continue_with': 'Continue with',
    'auth_continue_google': 'Continue with Google',
    'auth_continue_facebook': 'Continue with Facebook',
    'auth_continue_apple': 'Continue with Apple',
    'auth_or': 'or',
    
    // Navigation links
    'auth_no_account': "Don't have an account?",
    'auth_sign_up_here': 'Sign up here',
    'auth_have_account': 'Already have an account?',
    'auth_login_here': 'Login here',
    
    // Toast messages
    'auth_welcome_back_toast': 'Welcome back!',
    'auth_account_created': 'Account Created!',
    'auth_login_failed': 'Login Failed',
    'auth_signup_failed': 'Signup Failed',
    'auth_social_connecting': 'Connecting',
    'auth_social_error': 'Authentication Error',
    
    // Legacy login page keys
    'auth_login_header': 'Login',
    'auth_manage_profile': 'Manage Your Profile',
    'auth_enjoy_listening': 'Enjoy',
    'auth_listening': 'Listening',
    'auth_forgot_password': 'Forgot Password?',
    
    // Legacy signup page keys
    'auth_signup_header': 'Create Account',
    'auth_username_optional': 'Username (optional)',
    'auth_username_placeholder': 'Username',
    'auth_already_have_account': 'Already have an account?',
    
    // Common validation and errors
    'auth_email_required': 'Email is required',
    'auth_password_required': 'Password is required',
    'auth_invalid_credentials': 'Invalid email or password',
    'auth_network_error': 'Network error. Please try again.',
    
    // Additional form labels
    'auth_full_name_label': 'Full Name',
    'auth_username_label': 'Username',
    'auth_choose_unique_username': 'Choose a unique username',
    'auth_enter_email': 'Enter your email address',
    'auth_password_label': 'Password',
    'auth_enter_password': 'Create a strong password',
    'auth_continue_with_email': 'Or continue with email',
    
    // Request Station Modal
    'modal_request_station_title': 'Request a Station',
    'modal_request_station_description': "Can't find your favorite station? Request it and we'll add it to our database!",
    'modal_station_name_placeholder': 'Station Name',
    'modal_station_url_placeholder': 'Station URL',
    'modal_select_country': 'Select Country',
    'modal_description_placeholder': 'Description (optional)',
    'modal_cancel_button': 'Cancel',
    'modal_submit_button': 'Submit Request',
    'modal_sending': 'Sending...',
    'modal_success': 'Success',
    'request_station_success': 'We got your request, thank you!',
    'modal_error': 'Error',
    'modal_error_try_again': 'Something went wrong. Please try again.',
    
    // Add Your Station Modal
    'modal_add_station_title': 'Add Your Station',
    'modal_station_name_label': 'Station Name',
    'modal_station_url_label': 'Station URL',
    'modal_country_label': 'Country',
    'modal_description_label': 'Description',
    
    // Recommendations Page
    'for_you_subtitle': 'Personalized stations based on your taste',
    'mood_selector': 'How are you feeling?',
    'mood_description': 'Select your mood to get better recommendations',
    'mood_all': 'All Moods',
    'mood_energetic': 'Energetic',
    'mood_relaxed': 'Relaxed',
    'mood_focused': 'Focused',
    'mood_nostalgic': 'Nostalgic',
    'mood_party': 'Party',
    'mood_chill': 'Chill',
    'your_music_profile': 'Your Music Profile',
    'profile_description': 'Based on your listening history',
    'avg_listen_time': 'Average Listen Time',
    'stations_played': 'Stations Played',
    'profile_strength': 'Profile Strength',
    'total_sessions': 'Total Sessions',
    'preferred_genres': 'Your Preferred Genres',
    'preferred_countries': 'Your Preferred Countries',
    'personalized_for_you': 'Personalized for You',
    'personalized_description': 'Based on your listening patterns and preferences',
    'trending_now': 'Trending Now',
    'trending_description': 'Popular stations everyone is talking about',
    'fresh_discoveries': 'Fresh Discoveries',
    'fresh_description': 'New and exciting stations to explore',
    'stations_for_mood': 'stations for mood',
    'stations_ml_powered': 'stations (ML-powered)',
    'stations_diverse_mix': 'stations (diverse mix)',
    'error_fetch_personalized_stations': 'Failed to fetch personalized stations',
    'error_fetch_trending_stations': 'Failed to fetch trending stations',
    'debug_personalized_stations_fetched': 'Personalized stations fetched:',
    'debug_personalized_fallback_fetched': 'Personalized fallback stations fetched:',
    'debug_trending_stations_fetched': 'Trending stations fetched:',
    'debug_discovery_stations_fetched': 'Discovery stations fetched:',
    'debug_discovery_strategy_failed': 'Discovery strategy failed:',
    
    // Homepage translations
    'homepage_see_all': 'See All',
    'homepage_community_favorites': 'Community Favorites',
    'homepage_genres': 'Genres',
    'homepage_popular_stations': 'Popular Stations',
    'homepage_stations_near_you': 'Stations Near You',
    'homepage_personalized_recommendations': 'Personalized Recommendations',
    
    // LCP OPTIMIZATION: Hero section text for instant rendering
    'hero_over_100_countries': 'Over 100 countries',
    'hero_worlds_best_radio': 'The world\'s best radio applications',
    'hero_listen_everywhere': 'Listen everywhere anytime free',
    'hero_search_placeholder': 'Search for radio stations...',
    
    // 404 Page translations
    '404_page_not_found': 'Page Not Found',
    '404_description': 'The page you are looking for does not exist.',
    '404_help_text': 'Use the search below or browse our popular content to find what you need.',
    'search_stations': 'Search Stations',
    'search_placeholder': 'Search for radio stations...',
    'homepage': 'Homepage',
    'homepage_description': 'Discover thousands of radio stations from around the world',
    'go_home': 'Go Home',
    'popular_stations': 'Popular Stations',
    'popular_stations_description': 'Most listened radio stations worldwide',
    'browse_popular': 'Browse Popular',
    'music_genres': 'Music Genres',
    'genres_description': 'Find stations by your favorite music style',
    'explore_genres': 'Explore Genres',
    'try_these_popular_stations': 'Try These Popular Stations',
    'popular_genres': 'Popular Genres',
    'stations': 'stations',
    'still_need_help': 'Still Need Help?',
    'report_broken_link_description': 'Let us know about broken links or missing content',
    'report_broken_link': 'Report Broken Link',
    'contact_us': 'Contact Us',
    
    // FAQ Section - SEO Content
    'faq_title': 'Everything You Should Know About Radio',
    'faq_subtitle': 'Frequently asked questions about online radio streaming',
    'faq_what_is_radio': 'What is Radio?',
    'faq_what_is_radio_answer': 'Radio is a wireless technology that transmits audio content through electromagnetic waves. Traditional radio broadcasts over AM or FM frequencies, while modern digital options include internet radio and DAB+ digital broadcasting.',
    'faq_what_is_internet_radio': 'What is Internet Radio?',
    'faq_what_is_internet_radio_answer': 'Internet radio streams audio content over the internet instead of traditional radio waves. You can listen to thousands of stations worldwide on any device with an internet connection, including smartphones, tablets, and computers.',
    'faq_what_is_web_radio': 'What is Web Radio?',
    'faq_what_is_web_radio_answer': 'Web radio is essentially the same as internet radio - stations that broadcast exclusively online through websites or apps. It offers unlimited variety with stations from every country and genre without geographical limitations.',
    'faq_how_to_listen': 'How can I listen to radio?',
    'faq_how_to_listen_answer': 'You can listen to radio in multiple ways: traditional FM/AM receivers, internet radio through websites and apps, DAB+ digital receivers, smart speakers, or car entertainment systems. Mega Radio makes it easy to listen directly in your web browser.',
    'faq_listen_on_phone': 'Can I listen to radio on my phone?',
    'faq_listen_on_phone_answer': 'Yes! You can listen to radio on any smartphone through internet radio apps or mobile browsers. Simply visit Mega Radio on your mobile browser to access thousands of stations without downloading any app.',
    'faq_is_radio_free': 'Is internet radio free?',
    'faq_is_radio_free_answer': 'Yes, internet radio is completely free to listen to on Mega Radio. You only need an internet connection. Some stations may include advertisements, but there are no subscription fees or hidden costs.',
    'faq_listen_on_pc': 'How can I listen to radio on my PC?',
    'faq_listen_on_pc_answer': 'Listening to radio on your PC is simple - just open any web browser, visit Mega Radio, search for your favorite station, and click play. No software installation required. You can also use dedicated radio apps if you prefer.',
    'faq_which_stations': 'Which radio stations can I listen to?',
    'faq_which_stations_answer': 'Mega Radio offers access to over 60,000 radio stations from 120+ countries worldwide. You can find stations playing every genre imaginable - from pop and rock to classical, jazz, news, sports, and talk shows.',
    'faq_best_station': 'Which radio station is the best?',
    'faq_best_station_answer': 'The best radio station depends on your personal taste in music and content. Explore our trending stations, browse by genre or country, and use our personalized recommendations to discover stations that match your preferences.',
    'faq_no_ads_stations': 'Which radio stations have no advertising?',
    'faq_no_ads_stations_answer': 'Many public broadcasting and classical music stations operate without commercial advertising. Browse our collection and filter by genre to find ad-free listening experiences, particularly in classical, jazz, and public radio categories.',
    'faq_about_megaradio': 'About Mega Radio',
    'faq_about_megaradio_text': 'Mega Radio is your ultimate destination for discovering and streaming live radio stations from around the world. With over 60,000 stations spanning 120+ countries, we bring you unlimited access to music, news, sports, and entertainment in every language and genre imaginable.',
    'faq_about_megaradio_features': 'Our platform features advanced search capabilities, personalized recommendations, and seamless streaming across all your devices. Whether you love pop, rock, classical, jazz, or talk shows, Mega Radio makes it easy to find and enjoy your perfect station - completely free, no registration required.',
    
    // Enhanced About Section - SEO Optimized
    'faq_about_megaradio_intro': 'Mega Radio is your ultimate destination for discovering and streaming live radio stations from around the world. With over 60,000 free radio stations spanning 120+ countries, we deliver unlimited access to music, news, sports, and entertainment across every language and genre.',
    'faq_about_global_coverage': 'Global Radio Station Coverage',
    'faq_about_global_coverage_text': 'Listen to free live radio from every corner of the globe. Our extensive collection includes popular FM and AM radio stations, internet radio, online radio broadcasts, and web radio from major cities and local communities worldwide. Discover music radio playing pop, rock, classical, jazz, hip-hop, electronic, country, and world music, plus news radio, sports radio, and talk radio stations broadcasting in dozens of languages.',
    'faq_about_features': 'Advanced Radio Streaming Features',
    'faq_about_features_text': 'Our platform features powerful search capabilities to instantly find radio stations by name, genre, country, or language. Browse curated collections of popular radio stations, explore trending live broadcasts, and discover personalized radio recommendations based on your listening preferences. The intuitive interface works seamlessly across all devices - listen on your smartphone, tablet, desktop computer, laptop, smart speaker, or smart TV.',
    'faq_about_streaming_quality': 'Experience crystal-clear audio quality with reliable connections for uninterrupted radio streaming. Our advanced technology ensures smooth playback whether you are listening to music radio, news broadcasts, sports commentary, or talk shows from local and international radio stations.',
    'faq_about_free_access': 'Completely Free Radio Streaming',
    'faq_about_free_access_text': 'Enjoy unlimited free access to live radio stations worldwide with no subscription fees, no registration required, and no hidden costs. Start listening to your favorite radio stations instantly in your web browser. Mega Radio brings the world of online radio to everyone, breaking down geographical barriers and making global radio broadcasting accessible to anyone with an internet connection.',
    
    'tv_login_title': 'Connect Your TV',
    'tv_login_required_title': 'Login Required',
    'tv_login_required_description': 'Please log in to your Mega Radio account first, then come back here to connect your TV.',
    'tv_go_to_login': 'Go to Login',
    'tv_enter_code_title': 'Enter the Code Shown on Your TV',
    'tv_enter_code_description': 'Open Mega Radio on your TV and enter the 6-digit code displayed on the screen.',
    'tv_code_placeholder': 'Enter 6-digit code',
    'tv_activating': 'Connecting to your TV...',
    'tv_activation_success': 'TV Connected Successfully!',
    'tv_activation_failed': 'Connection failed. Please try again.',
    'tv_network_error': 'Network error. Please check your connection.',
    'tv_how_it_works': 'How It Works',
    'tv_step1_description': 'Open the Mega Radio app on your Samsung TV or LG TV.',
    'tv_step2_description': 'A 6-digit code will appear on your TV screen. Enter that code above.',
    'tv_step3_description': 'Your TV will automatically connect to your account. You can then cast radio stations from your phone or computer.',
    'tv_supported_devices': 'Supported devices: Samsung Smart TV (Tizen), LG Smart TV (webOS). Your TV stays connected to your account permanently — no need to reconnect.',
    'tv_step_web': 'Web / Mobile',
    'tv_step_tv': 'TV',
  };

  // Translation function with proper priority handling
  const t = useCallback((key: string, fallback?: string, params?: Record<string, string>): string => {
    let translatedText = '';
    
    // PRIORITY 1: Check current language translations (skip if has "Homepage" prefix bug or corrupted placeholder values)
    if (translations && translations[key] && 
        !translations[key].startsWith('Homepage ') && 
        !['Title', 'Subtitle', 'titel', 'subtitel'].includes(translations[key])) {
      translatedText = translations[key];
    }

    // PRIORITY 2: If current language is not English and no translation found, try English (skip if has "Homepage" prefix bug or corrupted placeholder values)
    if (!translatedText && language !== 'en' && englishTranslations && englishTranslations[key] && 
        !englishTranslations[key].startsWith('Homepage ') && 
        !['Title', 'Subtitle', 'titel', 'subtitel'].includes(englishTranslations[key])) {
      translatedText = englishTranslations[key];
    }

    // PRIORITY 3: Global fallback for all keys (hardcoded fallbacks)
    if (!translatedText && GLOBAL_AUTH_FALLBACKS[key]) {
      translatedText = GLOBAL_AUTH_FALLBACKS[key];
    }

    // PRIORITY 4: Try to find in translation keys for default value
    if (!translatedText && translationKeys) {
      const translationKey = translationKeys.find(tk => tk.key === key);
      if (translationKey && translationKey.defaultValue) {
        translatedText = translationKey.defaultValue;
      }
    }

    // PRIORITY 5: Use fallback parameter or English translation (NEVER show key names!)
    if (!translatedText) {
      // Use fallback if provided, otherwise use English translation, NEVER the key name
      translatedText = fallback || englishTranslations?.[key] || key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    // Substitute parameters if provided (case-insensitive matching)
    if (params && translatedText) {
      Object.entries(params).forEach(([paramKey, paramValue]) => {
        // Match {paramKey} in any case: {country}, {COUNTRY}, {Country} all match
        const placeholder = new RegExp(`\\{${paramKey}\\}`, 'gi');
        translatedText = translatedText.replace(placeholder, paramValue);
      });
    }

    return translatedText;
  }, [translations, englishTranslations, translationKeys, language]);

  // Change language function with instant switching (use cache first, then background update)
  const setLanguage = useCallback(async (newLanguage: string) => {
    setLanguageState(newLanguage);
    localStorage.setItem('preferredLanguage', newLanguage);
    
    // Check if translation already exists in cache for instant switch
    const cachedTranslations = queryClient.getQueryData(["/api/translations", newLanguage]);
    
    if (!cachedTranslations) {
      // If not cached, prefetch it immediately for future instant switches
      queryClient.prefetchQuery({
        queryKey: ["/api/translations", newLanguage],
        queryFn: async () => {
          const response = await fetch(`/api/translations/${newLanguage}`);
          if (!response.ok) throw new Error('Failed to fetch translations');
          return response.json();
        },
        staleTime: 30 * 60 * 1000,
        gcTime: 60 * 60 * 1000,
      });
    }
    
    // Prefetch common languages for future instant switches
    const commonLanguages = ['en', 'de', 'es', 'fr', 'it', 'pt', 'tr'];
    commonLanguages.forEach(lang => {
      if (!queryClient.getQueryData(["/api/translations", lang])) {
        setTimeout(() => {
          queryClient.prefetchQuery({
            queryKey: ["/api/translations", lang],
            queryFn: async () => {
              const response = await fetch(`/api/translations/${lang}`);
              if (!response.ok) throw new Error('Failed to fetch translations');
              return response.json();
            },
            staleTime: 30 * 60 * 1000,
            gcTime: 60 * 60 * 1000,
          });
        }, 100); // Stagger prefetching
      }
    });
    
    // Force immediate refetch if needed, but don't block UI
    setTimeout(() => {
      queryClient.fetchQuery({
        queryKey: ["/api/translations", newLanguage],
      });
    }, 100);
  }, [queryClient]);

  // Add a listener for URL changes to trigger language switching
  useEffect(() => {
    const handlePopstate = () => {
      const urlPath = window.location.pathname;
      const countryCodeMatch = urlPath.match(/^\/([a-z]{2})(?:\/|$)/);
      
      if (countryCodeMatch) {
        const urlCountryCode = countryCodeMatch[1];
        const languageFromUrl = COUNTRY_TO_LANGUAGE[urlCountryCode];
        
        if (languageFromUrl && languageFromUrl !== language) {
          // Popstate language change
          setLanguageState(languageFromUrl);
          localStorage.setItem('preferredLanguage', languageFromUrl);
        }
      }
    };

    // Listen for URL changes (back/forward buttons)
    window.addEventListener('popstate', handlePopstate);
    
    return () => window.removeEventListener('popstate', handlePopstate);
  }, [language]);

  // Force re-render when language changes
  useEffect(() => {
    // Language changed, translations will be refetched automatically
  }, [language, translations]);

  return {
    t,
    language,
    setLanguage,
    isLoading,
    refetch,
    translationCount: translations?.length || 0,
    availableLanguages: ['en', 'de', 'es', 'fr', 'tr', 'ar'] // Available languages with translations
  };
}
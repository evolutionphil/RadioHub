import express from 'express';
import mongoose from 'mongoose';

const app = express();

// Translation Schema
const translationSchema = new mongoose.Schema({
  language: { type: String, required: true },
  key: { type: String, required: true },
  value: { type: String, required: true },
  category: String,
  lastUpdated: { type: Date, default: Date.now }
});

const Translation = mongoose.models.Translation || mongoose.model('Translation', translationSchema);

// 100% GERMAN TRANSLATIONS
const germanTranslations: Record<string, string> = {
  // ML RECOMMENDATIONS
  'ml_reason_popular_station': 'Beliebter Sender',
  'ml_reason_great_for_discovering': 'Großartig zum Entdecken neuer Musik',
  'ml_why_recommendation': 'Warum diese Empfehlung:',
  'ml_high_confidence_match': 'Hohe Übereinstimmung',
  
  // MOODS
  'mood_energetic': 'Energiegeladen',
  'mood_relaxed': 'Entspannt',
  'mood_focused': 'Konzentriert',
  'mood_nostalgic': 'Nostalgisch',
  'mood_party': 'Feierlaune',
  'mood_chill': 'Gelassen',
  'mood_all': 'Alle Stimmungen',
  'mood_selector': 'Wie fühlen Sie sich?',
  'mood_description': 'Wählen Sie Ihre Stimmung für bessere Empfehlungen',
  
  // FOR YOU PAGE
  'nav_for_you': 'Für Sie',
  'for_you_subtitle': 'Personalisierte Sender basierend auf Ihrem Geschmack',
  'your_music_profile': 'Ihr Musikprofil',
  'profile_description': 'Basierend auf Ihrem Hörverlauf',
  'avg_listen_time': 'Durchschnittliche Hörzeit',
  'stations_played': 'Gespielte Sender',
  'profile_strength': 'Profilstärke',
  'total_sessions': 'Sitzungen gesamt',
  'preferred_genres': 'Ihre bevorzugten Genres',
  'preferred_countries': 'Ihre bevorzugten Länder',
  'personalized_for_you': 'Personalisiert für Sie',
  'trending_now': 'Derzeit im Trend',
  'discover_new': 'Neues entdecken',
  'based_on_genres': 'Basierend auf Ihren Genres',
  'no_recommendations': 'Keine Empfehlungen',
  'no_recommendations_desc': 'Beginnen Sie zu hören, um personalisierte Empfehlungen zu erhalten',
  'browse_stations': 'Sender durchsuchen',
  'homepage_see_all': 'Alle anzeigen',
  'personalized_description': 'Basierend auf Ihren Hörgewohnheiten und Vorlieben',
  'trending_description': 'Beliebte Sender, über die alle sprechen',
  
  // USER MENU
  'user_menu_signed_in_as': 'Angemeldet als',
  'user_menu_your_favorites': 'Ihre Favoriten',
  'user_menu_discover': 'Entdecken',
  'user_menu_records': 'Aufzeichnungen',
  'user_menu_profile': 'Profil',
  'profile_nav_favorites': 'Favoriten',
  'profile_nav_discover': 'Entdecken',
  'profile_nav_records': 'Aufzeichnungen',
  'profile_nav_profile': 'Profil',
  
  // REGIONS & SEARCH
  'regions_search_countries': 'Länder durchsuchen...',
  'regions_search_cities': 'Städte durchsuchen...',
  'regions_search_stations': 'Sender durchsuchen...',
  'regions_all_genres': 'Alle Genres',
  'regions_popular_in_region': 'Beliebt in dieser Region',
  
  // COMMON
  'all': 'Alle',
  'latest': 'Neueste',
  'recent': 'Kürzlich',
  'popular': 'Beliebt',
  'top': 'Top',
  'most': 'Meiste',
  'stations_label': 'Sender',
  'stations_for_mood': 'Sender für Stimmung',
  'stations_diverse_mix': 'Sender (vielfältige Mischung)',
  'stations_for_genre': 'Für Genre',
  
  // PLAYER
  'play_button': 'Wiedergabe',
  'stop_button': 'Stopp',
  'audio': 'Audio',
  'now_playing': 'Läuft gerade',
  'station_playing': 'Sender läuft',
  'station_stopped': 'Sender gestoppt',
  
  // NAVIGATION
  'nav_all_stations': 'Alle Sender',
  'nav_your_favorites': 'Ihre Favoriten',
  'nav_view_all_notifications': 'Alle Benachrichtigungen anzeigen',
  
  // SEO
  'seo_popular_stations': 'Beliebte Sender',
  'seo_community_favorites': 'Community-Favoriten',
  'seo_all_stations': 'Alle Sender',
  'discover_all_stations': 'Alle Sender entdecken',
  
  // FAVORITES
  'favorites_add_to_favorites': 'Zu Favoriten hinzufügen',
  'favorites_remove_from_favorites': 'Aus Favoriten entfernen',
  'favorites_recording_statistics_and_more': 'Aufnahmestatistiken und mehr',
  
  // ERRORS
  'error_fetch_personalized_stations': 'Personalisierte Sender konnten nicht abgerufen werden',
  'error_fetch_trending_stations': 'Trendende Sender konnten nicht abgerufen werden',
  'error_fetch_genre_based_stations': 'Genre-basierte Sender konnten nicht abgerufen werden',
  
  // ADMIN
  'admin_error_network': 'Netzwerkfehler',
  'admin_error_codec_unsupported': 'Codec nicht unterstützt',
  'admin_error_connection_timeout': 'Verbindungszeitüberschreitung',
  'admin_error_stream_unavailable': 'Stream nicht verfügbar',
  'admin_error_audio': 'Audiofehler',
  'admin_all_statuses': 'Alle Status',
  'admin_slug_generation_progress': 'Slug-Generierungsfortschritt',
  'admin_overall_progress': 'Gesamtfortschritt',
  'admin_generation_progress': 'Generierungsfortschritt',
  'admin_generation_results': 'Generierungsergebnisse',
  'analytics_customize_view': 'Ansicht anpassen',
  'analytics_pick_date_range': 'Datumsbereich auswählen',
  'analytics_play_events': 'Wiedergabe-Ereignisse',
  'analytics_stop_events': 'Stopp-Ereignisse',
  'analytics_favorite_events': 'Favoriten-Ereignisse',
  'analytics_search_events': 'Such-Ereignisse',
  'analytics_rating_events': 'Bewertungs-Ereignisse',
  'analytics_click_events': 'Klick-Ereignisse',
  'analytics_top_countries': 'Top-Länder',
  'analytics_stations_by_country': 'Sender nach Land',
  'analytics_most_popular_genres': 'Beliebteste Genres',
  'analytics_recent_events': 'Kürzliche Ereignisse',
  'analytics_latest_user_interactions': 'Neueste Benutzerinteraktionen',
  'admin_category_description': 'Beschreibung',
  'admin_category_name': 'Kategoriename',
  'admin_recent_sync_activity': 'Kürzliche Synchronisierungsaktivität',
  
  // SORTING
  'sort_most_popular': 'Beliebteste',
  'sort_most_clicked': 'Meistgeklickt',
  'sort_recently_updated': 'Kürzlich aktualisiert',
  
  // RADIO FRONTEND
  'radio_premium_headphones': 'Premium-Kopfhörer für Musik-Streaming',
  'radio_popular_stations': 'Beliebte Radiosender',
  'radio_discover_popular': 'Entdecken Sie die beliebtesten Radiosender aus der ganzen Welt auf Mega Radio',
  'radio_featured_stations': 'Empfohlene Radiosender',
  'radio_music_genres': 'Musikgenres',
  
  // FORMS
  'modal_stream_url_placeholder': 'Stream-URL',
  
  // GUIDE
  'guide_search_title': 'Sender suchen',
  'guide_favorites_title': 'Favoriten speichern',
  'guide_favorites_yellow_button': 'Drücken Sie die GELBE Taste, um Favoriten hinzuzufügen',
  
  // HEADER
  'header_welcome_message': 'Willkommen',
  'header_get_mobile_app': 'Mobile App herunterladen',
};

export async function updateGermanTranslations() {
  let updatedCount = 0;
  let addedCount = 0;

  for (const [key, value] of Object.entries(germanTranslations)) {
    const existing = await Translation.findOne({ language: 'de', key });
    
    if (existing) {
      existing.value = value;
      existing.lastUpdated = new Date();
      await existing.save();
      updatedCount++;
    } else {
      await Translation.create({
        language: 'de',
        key,
        value,
        category: 'general',
        lastUpdated: new Date()
      });
      addedCount++;
    }
  }

  return { addedCount, updatedCount, total: Object.keys(germanTranslations).length };
}

export { germanTranslations };

import { MongoClient } from 'mongodb';

async function addAboutSectionTranslations() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db();
    
    // Translation keys for the About Mega Radio section
    const translations = [
      // Main About Section
      { key: 'about_mega_radio', language: 'en', value: 'About Mega Radio' },
      { key: 'about_mega_radio_subtitle', language: 'en', value: 'Your ultimate destination for global radio streaming' },
      { key: 'about_mega_radio_description_1', language: 'en', value: 'Mega Radio is your gateway to over 60,000 live radio stations from more than 120 countries worldwide. Experience unlimited access to music, news, talk shows, and sports broadcasting without any subscription fees or restrictions.' },
      { key: 'about_mega_radio_description_2', language: 'en', value: 'Built with cutting-edge technology and optimized for all devices, Mega Radio delivers crystal-clear audio streaming with intelligent recommendations powered by machine learning to help you discover your next favorite station.' },
      { key: 'about_mega_radio_cta', language: 'en', value: 'Start exploring the world of radio broadcasting today - completely free!' },
      
      // Features Section
      { key: 'features_title', language: 'en', value: 'Key Features' },
      { key: 'feature_live_streaming', language: 'en', value: 'Live 24/7 streaming with instant playback' },
      { key: 'feature_multilingual', language: 'en', value: 'Multilingual support in 45+ languages' },
      { key: 'feature_global_coverage', language: 'en', value: 'Global coverage across all continents' },
      { key: 'feature_high_quality', language: 'en', value: 'High-quality audio up to 320kbps' },
      { key: 'feature_no_registration', language: 'en', value: 'No registration required to start listening' },
      { key: 'feature_ai_recommendations', language: 'en', value: 'AI-powered personalized recommendations' },
      
      // Coverage Section
      { key: 'coverage_title', language: 'en', value: 'Global Coverage' },
      { key: 'coverage_stations', language: 'en', value: '60,000+ radio stations worldwide' },
      { key: 'coverage_countries', language: 'en', value: '120+ countries and territories' },
      { key: 'coverage_languages', language: 'en', value: '45+ languages and dialects' },
      { key: 'coverage_genres', language: 'en', value: '50+ music genres and categories' },
      { key: 'coverage_formats', language: 'en', value: 'Multiple audio formats (MP3, AAC, HLS, OGG)' },
      { key: 'coverage_compatibility', language: 'en', value: 'Cross-platform compatibility' },
      
      // Feature Tags
      { key: 'feature_tag_free', language: 'en', value: 'Completely Free' },
      { key: 'feature_tag_no_ads', language: 'en', value: 'No Intrusive Ads' },
      { key: 'feature_tag_unlimited', language: 'en', value: 'Unlimited Listening' }
    ];
    
    // Add German translations
    const germanTranslations = [
      { key: 'about_mega_radio', language: 'de', value: 'Über Mega Radio' },
      { key: 'about_mega_radio_subtitle', language: 'de', value: 'Ihr ultimatives Ziel für globales Radio-Streaming' },
      { key: 'about_mega_radio_description_1', language: 'de', value: 'Mega Radio ist Ihr Zugang zu über 60.000 Live-Radiosendern aus mehr als 120 Ländern weltweit. Erleben Sie unbegrenzten Zugang zu Musik, Nachrichten, Talk-Shows und Sportsendungen ohne Abonnementgebühren oder Einschränkungen.' },
      { key: 'about_mega_radio_description_2', language: 'de', value: 'Mit modernster Technologie entwickelt und für alle Geräte optimiert, liefert Mega Radio kristallklares Audio-Streaming mit intelligenten, durch maschinelles Lernen betriebenen Empfehlungen, um Ihnen dabei zu helfen, Ihren nächsten Lieblingssender zu entdecken.' },
      { key: 'about_mega_radio_cta', language: 'de', value: 'Beginnen Sie noch heute mit der Erkundung der Welt des Radiosendens - völlig kostenlos!' },
      
      { key: 'features_title', language: 'de', value: 'Hauptfunktionen' },
      { key: 'feature_live_streaming', language: 'de', value: 'Live 24/7 Streaming mit sofortiger Wiedergabe' },
      { key: 'feature_multilingual', language: 'de', value: 'Mehrsprachige Unterstützung in 45+ Sprachen' },
      { key: 'feature_global_coverage', language: 'de', value: 'Globale Abdeckung auf allen Kontinenten' },
      { key: 'feature_high_quality', language: 'de', value: 'Hochwertige Audioqualität bis zu 320kbps' },
      { key: 'feature_no_registration', language: 'de', value: 'Keine Registrierung erforderlich' },
      { key: 'feature_ai_recommendations', language: 'de', value: 'KI-gestützte personalisierte Empfehlungen' },
      
      { key: 'coverage_title', language: 'de', value: 'Globale Abdeckung' },
      { key: 'coverage_stations', language: 'de', value: '60.000+ Radiosender weltweit' },
      { key: 'coverage_countries', language: 'de', value: '120+ Länder und Territorien' },
      { key: 'coverage_languages', language: 'de', value: '45+ Sprachen und Dialekte' },
      { key: 'coverage_genres', language: 'de', value: '50+ Musikgenres und Kategorien' },
      { key: 'coverage_formats', language: 'de', value: 'Mehrere Audioformate (MP3, AAC, HLS, OGG)' },
      { key: 'coverage_compatibility', language: 'de', value: 'Plattformübergreifende Kompatibilität' },
      
      { key: 'feature_tag_free', language: 'de', value: 'Völlig Kostenlos' },
      { key: 'feature_tag_no_ads', language: 'de', value: 'Keine Störenden Werbungen' },
      { key: 'feature_tag_unlimited', language: 'de', value: 'Unbegrenztes Hören' }
    ];

    // Add Spanish translations
    const spanishTranslations = [
      { key: 'about_mega_radio', language: 'es', value: 'Acerca de Mega Radio' },
      { key: 'about_mega_radio_subtitle', language: 'es', value: 'Tu destino definitivo para transmisión de radio global' },
      { key: 'about_mega_radio_description_1', language: 'es', value: 'Mega Radio es tu puerta de entrada a más de 60,000 estaciones de radio en vivo de más de 120 países en todo el mundo. Experimenta acceso ilimitado a música, noticias, programas de entrevistas y transmisiones deportivas sin tarifas de suscripción ni restricciones.' },
      { key: 'about_mega_radio_description_2', language: 'es', value: 'Construido con tecnología de vanguardia y optimizado para todos los dispositivos, Mega Radio ofrece transmisión de audio cristalino con recomendaciones inteligentes impulsadas por aprendizaje automático para ayudarte a descubrir tu próxima estación favorita.' },
      { key: 'about_mega_radio_cta', language: 'es', value: '¡Comienza a explorar el mundo de la radiodifusión hoy - completamente gratis!' },
      
      { key: 'features_title', language: 'es', value: 'Características Principales' },
      { key: 'feature_live_streaming', language: 'es', value: 'Transmisión en vivo 24/7 con reproducción instantánea' },
      { key: 'feature_multilingual', language: 'es', value: 'Soporte multilingüe en 45+ idiomas' },
      { key: 'feature_global_coverage', language: 'es', value: 'Cobertura global en todos los continentes' },
      { key: 'feature_high_quality', language: 'es', value: 'Audio de alta calidad hasta 320kbps' },
      { key: 'feature_no_registration', language: 'es', value: 'No se requiere registro para comenzar a escuchar' },
      { key: 'feature_ai_recommendations', language: 'es', value: 'Recomendaciones personalizadas con IA' },
      
      { key: 'coverage_title', language: 'es', value: 'Cobertura Global' },
      { key: 'coverage_stations', language: 'es', value: '60,000+ estaciones de radio mundiales' },
      { key: 'coverage_countries', language: 'es', value: '120+ países y territorios' },
      { key: 'coverage_languages', language: 'es', value: '45+ idiomas y dialectos' },
      { key: 'coverage_genres', language: 'es', value: '50+ géneros musicales y categorías' },
      { key: 'coverage_formats', language: 'es', value: 'Múltiples formatos de audio (MP3, AAC, HLS, OGG)' },
      { key: 'coverage_compatibility', language: 'es', value: 'Compatibilidad multiplataforma' },
      
      { key: 'feature_tag_free', language: 'es', value: 'Completamente Gratis' },
      { key: 'feature_tag_no_ads', language: 'es', value: 'Sin Anuncios Intrusivos' },
      { key: 'feature_tag_unlimited', language: 'es', value: 'Escucha Ilimitada' }
    ];

    // Combine all translations
    const allTranslations = [...translations, ...germanTranslations, ...spanishTranslations];
    
    for (const translation of allTranslations) {
      // Try to update existing, if not exists then insert
      await db.collection('translations').updateOne(
        { key: translation.key, language: translation.language },
        { $set: translation },
        { upsert: true }
      );
    }
    
    console.log('✅ About Mega Radio section translations added successfully');
    console.log(`📊 Added ${allTranslations.length} translation entries across ${[...new Set(allTranslations.map(t => t.language))].length} languages`);
  } catch (error) {
    console.error('❌ Error adding translations:', error);
  } finally {
    await client.close();
  }
}

addAboutSectionTranslations();
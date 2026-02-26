import mongoose from 'mongoose';
import { TranslationLanguage } from '../shared/mongo-schemas';
import { logger } from './utils/logger';

// MongoDB connection string - use in-memory database for development
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/radiostation-dev';

logger.log('🔗 MongoDB: Connecting to', MONGODB_URI.replace(/\/\/.*@/, '//<credentials>@'));

let isConnected = false;

// Cleanup placeholder text from existing descriptions
async function cleanupDescriptionPlaceholders() {
  try {
    const db = mongoose.connection.db;
    if (!db) return;
    
    const collection = db.collection('stations');
    
    // COMPREHENSIVE patterns for ALL 20+ languages supported by the system
    const placeholderPatterns = [
      // Translation header patterns (NEW - catches [TRANSLATED FULL DESCRIPTION...])
      /^\[?\s*TRANSLATED\s+FULL\s+DESCRIPTION[^\]]*\]?\s*/gi,
      /^\[?\s*TRANSLATED\s+DESCRIPTION[^\]]*\]?\s*/gi,
      /^\[?\s*TRANSLATED\s+META[^\]]*\]?\s*/gi,
      
      // English patterns
      /^\[?\s*FULL DESCRIPTION[^\]]*\]?\s*/gi,
      /^\[?\s*SEO META DESCRIPTION[^\]]*\]?\s*/gi,
      /^\[?\s*Response format[^\]]*\]?\s*/gi,
      
      // German patterns (Deutsch)
      /^\[?\s*Volle Beschreibung[^\]]*\]?\s*/gi,
      /^\[?\s*DESCRIPTION HERE[^\]]*Deutsch\]?\s*/gi,
      /^\[?\s*Beschreibung[^\]]*Wörter[^\]]*\]?\s*/gi,
      /^\[?\s*SEO-Meta[^\]]*\]?\s*/gi,
      
      // French patterns (Français)
      /^\[?\s*Description Complète[^\]]*\]?\s*/gi,
      /^\[?\s*DESCRIPTION COMPLÈTE[^\]]*\]?\s*/gi,
      /^\[?\s*Description.*mots.*Français\]?\s*/gi,
      /^\[?\s*DESCRIPTION[^\]]*français\]?\s*/gi,
      
      // Spanish patterns (Español)
      /^\[?\s*DESCRIPCIÓN COMPLETA[^\]]*\]?\s*/gi,
      /^\[?\s*Descripción Completa[^\]]*\]?\s*/gi,
      /^\[?\s*Description.*palabras.*Español\]?\s*/gi,
      /^\[?\s*DESCRIPCIÓN[^\]]*español\]?\s*/gi,
      
      // Italian patterns (Italiano)
      /^\[?\s*Descrizione Completa[^\]]*\]?\s*/gi,
      /^\[?\s*DESCRIZIONE COMPLETA[^\]]*\]?\s*/gi,
      /^\[?\s*Description.*parole.*Italiano\]?\s*/gi,
      
      // Portuguese patterns (Português)
      /^\[?\s*DESCRIÇÃO COMPLETA[^\]]*\]?\s*/gi,
      /^\[?\s*Descrição Completa[^\]]*\]?\s*/gi,
      /^\[?\s*Description.*palavras.*Português\]?\s*/gi,
      
      // Russian patterns (Русский)
      /^\[?\s*ПОЛНОЕ ОПИСАНИЕ[^\]]*\]?\s*/gi,
      /^\[?\s*Полное описание[^\]]*\]?\s*/gi,
      /^\[?\s*Description.*слов.*Русск\]?\s*/gi,
      
      // Arabic patterns (العربية)
      /^\[?\s*الوصف الكامل[^\]]*\]?\s*/gi,
      /^\[?\s*وصف[^\]]*العربية\]?\s*/gi,
      
      // Turkish patterns (Türkçe)
      /^\[?\s*TAM AÇIKLAMA[^\]]*\]?\s*/gi,
      /^\[?\s*AÇIKLAMA[^\]]*Türkçe\]?\s*/gi,
      /^\[?\s*Tam Açıklama[^\]]*\]?\s*/gi,
      
      // Polish patterns (Polski)
      /^\[?\s*PEŁNY OPIS[^\]]*\]?\s*/gi,
      /^\[?\s*Description.*słów.*polski\]?\s*/gi,
      
      // Dutch patterns (Nederlands)
      /^\[?\s*VOLLEDIGE BESCHRIJVING[^\]]*\]?\s*/gi,
      /^\[?\s*Description.*woorden.*Nederlands\]?\s*/gi,
      
      // Swedish patterns (Svenska)
      /^\[?\s*FULLSTÄNDIG BESKRIVNING[^\]]*\]?\s*/gi,
      
      // Greek patterns (Ελληνικά)
      /^\[?\s*ΠΛΗΣΙΑΣΙΑΤΗ ΠΕΡΙΓΡΑΦΗ[^\]]*\]?\s*/gi,
      
      // Chinese patterns (中文)
      /^\[?\s*完整描述[^\]]*\]?\s*/gi,
      /^\[?\s*FULL DESCRIPTION[^\]]*中文\]?\s*/gi,
      
      // Japanese patterns (日本語)
      /^\[?\s*完全な説明[^\]]*\]?\s*/gi,
      
      // Korean patterns (한국어)
      /^\[?\s*전체 설명[^\]]*\]?\s*/gi,
      
      // Hindi patterns (हिन्दी)
      /^\[?\s*पूर्ण विवरण[^\]]*\]?\s*/gi,
      
      // Generic patterns that catch instruction-like text in ANY language
      /^\[?\s*HERE\s*-\s*\d+[^\]]*\]?\s*/gi,
      /^\[?\s*HERE\s*-\s*\d+\s*words[^\]]*\]?\s*/gi,
      /^\[?\s*FULL[^\]]*\d+\s*words[^\]]*\]?\s*/gi,
      /^\[?\s*\d+[^\]]*words[^\]]*\]?\s*/gi,
      /^\[?\s*\d+[^\]]*Wörter[^\]]*\]?\s*/gi,
      /^\[?\s*\d+[^\]]*mots[^\]]*\]?\s*/gi,
      /^\[?\s*\d+[^\]]*palabras[^\]]*\]?\s*/gi,
      /^\[?\s*\d+[^\]]*parole[^\]]*\]?\s*/gi,
      /^\[?\s*\d+[^\]]*palabras[^\]]*\]?\s*/gi,
      /^\[?\s*\d+[^\]]*слов[^\]]*\]?\s*/gi,
      /^\[?\s*\d+[^\]]*كلمة[^\]]*\]?\s*/gi,
      /^\[?\s*\d+[^\]]*kelime[^\]]*\]?\s*/gi,
      /^\[?\s*DESCRIPTION[^\]]*CHARACTER[^\]]*\]?\s*/gi,
      /^\[?\s*META[^\]]*\d+[^\]]*\]?\s*/gi,
      
      // Catch leading/trailing brackets
      /^\[+\s*/,
      /\s*\]+$/,
    ];

    const cursor = collection.find({ descriptions: { $exists: true, $ne: null } });
    const docs = await cursor.toArray();
    
    if (docs.length === 0) return;
    
    let cleaned = 0;
    for (const doc of docs) {
      let changed = false;

      if (doc.descriptions && typeof doc.descriptions === 'object') {
        for (const lang of Object.keys(doc.descriptions)) {
          const desc = doc.descriptions[lang];
          
          // Handle BOTH formats:
          // 1. Object format: { full: string, meta: string }
          // 2. Simple string format: "string"
          
          if (desc && typeof desc === 'object' && desc.full && typeof desc.full === 'string') {
            // Object format with .full property
            const original = desc.full;
            let text = original;

            // Apply all cleanup patterns
            for (const pattern of placeholderPatterns) {
              text = text.replace(pattern, '').trim();
            }

            if (text !== original && text.length > 0) {
              doc.descriptions[lang].full = text;
              changed = true;
              logger.log(`🧹 Cleanup: Removed placeholder from "${doc.name}" (${lang})`);
            }
          } else if (typeof desc === 'string') {
            // Simple string format
            const original = desc;
            let text = original;

            // Apply all cleanup patterns
            for (const pattern of placeholderPatterns) {
              text = text.replace(pattern, '').trim();
            }

            if (text !== original && text.length > 0) {
              doc.descriptions[lang] = text;
              changed = true;
              logger.log(`🧹 Cleanup: Removed placeholder from "${doc.name}" (${lang})`);
            }
          }
        }
      }

      if (changed) {
        await collection.updateOne({ _id: doc._id }, { $set: { descriptions: doc.descriptions } });
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.log(`✅ Cleaned ${cleaned} stations of placeholder text`);
    }
  } catch (error) {
    logger.log('⚠️ Placeholder cleanup failed (non-critical):', error);
  }
}

// Seed default translation languages if database is empty
async function seedDefaultLanguages() {
  try {
    const count = await TranslationLanguage.countDocuments();
    
    if (count === 0) {
      logger.log('🌱 Seeding default translation languages...');
      
      const defaultLanguages = [
        { code: 'en', name: 'English', isEnabled: true, isDefault: true },
        { code: 'tr', name: 'Turkish', isEnabled: true, isDefault: false },
        { code: 'es', name: 'Spanish', isEnabled: true, isDefault: false },
        { code: 'fr', name: 'French', isEnabled: true, isDefault: false },
        { code: 'de', name: 'German', isEnabled: true, isDefault: false },
        { code: 'ar', name: 'Arabic', isEnabled: true, isDefault: false },
        { code: 'it', name: 'Italian', isEnabled: true, isDefault: false },
        { code: 'pt', name: 'Portuguese', isEnabled: true, isDefault: false },
        { code: 'ru', name: 'Russian', isEnabled: true, isDefault: false },
        { code: 'zh', name: 'Chinese', isEnabled: true, isDefault: false },
        { code: 'ja', name: 'Japanese', isEnabled: true, isDefault: false },
        { code: 'ko', name: 'Korean', isEnabled: true, isDefault: false }
      ];

      await TranslationLanguage.insertMany(defaultLanguages);
      logger.log(`✅ Seeded ${defaultLanguages.length} default translation languages`);
    }
  } catch (error) {
    logger.log('⚠️ Language seeding failed (non-critical):', error);
  }
}

export async function connectToMongoDB() {
  if (isConnected) {
    return;
  }

  const isProd = process.env.NODE_ENV === 'production';

  try {
    await mongoose.connect(MONGODB_URI, {
      // Connection pool: default 5 is too low for heavy startup warmup
      maxPoolSize: isProd ? 25 : 10,
      minPoolSize: isProd ? 5 : 2,
      // Timeout settings: production needs more time for cold starts
      serverSelectionTimeoutMS: isProd ? 30000 : 15000,
      socketTimeoutMS: isProd ? 60000 : 45000,
      connectTimeoutMS: isProd ? 30000 : 15000,
      // Buffer queries while reconnecting (don't fail immediately on transient disconnect)
      bufferCommands: true,
      // Use IPv4 to avoid IPv6 routing issues on some cloud providers
      family: 4,
      // Heartbeat to keep connection alive
      heartbeatFrequencyMS: 10000,
    });
    isConnected = true;
    logger.log('✅ MongoDB: Connected successfully');
    
    // Seed default languages after connection (this is critical, so we await it)
    await seedDefaultLanguages();
    
    // Clean up any placeholder text from existing descriptions in BACKGROUND (non-blocking)
    // This runs async without blocking the port binding
    cleanupDescriptionPlaceholders().catch(err => 
      logger.log('⚠️ Background cleanup error:', err)
    );
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    logger.log('💡 MongoDB: Using in-memory fallback for development');
    // Don't throw error, let app continue with basic functionality
  }
}

// Re-export User model for deployment compatibility
export { User } from '../shared/mongo-schemas';

export default mongoose;
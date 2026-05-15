import mongoose from 'mongoose';
import { TranslationLanguage } from '@workspace/db-shared/mongo-schemas';
import { logger } from './utils/logger';

// MongoDB connection string - use in-memory database for development
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/radiostation-dev';

logger.log('🔗 MongoDB: Connecting to', MONGODB_URI.replace(/\/\/.*@/, '//<credentials>@'));

let isConnected = false;
let listenersRegistered = false;

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

    const cursor = collection.find({ descriptions: { $exists: true, $ne: null } }).batchSize(500);
    
    let cleaned = 0;
    const bulkOps: any[] = [];

    for await (const doc of cursor) {
      let changed = false;

      if (doc.descriptions && typeof doc.descriptions === 'object' && doc.descriptions !== null) {
        for (const lang of Object.keys(doc.descriptions)) {
          const desc = doc.descriptions[lang];
          
          if (desc && typeof desc === 'object' && desc !== null && desc.full && typeof desc.full === 'string') {
            const original = desc.full;
            let text = original;
            for (const pattern of placeholderPatterns) {
              text = text.replace(pattern, '').trim();
            }
            if (text !== original && text.length > 0) {
              doc.descriptions[lang].full = text;
              changed = true;
            }
          } else if (typeof desc === 'string') {
            const original = desc;
            let text = original;
            for (const pattern of placeholderPatterns) {
              text = text.replace(pattern, '').trim();
            }
            if (text !== original && text.length > 0) {
              doc.descriptions[lang] = text;
              changed = true;
            }
          }
        }
      }

      if (changed) {
        bulkOps.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { descriptions: doc.descriptions } } } });
        cleaned++;
        if (bulkOps.length >= 500) {
          await collection.bulkWrite(bulkOps, { ordered: false });
          bulkOps.length = 0;
        }
      }
    }

    if (bulkOps.length > 0) {
      await collection.bulkWrite(bulkOps, { ordered: false });
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

let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempt = 0;
let reconnectInProgress = false;
const MAX_BACKOFF_MS = 60_000;

function scheduleReconnect(reason: string) {
  if (reconnectTimer || reconnectInProgress) return;
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) return;

  reconnectAttempt++;
  // attempt=1 → 1s, 2 → 2s, 3 → 4s, … capped at 60s
  const delay = Math.min(1000 * Math.pow(2, Math.min(reconnectAttempt - 1, 6)), MAX_BACKOFF_MS);
  logger.error(`🔁 MongoDB reconnect scheduled in ${delay}ms (attempt ${reconnectAttempt}, reason: ${reason})`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
      reconnectAttempt = 0;
      return;
    }
    reconnectInProgress = true;
    try {
      if (mongoose.connection.readyState !== 0) {
        try { await mongoose.disconnect(); } catch {}
      }
      await doConnect();
      logger.log(`✅ MongoDB: Reconnect succeeded on attempt ${reconnectAttempt}`);
      reconnectAttempt = 0;
    } catch (err: any) {
      logger.error(`❌ MongoDB reconnect attempt ${reconnectAttempt} failed: ${err?.message || err}`);
      reconnectInProgress = false;
      scheduleReconnect('retry-after-failure');
      return;
    }
    reconnectInProgress = false;
  }, delay);
}

// CRITICAL: bufferCommands=false prevents Mongoose from queueing operations
// in memory while disconnected. With buffering ON, every API request that hits
// Mongoose during an outage piles up — RSS climbs and the process eventually
// OOMs. With buffering OFF, queries fail fast (caught by the circuit breaker)
// and memory stays flat.
mongoose.set('bufferCommands', false);

async function doConnect() {
  const isProd = process.env.NODE_ENV === 'production';
  // INCIDENT 2026-05-14 round 8 — failover hardening.
  // Previous config (maxPoolSize:100, socketTimeoutMS:45s, serverSelectionTimeoutMS:30s,
  // no readPreference) turned a brief Atlas primary failover at 11:00:22 UTC into a
  // 10-minute error storm: hundreds of stuck connections (each held 45s),
  // 30s-per-op selection waits, and ALL reads forced onto a stepping-down primary.
  // The new config:
  //   - readPreference: 'primaryPreferred' lets reads fall back to a secondary
  //     during a primary blip instead of hard-failing.
  //   - maxPoolSize 30 keeps us well below Atlas M10 pool budget while supporting
  //     observed peak concurrency (~13). 100 was overkill and made stuck-pool
  //     amplification possible.
  //   - socketTimeoutMS 15s + serverSelectionTimeoutMS 8s + waitQueueTimeoutMS 5s
  //     means a degraded cluster fails fast (5–15s, not 45s), connections free
  //     up quickly, and the pool never accumulates stuck handles.
  //   - heartbeatFrequencyMS 5s (was 10s) so the driver notices topology
  //     changes (failover) twice as fast.
  // INCIDENT 2026-05-15 v3 — USER DIRECTIVE: maximise every timeout knob so
  // boot warmup, sync ingest, and admin aggregations never get cut off by a
  // tight client-side budget. Atlas M10 happily handles 100 connections (cap
  // is 1500 cluster-wide) and 2-minute socket waits; the previous tight
  // values were aimed at "fail fast during failover" but caused more harm
  // than good during normal boot. Generous values here + soft-fail catches
  // in route handlers give the same UX without the timeout cascade.
  // INCIDENT 2026-05-15 v5 — pool-size right-sizing (timeouts UNCHANGED).
  // Each MongoDB driver TLS connection costs ~5–10 MB of native heap (BSON
  // buffers, OpenSSL session state, write batch staging). With M10's 3-node
  // replica set the driver opens a connection per node per pool slot, so
  // maxPool=100 / minPool=10 reserves 30 idle TLS sockets at boot worth
  // 150–300 MB native — visible in production as a 400–600 MB native
  // baseline. Pool size is INDEPENDENT of timeout budget: the long
  // serverSelection / socket / waitQueue values stay, we just stop
  // pre-allocating sockets nobody uses. Observed peak concurrency on this
  // workload is < 15 inflight ops, so maxPool=30 / minPool=2 keeps headroom
  // (2x peak) and frees ~250 MB native vs the previous setting.
  await mongoose.connect(MONGODB_URI, {
    maxPoolSize: isProd ? 30 : 10,
    minPoolSize: isProd ? 2 : 2,
    serverSelectionTimeoutMS: isProd ? 60000 : 30000,
    socketTimeoutMS: isProd ? 120000 : 60000,
    connectTimeoutMS: isProd ? 60000 : 30000,
    waitQueueTimeoutMS: isProd ? 60000 : 30000,
    bufferCommands: false,
    maxIdleTimeMS: 30000,
    family: 4,
    heartbeatFrequencyMS: isProd ? 5000 : 10000,
    retryWrites: true,
    retryReads: true,
    readPreference: 'primaryPreferred',
    w: 'majority',
  });
}

export function getMongoHealth() {
  return {
    readyState: mongoose.connection.readyState,
    isConnected,
    reconnectAttempt,
    reconnectScheduled: reconnectTimer !== null,
  };
}

export async function connectToMongoDB() {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }

  if (!listenersRegistered) {
    listenersRegistered = true;
    mongoose.connection.on('error', (err) => {
      logger.error('❌ MongoDB connection error (runtime):', err.message);
      // Some failure modes (half-open sockets, server selection failures) emit
      // 'error' but never 'disconnected'. Schedule a reconnect anyway so we
      // don't sit in a stale state forever. scheduleReconnect() is idempotent.
      if (mongoose.connection.readyState !== 1 && mongoose.connection.readyState !== 2) {
        scheduleReconnect('error-event');
      }
    });
    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      logger.error('⚠️ MongoDB disconnected — scheduling app-level reconnect');
      scheduleReconnect('disconnected-event');
    });
    mongoose.connection.on('close', () => {
      isConnected = false;
      logger.error('⚠️ MongoDB connection closed — scheduling app-level reconnect');
      scheduleReconnect('close-event');
    });
    mongoose.connection.on('reconnected', () => {
      isConnected = true;
      reconnectAttempt = 0;
      logger.log('✅ MongoDB reconnected successfully');
    });
    mongoose.connection.on('connected', () => {
      isConnected = true;
      reconnectAttempt = 0;
    });
  }

  try {
    await doConnect();
    isConnected = true;
    reconnectAttempt = 0;
    logger.log('✅ MongoDB: Connected successfully');
    // Identity log — used to detect multi-cluster / wrong-DB writes for AuthToken
    logger.log(`🔗 Mongo identity host=${mongoose.connection.host} port=${(mongoose.connection as any).port} db=${mongoose.connection.name}`);
    await seedDefaultLanguages();
  } catch (error: any) {
    // FAIL-FAST: with bufferCommands=false, the warmup tasks downstream of
    // connectToMongoDB() will throw on every query if we let boot continue
    // here. That triggered a silent 2s container restart loop on Railway
    // when Atlas was unreachable (IP allowlist / paused cluster / wrong
    // URI) — the real reason was buried under hundreds of "before initial
    // connection is complete" errors. Re-throw so the operator sees the
    // actual connection failure on the very first log line.
    const msg = error?.message || String(error);
    console.error('❌ FATAL: MongoDB initial connection failed:', msg);
    console.error('💡 Check on Railway / Atlas:');
    console.error('   1. Env var MONGODB_URI is set and correct');
    console.error('   2. Atlas Network Access allowlist includes the deploy host (or 0.0.0.0/0 for testing)');
    console.error('   3. Atlas cluster is not paused (M0 free tier auto-pauses after 60 idle days)');
    // Still schedule background reconnect for the (unlikely) case the
    // process is kept alive by an orchestrator that ignores exit codes.
    scheduleReconnect('initial-connect-failed');
    throw new Error(`MongoDB initial connection failed: ${msg}`);
  }
}

// Re-export User model for deployment compatibility
export { User } from '@workspace/db-shared/mongo-schemas';

export default mongoose;
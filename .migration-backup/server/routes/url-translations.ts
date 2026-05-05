import { Router, Request, Response } from 'express';
import { UrlTranslation } from '../../shared/mongo-schemas';
import { URL_TRANSLATIONS } from '../../shared/url-translations';
import { SEO_LANGUAGES } from '../../shared/seo-config';
import OpenAI from 'openai';

const router = Router();

// Initialize OpenAI client
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

// Middleware to check if user is admin (using req.session.adminAuth for admin sessions)
const requireAdmin = async (req: Request, res: Response, next: Function) => {
  const session = req.session as any;
  
  if (!session || !session.adminAuth) {
    return res.status(401).json({ 
      error: 'Admin authentication required',
      message: 'You must be logged in as an admin to access this resource.'
    });
  }

  try {
    // Check if admin session is valid
    if (session.adminAuth.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Admin access required',
        message: 'You do not have permission to access this resource. Admin privileges required.'
      });
    }

    // Store admin info for easier access
    (req.session as any).adminUser = session.adminAuth;
    next();
  } catch (error) {
    return res.status(500).json({ error: 'Authentication error' });
  }
};

// Get all available English paths (from static file)
router.get('/available-paths', requireAdmin, async (req: Request, res: Response) => {
  try {
    // Get all unique English paths from the static URL_TRANSLATIONS
    const pathsSet = new Set<string>();
    
    // Iterate through all languages to collect all unique paths
    Object.values(URL_TRANSLATIONS).forEach((translations: any) => {
      Object.keys(translations).forEach(path => {
        pathsSet.add(path);
      });
    });
    
    const paths = Array.from(pathsSet).sort();
    res.json(paths);
  } catch (error: any) {
    console.error('Error fetching available paths:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch available paths' });
  }
});

// Get all URL translations from database
router.get('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const translations = await UrlTranslation.find({ isActive: true }).sort({ languageCode: 1, englishPath: 1 });
    res.json(translations);
  } catch (error: any) {
    console.error('Error fetching URL translations:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch URL translations' });
  }
});

// Get URL translations for a specific language
router.get('/:languageCode', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { languageCode } = req.params;
    const translations = await UrlTranslation.find({ 
      languageCode, 
      isActive: true 
    }).sort({ englishPath: 1 });
    
    res.json(translations);
  } catch (error: any) {
    console.error('Error fetching URL translations for language:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch URL translations' });
  }
});

// Bulk save URL translations
router.post('/bulk', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { translations } = req.body;
    
    if (!Array.isArray(translations)) {
      return res.status(400).json({ message: 'Translations must be an array' });
    }
    
    // Validate each translation
    for (const translation of translations) {
      if (!translation.languageCode || !translation.englishPath || !translation.translatedPath) {
        return res.status(400).json({ 
          message: 'Each translation must have languageCode, englishPath, and translatedPath' 
        });
      }
    }
    
    // Use bulkWrite for efficient upserts
    const operations = translations.map(translation => ({
      updateOne: {
        filter: { 
          languageCode: translation.languageCode, 
          englishPath: translation.englishPath 
        },
        update: {
          $set: {
            translatedPath: translation.translatedPath,
            isActive: true,
            notes: translation.notes || '',
            updatedAt: new Date()
          }
        },
        upsert: true
      }
    }));
    
    const result = await UrlTranslation.bulkWrite(operations);
    
    console.log(`✅ Saved ${result.upsertedCount + result.modifiedCount} URL translations`);
    
    // Clear the cache so fresh data is loaded
    const { performanceCache } = await import('../performance-cache');
    performanceCache.clearUrlTranslations();
    
    // Reload URL translations into memory
    const { loadDatabaseUrlTranslations } = await import('../../shared/url-translations');
    await loadDatabaseUrlTranslations();
    
    res.json({ 
      message: 'URL translations saved successfully',
      upserted: result.upsertedCount,
      modified: result.modifiedCount
    });
  } catch (error: any) {
    console.error('Error saving URL translations:', error);
    res.status(500).json({ message: error.message || 'Failed to save URL translations' });
  }
});

// Auto-translate using OpenAI
router.post('/auto-translate', requireAdmin, async (req: Request, res: Response) => {
  try {
    if (!openai) {
      return res.status(500).json({ 
        message: 'OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.' 
      });
    }
    
    const { languageCode, paths } = req.body;
    
    if (!languageCode) {
      return res.status(400).json({ message: 'Language code is required' });
    }
    
    if (!Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ message: 'Paths must be a non-empty array' });
    }
    
    // Find the language name
    const language = SEO_LANGUAGES.find((lang: { code: string; name: string }) => lang.code === languageCode);
    if (!language) {
      return res.status(400).json({ message: 'Invalid language code' });
    }
    
    // Prepare the translation request
    const pathsToTranslate = paths.join(', ');
    
    const prompt = `You are a professional translator specializing in URL slugs for websites. 
    
Translate the following English URL path segments into ${language.name} (${languageCode}). 
These will be used in website URLs, so they must:
- Be lowercase
- Use hyphens (-) instead of spaces
- Be short and SEO-friendly
- Avoid special characters that don't work well in URLs
- Be natural and commonly used terms in ${language.name}

English paths to translate: ${pathsToTranslate}

Respond with ONLY a JSON object where keys are the English paths and values are the translated paths.
Example format: {"about": "uber", "stations": "sender", "genres": "genres"}`;

    console.log(`🤖 OpenAI: Translating ${paths.length} paths to ${language.name}...`);
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: 'You are a professional translator specializing in SEO-friendly URL slugs. Always respond with valid JSON only.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });
    
    const translatedContent = completion.choices[0]?.message?.content;
    if (!translatedContent) {
      throw new Error('No translation response from OpenAI');
    }
    
    const translations = JSON.parse(translatedContent);
    
    console.log(`✅ OpenAI: Successfully translated ${Object.keys(translations).length} paths`);
    
    res.json({ 
      translations,
      language: language.name,
      languageCode
    });
  } catch (error: any) {
    console.error('Error auto-translating:', error);
    res.status(500).json({ 
      message: error.message || 'Failed to auto-translate',
      details: error.response?.data || error.message 
    });
  }
});

// Delete a URL translation
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await UrlTranslation.findByIdAndDelete(id);
    
    if (!result) {
      return res.status(404).json({ message: 'URL translation not found' });
    }
    
    console.log(`🗑️ Deleted URL translation: ${result.languageCode}/${result.englishPath}`);
    
    res.json({ message: 'URL translation deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting URL translation:', error);
    res.status(500).json({ message: error.message || 'Failed to delete URL translation' });
  }
});

// Get translation statistics
router.get('/stats/overview', requireAdmin, async (req: Request, res: Response) => {
  try {
    const totalTranslations = await UrlTranslation.countDocuments({ isActive: true });
    
    // Get count by language
    const byLanguage = await UrlTranslation.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$languageCode', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    
    // Get count by path
    const byPath = await UrlTranslation.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$englishPath', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    res.json({
      totalTranslations,
      byLanguage,
      byPath,
      totalLanguages: byLanguage.length
    });
  } catch (error: any) {
    console.error('Error fetching URL translation stats:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch stats' });
  }
});

export default router;

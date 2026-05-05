import { TranslationMetadata } from '../shared/mongo-schemas';
import { logger } from '../utils/logger';

export class TranslationVersionService {
  private static SCOPE = 'global';

  private static async ensureMetadataExists(): Promise<void> {
    try {
      const existing = await TranslationMetadata.findOne({ scope: this.SCOPE });
      if (!existing) {
        await TranslationMetadata.create({
          scope: this.SCOPE,
          languagesVersion: 1,
          lastBumpedAt: new Date(),
          notes: 'Auto-created translation metadata'
        });
        logger.log('✅ Translation metadata initialized with version 1');
      }
    } catch (error) {
      logger.log('⚠️  Translation metadata may already exist or creation failed:', error);
    }
  }

  static async bumpVersion(notes?: string): Promise<{ version: number; success: boolean }> {
    try {
      await this.ensureMetadataExists();

      const metadata = await TranslationMetadata.findOneAndUpdate(
        { scope: this.SCOPE },
        { 
          $inc: { languagesVersion: 1 },
          $set: { 
            lastBumpedAt: new Date(),
            updatedAt: new Date(),
            ...(notes && { notes })
          }
        },
        { 
          new: true,
          upsert: true
        }
      );

      if (!metadata) {
        logger.log('❌ Failed to bump translation version');
        return { version: 0, success: false };
      }

      logger.log(`🔄 Translation version bumped to ${metadata.languagesVersion}`);
      return { version: metadata.languagesVersion, success: true };
    } catch (error) {
      logger.log('❌ Error bumping translation version:', error);
      return { version: 0, success: false };
    }
  }

  static async getCurrentVersion(): Promise<number> {
    try {
      await this.ensureMetadataExists();
      
      const metadata = await TranslationMetadata.findOne({ scope: this.SCOPE });
      return metadata?.languagesVersion || 1;
    } catch (error) {
      logger.log('⚠️  Error fetching translation version:', error);
      return 1;
    }
  }

  static async getMetadata() {
    try {
      await this.ensureMetadataExists();
      
      const metadata = await TranslationMetadata.findOne({ scope: this.SCOPE }).lean();
      return metadata || {
        scope: this.SCOPE,
        languagesVersion: 1,
        lastBumpedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };
    } catch (error) {
      logger.log('⚠️  Error fetching translation metadata:', error);
      return {
        scope: this.SCOPE,
        languagesVersion: 1,
        lastBumpedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
  }

  static async bumpVersionViaApi(adminToken?: string): Promise<{ success: boolean; version: number }> {
    try {
      const port = process.env.PORT || '5000';
      const baseUrl = process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : process.env.RAILWAY_PUBLIC_DOMAIN
          ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
          : `http://localhost:${port}`;

      const response = await fetch(`${baseUrl}/api/admin/translation-metadata/bump`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken && { 'Authorization': `Bearer ${adminToken}` })
        },
        credentials: 'include'
      });

      if (!response.ok) {
        logger.log('❌ Failed to bump version via API:', response.status);
        return { success: false, version: 0 };
      }

      const data = await response.json();
      logger.log(`✅ Version bumped via API to ${data.version}`);
      return { success: true, version: data.version };
    } catch (error) {
      logger.log('❌ Error calling bump API:', error);
      return { success: false, version: 0 };
    }
  }
}

export async function bumpTranslationVersion(notes?: string) {
  return TranslationVersionService.bumpVersion(notes);
}

export async function getCurrentTranslationVersion() {
  return TranslationVersionService.getCurrentVersion();
}

export async function getTranslationMetadata() {
  return TranslationVersionService.getMetadata();
}

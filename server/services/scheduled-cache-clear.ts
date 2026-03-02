import cron from 'node-cron';
import axios from 'axios';
import { logger } from '../utils/logger';
import { performanceCache } from '../performance-cache';
import { PrecomputedStationsService } from './precomputed-stations';
import { TranslationSyncService } from './translation-sync';

interface CloudflarePurgeResult {
  success: boolean;
  errors?: string[];
  messages?: string[];
}

interface CacheClearResult {
  timestamp: Date;
  serverCache: {
    seoHtmlCleared: number;
    pageDataCleared: number;
  };
  cloudflare: {
    success: boolean;
    message: string;
  };
}

export class ScheduledCacheClearService {
  private static instance: ScheduledCacheClearService;
  private isInitialized = false;
  private lastClearResult: CacheClearResult | null = null;

  private constructor() {}

  public static getInstance(): ScheduledCacheClearService {
    if (!ScheduledCacheClearService.instance) {
      ScheduledCacheClearService.instance = new ScheduledCacheClearService();
    }
    return ScheduledCacheClearService.instance;
  }

  public initialize(): void {
    if (this.isInitialized) {
      logger.log('⏰ Scheduled cache clear service already initialized');
      return;
    }

    logger.log('⏰ Initializing scheduled cache clear service...');
    
    cron.schedule('0 3 * * *', async () => {
      logger.log('🌙 Running scheduled nightly SEO cache clear at 3:00 AM...');
      await this.clearAllSeoCaches();
    }, {
      timezone: 'Europe/Berlin'
    });

    cron.schedule('30 4 * * 0', async () => {
      logger.log('🔄 Running weekly precomputed stations cache refresh (Sunday 4:30 AM)...');
      try {
        await PrecomputedStationsService.refreshAllCountries();
        logger.log('✅ Precomputed stations cache refreshed successfully');
      } catch (error) {
        logger.error('❌ Failed to refresh precomputed stations cache:', error);
      }
    }, {
      timezone: 'Europe/Berlin'
    });

    cron.schedule('0 5 1 * *', async () => {
      logger.log('🌍 Running monthly translation key scan (1st of month at 5:00 AM)...');
      try {
        const result = await TranslationSyncService.scanForNewKeys();
        logger.log(`✅ Monthly key scan complete: ${result.keysAdded} new keys found`);
      } catch (error) {
        logger.error('❌ Failed to run monthly translation scan:', error);
      }
    }, {
      timezone: 'Europe/Berlin'
    });

    this.isInitialized = true;
    logger.log('✅ Scheduled cache clear service initialized — SEO daily 3:00, Precomputed Sunday 4:30, Translations monthly 1st 5:00 (Europe/Berlin)');
  }

  public async clearAllSeoCaches(): Promise<CacheClearResult> {
    const timestamp = new Date();
    logger.log(`🧹 Starting SEO cache clear at ${timestamp.toISOString()}`);

    const serverResult = performanceCache.clearSeoCaches();
    
    const cloudflareResult = await this.purgeCloudflareCache();

    const result: CacheClearResult = {
      timestamp,
      serverCache: serverResult,
      cloudflare: cloudflareResult
    };

    this.lastClearResult = result;

    logger.log(`✅ SEO cache clear completed:
      - Server: ${serverResult.seoHtmlCleared} HTML + ${serverResult.pageDataCleared} page data entries
      - Cloudflare: ${cloudflareResult.success ? 'Success' : 'Failed'} - ${cloudflareResult.message}`);

    return result;
  }

  private async purgeCloudflareCache(): Promise<{ success: boolean; message: string }> {
    const zoneId = process.env.CLOUDFLARE_ZONE_ID;
    const apiKey = process.env.CLOUDFLARE_API_KEY;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!zoneId || !apiKey) {
      logger.log('⚠️ Cloudflare credentials not configured, skipping Cloudflare cache purge');
      return {
        success: false,
        message: 'Cloudflare credentials not configured'
      };
    }

    try {
      logger.log('🌐 Purging Cloudflare cache...');
      
      const response = await axios.post<CloudflarePurgeResult>(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
        {
          purge_everything: true
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (response.data.success) {
        logger.log('✅ Cloudflare cache purged successfully');
        return {
          success: true,
          message: 'Cloudflare cache purged successfully'
        };
      } else {
        const errorMsg = response.data.errors?.join(', ') || 'Unknown error';
        logger.log(`❌ Cloudflare cache purge failed: ${errorMsg}`);
        return {
          success: false,
          message: `Cloudflare purge failed: ${errorMsg}`
        };
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.errors?.[0]?.message || error.message || 'Unknown error';
      logger.log(`❌ Cloudflare cache purge error: ${errorMsg}`);
      return {
        success: false,
        message: `Cloudflare purge error: ${errorMsg}`
      };
    }
  }

  public async purgeCloudflareUrls(urls: string[]): Promise<{ success: boolean; message: string }> {
    const zoneId = process.env.CLOUDFLARE_ZONE_ID;
    const apiKey = process.env.CLOUDFLARE_API_KEY;

    if (!zoneId || !apiKey) {
      return {
        success: false,
        message: 'Cloudflare credentials not configured'
      };
    }

    if (urls.length === 0) {
      return {
        success: false,
        message: 'No URLs provided'
      };
    }

    if (urls.length > 30) {
      return {
        success: false,
        message: 'Maximum 30 URLs per purge request'
      };
    }

    try {
      logger.log(`🌐 Purging ${urls.length} URLs from Cloudflare cache...`);
      
      const response = await axios.post<CloudflarePurgeResult>(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
        {
          files: urls
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (response.data.success) {
        logger.log(`✅ Purged ${urls.length} URLs from Cloudflare cache`);
        return {
          success: true,
          message: `Purged ${urls.length} URLs successfully`
        };
      } else {
        const errorMsg = response.data.errors?.join(', ') || 'Unknown error';
        return {
          success: false,
          message: `Cloudflare purge failed: ${errorMsg}`
        };
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.errors?.[0]?.message || error.message || 'Unknown error';
      return {
        success: false,
        message: `Cloudflare purge error: ${errorMsg}`
      };
    }
  }

  public getLastClearResult(): CacheClearResult | null {
    return this.lastClearResult;
  }

  public getStatus(): { initialized: boolean; lastClear: CacheClearResult | null; nextScheduledClear: string } {
    const now = new Date();
    const berlinOffset = this.getBerlinOffset();
    const nextClear = new Date();
    nextClear.setHours(3, 0, 0, 0);
    
    if (nextClear <= now) {
      nextClear.setDate(nextClear.getDate() + 1);
    }

    return {
      initialized: this.isInitialized,
      lastClear: this.lastClearResult,
      nextScheduledClear: nextClear.toISOString()
    };
  }

  private getBerlinOffset(): number {
    const jan = new Date(new Date().getFullYear(), 0, 1);
    const jul = new Date(new Date().getFullYear(), 6, 1);
    const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
    const isDST = new Date().getTimezoneOffset() < stdOffset;
    return isDST ? 2 : 1;
  }
}

export const scheduledCacheClearService = ScheduledCacheClearService.getInstance();

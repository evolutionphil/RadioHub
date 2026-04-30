import { logger } from '../utils/logger';
import axios from 'axios';
import { IndexNowLog } from '../../shared/mongo-schemas';

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const API_KEY = '5ace9b68e3a60b85c7c5a61f1226a652';
// Production domain only
const ALLOWED_HOSTS = ['themegaradio.com'];
const PRIMARY_HOST = 'themegaradio.com'; // Default for helper methods
const MAX_URLS_PER_REQUEST = 10000;

type IndexNowTrigger = 'manual' | 'station-update' | 'sitemap-regen' | 'sync-complete';

interface IndexNowResponse {
  success: boolean;
  statusCode?: number;
  message?: string;
  error?: string;
}

export class IndexNowService {
  private static async submitRequest(urls: string[], trigger: IndexNowTrigger, retryCount = 0): Promise<IndexNowResponse> {
    const startTime = Date.now();
    let host = '';
    
    try {
      // Determine which host to use based on the URLs being submitted
      const firstUrl = urls[0];
      const urlObj = new URL(firstUrl);
      host = urlObj.hostname.replace('www.', '');
      const keyLocation = `https://${host}/${API_KEY}.txt`;
      
      const payload = {
        host,
        key: API_KEY,
        keyLocation,
        urlList: urls
      };

      logger.log(`📡 IndexNow: Submitting ${urls.length} URLs to search engines...`);
      logger.log(`📡 IndexNow Payload:`, JSON.stringify(payload, null, 2));

      const response = await axios.post(INDEXNOW_ENDPOINT, payload, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        },
        validateStatus: () => true // Accept any status code
      });

      const statusCode = response.status;
      const responseTime = Date.now() - startTime;

      // Log to database AFTER getting response
      try {
        await IndexNowLog.create({
          timestamp: new Date(),
          host,
          urlCount: urls.length,
          status: (statusCode === 200 || statusCode === 202) ? 'success' : 'failed',
          statusCode,
          trigger,
          errorMessage: (statusCode !== 200 && statusCode !== 202) ? (response.data ? JSON.stringify(response.data) : 'Unknown error') : undefined,
          sampleUrls: urls.slice(0, 5),
          retryAttempt: retryCount,
          responseTime
        });
      } catch (dbError: any) {
        logger.log(`⚠️ IndexNow: Failed to log to database:`, dbError.message);
      }

      if (statusCode === 200) {
        logger.log(`✅ IndexNow: Successfully submitted ${urls.length} URLs (Status: ${statusCode})`);
        return { success: true, statusCode, message: 'URLs submitted successfully' };
      } else if (statusCode === 202) {
        logger.log(`✅ IndexNow: URLs accepted for processing (Status: ${statusCode})`);
        return { success: true, statusCode, message: 'URLs accepted for processing' };
      } else {
        const errorText = response.data ? JSON.stringify(response.data) : 'Unknown error';
        logger.log(`⚠️ IndexNow: Failed with status ${statusCode}: ${errorText}`);
        
        if (retryCount === 0) {
          logger.log(`🔄 IndexNow: Retrying submission (attempt 2/2)...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return this.submitRequest(urls, trigger, 1);
        }
        
        return { 
          success: false, 
          statusCode, 
          error: `Failed with status ${statusCode}: ${errorText}` 
        };
      }
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      logger.log(`❌ IndexNow: Error submitting URLs:`, error.message);
      
      // Log error to database
      try {
        await IndexNowLog.create({
          timestamp: new Date(),
          host: host || 'unknown',
          urlCount: urls.length,
          status: 'failed',
          trigger,
          errorMessage: error.message || 'Unknown error occurred',
          sampleUrls: urls.slice(0, 5),
          retryAttempt: retryCount,
          responseTime
        });
      } catch (dbError: any) {
        logger.log(`⚠️ IndexNow: Failed to log to database:`, dbError.message);
      }
      
      if (retryCount === 0) {
        logger.log(`🔄 IndexNow: Retrying after error (attempt 2/2)...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.submitRequest(urls, trigger, 1);
      }
      
      return { 
        success: false, 
        error: error.message || 'Unknown error occurred' 
      };
    }
  }

  static async submitToIndexNow(urls: string[], trigger: IndexNowTrigger = 'manual'): Promise<IndexNowResponse> {
    if (!urls || urls.length === 0) {
      logger.log(`⚠️ IndexNow: No URLs provided for submission`);
      return { success: false, error: 'No URLs provided' };
    }

    if (urls.length > MAX_URLS_PER_REQUEST) {
      logger.log(`⚠️ IndexNow: Too many URLs (${urls.length}). Maximum is ${MAX_URLS_PER_REQUEST}`);
      return { 
        success: false, 
        error: `Maximum ${MAX_URLS_PER_REQUEST} URLs allowed per request` 
      };
    }

    // Filter and group URLs by hostname (IndexNow requires all URLs in a batch to match the declared host)
    const urlsByHost = new Map<string, string[]>();
    
    urls.forEach(url => {
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.replace('www.', '');
        
        if (ALLOWED_HOSTS.includes(hostname)) {
          if (!urlsByHost.has(hostname)) {
            urlsByHost.set(hostname, []);
          }
          urlsByHost.get(hostname)!.push(url);
        }
      } catch {
        // Invalid URL, skip it
      }
    });

    if (urlsByHost.size === 0) {
      logger.log(`⚠️ IndexNow: No valid URLs for allowed hosts: ${ALLOWED_HOSTS.join(', ')}`);
      return { success: false, error: 'No valid URLs for allowed hosts' };
    }

    // Submit each host's URLs separately
    const results: IndexNowResponse[] = [];
    
    for (const [host, hostUrls] of Array.from(urlsByHost.entries())) {
      logger.log(`📡 IndexNow: Submitting ${hostUrls.length} URLs for host: ${host}`);
      const result = await this.submitRequest(hostUrls, trigger);
      results.push(result);
    }

    // Return combined result
    const allSuccess = results.every(r => r.success);
    const totalUrls = Array.from(urlsByHost.values()).reduce((sum, arr) => sum + arr.length, 0);
    
    if (allSuccess) {
      return {
        success: true,
        message: `Successfully submitted ${totalUrls} URLs across ${urlsByHost.size} domain(s)`
      };
    } else {
      const failedHosts = Array.from(urlsByHost.keys()).filter((_, i) => !results[i].success);
      return {
        success: false,
        error: `Failed for domains: ${failedHosts.join(', ')}`
      };
    }
  }

  static async submitSingleUrl(url: string, trigger: IndexNowTrigger = 'manual'): Promise<IndexNowResponse> {
    return this.submitToIndexNow([url], trigger);
  }

  /**
   * ARCHITECT P0 fix (2026-04-30): IndexNow submissions MUST use the prefix-all
   * canonical (`/en/station/...`, `/en/genres/...`). Previously we sent the
   * legacy bare-slash URLs (`/station/`, `/genre/`), which 301-redirect to
   * `/en/...`. Bing/Yandex IndexNow treats the redirect target as the real
   * URL anyway, but submitting the redirect source counts toward the per-day
   * IndexNow quota and gets logged as `Redirected URL` in Bing Webmaster
   * Tools, polluting the dashboard. We now submit the canonical destination
   * directly.
   */
  static async submitStationUrls(stationSlugs: string[], host: string = PRIMARY_HOST, trigger: IndexNowTrigger = 'station-update'): Promise<IndexNowResponse> {
    const urls = stationSlugs.map(slug => `https://${host}/en/station/${slug}`);
    return this.submitToIndexNow(urls, trigger);
  }

  static async submitGenreUrls(genreSlugs: string[], host: string = PRIMARY_HOST, trigger: IndexNowTrigger = 'manual'): Promise<IndexNowResponse> {
    const urls = genreSlugs.map(slug => `https://${host}/en/genres/${slug}`);
    return this.submitToIndexNow(urls, trigger);
  }

  /**
   * ARCHITECT P0 fix (2026-04-30): only submit `/sitemap-index.xml` —
   * `/sitemap.xml` does not exist on this domain (we removed the legacy route
   * months ago). Submitting it logged daily 404s in Bing Webmaster Tools.
   */
  static async submitSitemaps(host: string = PRIMARY_HOST, trigger: IndexNowTrigger = 'sitemap-regen'): Promise<IndexNowResponse> {
    const sitemapUrls = [
      `https://${host}/sitemap-index.xml`,
    ];
    return this.submitToIndexNow(sitemapUrls, trigger);
  }
}

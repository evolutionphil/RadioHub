import { logger } from '../utils/logger';
import axios from 'axios';
import { IndexNowLog } from '@workspace/db-shared/mongo-schemas';
import { validateOutboundUrl } from '../utils/safe-fetch';

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
// IndexNow key. Backed by env (`INDEXNOW_API_KEY`); falls back to the legacy
// committed key only when env is not set, so existing deployments keep working
// during rotation. The key file at https://<host>/<KEY>.txt MUST contain this
// same value for IndexNow ownership verification — rotating it requires
// updating both the env var AND the .txt file served at the domain root.
const API_KEY = process.env.INDEXNOW_API_KEY || '5ace9b68e3a60b85c7c5a61f1226a652';
if (!process.env.INDEXNOW_API_KEY) {
  logger.log('⚠️ IndexNow: INDEXNOW_API_KEY env not set, using legacy committed key. Set the env var (and update the .txt key file at the domain root) to rotate.');
}
// Production domain only
const ALLOWED_HOSTS = ['themegaradio.com'];
const PRIMARY_HOST = 'themegaradio.com'; // Default for helper methods
const MAX_URLS_PER_REQUEST = 10000;

type IndexNowTrigger = 'manual' | 'station-update' | 'sitemap-regen' | 'sync-complete' | 'sitemap-diff';

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

      // SSRF guard the outbound endpoint and follow any redirects manually,
      // re-validating each hop. The endpoint is hardcoded so the risk surface
      // is small, but this keeps us aligned with the project SSRF rule.
      let currentEndpoint = INDEXNOW_ENDPOINT;
      let response: any = null;
      // Allow at most MAX_REDIRECTS hops AFTER the initial request, so the loop
      // body runs up to MAX_REDIRECTS+1 times (initial + N follows).
      const MAX_REDIRECTS = 3;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const guarded = await validateOutboundUrl(currentEndpoint);
        if (!guarded.ok) {
          throw new Error(`IndexNow outbound URL blocked by SSRF guard: ${guarded.reason}`);
        }
        response = await axios.post(currentEndpoint, payload, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          maxRedirects: 0,
          validateStatus: () => true // Accept any status code (incl. 3xx for manual follow)
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers?.['location'];
          if (!location) {
            // 3xx without Location header — treat as terminal so we don't loop.
            break;
          }
          if (hop === MAX_REDIRECTS) {
            throw new Error('IndexNow: too many redirects');
          }
          try {
            currentEndpoint = new URL(location, currentEndpoint).toString();
          } catch {
            throw new Error('IndexNow: malformed redirect Location');
          }
          continue;
        }
        break;
      }

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

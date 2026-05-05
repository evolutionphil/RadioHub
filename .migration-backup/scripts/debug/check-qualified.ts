import { performanceCache } from '../../server/performance-cache';
import { REQUIRED_STATION_SEO_KEYS, REQUIRED_HOMEPAGE_SEO_KEYS, hasCompleteSeoTranslations, ACTIVE_SITEMAP_LANGUAGES } from '../../shared/seo-config';

(async () => {
  for (const lang of ['tr','en','de','es','fr','ar']) {
    try {
      const t: any = await performanceCache.getTranslations(lang);
      const total = t ? Object.keys(t).length : 0;
      const all = [...REQUIRED_STATION_SEO_KEYS, ...REQUIRED_HOMEPAGE_SEO_KEYS];
      const missing = all.filter(k => !(typeof t?.[k] === 'string' && t[k].trim().length>0));
      console.log(`${lang}: total=${total} missing=${JSON.stringify(missing)} complete=${hasCompleteSeoTranslations(t)}`);
    } catch(e:any) { console.log(`${lang}: ERR ${e?.message||e}`); }
  }
  console.log('ACTIVE_SITEMAP_LANGUAGES count:', ACTIVE_SITEMAP_LANGUAGES.length);
  process.exit(0);
})();

import { useTranslation } from "@/hooks/useTranslation";
import { SeoHead } from "@/components/SeoHead";

export function About() {
  const { t } = useTranslation();
  
  return (
    <div>
      <SeoHead pageType="about" />
      
      <div className="relative flex h-[200px] items-center bg-[url('/assets/images/about-bg.webp')] bg-cover bg-center sm:h-[300px]">
        <div className="container mx-auto">
          <h2 className="text-[26px] font-bold text-white sm:text-[36px]">{t('about_page_title')}</h2>
        </div>
        <div className="absolute bottom-0 left-0 w-full">
          <img 
            loading="lazy" 
            className="w-full max-w-7xl h-auto" 
            src="/assets/images/about-frame.png"
            srcSet="/assets/images/about-frame-600w.webp 600w, /assets/images/about-frame-1200w.webp 1200w, /assets/images/about-frame.png 1800w"
            sizes="(max-width: 768px) 600px, (max-width: 1400px) 1200px, 1800px"
            alt={t('about_hero_image_alt')} 
          />
        </div>
      </div>
      
      <div className="py-[100px] text-white">
        <div className="container max-w-4xl mx-auto space-y-12">
          {/* About Content */}
          <section className="space-y-8">
            <h1 className="text-4xl font-bold mb-8">{t('about_mega_radio')}</h1>
            <div className="prose prose-lg prose-invert max-w-none space-y-6">
              <p className="text-lg leading-relaxed">
                {t('about_intro_paragraph_1')}
              </p>
              <p className="text-lg leading-relaxed">
                {t('about_intro_paragraph_2')}
              </p>
              <p className="text-lg leading-relaxed">
                {t('about_intro_paragraph_3')}
              </p>
            </div>
          </section>

          {/* Key Features */}
          <section className="space-y-6">
            <h2 className="text-3xl font-bold">{t('why_choose_mega_radio')}</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-white/5 p-6 rounded-xl">
                <h3 className="text-xl font-semibold mb-3">🌍 {t('about_feature_global_coverage_title')}</h3>
                <p>{t('about_feature_global_coverage_description')}</p>
              </div>
              <div className="bg-white/5 p-6 rounded-xl">
                <h3 className="text-xl font-semibold mb-3">🎵 {t('about_feature_all_genres_title')}</h3>
                <p>{t('about_feature_all_genres_description')}</p>
              </div>
              <div className="bg-white/5 p-6 rounded-xl">
                <h3 className="text-xl font-semibold mb-3">📱 {t('about_feature_cross_platform_title')}</h3>
                <p>{t('about_feature_cross_platform_description')}</p>
              </div>
              <div className="bg-white/5 p-6 rounded-xl">
                <h3 className="text-xl font-semibold mb-3">🔒 {t('about_feature_privacy_first_title')}</h3>
                <p>{t('about_feature_privacy_first_description')}</p>
              </div>
            </div>
          </section>

          {/* SEO FAQ Section with Database Translations */}
          <section className="space-y-8">
            <h2 className="text-3xl font-bold">{t('faq_seo_coverage_title')}</h2>
            
            {/* Intro */}
            <div className="prose prose-lg prose-invert max-w-none">
              <p className="text-lg leading-relaxed">{t('faq_seo_intro')}</p>
            </div>

            {/* Global Radio Station Coverage */}
            <div className="bg-white/5 p-6 rounded-xl">
              <h3 className="text-2xl font-semibold mb-4 text-[#FF4199]">{t('faq_seo_coverage_title')}</h3>
              <p className="text-gray-300 leading-relaxed">{t('faq_seo_coverage')}</p>
            </div>

            {/* Advanced Radio Streaming Features */}
            <div className="space-y-4">
              <h3 className="text-2xl font-semibold text-[#FF4199]">{t('faq_seo_features_title')}</h3>
              <div className="bg-white/5 p-6 rounded-xl">
                <p className="text-gray-300 leading-relaxed mb-4">{t('faq_seo_features_1')}</p>
                <p className="text-gray-300 leading-relaxed">{t('faq_seo_features_2')}</p>
              </div>
            </div>

            {/* Listen on Any Device */}
            <div className="bg-white/5 p-6 rounded-xl">
              <h3 className="text-2xl font-semibold mb-4 text-[#FF4199]">{t('faq_seo_devices_title')}</h3>
              <p className="text-gray-300 leading-relaxed">{t('faq_seo_devices')}</p>
            </div>

            {/* Completely Free Radio Streaming */}
            <div className="space-y-4">
              <h3 className="text-2xl font-semibold text-[#FF4199]">{t('faq_seo_free_title')}</h3>
              <div className="bg-white/5 p-6 rounded-xl">
                <p className="text-gray-300 leading-relaxed mb-4">{t('faq_seo_free_access')}</p>
                <p className="text-gray-300 leading-relaxed">{t('faq_seo_free_community')}</p>
              </div>
            </div>
          </section>

          {/* Technical Information */}
          <section className="space-y-6">
            <h2 className="text-3xl font-bold">{t('about_technical_excellence_title')}</h2>
            <div className="prose prose-lg prose-invert max-w-none">
              <p>
                {t('about_technical_intro')}
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>{t('about_tech_feature_hls')}</li>
                <li>{t('about_tech_feature_metadata')}</li>
                <li>{t('about_tech_feature_format_conversion')}</li>
                <li>{t('about_tech_feature_gps_discovery')}</li>
                <li>{t('about_tech_feature_ml_recommendations')}</li>
                <li>{t('about_tech_feature_multilanguage')}</li>
                <li>{t('about_tech_feature_seo')}</li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
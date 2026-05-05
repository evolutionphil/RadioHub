import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { ChevronDown, ChevronUp } from "lucide-react";

export default function RadioFAQ() {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const faqs = [
    { question: t('faq_what_is_radio'), answer: t('faq_what_is_radio_answer') },
    { question: t('faq_what_is_internet_radio'), answer: t('faq_what_is_internet_radio_answer') },
    { question: t('faq_what_is_web_radio'), answer: t('faq_what_is_web_radio_answer') },
    { question: t('faq_how_to_listen'), answer: t('faq_how_to_listen_answer') },
    { question: t('faq_listen_on_phone'), answer: t('faq_listen_on_phone_answer') },
    { question: t('faq_is_radio_free'), answer: t('faq_is_radio_free_answer') },
    { question: t('faq_listen_on_pc'), answer: t('faq_listen_on_pc_answer') },
    { question: t('faq_which_stations'), answer: t('faq_which_stations_answer') },
    { question: t('faq_best_station'), answer: t('faq_best_station_answer') },
    { question: t('faq_no_ads_stations'), answer: t('faq_no_ads_stations_answer') }
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Minimal Apple-style Header */}
        <div className="flex items-center justify-between py-4 border-t border-gray-800">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg md:text-xl font-semibold text-white truncate">
              {t('faq_title')}
            </h2>
            <p className="text-gray-500 text-xs md:text-sm mt-0.5 truncate">
              {t('faq_subtitle')}
            </p>
          </div>
          
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 text-[#FF4199] hover:text-[#FF097B] text-sm font-medium transition-colors shrink-0 ml-4"
            aria-expanded={isExpanded}
            data-testid="button-toggle-faq-content"
          >
            <span>{isExpanded ? t('faq_show_less', 'Less') : t('faq_learn_more', 'More')}</span>
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Expandable Content - Ultra Compact */}
        <div 
          className={`overflow-hidden transition-all duration-400 ease-out ${
            isExpanded ? 'max-h-[4000px] opacity-100' : 'max-h-0 opacity-0'
          }`}
          aria-hidden={!isExpanded}
        >
          <div className="py-4 space-y-3">
            {/* Compact FAQ Grid */}
            <div className="grid md:grid-cols-2 gap-2">
              {faqs.map((faq, index) => (
                <details 
                  key={index} 
                  className="group bg-white/5 rounded-lg"
                >
                  <summary className="flex items-center justify-between cursor-pointer px-4 py-3 text-white text-sm font-medium hover:bg-white/10 rounded-lg transition-colors list-none">
                    <span className="pr-2">{faq.question}</span>
                    <ChevronDown className="w-4 h-4 text-gray-500 group-open:rotate-180 transition-transform shrink-0" />
                  </summary>
                  <p className="px-4 pb-3 text-gray-400 text-xs leading-relaxed">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>

            {/* Compact SEO Content */}
            <div className="pt-4 border-t border-gray-800">
              <h3 className="text-base font-semibold text-white mb-3">
                {t('about_megaradio')}
              </h3>
              <p className="text-gray-400 text-xs leading-relaxed mb-4">
                {t('faq_seo_intro')}
              </p>
              
              <div className="grid md:grid-cols-2 gap-4 text-xs">
                <div>
                  <h4 className="font-medium text-white mb-1">{t('faq_seo_coverage_title')}</h4>
                  <p className="text-gray-500 leading-relaxed">{t('faq_seo_coverage')}</p>
                </div>
                <div>
                  <h4 className="font-medium text-white mb-1">{t('faq_seo_features_title')}</h4>
                  <p className="text-gray-500 leading-relaxed">{t('faq_seo_features_1')}</p>
                </div>
                <div>
                  <h4 className="font-medium text-white mb-1">{t('faq_seo_devices_title')}</h4>
                  <p className="text-gray-500 leading-relaxed">{t('faq_seo_devices')}</p>
                </div>
                <div>
                  <h4 className="font-medium text-white mb-1">{t('faq_seo_free_title')}</h4>
                  <p className="text-gray-500 leading-relaxed">{t('faq_seo_free_access')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

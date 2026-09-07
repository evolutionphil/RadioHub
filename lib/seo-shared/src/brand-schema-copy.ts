import { getHomeSeoTemplate } from './home-seo-templates';

// Translate prose, not schema vocabulary, legal names or stable entity IDs.
const BRAND_COPY: Record<string, { support: string; vienna: string; developer: string }> = {
  en: { support: 'Customer service', vienna: 'Vienna', developer: 'Vienna-based software studio developing MegaRadio.' },
  es: { support: 'Atención al cliente', vienna: 'Viena', developer: 'Estudio de software con sede en Viena que desarrolla MegaRadio.' },
  fr: { support: 'Service client', vienna: 'Vienne', developer: 'Studio de développement logiciel basé à Vienne, créateur de MegaRadio.' },
  de: { support: 'Kundenservice', vienna: 'Wien', developer: 'Softwarestudio mit Sitz in Wien, das MegaRadio entwickelt.' },
  pt: { support: 'Atendimento ao cliente', vienna: 'Viena', developer: 'Estúdio de software sediado em Viena que desenvolve o MegaRadio.' },
  it: { support: 'Servizio clienti', vienna: 'Vienna', developer: 'Studio di sviluppo software con sede a Vienna che sviluppa MegaRadio.' },
  ru: { support: 'Служба поддержки', vienna: 'Вена', developer: 'Студия разработки программного обеспечения в Вене, создающая MegaRadio.' },
  ar: { support: 'خدمة العملاء', vienna: 'فيينا', developer: 'استوديو برمجيات مقره فيينا يطوّر MegaRadio.' },
  zh: { support: '客户服务', vienna: '维也纳', developer: '位于维也纳、开发 MegaRadio 的软件工作室。' },
  tr: { support: 'Müşteri hizmetleri', vienna: 'Viyana', developer: 'MegaRadio’yu geliştiren Viyana merkezli yazılım stüdyosu.' },
  ja: { support: 'カスタマーサービス', vienna: 'ウィーン', developer: 'ウィーンを拠点に MegaRadio を開発するソフトウェアスタジオ。' },
  ko: { support: '고객 서비스', vienna: '빈', developer: '빈에 본사를 두고 MegaRadio를 개발하는 소프트웨어 스튜디오입니다.' },
  hi: { support: 'ग्राहक सेवा', vienna: 'वियना', developer: 'वियना स्थित सॉफ़्टवेयर स्टूडियो जो MegaRadio विकसित करता है।' },
  he: { support: 'שירות לקוחות', vienna: 'וינה', developer: 'סטודיו תוכנה שבסיסו בווינה ומפתח את MegaRadio.' },
};

export function getBrandSchemaCopy(language: string, translations: Record<string, string> = {}) {
  const locale = language.toLowerCase().split(/[-_]/)[0];
  return {
    ...(BRAND_COPY[locale] || BRAND_COPY.en),
    description: translations.faq_seo_intro?.trim() || translations.meta_description?.trim()
      || translations.home_page_description?.trim() || getHomeSeoTemplate(locale).description,
  };
}

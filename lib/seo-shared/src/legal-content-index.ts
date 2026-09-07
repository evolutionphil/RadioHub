import { AR_LEGAL_CONTENT, HE_LEGAL_CONTENT, RU_LEGAL_CONTENT } from './legal-content-eastern';
import { ES_LEGAL_CONTENT, FR_LEGAL_CONTENT, IT_LEGAL_CONTENT, PT_LEGAL_CONTENT } from './legal-content-romance';
import { HI_LEGAL_CONTENT, JA_LEGAL_CONTENT, KO_LEGAL_CONTENT, ZH_LEGAL_CONTENT } from './legal-content-asian';
import { DE_LEGAL_CONTENT, EN_LEGAL_CONTENT, TR_LEGAL_CONTENT, type LegalLocale, type LegalLocaleCopy } from './legal-content';

export { LEGAL_CONTACT_EMAIL, LEGAL_REVIEWED_AT, LEGAL_LOCALES, type LegalPageKind } from './legal-content';

export const LEGAL_CONTENT: Record<LegalLocale, LegalLocaleCopy> = {
  en: EN_LEGAL_CONTENT, de: DE_LEGAL_CONTENT, tr: TR_LEGAL_CONTENT,
  es: ES_LEGAL_CONTENT, fr: FR_LEGAL_CONTENT, it: IT_LEGAL_CONTENT, pt: PT_LEGAL_CONTENT,
  ru: RU_LEGAL_CONTENT, ar: AR_LEGAL_CONTENT, he: HE_LEGAL_CONTENT,
  zh: ZH_LEGAL_CONTENT, ja: JA_LEGAL_CONTENT, ko: KO_LEGAL_CONTENT, hi: HI_LEGAL_CONTENT,
};

export function resolveLegalLocale(language: string): LegalLocale {
  const code = language.toLowerCase().replace('_', '-').split('-')[0];
  return Object.prototype.hasOwnProperty.call(LEGAL_CONTENT, code) ? code as LegalLocale : 'en';
}

export function getLegalContent(language: string): LegalLocaleCopy {
  return LEGAL_CONTENT[resolveLegalLocale(language)];
}

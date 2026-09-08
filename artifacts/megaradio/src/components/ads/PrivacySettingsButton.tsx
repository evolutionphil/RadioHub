import { useEffect, useState } from 'react';

export const PRIVACY_SETTINGS_LABELS: Record<string, string> = {
  en: 'Privacy and cookie settings', de: 'Datenschutz- und Cookie-Einstellungen',
  tr: 'Gizlilik ve çerez ayarları', es: 'Configuración de privacidad y cookies',
  fr: 'Paramètres de confidentialité et des cookies', pt: 'Definições de privacidade e cookies',
  it: 'Impostazioni di privacy e cookie', ru: 'Настройки конфиденциальности и файлов cookie',
  ar: 'إعدادات الخصوصية وملفات تعريف الارتباط', zh: '隐私和 Cookie 设置',
  ja: 'プライバシーと Cookie の設定', ko: '개인정보 및 쿠키 설정',
  hi: 'निजता और कुकी सेटिंग', he: 'הגדרות פרטיות וקובצי Cookie',
};

interface ConsentApi {
  callbackQueue?: { push(callback: (() => void) | { CONSENT_API_READY: () => void } | { CONSENT_DATA_READY: () => void }): unknown };
  showRevocationMessage?: () => void;
}
type ConsentWindow = Window & { googlefc?: ConsentApi };

/** Google's supported API; no additional SDK, polling, or automatic consent. */
export default function PrivacySettingsButton({ language }: { language: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    const host = window as ConsentWindow;
    const api = host.googlefc ||= {};
    api.callbackQueue ||= [];
    const updateReady = () => {
      if (mounted) setReady(typeof host.googlefc?.showRevocationMessage === 'function');
    };
    // Google can register revocation after its framework API becomes callable.
    // Check both documented lifecycle phases, including an already-loaded SDK.
    updateReady();
    api.callbackQueue.push({ CONSENT_API_READY: updateReady });
    api.callbackQueue.push({ CONSENT_DATA_READY: updateReady });
    return () => { mounted = false; };
  }, []);

  if (!ready) return null;
  return <button type="button" data-testid="privacy-settings"
    className="inline-flex items-center min-h-[44px] md:min-h-[30px] text-left bg-transparent border-0 p-0 m-0 cursor-pointer text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors"
    onClick={() => {
      const api = (window as ConsentWindow).googlefc;
      // Queue only the visitor's explicit action. Never write consent cookies.
      if (typeof api?.showRevocationMessage === 'function') {
        api.callbackQueue?.push({ CONSENT_API_READY: () => (window as ConsentWindow).googlefc?.showRevocationMessage?.() });
      }
    }}>
    {PRIVACY_SETTINGS_LABELS[language] || PRIVACY_SETTINGS_LABELS.en}
  </button>;
}

/**
 * Backfill seeder for premium / TV-onboarding (`premium_*`, `onboarding_premium_*`,
 * `code_*`, `upgrade_*`) UI translations.
 *
 * These keys are used by:
 *   - TV app  PremiumUpgrade screen
 *   - TV app  OnboardingPremium screen
 *   - Web     /activate page
 *   - Web     /premium page CTA copy
 *
 * The seeder is idempotent: it never overwrites an existing non-empty value
 * (admin-edited copy wins). Safe to re-run on every deploy.
 *
 * Invoked from `routes.ts` alongside `seedSearchPageTranslations()`.
 */


import { logger } from '../utils/logger';
import { pgLocalization } from '../data/postgres-localization-store';

interface PremiumKeyDef {
  key: string;
  defaultValue: string;
  description: string;
}

const PREMIUM_KEYS: PremiumKeyDef[] = [
  // ── TV PremiumUpgrade screen ─────────────────────────────────────────────
  {
    key: 'premium_upgrade_title',
    defaultValue: 'Upgrade on your phone',
    description: 'Headline on the TV premium-upgrade QR screen',
  },
  {
    key: 'premium_upgrade_subtitle',
    defaultValue:
      'Scan the QR code or visit the URL on any device, then enter the 6-digit code. Payment happens securely in your browser.',
    description: 'Subtitle on the TV premium-upgrade QR screen',
  },
  {
    key: 'premium_activated',
    defaultValue: "You're Premium!",
    description: 'Success message shown after activation on TV',
  },
  {
    key: 'premium_active',
    defaultValue: 'MegaRadio Premium · Active',
    description: 'Badge shown when subscription is already active on TV',
  },
  {
    key: 'premium_redirecting',
    defaultValue: 'Returning to your radio...',
    description: 'Transition message after activation on TV',
  },
  {
    key: 'premium_tagline',
    defaultValue: 'Ad-free · High-quality streams',
    description: 'Short tagline on premium screens',
  },
  {
    key: 'upgrade_to_premium',
    defaultValue: 'Upgrade to Premium',
    description: 'Generic CTA button label for premium upgrade',
  },
  // ── Benefit bullets ──────────────────────────────────────────────────────
  {
    key: 'premium_benefit_no_ads',
    defaultValue: 'Ad-free listening',
    description: 'Premium benefit bullet — no ads',
  },
  {
    key: 'premium_benefit_quality',
    defaultValue: 'HQ audio streams',
    description: 'Premium benefit bullet — audio quality',
  },
  {
    key: 'premium_benefit_multi',
    defaultValue: 'All your devices',
    description: 'Premium benefit bullet — multi-device',
  },
  {
    key: 'premium_benefit_unlimited',
    defaultValue: 'Unlimited skips',
    description: 'Premium benefit bullet — skips',
  },
  // ── TV OnboardingPremium screen ──────────────────────────────────────────
  {
    key: 'onboarding_premium_title',
    defaultValue: 'Start with Premium —',
    description: 'Onboarding premium screen first title line',
  },
  {
    key: 'onboarding_premium_title_2',
    defaultValue: 'no ads, ever.',
    description: 'Onboarding premium screen second title line',
  },
  {
    key: 'onboarding_premium_subtitle',
    defaultValue:
      'Skip the ads. Get the highest-quality streams. Listen on all your devices.',
    description: 'Onboarding premium screen subtitle',
  },
  {
    key: 'onboarding_premium_billing',
    defaultValue: 'Cancel anytime · Manage on themegaradio.com/account',
    description: 'Billing/compliance line on onboarding premium screen',
  },
  {
    key: 'onboarding_premium_cta_primary',
    defaultValue: 'Upgrade with QR code',
    description: 'Primary CTA button on onboarding premium screen',
  },
  {
    key: 'onboarding_premium_cta_skip',
    defaultValue: 'Continue with free',
    description: 'Skip/free CTA on onboarding premium screen',
  },
  {
    key: 'onboarding_premium_scan_title',
    defaultValue: 'Scan with your phone',
    description: 'Title shown when QR code is displayed during onboarding',
  },
  {
    key: 'onboarding_premium_scan_sub',
    defaultValue:
      'Complete payment on your phone in under 30 seconds. The TV will switch to Premium automatically when you finish.',
    description: 'Subtitle shown when QR code is displayed during onboarding',
  },
  {
    key: 'onboarding_premium_back_hint',
    defaultValue: 'Press BACK to skip and go to the app',
    description: 'Remote-control hint shown on onboarding premium scan screen',
  },
  {
    key: 'onboarding_premium_maybe_later',
    defaultValue: 'Maybe later — Continue free',
    description: 'Dismiss link at bottom of onboarding premium scan screen',
  },
  // ── Shared code / connection status labels ───────────────────────────────
  {
    key: 'code_expires_in',
    defaultValue: 'Code expires in',
    description: 'Label prefix for countdown timer next to activation code',
  },
  {
    key: 'code_expired',
    defaultValue: 'Code expired',
    description: 'Status label when activation code has timed out',
  },
  {
    key: 'connection_error',
    defaultValue: 'Connection error',
    description: 'Generic connection error label on TV screens',
  },
  {
    key: 'generate_new_code',
    defaultValue: 'Generate new code',
    description: 'Button label to request a fresh activation code',
  },
  {
    key: 'or',
    defaultValue: 'OR ENTER CODE',
    description: 'Separator label between QR scan and manual code entry',
  },
  // ── TV Login page ─────────────────────────────────────────────────────────
  {
    key: 'tv_login_scan_qr',
    defaultValue: 'Scan QR Code',
    description: 'Button/label for QR code scanning on the TV login page',
  },
  {
    key: 'tv_login_qr_or_code',
    defaultValue: 'Scan the QR code or enter your TV code below',
    description: 'Separator explaining the two login options on the TV login page',
  },
];

// ── Per-language translations ─────────────────────────────────────────────
// Add new languages here — missing languages fall back to English at runtime.
const TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    premium_upgrade_title: 'Upgrade on your phone',
    premium_upgrade_subtitle:
      'Scan the QR code or visit the URL on any device, then enter the 6-digit code. Payment happens securely in your browser.',
    premium_activated: "You're Premium!",
    premium_active: 'MegaRadio Premium · Active',
    premium_redirecting: 'Returning to your radio...',
    premium_tagline: 'Ad-free · High-quality streams',
    upgrade_to_premium: 'Upgrade to Premium',
    premium_benefit_no_ads: 'Ad-free listening',
    premium_benefit_quality: 'HQ audio streams',
    premium_benefit_multi: 'All your devices',
    premium_benefit_unlimited: 'Unlimited skips',
    onboarding_premium_title: 'Start with Premium —',
    onboarding_premium_title_2: 'no ads, ever.',
    onboarding_premium_subtitle:
      'Skip the ads. Get the highest-quality streams. Listen on all your devices.',
    onboarding_premium_billing:
      'Cancel anytime · Manage on themegaradio.com/account',
    onboarding_premium_cta_primary: 'Upgrade with QR code',
    onboarding_premium_cta_skip: 'Continue with free',
    onboarding_premium_scan_title: 'Scan with your phone',
    onboarding_premium_scan_sub:
      'Complete payment on your phone in under 30 seconds. The TV will switch to Premium automatically when you finish.',
    onboarding_premium_back_hint: 'Press BACK to skip and go to the app',
    onboarding_premium_maybe_later: 'Maybe later — Continue free',
    code_expires_in: 'Code expires in',
    code_expired: 'Code expired',
    connection_error: 'Connection error',
    generate_new_code: 'Generate new code',
    or: 'OR ENTER CODE',
    tv_login_scan_qr: 'Scan QR Code',
    tv_login_qr_or_code: 'Scan the QR code or enter your TV code below',
  },

  tr: {
    premium_upgrade_title: "Telefonunda Premium'a geç",
    premium_upgrade_subtitle:
      "QR kodu telefonunla tara veya URL'ye gir, sonra 6 haneli kodu yaz. Ödeme tarayıcında güvenle yapılır.",
    premium_activated: 'Artık Premium üyesiniz!',
    premium_active: 'MegaRadio Premium · Aktif',
    premium_redirecting: 'Radyonuza dönülüyor...',
    premium_tagline: 'Reklamsız · Yüksek kaliteli yayın',
    upgrade_to_premium: "Premium'a Yükselt",
    premium_benefit_no_ads: 'Reklamsız dinleme',
    premium_benefit_quality: 'Yüksek kaliteli ses',
    premium_benefit_multi: 'Tüm cihazlarında',
    premium_benefit_unlimited: 'Sınırsız geçiş',
    onboarding_premium_title: 'Premium ile başla —',
    onboarding_premium_title_2: 'reklamsız, her zaman.',
    onboarding_premium_subtitle:
      'Reklamları atla. En kaliteli yayını dinle. Tüm cihazlarında çalsın.',
    onboarding_premium_billing:
      'İstediğin zaman iptal et · themegaradio.com/hesabim üzerinden yönet',
    onboarding_premium_cta_primary: "QR ile Premium'a Yükselt",
    onboarding_premium_cta_skip: 'Ücretsiz devam et',
    onboarding_premium_scan_title: 'Telefonunla tara',
    onboarding_premium_scan_sub:
      'Ödemeyi telefonunda 30 saniyeden kısa sürede tamamla. TV bittiğinde otomatik olarak Premium\'a geçer.',
    onboarding_premium_back_hint:
      'Atlayıp uygulamaya geçmek için GERİ tuşuna bas',
    onboarding_premium_maybe_later: 'Daha sonra — Ücretsiz devam',
    code_expires_in: 'Kod süresi',
    code_expired: 'Kodun süresi doldu',
    connection_error: 'Bağlantı hatası',
    generate_new_code: 'Yeni kod oluştur',
    or: 'YA DA KODU GİR',
    tv_login_scan_qr: 'QR Kodu Tara',
    tv_login_qr_or_code: 'QR kodu tara veya TV kodunu aşağıya gir',
  },

  de: {
    premium_upgrade_title: 'Upgrade per Smartphone',
    premium_upgrade_subtitle:
      'Scanne den QR-Code oder öffne die URL auf einem beliebigen Gerät und gib dann den 6-stelligen Code ein. Zahlung erfolgt sicher in deinem Browser.',
    premium_activated: 'Du bist jetzt Premium!',
    premium_active: 'MegaRadio Premium · Aktiv',
    premium_redirecting: 'Zurück zu deinem Radio...',
    premium_tagline: 'Werbefrei · Hochwertige Streams',
    upgrade_to_premium: 'Auf Premium upgraden',
    premium_benefit_no_ads: 'Werbefreies Hören',
    premium_benefit_quality: 'HQ-Audio-Streams',
    premium_benefit_multi: 'Auf allen Geräten',
    premium_benefit_unlimited: 'Unbegrenzte Skips',
    onboarding_premium_title: 'Starte mit Premium —',
    onboarding_premium_title_2: 'ohne Werbung, für immer.',
    onboarding_premium_subtitle:
      'Keine Werbung. Beste Streaming-Qualität. Auf allen deinen Geräten.',
    onboarding_premium_billing:
      'Jederzeit kündbar · Verwaltung auf themegaradio.com/account',
    onboarding_premium_cta_primary: 'Mit QR-Code upgraden',
    onboarding_premium_cta_skip: 'Mit kostenloser Version fortfahren',
    onboarding_premium_scan_title: 'Scan mit deinem Smartphone',
    onboarding_premium_scan_sub:
      'Schließe die Zahlung in unter 30 Sekunden auf deinem Telefon ab. Der TV wechselt automatisch zu Premium, sobald du fertig bist.',
    onboarding_premium_back_hint:
      'Drücke ZURÜCK zum Überspringen und Wechseln zur App',
    onboarding_premium_maybe_later: 'Später — Kostenlos fortfahren',
    code_expires_in: 'Code läuft ab in',
    code_expired: 'Code abgelaufen',
    connection_error: 'Verbindungsfehler',
    generate_new_code: 'Neuen Code generieren',
    or: 'ODER CODE EINGEBEN',
    tv_login_scan_qr: 'QR-Code scannen',
    tv_login_qr_or_code: 'QR-Code scannen oder TV-Code unten eingeben',
  },

  es: {
    premium_upgrade_title: 'Sube de plan en tu teléfono',
    premium_upgrade_subtitle:
      'Escanea el código QR o visita la URL en cualquier dispositivo e ingresa el código de 6 dígitos. El pago se realiza de forma segura en tu navegador.',
    premium_activated: '¡Eres Premium!',
    premium_active: 'MegaRadio Premium · Activo',
    premium_redirecting: 'Volviendo a tu radio...',
    premium_tagline: 'Sin anuncios · Streams de alta calidad',
    upgrade_to_premium: 'Actualizar a Premium',
    premium_benefit_no_ads: 'Escucha sin anuncios',
    premium_benefit_quality: 'Streams de audio HQ',
    premium_benefit_multi: 'Todos tus dispositivos',
    premium_benefit_unlimited: 'Saltos ilimitados',
    onboarding_premium_title: 'Empieza con Premium —',
    onboarding_premium_title_2: 'sin anuncios, nunca.',
    onboarding_premium_subtitle:
      'Salta los anuncios. Obtén streams de la más alta calidad. Escucha en todos tus dispositivos.',
    onboarding_premium_billing:
      'Cancela cuando quieras · Gestiona en themegaradio.com/account',
    onboarding_premium_cta_primary: 'Actualizar con código QR',
    onboarding_premium_cta_skip: 'Continuar gratis',
    onboarding_premium_scan_title: 'Escanea con tu teléfono',
    onboarding_premium_scan_sub:
      'Completa el pago en tu teléfono en menos de 30 segundos. El TV cambiará a Premium automáticamente cuando termines.',
    onboarding_premium_back_hint: 'Presiona ATRÁS para omitir e ir a la app',
    onboarding_premium_maybe_later: 'Quizás después — Continuar gratis',
    code_expires_in: 'El código expira en',
    code_expired: 'Código expirado',
    connection_error: 'Error de conexión',
    generate_new_code: 'Generar nuevo código',
    or: 'O INGRESA EL CÓDIGO',
    tv_login_scan_qr: 'Escanear código QR',
    tv_login_qr_or_code: 'Escanea el QR o ingresa tu código de TV a continuación',
  },

  fr: {
    premium_upgrade_title: 'Passer à Premium sur votre téléphone',
    premium_upgrade_subtitle:
      "Scannez le code QR ou visitez l'URL sur n'importe quel appareil, puis entrez le code à 6 chiffres. Le paiement s'effectue en toute sécurité dans votre navigateur.",
    premium_activated: 'Vous êtes Premium !',
    premium_active: 'MegaRadio Premium · Actif',
    premium_redirecting: 'Retour à votre radio...',
    premium_tagline: 'Sans publicité · Streams haute qualité',
    upgrade_to_premium: 'Passer à Premium',
    premium_benefit_no_ads: 'Écoute sans publicité',
    premium_benefit_quality: 'Streams audio HQ',
    premium_benefit_multi: 'Sur tous vos appareils',
    premium_benefit_unlimited: 'Skips illimités',
    onboarding_premium_title: 'Commencez avec Premium —',
    onboarding_premium_title_2: 'sans pub, à jamais.',
    onboarding_premium_subtitle:
      "Supprimez les pubs. Obtenez des streams de la meilleure qualité. Écoutez sur tous vos appareils.",
    onboarding_premium_billing:
      'Annulez à tout moment · Gérez sur themegaradio.com/account',
    onboarding_premium_cta_primary: 'Passer à Premium avec QR',
    onboarding_premium_cta_skip: 'Continuer gratuitement',
    onboarding_premium_scan_title: 'Scannez avec votre téléphone',
    onboarding_premium_scan_sub:
      'Finalisez le paiement sur votre téléphone en moins de 30 secondes. La TV passera automatiquement en Premium.',
    onboarding_premium_back_hint:
      "Appuyez sur RETOUR pour ignorer et aller à l'application",
    onboarding_premium_maybe_later: 'Plus tard — Continuer gratuitement',
    code_expires_in: 'Le code expire dans',
    code_expired: 'Code expiré',
    connection_error: 'Erreur de connexion',
    generate_new_code: 'Générer un nouveau code',
    or: 'OU ENTREZ LE CODE',
    tv_login_scan_qr: 'Scanner le code QR',
    tv_login_qr_or_code: 'Scannez le QR ou entrez votre code TV ci-dessous',
  },

  it: {
    premium_upgrade_title: 'Passa a Premium dal tuo telefono',
    premium_upgrade_subtitle:
      'Scansiona il codice QR o visita il link su qualsiasi dispositivo, poi inserisci il codice a 6 cifre. Il pagamento avviene in modo sicuro nel tuo browser.',
    premium_activated: 'Sei Premium!',
    premium_active: 'MegaRadio Premium · Attivo',
    premium_redirecting: 'Ritorno alla tua radio...',
    premium_tagline: 'Senza pubblicità · Stream ad alta qualità',
    upgrade_to_premium: 'Passa a Premium',
    premium_benefit_no_ads: 'Ascolto senza pubblicità',
    premium_benefit_quality: 'Stream audio HQ',
    premium_benefit_multi: 'Su tutti i tuoi dispositivi',
    premium_benefit_unlimited: 'Skip illimitati',
    onboarding_premium_title: 'Inizia con Premium —',
    onboarding_premium_title_2: 'senza pubblicità, mai.',
    onboarding_premium_subtitle:
      'Salta le pubblicità. Ottieni stream della massima qualità. Ascolta su tutti i tuoi dispositivi.',
    onboarding_premium_billing:
      'Annulla in qualsiasi momento · Gestisci su themegaradio.com/account',
    onboarding_premium_cta_primary: 'Passa a Premium con QR',
    onboarding_premium_cta_skip: 'Continua con il piano gratuito',
    onboarding_premium_scan_title: 'Scansiona con il tuo telefono',
    onboarding_premium_scan_sub:
      'Completa il pagamento sul tuo telefono in meno di 30 secondi. La TV passerà automaticamente a Premium.',
    onboarding_premium_back_hint:
      "Premi INDIETRO per saltare e andare all'app",
    onboarding_premium_maybe_later: 'Forse dopo — Continua gratis',
    code_expires_in: 'Il codice scade tra',
    code_expired: 'Codice scaduto',
    connection_error: 'Errore di connessione',
    generate_new_code: 'Genera nuovo codice',
    or: 'OPPURE INSERISCI IL CODICE',
    tv_login_scan_qr: 'Scansiona il codice QR',
    tv_login_qr_or_code: 'Scansiona il QR o inserisci il tuo codice TV qui sotto',
  },

  pt: {
    premium_upgrade_title: 'Faça upgrade no seu telemóvel',
    premium_upgrade_subtitle:
      'Digitalize o código QR ou visite o URL em qualquer dispositivo e introduza o código de 6 dígitos. O pagamento é feito de forma segura no seu navegador.',
    premium_activated: 'É Premium!',
    premium_active: 'MegaRadio Premium · Ativo',
    premium_redirecting: 'Voltando à sua rádio...',
    premium_tagline: 'Sem anúncios · Streams de alta qualidade',
    upgrade_to_premium: 'Atualizar para Premium',
    premium_benefit_no_ads: 'Ouça sem anúncios',
    premium_benefit_quality: 'Streams de áudio HQ',
    premium_benefit_multi: 'Em todos os seus dispositivos',
    premium_benefit_unlimited: 'Skips ilimitados',
    onboarding_premium_title: 'Comece com Premium —',
    onboarding_premium_title_2: 'sem anúncios, nunca.',
    onboarding_premium_subtitle:
      'Sem anúncios. A melhor qualidade de streaming. Ouça em todos os seus dispositivos.',
    onboarding_premium_billing:
      'Cancele quando quiser · Gerencie em themegaradio.com/account',
    onboarding_premium_cta_primary: 'Fazer upgrade com QR',
    onboarding_premium_cta_skip: 'Continuar grátis',
    onboarding_premium_scan_title: 'Digitalize com o seu telefone',
    onboarding_premium_scan_sub:
      'Conclua o pagamento no seu telemóvel em menos de 30 segundos. A TV mudará automaticamente para Premium.',
    onboarding_premium_back_hint:
      'Pressione VOLTAR para ignorar e ir para o app',
    onboarding_premium_maybe_later: 'Talvez depois — Continuar grátis',
    code_expires_in: 'O código expira em',
    code_expired: 'Código expirado',
    connection_error: 'Erro de conexão',
    generate_new_code: 'Gerar novo código',
    or: 'OU INSERIR CÓDIGO',
    tv_login_scan_qr: 'Digitalizar código QR',
    tv_login_qr_or_code: 'Digitaliza o QR ou introduz o teu código de TV abaixo',
  },

  ar: {
    premium_upgrade_title: 'الترقية إلى بريميوم من هاتفك',
    premium_upgrade_subtitle:
      'امسح رمز QR أو زُر الرابط على أي جهاز، ثم أدخل الرمز المكوّن من 6 أرقام. تتم عملية الدفع بأمان في متصفحك.',
    premium_activated: 'أصبحت مشتركاً بريميوم!',
    premium_active: 'MegaRadio Premium · نشط',
    premium_redirecting: 'العودة إلى راديوك...',
    premium_tagline: 'بدون إعلانات · بث عالي الجودة',
    upgrade_to_premium: 'الترقية إلى بريميوم',
    premium_benefit_no_ads: 'استمع بدون إعلانات',
    premium_benefit_quality: 'بث صوتي عالي الجودة',
    premium_benefit_multi: 'على جميع أجهزتك',
    premium_benefit_unlimited: 'تخطٍّ غير محدود',
    onboarding_premium_title: 'ابدأ مع بريميوم —',
    onboarding_premium_title_2: 'بدون إعلانات، للأبد.',
    onboarding_premium_subtitle:
      'تخلّص من الإعلانات. استمتع بأفضل جودة بث. استمع على جميع أجهزتك.',
    onboarding_premium_billing:
      'إلغاء في أي وقت · الإدارة عبر themegaradio.com/account',
    onboarding_premium_cta_primary: 'الترقية برمز QR',
    onboarding_premium_cta_skip: 'المتابعة مجاناً',
    onboarding_premium_scan_title: 'امسح بهاتفك',
    onboarding_premium_scan_sub:
      'أتمّ عملية الدفع من هاتفك في أقل من 30 ثانية. سيتحوّل التلفزيون تلقائياً إلى بريميوم عند الانتهاء.',
    onboarding_premium_back_hint:
      'اضغط BACK للتخطي والذهاب إلى التطبيق',
    onboarding_premium_maybe_later: 'ربما لاحقاً — المتابعة مجاناً',
    code_expires_in: 'الرمز ينتهي في',
    code_expired: 'انتهت صلاحية الرمز',
    connection_error: 'خطأ في الاتصال',
    generate_new_code: 'إنشاء رمز جديد',
    or: 'أو أدخل الرمز',
    tv_login_scan_qr: 'مسح رمز QR',
    tv_login_qr_or_code: 'امسح رمز QR أو أدخل رمز التلفزيون أدناه',
  },

  ru: {
    premium_upgrade_title: 'Перейти на Premium с телефона',
    premium_upgrade_subtitle:
      'Отсканируй QR-код или открой ссылку на любом устройстве и введи 6-значный код. Оплата проходит безопасно в браузере.',
    premium_activated: 'Вы — Premium!',
    premium_active: 'MegaRadio Premium · Активен',
    premium_redirecting: 'Возвращаемся к радио...',
    premium_tagline: 'Без рекламы · Потоки высокого качества',
    upgrade_to_premium: 'Перейти на Premium',
    premium_benefit_no_ads: 'Слушай без рекламы',
    premium_benefit_quality: 'HQ аудиопотоки',
    premium_benefit_multi: 'На всех устройствах',
    premium_benefit_unlimited: 'Неограниченные пропуски',
    onboarding_premium_title: 'Начни с Premium —',
    onboarding_premium_title_2: 'без рекламы, навсегда.',
    onboarding_premium_subtitle:
      'Никакой рекламы. Лучшее качество потоков. Слушай на всех своих устройствах.',
    onboarding_premium_billing:
      'Отменяй когда угодно · Управление на themegaradio.com/account',
    onboarding_premium_cta_primary: 'Перейти на Premium по QR',
    onboarding_premium_cta_skip: 'Продолжить бесплатно',
    onboarding_premium_scan_title: 'Отсканируй телефоном',
    onboarding_premium_scan_sub:
      'Заверши оплату на телефоне менее чем за 30 секунд. Телевизор автоматически переключится на Premium.',
    onboarding_premium_back_hint:
      'Нажми НАЗАД, чтобы пропустить и перейти в приложение',
    onboarding_premium_maybe_later: 'Позже — Продолжить бесплатно',
    code_expires_in: 'Код истекает через',
    code_expired: 'Срок кода истёк',
    connection_error: 'Ошибка соединения',
    generate_new_code: 'Сгенерировать новый код',
    or: 'ИЛИ ВВЕДИТЕ КОД',
    tv_login_scan_qr: 'Сканировать QR-код',
    tv_login_qr_or_code: 'Отсканируй QR-код или введи TV-код ниже',
  },

  ja: {
    premium_upgrade_title: 'スマホでプレミアムにアップグレード',
    premium_upgrade_subtitle:
      'QRコードをスキャンするか、URLを開いて6桁のコードを入力してください。支払いはブラウザで安全に行われます。',
    premium_activated: 'プレミアム会員になりました！',
    premium_active: 'MegaRadio Premium · 有効',
    premium_redirecting: 'ラジオに戻っています...',
    premium_tagline: '広告なし · 高品質ストリーム',
    upgrade_to_premium: 'プレミアムにアップグレード',
    premium_benefit_no_ads: '広告なしでリスニング',
    premium_benefit_quality: 'HQ オーディオストリーム',
    premium_benefit_multi: 'すべてのデバイスで',
    premium_benefit_unlimited: '無制限スキップ',
    onboarding_premium_title: 'プレミアムで始めよう —',
    onboarding_premium_title_2: '広告なし、ずっと。',
    onboarding_premium_subtitle:
      '広告をスキップ。最高品質のストリームを。すべてのデバイスで聴こう。',
    onboarding_premium_billing:
      'いつでもキャンセル · themegaradio.com/account で管理',
    onboarding_premium_cta_primary: 'QRコードでプレミアムにアップグレード',
    onboarding_premium_cta_skip: '無料で続ける',
    onboarding_premium_scan_title: 'スマホでスキャン',
    onboarding_premium_scan_sub:
      'スマホで30秒以内に支払いを完了。完了するとテレビが自動的にプレミアムに切り替わります。',
    onboarding_premium_back_hint: 'BACKを押してスキップしてアプリへ',
    onboarding_premium_maybe_later: 'あとで — 無料で続ける',
    code_expires_in: 'コードの有効期限',
    code_expired: 'コードの有効期限が切れました',
    connection_error: '接続エラー',
    generate_new_code: '新しいコードを生成',
    or: 'またはコードを入力',
    tv_login_scan_qr: 'QRコードをスキャン',
    tv_login_qr_or_code: 'QRコードをスキャンするかTVコードを以下に入力',
  },

  ko: {
    premium_upgrade_title: '스마트폰으로 프리미엄 업그레이드',
    premium_upgrade_subtitle:
      'QR 코드를 스캔하거나 URL을 방문한 후 6자리 코드를 입력하세요. 결제는 브라우저에서 안전하게 이루어집니다.',
    premium_activated: '프리미엄 회원이 되셨습니다!',
    premium_active: 'MegaRadio Premium · 활성',
    premium_redirecting: '라디오로 돌아가는 중...',
    premium_tagline: '광고 없음 · 고품질 스트림',
    upgrade_to_premium: '프리미엄으로 업그레이드',
    premium_benefit_no_ads: '광고 없이 듣기',
    premium_benefit_quality: 'HQ 오디오 스트림',
    premium_benefit_multi: '모든 기기에서',
    premium_benefit_unlimited: '무제한 건너뛰기',
    onboarding_premium_title: '프리미엄으로 시작하세요 —',
    onboarding_premium_title_2: '광고 없이, 영원히.',
    onboarding_premium_subtitle:
      '광고를 건너뛰세요. 최고 품질의 스트림을 즐기세요. 모든 기기에서 들으세요.',
    onboarding_premium_billing:
      '언제든지 취소 · themegaradio.com/account에서 관리',
    onboarding_premium_cta_primary: 'QR 코드로 업그레이드',
    onboarding_premium_cta_skip: '무료로 계속하기',
    onboarding_premium_scan_title: '스마트폰으로 스캔',
    onboarding_premium_scan_sub:
      '30초 이내에 스마트폰으로 결제를 완료하세요. TV가 자동으로 프리미엄으로 전환됩니다.',
    onboarding_premium_back_hint: 'BACK을 눌러 건너뛰고 앱으로 이동',
    onboarding_premium_maybe_later: '나중에 — 무료로 계속하기',
    code_expires_in: '코드 만료',
    code_expired: '코드가 만료되었습니다',
    connection_error: '연결 오류',
    generate_new_code: '새 코드 생성',
    or: '또는 코드 입력',
    tv_login_scan_qr: 'QR 코드 스캔',
    tv_login_qr_or_code: 'QR 코드를 스캔하거나 TV 코드를 아래에 입력하세요',
  },

  zh: {
    premium_upgrade_title: '用手机升级 Premium',
    premium_upgrade_subtitle:
      '扫描二维码或在任何设备上访问链接，然后输入6位数字码。支付将在您的浏览器中安全完成。',
    premium_activated: '您已升级为 Premium！',
    premium_active: 'MegaRadio Premium · 有效',
    premium_redirecting: '正在返回您的收音机...',
    premium_tagline: '无广告 · 高质量流媒体',
    upgrade_to_premium: '升级到 Premium',
    premium_benefit_no_ads: '无广告收听',
    premium_benefit_quality: '高音质流媒体',
    premium_benefit_multi: '所有设备均可使用',
    premium_benefit_unlimited: '无限跳过',
    onboarding_premium_title: '从 Premium 开始 —',
    onboarding_premium_title_2: '永远没有广告。',
    onboarding_premium_subtitle:
      '跳过广告。获得最高质量的流媒体。在所有设备上收听。',
    onboarding_premium_billing:
      '随时取消 · 在 themegaradio.com/account 上管理',
    onboarding_premium_cta_primary: '用二维码升级 Premium',
    onboarding_premium_cta_skip: '继续免费使用',
    onboarding_premium_scan_title: '用手机扫描',
    onboarding_premium_scan_sub:
      '在30秒内在手机上完成支付。完成后电视将自动切换到 Premium。',
    onboarding_premium_back_hint: '按返回键跳过并进入应用',
    onboarding_premium_maybe_later: '稍后再说 — 继续免费使用',
    code_expires_in: '验证码在',
    code_expired: '验证码已过期',
    connection_error: '连接错误',
    generate_new_code: '生成新验证码',
    or: '或输入验证码',
    tv_login_scan_qr: '扫描QR码',
    tv_login_qr_or_code: '扫描QR码或在下方输入您的TV验证码',
  },

  hi: {
    premium_upgrade_title: 'अपने फ़ोन पर अपग्रेड करें',
    premium_upgrade_subtitle:
      'QR कोड स्कैन करें या किसी भी डिवाइस पर URL खोलें, फिर 6-अंकीय कोड दर्ज करें। भुगतान आपके ब्राउज़र में सुरक्षित रूप से होता है।',
    premium_activated: 'आप Premium हो गए!',
    premium_active: 'MegaRadio Premium · सक्रिय',
    premium_redirecting: 'आपके रेडियो पर वापस जा रहे हैं...',
    premium_tagline: 'विज्ञापन-मुक्त · उच्च गुणवत्ता स्ट्रीम',
    upgrade_to_premium: 'Premium पर अपग्रेड करें',
    premium_benefit_no_ads: 'विज्ञापन-मुक्त सुनना',
    premium_benefit_quality: 'HQ ऑडियो स्ट्रीम',
    premium_benefit_multi: 'सभी डिवाइस पर',
    premium_benefit_unlimited: 'असीमित स्किप',
    onboarding_premium_title: 'Premium से शुरू करें —',
    onboarding_premium_title_2: 'कोई विज्ञापन नहीं, कभी नहीं।',
    onboarding_premium_subtitle:
      'विज्ञापन छोड़ें। सर्वोच्च गुणवत्ता की स्ट्रीम पाएं। सभी डिवाइस पर सुनें।',
    onboarding_premium_billing:
      'कभी भी रद्द करें · themegaradio.com/account पर प्रबंधित करें',
    onboarding_premium_cta_primary: 'QR कोड से Premium में अपग्रेड',
    onboarding_premium_cta_skip: 'मुफ़्त में जारी रखें',
    onboarding_premium_scan_title: 'अपने फ़ोन से स्कैन करें',
    onboarding_premium_scan_sub:
      '30 सेकंड से कम में अपने फ़ोन पर भुगतान पूरा करें। समाप्त होने पर TV स्वतः Premium पर स्विच हो जाएगा।',
    onboarding_premium_back_hint:
      'छोड़ने और ऐप पर जाने के लिए BACK दबाएं',
    onboarding_premium_maybe_later: 'बाद में — मुफ़्त में जारी रखें',
    code_expires_in: 'कोड समाप्त होता है',
    code_expired: 'कोड की समय सीमा समाप्त',
    connection_error: 'कनेक्शन त्रुटि',
    generate_new_code: 'नया कोड जेनरेट करें',
    or: 'या कोड दर्ज करें',
    tv_login_scan_qr: 'QR कोड स्कैन करें',
    tv_login_qr_or_code: 'QR कोड स्कैन करें या नीचे अपना TV कोड दर्ज करें',
  },

  he: {
    premium_upgrade_title: 'שדרג מהטלפון שלך',
    premium_upgrade_subtitle:
      'סרוק את קוד ה-QR או בקר ב-URL בכל מכשיר, ואז הזן את הקוד בן 6 הספרות. התשלום מתבצע בצורה מאובטחת בדפדפן שלך.',
    premium_activated: 'אתה פרמיום!',
    premium_active: 'MegaRadio Premium · פעיל',
    premium_redirecting: 'חוזר לרדיו שלך...',
    premium_tagline: 'ללא פרסומות · סטרימינג באיכות גבוהה',
    upgrade_to_premium: 'שדרג לפרמיום',
    premium_benefit_no_ads: 'האזנה ללא פרסומות',
    premium_benefit_quality: 'זרמי שמע HQ',
    premium_benefit_multi: 'בכל המכשירים שלך',
    premium_benefit_unlimited: 'דילוגים ללא הגבלה',
    onboarding_premium_title: 'התחל עם פרמיום —',
    onboarding_premium_title_2: 'ללא פרסומות, לנצח.',
    onboarding_premium_subtitle:
      'דלג על הפרסומות. קבל זרמי שמע באיכות הגבוהה ביותר. האזן בכל המכשירים שלך.',
    onboarding_premium_billing:
      'בטל בכל עת · נהל ב-themegaradio.com/account',
    onboarding_premium_cta_primary: 'שדרג לפרמיום עם QR',
    onboarding_premium_cta_skip: 'המשך בחינם',
    onboarding_premium_scan_title: 'סרוק עם הטלפון שלך',
    onboarding_premium_scan_sub:
      'השלם את התשלום בטלפון שלך תוך פחות מ-30 שניות. הטלוויזיה תעבור אוטומטית לפרמיום.',
    onboarding_premium_back_hint: 'לחץ BACK לדלג ולעבור לאפליקציה',
    onboarding_premium_maybe_later: 'אולי אחר כך — המשך בחינם',
    code_expires_in: 'הקוד פג בעוד',
    code_expired: 'הקוד פג',
    connection_error: 'שגיאת חיבור',
    generate_new_code: 'צור קוד חדש',
    or: 'או הזן קוד',
    tv_login_scan_qr: 'סרוק קוד QR',
    tv_login_qr_or_code: 'סרוק את קוד QR או הזן את קוד הטלוויזיה למטה',
  },
};

// ── Seeder ────────────────────────────────────────────────────────────────────

export async function seedPremiumTranslations(): Promise<void> {
  {
    const changed = await pgLocalization().seedTranslationBundle(PREMIUM_KEYS, TRANSLATIONS, 'premium');
    logger.log(`seedPremiumTranslations: backfilled ${changed} PostgreSQL rows`);
    return;
  }

}

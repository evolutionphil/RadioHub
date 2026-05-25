/**
 * Backfill seeder for subscription-management UI translations.
 *
 * 21 keys used by:
 *   - TV ManageSubscription screen
 *   - TV Settings subscription row
 *   - TV past-due banner
 *   - Web /account subscription section
 *
 * Idempotent — admin-edited values are never overwritten.
 * Invoked from `routes.ts` at boot alongside the other seeders.
 */

import { Translation, TranslationKey } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';

interface KeyDef {
  key: string;
  defaultValue: string;
  description: string;
}

const KEYS: KeyDef[] = [
  { key: 'back',                             defaultValue: 'Back',                        description: 'Generic back navigation label' },
  { key: 'account',                          defaultValue: 'Account',                     description: 'Account settings label' },
  { key: 'plan',                             defaultValue: 'Plan',                        description: 'Subscription plan label' },
  { key: 'monthly',                          defaultValue: 'Monthly',                     description: 'Monthly billing period label' },
  { key: 'annual',                           defaultValue: 'Annual',                      description: 'Annual billing period label' },
  { key: 'renews_on',                        defaultValue: 'Renews on',                   description: 'Label prefix for subscription renewal date' },
  { key: 'ends_on',                          defaultValue: 'Ends on',                     description: 'Label prefix for subscription end date (canceled)' },
  { key: 'refreshing',                       defaultValue: 'Refreshing…',                 description: 'Loading indicator while subscription status is being fetched' },
  { key: 'refresh_status',                   defaultValue: 'Refresh status',              description: 'Button label to manually refresh subscription status' },
  { key: 'scan_with_phone',                  defaultValue: 'SCAN WITH YOUR PHONE',        description: 'Instruction above QR code on manage-subscription screen' },
  { key: 'status_active',                    defaultValue: 'Active',                      description: 'Subscription status badge — active' },
  { key: 'status_trialing',                  defaultValue: 'Trial',                       description: 'Subscription status badge — trialing' },
  { key: 'status_past_due',                  defaultValue: 'Payment failed',              description: 'Subscription status badge — past_due' },
  { key: 'status_canceled',                  defaultValue: 'Canceled',                    description: 'Subscription status badge — canceled' },
  { key: 'past_due_banner',                  defaultValue: 'Payment failed — update your card to keep Premium active. Tap to fix.', description: 'Full-width pulsing banner shown to past_due users' },
  { key: 'manage_subscription_kicker',       defaultValue: 'YOUR SUBSCRIPTION',           description: 'Small uppercase label above title on manage-subscription screen' },
  { key: 'manage_subscription_title_premium',defaultValue: 'MegaRadio Premium',           description: 'Page title on manage-subscription screen — premium user' },
  { key: 'manage_subscription_title_free',   defaultValue: 'Free plan',                   description: 'Page title on manage-subscription screen — free user' },
  { key: 'manage_subscription_default_msg',  defaultValue: 'Scan the QR code with your phone to change your plan, update payment, or cancel.', description: 'Default helper text on manage-subscription screen' },
  { key: 'manage_subscription_past_due_msg', defaultValue: 'Your last payment failed. Scan the QR code with your phone and update your card to keep Premium.', description: 'Helper text shown when status is past_due' },
  { key: 'manage_subscription_canceling_msg',defaultValue: "You've canceled — Premium stays active until the end of the period. Scan to resume.", description: 'Helper text when cancelAtPeriodEnd=true' },
];

const TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    back: 'Back',
    account: 'Account',
    plan: 'Plan',
    monthly: 'Monthly',
    annual: 'Annual',
    renews_on: 'Renews on',
    ends_on: 'Ends on',
    refreshing: 'Refreshing…',
    refresh_status: 'Refresh status',
    scan_with_phone: 'SCAN WITH YOUR PHONE',
    status_active: 'Active',
    status_trialing: 'Trial',
    status_past_due: 'Payment failed',
    status_canceled: 'Canceled',
    past_due_banner: 'Payment failed — update your card to keep Premium active. Tap to fix.',
    manage_subscription_kicker: 'YOUR SUBSCRIPTION',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: 'Free plan',
    manage_subscription_default_msg: 'Scan the QR code with your phone to change your plan, update payment, or cancel.',
    manage_subscription_past_due_msg: 'Your last payment failed. Scan the QR code with your phone and update your card to keep Premium.',
    manage_subscription_canceling_msg: "You've canceled — Premium stays active until the end of the period. Scan to resume.",
  },
  tr: {
    back: 'Geri',
    account: 'Hesap',
    plan: 'Plan',
    monthly: 'Aylık',
    annual: 'Yıllık',
    renews_on: 'Yenileme',
    ends_on: 'Bitiş',
    refreshing: 'Yenileniyor…',
    refresh_status: 'Durumu yenile',
    scan_with_phone: 'TELEFONUNLA TARA',
    status_active: 'Aktif',
    status_trialing: 'Deneme',
    status_past_due: 'Ödeme başarısız',
    status_canceled: 'İptal edildi',
    past_due_banner: "Ödeme başarısız — Premium'unun devam etmesi için kartını güncelle. Dokunarak çöz.",
    manage_subscription_kicker: 'ÜYELİĞİN',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: 'Ücretsiz plan',
    manage_subscription_default_msg: 'Planını değiştirmek, ödemeyi güncellemek veya iptal etmek için QR\'ı telefonunla tara.',
    manage_subscription_past_due_msg: 'Son ödemen başarısız oldu. QR\'ı telefonunla tara ve Premium\'a devam için kartını güncelle.',
    manage_subscription_canceling_msg: 'İptal ettin — Premium dönem sonuna kadar aktif kalır. Devam etmek için QR\'ı tara.',
  },
  de: {
    back: 'Zurück',
    account: 'Konto',
    plan: 'Plan',
    monthly: 'Monatlich',
    annual: 'Jährlich',
    renews_on: 'Verlängert am',
    ends_on: 'Endet am',
    refreshing: 'Wird aktualisiert…',
    refresh_status: 'Status aktualisieren',
    scan_with_phone: 'MIT DEM SMARTPHONE SCANNEN',
    status_active: 'Aktiv',
    status_trialing: 'Testphase',
    status_past_due: 'Zahlung fehlgeschlagen',
    status_canceled: 'Gekündigt',
    past_due_banner: 'Zahlung fehlgeschlagen — aktualisiere deine Karte, um Premium zu behalten. Tippe zum Beheben.',
    manage_subscription_kicker: 'DEIN ABO',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: 'Kostenloser Plan',
    manage_subscription_default_msg: 'Scanne den QR-Code mit deinem Smartphone, um Plan zu ändern, Zahlung zu aktualisieren oder zu kündigen.',
    manage_subscription_past_due_msg: 'Deine letzte Zahlung ist fehlgeschlagen. Scanne den QR-Code und aktualisiere deine Karte, um Premium zu behalten.',
    manage_subscription_canceling_msg: 'Du hast gekündigt — Premium bleibt bis zum Periodenende aktiv. Scanne, um fortzusetzen.',
  },
  es: {
    back: 'Atrás',
    account: 'Cuenta',
    plan: 'Plan',
    monthly: 'Mensual',
    annual: 'Anual',
    renews_on: 'Se renueva el',
    ends_on: 'Termina el',
    refreshing: 'Actualizando…',
    refresh_status: 'Actualizar estado',
    scan_with_phone: 'ESCANEA CON TU TELÉFONO',
    status_active: 'Activo',
    status_trialing: 'Prueba',
    status_past_due: 'Pago fallido',
    status_canceled: 'Cancelado',
    past_due_banner: 'Pago fallido — actualiza tu tarjeta para mantener Premium activo. Toca para resolver.',
    manage_subscription_kicker: 'TU SUSCRIPCIÓN',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: 'Plan gratuito',
    manage_subscription_default_msg: 'Escanea el código QR con tu teléfono para cambiar tu plan, actualizar el pago o cancelar.',
    manage_subscription_past_due_msg: 'Tu último pago falló. Escanea el código QR con tu teléfono y actualiza tu tarjeta para mantener Premium.',
    manage_subscription_canceling_msg: 'Has cancelado — Premium permanece activo hasta el final del período. Escanea para reanudar.',
  },
  fr: {
    back: 'Retour',
    account: 'Compte',
    plan: 'Abonnement',
    monthly: 'Mensuel',
    annual: 'Annuel',
    renews_on: 'Renouvellement le',
    ends_on: 'Se termine le',
    refreshing: 'Actualisation…',
    refresh_status: 'Actualiser le statut',
    scan_with_phone: 'SCANNEZ AVEC VOTRE TÉLÉPHONE',
    status_active: 'Actif',
    status_trialing: 'Essai',
    status_past_due: 'Paiement échoué',
    status_canceled: 'Annulé',
    past_due_banner: 'Paiement échoué — mettez à jour votre carte pour garder Premium actif. Appuyez pour résoudre.',
    manage_subscription_kicker: 'VOTRE ABONNEMENT',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: 'Plan gratuit',
    manage_subscription_default_msg: 'Scannez le code QR avec votre téléphone pour changer de plan, mettre à jour le paiement ou annuler.',
    manage_subscription_past_due_msg: 'Votre dernier paiement a échoué. Scannez le code QR et mettez à jour votre carte pour conserver Premium.',
    manage_subscription_canceling_msg: "Vous avez annulé — Premium reste actif jusqu'à la fin de la période. Scannez pour reprendre.",
  },
  it: {
    back: 'Indietro',
    account: 'Account',
    plan: 'Piano',
    monthly: 'Mensile',
    annual: 'Annuale',
    renews_on: 'Si rinnova il',
    ends_on: 'Termina il',
    refreshing: 'Aggiornamento…',
    refresh_status: 'Aggiorna stato',
    scan_with_phone: 'SCANSIONA CON IL TUO TELEFONO',
    status_active: 'Attivo',
    status_trialing: 'Prova',
    status_past_due: 'Pagamento fallito',
    status_canceled: 'Annullato',
    past_due_banner: 'Pagamento fallito — aggiorna la tua carta per mantenere Premium attivo. Tocca per risolvere.',
    manage_subscription_kicker: 'IL TUO ABBONAMENTO',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: 'Piano gratuito',
    manage_subscription_default_msg: 'Scansiona il codice QR con il tuo telefono per cambiare piano, aggiornare il pagamento o annullare.',
    manage_subscription_past_due_msg: 'Il tuo ultimo pagamento è fallito. Scansiona il codice QR e aggiorna la tua carta per mantenere Premium.',
    manage_subscription_canceling_msg: 'Hai annullato — Premium rimane attivo fino alla fine del periodo. Scansiona per riprendere.',
  },
  pt: {
    back: 'Voltar',
    account: 'Conta',
    plan: 'Plano',
    monthly: 'Mensal',
    annual: 'Anual',
    renews_on: 'Renova em',
    ends_on: 'Termina em',
    refreshing: 'Atualizando…',
    refresh_status: 'Atualizar status',
    scan_with_phone: 'ESCANEIE COM SEU TELEFONE',
    status_active: 'Ativo',
    status_trialing: 'Período de teste',
    status_past_due: 'Pagamento falhou',
    status_canceled: 'Cancelado',
    past_due_banner: 'Pagamento falhou — atualize seu cartão para manter o Premium ativo. Toque para corrigir.',
    manage_subscription_kicker: 'SUA ASSINATURA',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: 'Plano gratuito',
    manage_subscription_default_msg: 'Escaneie o código QR com seu telefone para mudar seu plano, atualizar o pagamento ou cancelar.',
    manage_subscription_past_due_msg: 'Seu último pagamento falhou. Escaneie o QR e atualize seu cartão para manter o Premium.',
    manage_subscription_canceling_msg: 'Você cancelou — o Premium permanece ativo até o final do período. Escaneie para retomar.',
  },
  ar: {
    back: 'رجوع',
    account: 'الحساب',
    plan: 'الخطة',
    monthly: 'شهري',
    annual: 'سنوي',
    renews_on: 'يتجدد في',
    ends_on: 'ينتهي في',
    refreshing: 'جارٍ التحديث…',
    refresh_status: 'تحديث الحالة',
    scan_with_phone: 'امسح بهاتفك',
    status_active: 'نشط',
    status_trialing: 'تجريبي',
    status_past_due: 'فشل الدفع',
    status_canceled: 'ملغى',
    past_due_banner: 'فشل الدفع — حدّث بطاقتك للحفاظ على اشتراك بريميوم. اضغط لإصلاح المشكلة.',
    manage_subscription_kicker: 'اشتراكك',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: 'الخطة المجانية',
    manage_subscription_default_msg: 'امسح رمز QR بهاتفك لتغيير خطتك أو تحديث الدفع أو الإلغاء.',
    manage_subscription_past_due_msg: 'فشلت آخر عملية دفع. امسح رمز QR وحدّث بطاقتك للاحتفاظ بـ Premium.',
    manage_subscription_canceling_msg: 'لقد ألغيت الاشتراك — يظل Premium نشطاً حتى نهاية الفترة. امسح للاستئناف.',
  },
  ru: {
    back: 'Назад',
    account: 'Аккаунт',
    plan: 'Тариф',
    monthly: 'Ежемесячно',
    annual: 'Ежегодно',
    renews_on: 'Продлевается',
    ends_on: 'Заканчивается',
    refreshing: 'Обновление…',
    refresh_status: 'Обновить статус',
    scan_with_phone: 'ОТСКАНИРУЙ ТЕЛЕФОНОМ',
    status_active: 'Активен',
    status_trialing: 'Пробный',
    status_past_due: 'Платёж не прошёл',
    status_canceled: 'Отменён',
    past_due_banner: 'Платёж не прошёл — обнови карту, чтобы сохранить Premium. Нажми для исправления.',
    manage_subscription_kicker: 'ТВОЯ ПОДПИСКА',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: 'Бесплатный тариф',
    manage_subscription_default_msg: 'Отсканируй QR-код телефоном, чтобы сменить тариф, обновить оплату или отменить.',
    manage_subscription_past_due_msg: 'Последний платёж не прошёл. Отсканируй QR и обнови карту, чтобы сохранить Premium.',
    manage_subscription_canceling_msg: 'Ты отменил подписку — Premium остаётся активным до конца периода. Отсканируй для возобновления.',
  },
  ja: {
    back: '戻る',
    account: 'アカウント',
    plan: 'プラン',
    monthly: '月額',
    annual: '年間',
    renews_on: '更新日',
    ends_on: '終了日',
    refreshing: '更新中…',
    refresh_status: 'ステータスを更新',
    scan_with_phone: 'スマホでスキャン',
    status_active: 'アクティブ',
    status_trialing: 'トライアル',
    status_past_due: '支払い失敗',
    status_canceled: 'キャンセル済み',
    past_due_banner: '支払いに失敗しました — Premiumを維持するにはカードを更新してください。タップして修正。',
    manage_subscription_kicker: 'サブスクリプション',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: '無料プラン',
    manage_subscription_default_msg: 'QRコードをスマホでスキャンして、プランの変更、支払いの更新、またはキャンセルができます。',
    manage_subscription_past_due_msg: '最後の支払いに失敗しました。QRコードをスキャンしてカードを更新し、Premiumを維持してください。',
    manage_subscription_canceling_msg: 'キャンセルしました — Premiumは期間終了まで有効です。再開するにはスキャンしてください。',
  },
  ko: {
    back: '뒤로',
    account: '계정',
    plan: '플랜',
    monthly: '월간',
    annual: '연간',
    renews_on: '갱신일',
    ends_on: '종료일',
    refreshing: '새로 고침 중…',
    refresh_status: '상태 새로 고침',
    scan_with_phone: '스마트폰으로 스캔',
    status_active: '활성',
    status_trialing: '체험판',
    status_past_due: '결제 실패',
    status_canceled: '취소됨',
    past_due_banner: '결제에 실패했습니다 — Premium을 유지하려면 카드를 업데이트하세요. 탭하여 수정.',
    manage_subscription_kicker: '내 구독',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: '무료 플랜',
    manage_subscription_default_msg: '스마트폰으로 QR 코드를 스캔하여 플랜 변경, 결제 업데이트 또는 취소를 할 수 있습니다.',
    manage_subscription_past_due_msg: '마지막 결제에 실패했습니다. QR 코드를 스캔하고 카드를 업데이트하여 Premium을 유지하세요.',
    manage_subscription_canceling_msg: '구독을 취소했습니다 — Premium은 기간이 끝날 때까지 유지됩니다. 재개하려면 스캔하세요.',
  },
  zh: {
    back: '返回',
    account: '账户',
    plan: '套餐',
    monthly: '月付',
    annual: '年付',
    renews_on: '续订日期',
    ends_on: '到期日期',
    refreshing: '刷新中…',
    refresh_status: '刷新状态',
    scan_with_phone: '用手机扫描',
    status_active: '有效',
    status_trialing: '试用中',
    status_past_due: '付款失败',
    status_canceled: '已取消',
    past_due_banner: '付款失败 — 请更新您的银行卡以保持 Premium 有效。点击修复。',
    manage_subscription_kicker: '您的订阅',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: '免费套餐',
    manage_subscription_default_msg: '用手机扫描二维码，更换套餐、更新付款方式或取消订阅。',
    manage_subscription_past_due_msg: '最近一次付款失败。请扫描二维码并更新您的银行卡以保持 Premium。',
    manage_subscription_canceling_msg: '您已取消 — Premium 将在当前周期结束前保持有效。扫描二维码可恢复订阅。',
  },
  hi: {
    back: 'वापस',
    account: 'खाता',
    plan: 'प्लान',
    monthly: 'मासिक',
    annual: 'वार्षिक',
    renews_on: 'नवीनीकरण तिथि',
    ends_on: 'समाप्ति तिथि',
    refreshing: 'रिफ्रेश हो रहा है…',
    refresh_status: 'स्थिति रिफ्रेश करें',
    scan_with_phone: 'अपने फ़ोन से स्कैन करें',
    status_active: 'सक्रिय',
    status_trialing: 'ट्रायल',
    status_past_due: 'भुगतान विफल',
    status_canceled: 'रद्द',
    past_due_banner: 'भुगतान विफल — Premium सक्रिय रखने के लिए अपना कार्ड अपडेट करें। ठीक करने के लिए टैप करें।',
    manage_subscription_kicker: 'आपकी सदस्यता',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: 'मुफ़्त प्लान',
    manage_subscription_default_msg: 'प्लान बदलने, भुगतान अपडेट करने या रद्द करने के लिए QR कोड स्कैन करें।',
    manage_subscription_past_due_msg: 'आपका अंतिम भुगतान विफल हो गया। QR कोड स्कैन करें और Premium बनाए रखने के लिए कार्ड अपडेट करें।',
    manage_subscription_canceling_msg: 'आपने रद्द कर दिया — Premium अवधि समाप्त होने तक सक्रिय रहेगा। फिर से शुरू करने के लिए स्कैन करें।',
  },
  he: {
    back: 'חזרה',
    account: 'חשבון',
    plan: 'תוכנית',
    monthly: 'חודשי',
    annual: 'שנתי',
    renews_on: 'מתחדש ב-',
    ends_on: 'מסתיים ב-',
    refreshing: 'מרענן…',
    refresh_status: 'רענן סטטוס',
    scan_with_phone: 'סרוק עם הטלפון שלך',
    status_active: 'פעיל',
    status_trialing: 'ניסיון',
    status_past_due: 'תשלום נכשל',
    status_canceled: 'בוטל',
    past_due_banner: 'התשלום נכשל — עדכן את הכרטיס שלך כדי לשמור על Premium פעיל. הקש לתיקון.',
    manage_subscription_kicker: 'המנוי שלך',
    manage_subscription_title_premium: 'MegaRadio Premium',
    manage_subscription_title_free: 'תוכנית חינמית',
    manage_subscription_default_msg: 'סרוק את קוד ה-QR עם הטלפון שלך כדי לשנות תוכנית, לעדכן תשלום, או לבטל.',
    manage_subscription_past_due_msg: 'התשלום האחרון שלך נכשל. סרוק את ה-QR ועדכן את הכרטיס שלך כדי לשמור על Premium.',
    manage_subscription_canceling_msg: 'ביטלת — Premium נשאר פעיל עד סוף התקופה. סרוק כדי לחדש.',
  },
};

export async function seedSubscriptionUiTranslations(): Promise<void> {
  try {
    const keyOps = KEYS.map((def) => ({
      updateOne: {
        filter: { key: def.key },
        update: {
          $setOnInsert: {
            key: def.key,
            defaultValue: def.defaultValue,
            description: def.description,
            category: 'subscription',
            createdAt: new Date(),
          },
          $set: { updatedAt: new Date() },
        },
        upsert: true,
      },
    }));
    if (keyOps.length > 0) {
      await TranslationKey.bulkWrite(keyOps, { ordered: false });
    }

    const keyDocs = await TranslationKey.find({ key: { $in: KEYS.map((d) => d.key) } })
      .select({ _id: 1, key: 1 })
      .lean();
    const keyIdByKey = new Map<string, unknown>();
    for (const doc of keyDocs) keyIdByKey.set(doc.key, doc._id);

    const existing = await Translation.find({ keyId: { $in: keyDocs.map((d) => d._id) } })
      .select({ keyId: 1, language: 1, value: 1 })
      .lean();
    const populated = new Set<string>();
    for (const tx of existing) {
      if (typeof tx.value === 'string' && tx.value.trim().length > 0) {
        populated.add(`${String(tx.keyId)}::${tx.language}`);
      }
    }

    const txOps: Parameters<typeof Translation.bulkWrite>[0] = [];
    for (const [language, values] of Object.entries(TRANSLATIONS)) {
      for (const def of KEYS) {
        const keyId = keyIdByKey.get(def.key);
        if (!keyId) continue;
        const value = values[def.key];
        if (typeof value !== 'string' || value.trim().length === 0) continue;
        if (populated.has(`${String(keyId)}::${language}`)) continue;
        txOps.push({
          updateOne: {
            filter: { keyId, language },
            update: {
              $set: { keyId, language, value, isCompleted: true, lastModified: new Date() },
              $setOnInsert: { createdAt: new Date() },
            },
            upsert: true,
          },
        });
      }
    }

    if (txOps.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < txOps.length; i += CHUNK) {
        await Translation.bulkWrite(txOps.slice(i, i + CHUNK), { ordered: false });
      }
      logger.log(
        `✅ seedSubscriptionUiTranslations: backfilled ${txOps.length} subscription UI rows ` +
          `across ${Object.keys(TRANSLATIONS).length} languages.`,
      );
    }
  } catch (err) {
    logger.error('seedSubscriptionUiTranslations failed (non-fatal):', err);
  }
}

import type { PushNotificationMessages } from '@/hooks/usePushNotifications';
import { getProfileSettingsCopy } from './profile-settings-copy';

const outcomes: Record<string, readonly [string, string, string, string]> = {
  en: ['A test notification has been sent.', 'The notification action failed. Please try again.', 'The permission prompt was closed. Try again and choose Allow.', 'Enable notifications first.'],
  de: ['Eine Testbenachrichtigung wurde gesendet.', 'Die Benachrichtigungsaktion ist fehlgeschlagen. Bitte versuche es erneut.', 'Die Berechtigungsabfrage wurde geschlossen. Versuche es erneut und wähle „Zulassen“.', 'Aktiviere zuerst die Benachrichtigungen.'],
  tr: ['Test bildirimi gönderildi.', 'Bildirim işlemi başarısız oldu. Tekrar dene.', 'İzin penceresi kapatıldı. Tekrar dene ve İzin ver seçeneğini seç.', 'Önce bildirimleri etkinleştir.'],
  es: ['Se ha enviado una notificación de prueba.', 'La acción de notificaciones ha fallado. Inténtalo de nuevo.', 'Se cerró la solicitud de permiso. Inténtalo de nuevo y elige Permitir.', 'Activa primero las notificaciones.'],
  fr: ['Une notification de test a été envoyée.', 'L’action de notification a échoué. Réessayez.', 'La demande d’autorisation a été fermée. Réessayez et choisissez Autoriser.', 'Activez d’abord les notifications.'],
  pt: ['Uma notificação de teste foi enviada.', 'A ação de notificação falhou. Tente novamente.', 'O pedido de permissão foi fechado. Tente novamente e escolha Permitir.', 'Ative as notificações primeiro.'],
  it: ['È stata inviata una notifica di prova.', 'L’azione relativa alle notifiche non è riuscita. Riprova.', 'La richiesta di autorizzazione è stata chiusa. Riprova e scegli Consenti.', 'Attiva prima le notifiche.'],
  ru: ['Тестовое уведомление отправлено.', 'Не удалось выполнить действие с уведомлениями. Попробуйте снова.', 'Запрос разрешения был закрыт. Попробуйте снова и выберите «Разрешить».', 'Сначала включите уведомления.'],
  ar: ['تم إرسال إشعار تجريبي.', 'فشل إجراء الإشعارات. حاول مرة أخرى.', 'تم إغلاق طلب الإذن. حاول مرة أخرى واختر السماح.', 'فعّل الإشعارات أولًا.'],
  zh: ['测试通知已发送。', '通知操作失败，请重试。', '权限提示已关闭。请重试并选择允许。', '请先开启通知。'],
  ja: ['テスト通知を送信しました。', '通知の操作に失敗しました。もう一度お試しください。', '許可の確認画面が閉じられました。もう一度試して「許可」を選択してください。', 'まず通知を有効にしてください。'],
  ko: ['테스트 알림을 보냈습니다.', '알림 작업에 실패했습니다. 다시 시도해 주세요.', '권한 요청 창이 닫혔습니다. 다시 시도하고 허용을 선택하세요.', '먼저 알림을 켜세요.'],
  hi: ['परीक्षण सूचना भेज दी गई है।', 'सूचना की कार्रवाई विफल हुई। फिर से कोशिश करें।', 'अनुमति का संदेश बंद कर दिया गया। फिर से कोशिश करें और अनुमति दें चुनें।', 'पहले सूचनाएँ चालू करें।'],
  he: ['נשלחה התראת בדיקה.', 'פעולת ההתראות נכשלה. נסו שוב.', 'בקשת ההרשאה נסגרה. נסו שוב ובחרו באישור.', 'יש להפעיל תחילה את ההתראות.'],
};

export function getProfileSettingsNotificationMessages(language = 'en', translations?: Readonly<Record<string, string>>): PushNotificationMessages {
  const locale = language.toLowerCase().split('-')[0];
  const base = getProfileSettingsCopy(locale, translations);
  const [testSent, failed, permissionDismissed, notSubscribed] = outcomes[locale] || outcomes.en;
  const result: PushNotificationMessages = {
    successTitle: base.success, errorTitle: base.error, unsupported: base.unsupported, blocked: base.notificationBlockedHint,
    permissionGranted: `${base.notifications}: ${base.enabled}`, subscribed: `${base.notifications}: ${base.enabled}`,
    unsubscribed: `${base.notifications}: ${base.disabled}`, testSent, failed, permissionDismissed, notSubscribed,
  };
  const english = locale === 'en' ? result : getProfileSettingsNotificationMessages('en');
  for (const key of Object.keys(result) as (keyof PushNotificationMessages)[]) {
    const value = translations?.[`profile_notifications_${key}`]?.trim();
    if (value && !(locale !== 'en' && value === english[key])) result[key] = value;
  }
  return result;
}

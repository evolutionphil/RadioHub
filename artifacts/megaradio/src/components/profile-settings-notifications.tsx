import { useMemo, useRef, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import type { ProfileSettingsCopy } from '@/lib/profile-settings-copy';
import { getProfileSettingsNotificationMessages } from '@/lib/profile-settings-notification-copy';
import { useTranslation } from '@/hooks/useTranslation';

/** Subscription actions are immediate browser actions, independent of profile save. */
export function ProfileSettingsNotifications({ copy }: { copy: ProfileSettingsCopy }) {
  const { language, localeTranslations } = useTranslation();
  const messages = useMemo(() => getProfileSettingsNotificationMessages(language, localeTranslations), [language, localeTranslations]);
  const { isSupported, isSubscribed, permission, isLoading, subscribe, unsubscribe, sendTestNotification } = usePushNotifications(messages);
  const actionPending = useRef(false);
  const [pending, setPending] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    if (actionPending.current) return;
    actionPending.current = true;
    setPending(true);
    try { await action(); } finally { actionPending.current = false; setPending(false); }
  };
  const busy = isLoading || pending;
  return <section aria-labelledby="profile-notifications-title" className="rounded-2xl border border-white/[0.08] bg-[#151515] p-5 sm:p-6">
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FF4199]/10 text-[#FF4199]">
        {isSupported ? <Bell className="h-5 w-5" aria-hidden="true" /> : <BellOff className="h-5 w-5" aria-hidden="true" />}
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="profile-notifications-title" className="text-lg font-bold text-white">{copy.notifications}</h2>
        <p className="mt-1 text-sm leading-relaxed text-[#a3a3a3]">{isSupported ? copy.notificationsHint : copy.unsupported}</p>
      </div>
    </div>
    {isSupported && <div className="mt-5 border-t border-white/[0.08] pt-5">
      <div className="mb-4 flex items-center gap-2 text-sm text-[#c4c4c4]" role="status">
        <span className={`h-2 w-2 rounded-full ${isSubscribed ? 'bg-[#FF4199]' : 'bg-[#666]'}`} />
        {permission === 'denied' ? copy.blocked : isSubscribed ? copy.enabled : copy.disabled}
      </div>
      {permission === 'denied' && <p className="mb-4 text-sm leading-relaxed text-[#a3a3a3]">{copy.notificationBlockedHint}</p>}
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal border-white/15 bg-transparent px-4 py-2 text-white hover:bg-white/5" disabled={busy || (!isSubscribed && permission === 'denied')} onClick={() => void run(isSubscribed ? unsubscribe : subscribe)}>
          {busy && <Loader2 className="me-2 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
          {isSubscribed ? copy.disableNotifications : copy.enableNotifications}
        </Button>
        {isSubscribed && <Button type="button" variant="ghost" disabled={busy} className="h-auto min-h-11 max-w-full whitespace-normal text-[#ff73b3] hover:bg-[#FF4199]/10 hover:text-[#ff9bc8]" onClick={() => void run(sendTestNotification)}>{copy.testNotification}</Button>}
      </div>
    </div>}
  </section>;
}

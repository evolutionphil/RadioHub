import { useEffect } from 'react';
import { PushNotificationManager } from '@/services/pushNotificationManager';

/** Keep notification action forwarding available once for the application.
 * Station cards do not need their own permission polling or SW listeners. */
export function PushNotificationBridge() {
  useEffect(() => {
    void PushNotificationManager.getInstance().initialize();
  }, []);
  return null;
}

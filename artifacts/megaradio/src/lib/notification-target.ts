import { translateUrl } from '@workspace/seo-shared/url-translations';

export function notificationTarget(notification: { type: string; fromUserId?: unknown; data?: Record<string, any> }, language: string): string | null {
  const sender = notification.fromUserId;
  const senderId = typeof sender === 'string' ? sender : sender && typeof sender === 'object' ? (sender as any)._id : null;
  if (notification.type === 'new_message' && typeof senderId === 'string' && /^[a-f0-9]{24}$/i.test(senderId))
    return `/${language}/profile/messages?partner=${senderId}`;
  if (['follow', 'unfollow'].includes(notification.type) && typeof senderId === 'string' && /^[a-f0-9]{24}$/i.test(senderId))
    return `/${language}/users/${senderId}`;
  if (['new_station', 'favorite_station', 'favorite_update'].includes(notification.type)) {
    const identifier = notification.data?.stationSlug || notification.data?.stationId;
    if (typeof identifier === 'string' && identifier.trim())
      return `/${language}${translateUrl(`/station/${encodeURIComponent(identifier)}`, language)}`;
  }
  return null;
}

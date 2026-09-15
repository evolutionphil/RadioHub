/** Explicit fallbacks keep favorite feedback localized while dictionaries load. */
const messages: Record<string, readonly [string, string, string, string, string]> = {
  en: ['Added to favorites', 'Removed from favorites', 'Saved to your collection', 'Your favorites have been updated', 'Dismiss notification'],
  de: ['Zu Favoriten hinzugefügt', 'Aus Favoriten entfernt', 'In deiner Sammlung gespeichert', 'Deine Favoriten wurden aktualisiert', 'Benachrichtigung schließen'],
  tr: ['Favorilere eklendi', 'Favorilerden kaldırıldı', 'Koleksiyonuna kaydedildi', 'Favorilerin güncellendi', 'Bildirimi kapat'],
  fr: ['Ajouté aux favoris', 'Retiré des favoris', 'Enregistré dans votre collection', 'Vos favoris ont été mis à jour', 'Fermer la notification'],
  es: ['Añadido a favoritos', 'Eliminado de favoritos', 'Guardado en tu colección', 'Tus favoritos se han actualizado', 'Cerrar notificación'],
  it: ['Aggiunto ai preferiti', 'Rimosso dai preferiti', 'Salvato nella tua raccolta', 'I tuoi preferiti sono stati aggiornati', 'Chiudi notifica'],
  pt: ['Adicionado aos favoritos', 'Removido dos favoritos', 'Guardado na sua coleção', 'Os seus favoritos foram atualizados', 'Fechar notificação'],
  ru: ['Добавлено в избранное', 'Удалено из избранного', 'Сохранено в вашей коллекции', 'Избранное обновлено', 'Закрыть уведомление'],
  ko: ['즐겨찾기에 추가됨', '즐겨찾기에서 삭제됨', '컬렉션에 저장되었습니다', '즐겨찾기가 업데이트되었습니다', '알림 닫기'],
  hi: ['पसंदीदा में जोड़ा गया', 'पसंदीदा से हटाया गया', 'आपके संग्रह में सहेजा गया', 'आपकी पसंदीदा सूची अपडेट हो गई है', 'सूचना बंद करें'],
  he: ['נוסף למועדפים', 'הוסר מהמועדפים', 'נשמר באוסף שלך', 'המועדפים שלך עודכנו', 'סגירת התראה'],
  ar: ['تمت الإضافة إلى المفضلة', 'تمت الإزالة من المفضلة', 'تم الحفظ في مجموعتك', 'تم تحديث المفضلة', 'إغلاق الإشعار'],
  zh: ['已添加到收藏', '已从收藏中移除', '已保存到你的收藏', '你的收藏已更新', '关闭通知'],
  ja: ['お気に入りに追加しました', 'お気に入りから削除しました', 'コレクションに保存しました', 'お気に入りを更新しました', '通知を閉じる'],
};

export function favoriteNotificationText(language: string | undefined, translations?: Record<string, string>) {
  const text = messages[language ?? 'en'] ?? messages.en;
  const translated = (key: string, fallback: string) => translations?.[key]?.trim() || fallback;
  return {
    added: translated('favorites_added_to_favorites', text[0]),
    removed: translated('favorites_removed_from_favorites', text[1]),
    addedDescription: translated('favorites_added_to_favorites_description', text[2]),
    removedDescription: translated('favorites_removed_from_favorites_description', text[3]),
    close: translated('notification_dismiss', text[4]),
  };
}

// A station may have a heart in the list, detail view, and global player. Keep
// rapid concurrent clicks from issuing duplicate writes/announcements. No
// per-card observers, timers, persistent storage, or global account state.
const pendingFavorites = new WeakMap<object, Set<string>>();
export function acquireFavoriteMutation(client: object, userId: string, stationId: string): (() => void) | null {
  let pending = pendingFavorites.get(client);
  if (!pending) { pending = new Set(); pendingFavorites.set(client, pending); }
  const key = JSON.stringify([userId, stationId]);
  if (pending.has(key)) return null;
  pending.add(key);
  let released = false;
  return () => { if (!released) { pending.delete(key); released = true; } };
}

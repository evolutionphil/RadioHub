// Shared navigation stays independent of the private chat dictionaries.
const profileKeys = ['favorites', 'discover', 'profile', 'messages', 'feedback', 'logout'] as const;
const profileRows: Record<string, string[]> = {
  en: ['Your Favorites', 'Discover', 'Profile', 'Messages', 'Feedback', 'Logout'],
  de: ['Deine Favoriten', 'Entdecken', 'Profil', 'Nachrichten', 'Feedback', 'Abmelden'],
  tr: ['Favorilerin', 'Keşfet', 'Profil', 'Mesajlar', 'Geri bildirim', 'Çıkış yap'],
  es: ['Tus favoritos', 'Descubrir', 'Perfil', 'Mensajes', 'Comentarios', 'Cerrar sesión'],
  fr: ['Vos favoris', 'Découvrir', 'Profil', 'Messages', 'Commentaires', 'Déconnexion'],
  pt: ['Seus favoritos', 'Descobrir', 'Perfil', 'Mensagens', 'Comentários', 'Sair'],
  it: ['I tuoi preferiti', 'Scopri', 'Profilo', 'Messaggi', 'Feedback', 'Esci'],
  ru: ['Избранное', 'Обзор', 'Профиль', 'Сообщения', 'Обратная связь', 'Выйти'],
  ar: ['مفضلاتك', 'اكتشف', 'الملف الشخصي', 'الرسائل', 'الملاحظات', 'تسجيل الخروج'],
  zh: ['你的收藏', '发现', '个人资料', '消息', '反馈', '退出登录'],
  ja: ['お気に入り', '見つける', 'プロフィール', 'メッセージ', 'フィードバック', 'ログアウト'],
  ko: ['즐겨찾기', '둘러보기', '프로필', '메시지', '피드백', '로그아웃'],
  hi: ['आपके पसंदीदा', 'खोजें', 'प्रोफ़ाइल', 'संदेश', 'प्रतिक्रिया', 'लॉग आउट'],
  he: ['המועדפים שלך', 'גילוי', 'פרופיל', 'הודעות', 'משוב', 'התנתקות'],
};

export function getProfileNavCopy(language: string): Record<typeof profileKeys[number], string> {
  const row = profileRows[language.split('-')[0]] || profileRows.en;
  return Object.fromEntries(profileKeys.map((key, index) => [key, row[index]])) as Record<typeof profileKeys[number], string>;
}

// Small, synchronous fallback for the private chat shell while dictionaries load.
// Existing translated/admin-managed message strings still take precedence.
const keys = ['title', 'chats', 'contacts', 'search', 'connecting', 'live', 'online', 'offline', 'typing', 'back', 'send', 'image', 'message', 'empty', 'select', 'start', 'noContacts', 'greeting', 'removeImage'] as const;
type ChatCopy = Record<typeof keys[number], string>;
const rows: Record<string, string[]> = {
  en: ['Messages', 'Chats', 'Contacts', 'Search people…', 'Connecting…', 'Live', 'Online', 'Offline', 'typing…', 'Back to conversations', 'Send message', 'Send image', 'Message {name}', 'No conversations yet', 'Select a conversation to get started', 'Find someone you follow and say hello.', 'Follow someone to see contacts here.', 'Say hello to {name}!', 'Remove image'],
  de: ['Nachrichten', 'Chats', 'Kontakte', 'Personen suchen…', 'Verbinden…', 'Live', 'Online', 'Offline', 'schreibt…', 'Zurück zu den Chats', 'Nachricht senden', 'Bild senden', 'Nachricht an {name}', 'Noch keine Unterhaltungen', 'Wähle einen Chat aus, um loszulegen', 'Finde jemanden, dem du folgst, und sag Hallo.', 'Folge jemandem, um hier Kontakte zu sehen.', 'Sag Hallo zu {name}!', 'Bild entfernen'],
  tr: ['Mesajlar', 'Sohbetler', 'Kişiler', 'Kişi ara…', 'Bağlanıyor…', 'Canlı', 'Çevrimiçi', 'Çevrimdışı', 'yazıyor…', 'Sohbetlere dön', 'Mesaj gönder', 'Görsel gönder', '{name} kişisine mesaj', 'Henüz sohbet yok', 'Başlamak için bir sohbet seç', 'Takip ettiğin birini bul ve merhaba de.', 'Kişileri görmek için birini takip et.', '{name} kişisine merhaba de!', 'Görseli kaldır'],
  fr: ['Messages', 'Discussions', 'Contacts', 'Rechercher une personne…', 'Connexion…', 'En direct', 'En ligne', 'Hors ligne', 'écrit…', 'Retour aux discussions', 'Envoyer le message', 'Envoyer une image', 'Message à {name}', 'Aucune discussion', 'Choisissez une discussion pour commencer', 'Retrouvez une personne suivie et dites bonjour.', 'Suivez une personne pour voir vos contacts.', 'Dites bonjour à {name} !', 'Retirer l’image'],
  es: ['Mensajes', 'Chats', 'Contactos', 'Buscar personas…', 'Conectando…', 'En vivo', 'En línea', 'Sin conexión', 'escribiendo…', 'Volver a los chats', 'Enviar mensaje', 'Enviar imagen', 'Mensaje a {name}', 'Aún no hay conversaciones', 'Selecciona una conversación para empezar', 'Encuentra a alguien que sigues y saluda.', 'Sigue a alguien para ver contactos aquí.', '¡Saluda a {name}!', 'Eliminar imagen'],
  it: ['Messaggi', 'Chat', 'Contatti', 'Cerca persone…', 'Connessione…', 'In diretta', 'Online', 'Offline', 'sta scrivendo…', 'Torna alle chat', 'Invia messaggio', 'Invia immagine', 'Messaggio a {name}', 'Nessuna conversazione', 'Seleziona una conversazione per iniziare', 'Trova qualcuno che segui e saluta.', 'Segui qualcuno per vedere i contatti.', 'Saluta {name}!', 'Rimuovi immagine'],
  pt: ['Mensagens', 'Conversas', 'Contatos', 'Buscar pessoas…', 'Conectando…', 'Ao vivo', 'Online', 'Offline', 'digitando…', 'Voltar às conversas', 'Enviar mensagem', 'Enviar imagem', 'Mensagem para {name}', 'Ainda não há conversas', 'Selecione uma conversa para começar', 'Encontre alguém que você segue e diga olá.', 'Siga alguém para ver contatos aqui.', 'Diga olá para {name}!', 'Remover imagem'],
  ru: ['Сообщения', 'Чаты', 'Контакты', 'Поиск людей…', 'Подключение…', 'В эфире', 'В сети', 'Не в сети', 'печатает…', 'Назад к чатам', 'Отправить сообщение', 'Отправить изображение', 'Сообщение для {name}', 'Пока нет переписок', 'Выберите чат, чтобы начать', 'Найдите человека, на которого подписаны, и поздоровайтесь.', 'Подпишитесь на кого-нибудь, чтобы увидеть контакты.', 'Поздоровайтесь с {name}!', 'Удалить изображение'],
  nl: ['Berichten', 'Chats', 'Contacten', 'Personen zoeken…', 'Verbinden…', 'Live', 'Online', 'Offline', 'typt…', 'Terug naar chats', 'Bericht verzenden', 'Afbeelding verzenden', 'Bericht aan {name}', 'Nog geen gesprekken', 'Selecteer een gesprek om te beginnen', 'Zoek iemand die je volgt en zeg hallo.', 'Volg iemand om hier contacten te zien.', 'Zeg hallo tegen {name}!', 'Afbeelding verwijderen'],
  pl: ['Wiadomości', 'Czaty', 'Kontakty', 'Szukaj osób…', 'Łączenie…', 'Na żywo', 'Online', 'Offline', 'pisze…', 'Powrót do czatów', 'Wyślij wiadomość', 'Wyślij obraz', 'Wiadomość do {name}', 'Brak rozmów', 'Wybierz rozmowę, aby rozpocząć', 'Znajdź kogoś, kogo obserwujesz, i przywitaj się.', 'Obserwuj kogoś, aby zobaczyć kontakty.', 'Przywitaj się z {name}!', 'Usuń obraz'],
  ro: ['Mesaje', 'Conversații', 'Contacte', 'Caută persoane…', 'Conectare…', 'În direct', 'Online', 'Offline', 'scrie…', 'Înapoi la conversații', 'Trimite mesaj', 'Trimite imagine', 'Mesaj pentru {name}', 'Nicio conversație încă', 'Selectează o conversație pentru a începe', 'Găsește o persoană pe care o urmărești și salut-o.', 'Urmărește pe cineva pentru a vedea contacte.', 'Salută-l pe {name}!', 'Elimină imaginea'],
  el: ['Μηνύματα', 'Συνομιλίες', 'Επαφές', 'Αναζήτηση ατόμων…', 'Σύνδεση…', 'Ζωντανά', 'Συνδεδεμένος', 'Εκτός σύνδεσης', 'γράφει…', 'Πίσω στις συνομιλίες', 'Αποστολή μηνύματος', 'Αποστολή εικόνας', 'Μήνυμα στον/στην {name}', 'Δεν υπάρχουν συνομιλίες', 'Επίλεξε μια συνομιλία για να ξεκινήσεις', 'Βρες κάποιον που ακολουθείς και πες γεια.', 'Ακολούθησε κάποιον για να δεις επαφές.', 'Πες γεια στον/στην {name}!', 'Αφαίρεση εικόνας'],
  ar: ['الرسائل', 'المحادثات', 'جهات الاتصال', 'البحث عن أشخاص…', 'جارٍ الاتصال…', 'مباشر', 'متصل', 'غير متصل', 'يكتب…', 'العودة إلى المحادثات', 'إرسال رسالة', 'إرسال صورة', 'رسالة إلى {name}', 'لا توجد محادثات بعد', 'اختر محادثة للبدء', 'ابحث عن شخص تتابعه وألقِ التحية.', 'تابع شخصًا لعرض جهات الاتصال هنا.', 'ألقِ التحية على {name}!', 'إزالة الصورة'],
  zh: ['消息', '聊天', '联系人', '搜索用户…', '正在连接…', '实时', '在线', '离线', '正在输入…', '返回聊天列表', '发送消息', '发送图片', '给{name}发消息', '暂无聊天', '选择一个聊天开始交流', '找到你关注的人，打个招呼吧。', '关注用户后即可在此查看联系人。', '向{name}打个招呼！', '移除图片'],
  ja: ['メッセージ', 'チャット', '連絡先', 'ユーザーを検索…', '接続中…', 'ライブ', 'オンライン', 'オフライン', '入力中…', 'チャット一覧に戻る', 'メッセージを送信', '画像を送信', '{name}にメッセージ', 'まだ会話はありません', '会話を選んで始めましょう', 'フォローしている人に挨拶しましょう。', 'ユーザーをフォローすると連絡先が表示されます。', '{name}に挨拶しましょう！', '画像を削除'],
  ko: ['메시지', '채팅', '연락처', '사용자 검색…', '연결 중…', '실시간', '온라인', '오프라인', '입력 중…', '채팅 목록으로 돌아가기', '메시지 보내기', '이미지 보내기', '{name}에게 메시지', '아직 대화가 없습니다', '대화를 선택하여 시작하세요', '팔로우하는 사람에게 인사해 보세요.', '사용자를 팔로우하면 연락처가 표시됩니다.', '{name}에게 인사해 보세요!', '이미지 삭제'],
  hi: ['संदेश', 'चैट', 'संपर्क', 'लोगों को खोजें…', 'कनेक्ट हो रहा है…', 'लाइव', 'ऑनलाइन', 'ऑफ़लाइन', 'लिख रहे हैं…', 'चैट पर वापस जाएँ', 'संदेश भेजें', 'तस्वीर भेजें', '{name} को संदेश', 'अभी कोई बातचीत नहीं', 'शुरू करने के लिए बातचीत चुनें', 'जिसे आप फ़ॉलो करते हैं उसे नमस्ते कहें।', 'संपर्क देखने के लिए किसी को फ़ॉलो करें।', '{name} को नमस्ते कहें!', 'तस्वीर हटाएँ'],
  he: ['הודעות', 'שיחות', 'אנשי קשר', 'חיפוש אנשים…', 'מתחבר…', 'חי', 'מחובר', 'לא מחובר', 'מקליד…', 'חזרה לשיחות', 'שליחת הודעה', 'שליחת תמונה', 'הודעה אל {name}', 'אין שיחות עדיין', 'בחרו שיחה כדי להתחיל', 'מצאו מישהו שאתם עוקבים אחריו ואמרו שלום.', 'עקבו אחרי מישהו כדי לראות כאן אנשי קשר.', 'אמרו שלום ל־{name}!', 'הסרת תמונה'],
};

export function getChatCopy(language: string): ChatCopy {
  const row = rows[language.split('-')[0]] || rows.en;
  return Object.fromEntries(keys.map((key, index) => [key, row[index]])) as ChatCopy;
}

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

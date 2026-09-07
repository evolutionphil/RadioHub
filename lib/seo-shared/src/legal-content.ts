/**
 * Shared SSR/SPA translations of existing website legal copy, not a new policy.
 * Keep clauses in their original order and do not import mobile-only purchase
 * promises. Effective dates and operator identity require owner confirmation;
 * never derive a legal revision date from the visitor's clock.
 */
export const LEGAL_LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'] as const;
export type LegalLocale = typeof LEGAL_LOCALES[number];
export type LegalPageKind = 'privacy' | 'terms';
export interface LegalGroup { title: string; text: string; items: readonly string[] }
export interface LegalSection { title: string; text?: string; items?: readonly string[]; groups?: readonly LegalGroup[]; contact?: boolean }
export interface LegalPageCopy { title: string; subtitle: string; sections: readonly LegalSection[] }
export interface LegalLocaleCopy { email: string; privacy: LegalPageCopy; terms: LegalPageCopy }

// These contact mailboxes are already published in /api/app/pages. The former
// street address was literal template text, not a verified operator address.
export const LEGAL_CONTACT_EMAIL = { privacy: 'privacy@themegaradio.com', terms: 'legal@themegaradio.com' } as const;
export const LEGAL_REVIEWED_AT: string | null = null;

export const EN_LEGAL_CONTENT: LegalLocaleCopy = {
  email: 'Email',
  privacy: {
    title: 'Privacy Policy', subtitle: 'Your privacy and data protection information', sections: [
      { title: 'Introduction', text: 'At Mega Radio ("we," "our," or "us"), we respect your privacy and are committed to protecting your personal data. This privacy policy explains how we collect, use, and safeguard your information when you use our radio streaming service.' },
      { title: 'Information We Collect', groups: [
        { title: 'Personal Information', text: 'When you create an account or contact us, we may collect:', items: ['Name and email address', 'Username and password', 'Profile information and preferences', 'Communication history with our support team'] },
        { title: 'Usage Information', text: 'We automatically collect information about how you use our service:', items: ['Listening history and preferences', 'Device information and IP address', 'Browser type and operating system', 'Time and duration of your sessions'] },
      ] },
      { title: 'How We Use Your Information', items: ['To provide and improve our radio streaming service', 'To personalize your listening experience', 'To communicate with you about service updates', 'To provide customer support', 'To analyze usage patterns and improve our platform', 'To comply with legal obligations'] },
      { title: 'Information Sharing', text: 'We do not sell, trade, or rent your personal information. We may share your information only in these circumstances:', items: ['With your explicit consent', 'To comply with legal requirements', 'To protect our rights and property', 'With trusted service providers who assist in our operations', 'In connection with a business transfer or merger'] },
      { title: 'Data Security', text: 'We implement appropriate technical and organizational measures to protect your personal data against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the internet is 100% secure.' },
      { title: 'Your Rights', text: 'You have the right to:', items: ['Access your personal data', 'Correct inaccurate information', 'Delete your account and data', 'Export your data', 'Opt out of certain communications', 'Restrict processing of your data'] },
      { title: 'Cookies and Tracking', text: 'We use cookies and similar technologies to enhance your experience, analyze usage, and provide personalized content. You can control cookie settings through your browser preferences.' },
      { title: 'Third-Party Links', text: 'Our service may contain links to third-party websites. We are not responsible for the privacy practices of these external sites. We encourage you to review their privacy policies.' },
      { title: 'Changes to This Policy', text: 'We may update this privacy policy from time to time. We will notify you of any material changes by posting the new policy on this page and updating the "last updated" date.' },
      { title: 'Contact Us', text: 'If you have any questions about this privacy policy or our data practices, please contact us at:', contact: true },
    ],
  },
  terms: {
    title: 'Terms and Conditions', subtitle: 'Terms of use for Mega Radio services', sections: [
      { title: 'Acceptance of Terms', text: 'By accessing and using Mega Radio\'s services, you accept and agree to be bound by the terms and provision of this agreement. These Terms of Service govern your use of our radio streaming platform.' },
      { title: 'Description of Service', text: 'Mega Radio provides access to a collection of internet radio stations and streaming audio content. Our service allows users to discover, listen to, and enjoy radio stations from around the world.' },
      { title: 'User Accounts', items: ['You must provide accurate and complete information when creating an account', 'You are responsible for maintaining the confidentiality of your account credentials', 'You must notify us immediately of any unauthorized use of your account', 'One person or legal entity may not maintain more than one account'] },
      { title: 'Acceptable Use', text: 'You agree not to:', items: ['Use the service for any unlawful purposes or activities', 'Attempt to gain unauthorized access to our systems or other users\' accounts', 'Interfere with or disrupt the service or servers connected to the service', 'Reproduce, distribute, or create derivative works from our content without permission', 'Use automated systems to access the service without our written consent', 'Upload or transmit viruses, malware, or other harmful code'] },
      { title: 'Intellectual Property', text: 'The service and its original content are and will remain the exclusive property of Mega Radio and its licensors. The service is protected by copyright, trademark, and other laws. Our trademarks may not be used without our prior written consent.' },
      { title: 'Content and Radio Stations', text: 'We aggregate and provide access to radio stations and content from various sources. We do not own or control the content of these radio stations. Station availability and content quality may vary and are subject to the policies of individual broadcasters.' },
      { title: 'Privacy', text: 'Your privacy is important to us. Please review our Privacy Policy, which also governs your use of the service, to understand our practices.' },
      { title: 'Disclaimers', text: 'The service is provided "as is" without any representations or warranties, express or implied. We make no representations or warranties in relation to this service or the information and materials provided on this service.' },
      { title: 'Limitation of Liability', text: 'In no event shall Mega Radio, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential, or punitive damages arising out of your use of the service.' },
      { title: 'Termination', text: 'We may terminate or suspend your account and bar access to the service immediately, without prior notice or liability, under our sole discretion, for any reason whatsoever and without limitation, including but not limited to a breach of the Terms.' },
      { title: 'Changes to Terms', text: 'We reserve the right, at our sole discretion, to modify or replace these Terms at any time. If a revision is material, we will provide at least 30 days notice prior to any new terms taking effect.' },
      { title: 'Governing Law', text: 'These Terms shall be interpreted and governed by the laws of the jurisdiction in which Mega Radio operates, without regard to its conflict of law provisions.' },
      { title: 'Contact Information', text: 'If you have any questions about these Terms and Conditions, please contact us at:', contact: true },
    ],
  },
};

export const DE_LEGAL_CONTENT: LegalLocaleCopy = {
  email: 'E-Mail',
  privacy: { title: 'Datenschutzerklärung', subtitle: 'Informationen zu Ihrer Privatsphäre und zum Datenschutz', sections: [
    { title: 'Einleitung', text: 'Bei Mega Radio („wir“, „uns“ oder „unser“) achten wir Ihre Privatsphäre und setzen uns für den Schutz Ihrer personenbezogenen Daten ein. Diese Datenschutzerklärung erläutert, wie wir Ihre Informationen erfassen, verwenden und schützen, wenn Sie unseren Radio-Streaming-Dienst nutzen.' },
    { title: 'Welche Informationen wir erfassen', groups: [
      { title: 'Personenbezogene Informationen', text: 'Wenn Sie ein Konto erstellen oder uns kontaktieren, können wir Folgendes erfassen:', items: ['Name und E-Mail-Adresse', 'Benutzername und Passwort', 'Profilinformationen und Einstellungen', 'Kommunikationsverlauf mit unserem Supportteam'] },
      { title: 'Nutzungsinformationen', text: 'Wir erfassen automatisch Informationen darüber, wie Sie unseren Dienst nutzen:', items: ['Hörverlauf und Vorlieben', 'Geräteinformationen und IP-Adresse', 'Browsertyp und Betriebssystem', 'Zeitpunkt und Dauer Ihrer Sitzungen'] },
    ] },
    { title: 'Wie wir Ihre Informationen verwenden', items: ['Zur Bereitstellung und Verbesserung unseres Radio-Streaming-Dienstes', 'Zur Personalisierung Ihres Hörerlebnisses', 'Um Sie über Aktualisierungen des Dienstes zu informieren', 'Zur Bereitstellung von Kundensupport', 'Zur Analyse von Nutzungsmustern und Verbesserung unserer Plattform', 'Zur Erfüllung gesetzlicher Verpflichtungen'] },
    { title: 'Weitergabe von Informationen', text: 'Wir verkaufen, tauschen oder vermieten Ihre personenbezogenen Informationen nicht. Wir können Ihre Informationen ausschließlich in folgenden Fällen weitergeben:', items: ['Mit Ihrer ausdrücklichen Einwilligung', 'Zur Erfüllung gesetzlicher Anforderungen', 'Zum Schutz unserer Rechte und unseres Eigentums', 'An vertrauenswürdige Dienstleister, die uns bei unserem Betrieb unterstützen', 'Im Zusammenhang mit einer Unternehmensübertragung oder einem Zusammenschluss'] },
    { title: 'Datensicherheit', text: 'Wir setzen geeignete technische und organisatorische Maßnahmen ein, um Ihre personenbezogenen Daten vor unbefugtem Zugriff, Veränderung, Offenlegung oder Zerstörung zu schützen. Allerdings ist keine Übertragungsmethode über das Internet zu 100 % sicher.' },
    { title: 'Ihre Rechte', text: 'Sie haben das Recht:', items: ['Auf Ihre personenbezogenen Daten zuzugreifen', 'Unrichtige Informationen zu berichtigen', 'Ihr Konto und Ihre Daten zu löschen', 'Ihre Daten zu exportieren', 'Bestimmte Mitteilungen abzubestellen', 'Die Verarbeitung Ihrer Daten einzuschränken'] },
    { title: 'Cookies und Tracking', text: 'Wir verwenden Cookies und ähnliche Technologien, um Ihr Nutzungserlebnis zu verbessern, die Nutzung zu analysieren und personalisierte Inhalte bereitzustellen. Sie können Cookies über die Einstellungen Ihres Browsers verwalten.' },
    { title: 'Links zu Websites Dritter', text: 'Unser Dienst kann Links zu Websites Dritter enthalten. Wir sind nicht für die Datenschutzpraktiken dieser externen Websites verantwortlich. Wir empfehlen Ihnen, deren Datenschutzerklärungen zu lesen.' },
    { title: 'Änderungen dieser Erklärung', text: 'Wir können diese Datenschutzerklärung gelegentlich aktualisieren. Über wesentliche Änderungen informieren wir Sie, indem wir die neue Erklärung auf dieser Seite veröffentlichen und das Datum der letzten Aktualisierung anpassen.' },
    { title: 'Kontakt', text: 'Bei Fragen zu dieser Datenschutzerklärung oder zu unserem Umgang mit Daten erreichen Sie uns unter:', contact: true },
  ] },
  terms: { title: 'Nutzungsbedingungen', subtitle: 'Bedingungen für die Nutzung der Dienste von Mega Radio', sections: [
    { title: 'Annahme der Bedingungen', text: 'Indem Sie auf die Dienste von Mega Radio zugreifen und diese nutzen, akzeptieren Sie die Bestimmungen dieser Vereinbarung und erklären sich damit einverstanden, an sie gebunden zu sein. Diese Nutzungsbedingungen regeln Ihre Nutzung unserer Radio-Streaming-Plattform.' },
    { title: 'Beschreibung des Dienstes', text: 'Mega Radio bietet Zugang zu einer Sammlung von Internetradiosendern und Audio-Streaming-Inhalten. Unser Dienst ermöglicht es Nutzern, Radiosender aus aller Welt zu entdecken, zu hören und zu genießen.' },
    { title: 'Benutzerkonten', items: ['Bei der Kontoerstellung müssen Sie richtige und vollständige Angaben machen', 'Sie sind dafür verantwortlich, Ihre Zugangsdaten vertraulich zu behandeln', 'Sie müssen uns jede unbefugte Nutzung Ihres Kontos unverzüglich melden', 'Eine Person oder juristische Person darf nicht mehr als ein Konto führen'] },
    { title: 'Zulässige Nutzung', text: 'Sie verpflichten sich, Folgendes zu unterlassen:', items: ['Den Dienst für rechtswidrige Zwecke oder Aktivitäten zu nutzen', 'Unbefugten Zugriff auf unsere Systeme oder die Konten anderer Nutzer zu versuchen', 'Den Dienst oder damit verbundene Server zu beeinträchtigen oder zu stören', 'Unsere Inhalte ohne Erlaubnis zu vervielfältigen, zu verbreiten oder davon abgeleitete Werke zu erstellen', 'Ohne unsere schriftliche Zustimmung mit automatisierten Systemen auf den Dienst zuzugreifen', 'Viren, Schadsoftware oder anderen schädlichen Code hochzuladen oder zu übertragen'] },
    { title: 'Geistiges Eigentum', text: 'Der Dienst und seine ursprünglichen Inhalte sind und bleiben ausschließliches Eigentum von Mega Radio und seinen Lizenzgebern. Der Dienst ist durch Urheberrecht, Markenrecht und andere Gesetze geschützt. Unsere Marken dürfen ohne unsere vorherige schriftliche Zustimmung nicht verwendet werden.' },
    { title: 'Inhalte und Radiosender', text: 'Wir bündeln Radiosender und Inhalte aus verschiedenen Quellen und ermöglichen den Zugang dazu. Die Inhalte dieser Radiosender gehören uns nicht und unterliegen nicht unserer Kontrolle. Die Verfügbarkeit der Sender und die Qualität der Inhalte können variieren und richten sich nach den Vorgaben der jeweiligen Rundfunkanbieter.' },
    { title: 'Datenschutz', text: 'Ihre Privatsphäre ist uns wichtig. Bitte lesen Sie unsere Datenschutzerklärung, die ebenfalls für Ihre Nutzung des Dienstes gilt, um unseren Umgang mit Daten zu verstehen.' },
    { title: 'Gewährleistungsausschluss', text: 'Der Dienst wird im vorhandenen Zustand („wie besehen“) ohne ausdrückliche oder stillschweigende Zusicherungen oder Gewährleistungen bereitgestellt. Wir geben keine Zusicherungen oder Gewährleistungen hinsichtlich dieses Dienstes oder der darin bereitgestellten Informationen und Materialien ab.' },
    { title: 'Haftungsbeschränkung', text: 'Mega Radio sowie seine Geschäftsleitung, Mitarbeiter, Partner, Vertreter, Lieferanten oder verbundenen Unternehmen haften in keinem Fall für mittelbare, beiläufig entstandene, besondere Schäden, Folgeschäden oder Strafschadensersatz, die aus Ihrer Nutzung des Dienstes entstehen.' },
    { title: 'Beendigung', text: 'Wir können Ihr Konto nach unserem alleinigen Ermessen aus jedem beliebigen Grund, insbesondere bei einem Verstoß gegen diese Bedingungen, mit sofortiger Wirkung und ohne vorherige Ankündigung oder Haftung kündigen oder sperren und den Zugang zum Dienst untersagen.' },
    { title: 'Änderungen der Bedingungen', text: 'Wir behalten uns das Recht vor, diese Bedingungen jederzeit nach unserem alleinigen Ermessen zu ändern oder zu ersetzen. Bei wesentlichen Änderungen informieren wir Sie mindestens 30 Tage vor dem Inkrafttreten neuer Bedingungen.' },
    { title: 'Anwendbares Recht', text: 'Diese Bedingungen werden nach den Gesetzen des Rechtsraums ausgelegt und geregelt, in dem Mega Radio tätig ist, ohne Berücksichtigung seiner Kollisionsnormen.' },
    { title: 'Kontaktinformationen', text: 'Bei Fragen zu diesen Nutzungsbedingungen erreichen Sie uns unter:', contact: true },
  ] },
};

export const TR_LEGAL_CONTENT: LegalLocaleCopy = {
  email: 'E-posta',
  privacy: { title: 'Gizlilik Politikası', subtitle: 'Gizliliğiniz ve kişisel verilerin korunması hakkında bilgiler', sections: [
    { title: 'Giriş', text: 'Mega Radio olarak („biz“, „bize“ veya „bizim“) gizliliğinize saygı duyuyor ve kişisel verilerinizi korumayı taahhüt ediyoruz. Bu gizlilik politikası, radyo yayın hizmetimizi kullandığınızda bilgilerinizi nasıl topladığımızı, kullandığımızı ve koruduğumuzu açıklar.' },
    { title: 'Topladığımız bilgiler', groups: [
      { title: 'Kişisel bilgiler', text: 'Hesap oluşturduğunuzda veya bizimle iletişime geçtiğinizde şunları toplayabiliriz:', items: ['Ad ve e-posta adresi', 'Kullanıcı adı ve şifre', 'Profil bilgileri ve tercihler', 'Destek ekibimizle iletişim geçmişi'] },
      { title: 'Kullanım bilgileri', text: 'Hizmetimizi nasıl kullandığınızla ilgili bilgileri otomatik olarak toplarız:', items: ['Dinleme geçmişi ve tercihler', 'Cihaz bilgileri ve IP adresi', 'Tarayıcı türü ve işletim sistemi', 'Oturumlarınızın zamanı ve süresi'] },
    ] },
    { title: 'Bilgilerinizi nasıl kullanıyoruz', items: ['Radyo yayın hizmetimizi sunmak ve geliştirmek için', 'Dinleme deneyiminizi kişiselleştirmek için', 'Hizmet güncellemeleri hakkında sizinle iletişim kurmak için', 'Müşteri desteği sağlamak için', 'Kullanım alışkanlıklarını analiz etmek ve platformumuzu geliştirmek için', 'Yasal yükümlülüklere uymak için'] },
    { title: 'Bilgi paylaşımı', text: 'Kişisel bilgilerinizi satmayız, takas etmeyiz veya kiralamayız. Bilgilerinizi yalnızca şu durumlarda paylaşabiliriz:', items: ['Açık rızanızla', 'Yasal gerekliliklere uymak için', 'Haklarımızı ve mülkiyetimizi korumak için', 'Faaliyetlerimize yardımcı olan güvenilir hizmet sağlayıcılarla', 'Bir işletme devri veya birleşmesi kapsamında'] },
    { title: 'Veri güvenliği', text: 'Kişisel verilerinizi yetkisiz erişime, değiştirilmeye, ifşaya veya yok edilmeye karşı korumak için uygun teknik ve organizasyonel önlemler uygularız. Ancak internet üzerinden hiçbir aktarım yöntemi %100 güvenli değildir.' },
    { title: 'Haklarınız', text: 'Şu haklara sahipsiniz:', items: ['Kişisel verilerinize erişme', 'Yanlış bilgileri düzeltme', 'Hesabınızı ve verilerinizi silme', 'Verilerinizi dışa aktarma', 'Belirli iletileri almaktan vazgeçme', 'Verilerinizin işlenmesini kısıtlama'] },
    { title: 'Çerezler ve takip', text: 'Deneyiminizi geliştirmek, kullanımı analiz etmek ve kişiselleştirilmiş içerik sunmak için çerezler ve benzer teknolojiler kullanırız. Çerez ayarlarını tarayıcı tercihlerinizden yönetebilirsiniz.' },
    { title: 'Üçüncü taraf bağlantıları', text: 'Hizmetimiz üçüncü taraf web sitelerine bağlantılar içerebilir. Bu harici sitelerin gizlilik uygulamalarından sorumlu değiliz. Gizlilik politikalarını incelemenizi öneririz.' },
    { title: 'Bu politikadaki değişiklikler', text: 'Bu gizlilik politikasını zaman zaman güncelleyebiliriz. Önemli değişiklikleri yeni politikayı bu sayfada yayımlayıp son güncelleme tarihini değiştirerek size bildireceğiz.' },
    { title: 'Bize ulaşın', text: 'Bu gizlilik politikası veya veri uygulamalarımız hakkında sorularınız varsa bize şu adresten ulaşabilirsiniz:', contact: true },
  ] },
  terms: { title: 'Kullanım Koşulları', subtitle: 'Mega Radio hizmetlerinin kullanım koşulları', sections: [
    { title: 'Koşulların kabulü', text: 'Mega Radio hizmetlerine erişerek ve bunları kullanarak bu sözleşmenin hükümlerini kabul eder ve bunlarla bağlı olmayı onaylarsınız. Bu Kullanım Koşulları, radyo yayın platformumuzu kullanımınızı düzenler.' },
    { title: 'Hizmetin tanımı', text: 'Mega Radio, internet radyo istasyonlarından ve ses yayın içeriklerinden oluşan bir koleksiyona erişim sağlar. Hizmetimiz kullanıcıların dünyanın dört bir yanındaki radyo istasyonlarını keşfetmesine, dinlemesine ve keyfini çıkarmasına olanak tanır.' },
    { title: 'Kullanıcı hesapları', items: ['Hesap oluştururken doğru ve eksiksiz bilgi vermelisiniz', 'Hesabınıza ait giriş bilgilerinin gizliliğini korumaktan siz sorumlusunuz', 'Hesabınızın yetkisiz kullanımını bize derhal bildirmelisiniz', 'Bir kişi veya tüzel kişilik birden fazla hesap tutamaz'] },
    { title: 'Kabul edilebilir kullanım', text: 'Şunları yapmamayı kabul edersiniz:', items: ['Hizmeti yasa dışı amaçlar veya faaliyetler için kullanmak', 'Sistemlerimize veya diğer kullanıcıların hesaplarına yetkisiz erişim sağlamaya çalışmak', 'Hizmete veya hizmete bağlı sunuculara müdahale etmek ya da işleyişlerini bozmak', 'İçeriğimizi izinsiz çoğaltmak, dağıtmak veya içeriğimizden türetilmiş eserler oluşturmak', 'Yazılı iznimiz olmadan hizmete erişmek için otomatik sistemler kullanmak', 'Virüs, kötü amaçlı yazılım veya başka zararlı kod yüklemek ya da iletmek'] },
    { title: 'Fikri mülkiyet', text: 'Hizmet ve özgün içeriği, Mega Radio ve lisans verenlerinin münhasır mülkiyetindedir ve öyle kalacaktır. Hizmet telif hakkı, marka ve diğer yasalarla korunur. Markalarımız önceden yazılı iznimiz olmadan kullanılamaz.' },
    { title: 'İçerik ve radyo istasyonları', text: 'Çeşitli kaynaklardan radyo istasyonlarını ve içerikleri bir araya getirir ve bunlara erişim sağlarız. Bu radyo istasyonlarının içeriğinin sahibi değiliz ve içeriğini kontrol etmeyiz. İstasyonların kullanılabilirliği ve içerik kalitesi değişebilir ve her yayıncının kendi politikalarına tabidir.' },
    { title: 'Gizlilik', text: 'Gizliliğiniz bizim için önemlidir. Uygulamalarımızı anlamak için hizmet kullanımınızı da düzenleyen Gizlilik Politikamızı inceleyin.' },
    { title: 'Garanti reddi', text: 'Hizmet, açık veya zımni hiçbir beyan ya da garanti olmaksızın „olduğu gibi“ sunulur. Bu hizmet veya hizmette sunulan bilgi ve materyaller hakkında hiçbir beyan ya da garanti vermeyiz.' },
    { title: 'Sorumluluğun sınırlandırılması', text: 'Mega Radio veya yöneticileri, çalışanları, ortakları, temsilcileri, tedarikçileri ya da bağlı kuruluşları, hizmeti kullanımınızdan doğan dolaylı, arızi, özel, sonuçsal veya cezai nitelikteki zararlardan hiçbir durumda sorumlu tutulamaz.' },
    { title: 'Fesih', text: 'Tamamen kendi takdirimize bağlı olarak, Koşulların ihlali dâhil ancak bununla sınırlı olmaksızın herhangi bir nedenle, önceden bildirimde bulunmadan veya sorumluluk üstlenmeden hesabınızı derhal feshedebilir ya da askıya alabilir ve hizmete erişiminizi engelleyebiliriz.' },
    { title: 'Koşullardaki değişiklikler', text: 'Bu Koşulları tamamen kendi takdirimize bağlı olarak istediğimiz zaman değiştirme veya yenileriyle değiştirme hakkını saklı tutarız. Önemli bir değişiklik yapılırsa yeni koşullar yürürlüğe girmeden en az 30 gün önce bildirimde bulunacağız.' },
    { title: 'Uygulanacak hukuk', text: 'Bu Koşullar, kanunlar ihtilafına ilişkin hükümleri dikkate alınmaksızın Mega Radio’nun faaliyet gösterdiği yargı bölgesinin yasalarına göre yorumlanır ve uygulanır.' },
    { title: 'İletişim bilgileri', text: 'Bu Kullanım Koşulları hakkında sorularınız varsa bize şu adresten ulaşabilirsiniz:', contact: true },
  ] },
};

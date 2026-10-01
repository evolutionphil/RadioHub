export interface HomeHeroCopy {
  eyebrow: string;
  headline: string;
  tagline: string;
  direction: 'ltr' | 'rtl';
}

/** Visible homepage brand copy, shared by the first server paint and the app. */
export const HOME_HERO_COPY: Readonly<Record<string, HomeHeroCopy>> = {
  en: {
    eyebrow: 'The world’s sound, right here',
    headline: 'Listen to live radio',
    tagline: 'Free. Anytime. Anywhere.',
    direction: 'ltr',
  },
  de: {
    eyebrow: 'Sender aus aller Welt',
    headline: 'Radio live hören',
    tagline: 'Kostenlos. Jederzeit. Überall.',
    direction: 'ltr',
  },
  tr: {
    eyebrow: 'Dünyanın sesi burada',
    headline: 'Canlı radyo dinle',
    tagline: 'Ücretsiz. Her an. Her yerde.',
    direction: 'ltr',
  },
  es: {
    eyebrow: 'El sonido del mundo, aquí',
    headline: 'Radio en vivo',
    tagline: 'Gratis. Siempre. Donde estés.',
    direction: 'ltr',
  },
  fr: {
    eyebrow: 'Les sons du monde, ici',
    headline: 'Écoutez la radio en direct',
    tagline: 'Gratuit. À tout moment. Partout.',
    direction: 'ltr',
  },
  pt: {
    eyebrow: 'Os sons do mundo estão aqui',
    headline: 'Ouça rádio ao vivo',
    tagline: 'Grátis. Sempre. Em todo lugar.',
    direction: 'ltr',
  },
  it: {
    eyebrow: 'Il suono del mondo, qui',
    headline: 'Ascolta la radio in diretta',
    tagline: 'Gratis. Sempre. Ovunque.',
    direction: 'ltr',
  },
  ru: {
    eyebrow: 'Звуки мира — здесь',
    headline: 'Радио в прямом эфире',
    tagline: 'Бесплатно. Всегда. Везде.',
    direction: 'ltr',
  },
  ar: {
    eyebrow: 'صوت العالم هنا',
    headline: 'استمع للراديو مباشرة',
    tagline: 'مجانًا. في أي وقت. أينما كنت.',
    direction: 'rtl',
  },
  zh: {
    eyebrow: '世界之声，就在这里',
    headline: '收听电台直播',
    tagline: '免费。随时。随地。',
    direction: 'ltr',
  },
  ja: {
    eyebrow: '世界の音が、ここに',
    headline: 'ラジオをライブで聴く',
    tagline: '無料。いつでも。どこでも。',
    direction: 'ltr',
  },
  ko: {
    eyebrow: '세계의 소리가 여기에',
    headline: '실시간 라디오 듣기',
    tagline: '무료로. 언제나. 어디서나.',
    direction: 'ltr',
  },
  hi: {
    eyebrow: 'दुनिया की आवाज़ यहाँ',
    headline: 'लाइव रेडियो सुनें',
    tagline: 'मुफ़्त। कभी भी। कहीं भी।',
    direction: 'ltr',
  },
  he: {
    eyebrow: 'הצלילים של העולם כאן',
    headline: 'האזינו לרדיו בשידור חי',
    tagline: 'בחינם. בכל זמן. בכל מקום.',
    direction: 'rtl',
  },
};

export function getHomeHeroCopy(language: string): HomeHeroCopy {
  const code = language.trim().toLowerCase().split(/[-_]/)[0];
  return Object.prototype.hasOwnProperty.call(HOME_HERO_COPY, code)
    ? HOME_HERO_COPY[code]
    : HOME_HERO_COPY.en;
}

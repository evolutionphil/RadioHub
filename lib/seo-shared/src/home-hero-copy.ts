export interface HomeHeroCopy {
  eyebrow: string;
  headline: string;
  tagline: string;
  direction: 'ltr' | 'rtl';
}

/** Visible homepage brand copy, shared by the first server paint and the app. */
export const HOME_HERO_COPY: Readonly<Record<string, HomeHeroCopy>> = {
  en: {
    eyebrow: 'The world has your sound.',
    headline: 'Your radio. Your moment.',
    tagline: 'Live. Free. Everywhere.',
    direction: 'ltr',
  },
  de: {
    eyebrow: 'Die Welt hat deinen Sound.',
    headline: 'Dein Radio. Dein Moment.',
    tagline: 'Live. Kostenlos. Überall.',
    direction: 'ltr',
  },
  tr: {
    eyebrow: 'Dünyanın sesi, senin seçimin.',
    headline: 'Radyo, seninle güzel.',
    tagline: 'Canlı. Ücretsiz. Her yerde.',
    direction: 'ltr',
  },
  es: {
    eyebrow: 'El mundo suena a ti.',
    headline: 'Tu radio. Tu momento.',
    tagline: 'En vivo. Gratis. Donde estés.',
    direction: 'ltr',
  },
  fr: {
    eyebrow: 'Le monde à ton rythme.',
    headline: 'Ta radio. Ton moment.',
    tagline: 'En direct. Gratuit. Partout.',
    direction: 'ltr',
  },
  pt: {
    eyebrow: 'O mundo no seu ritmo.',
    headline: 'Sua rádio. Seu momento.',
    tagline: 'Ao vivo. Grátis. Em todo lugar.',
    direction: 'ltr',
  },
  it: {
    eyebrow: 'Il mondo ha il tuo ritmo.',
    headline: 'La tua radio. Il tuo ritmo.',
    tagline: 'In diretta. Gratis. Ovunque.',
    direction: 'ltr',
  },
  ru: {
    eyebrow: 'Весь мир на твоей волне.',
    headline: 'Твоё радио. Твой момент.',
    tagline: 'В эфире. Бесплатно. Везде.',
    direction: 'ltr',
  },
  ar: {
    eyebrow: 'صوت العالم على ذوقك.',
    headline: 'راديوك. لحظتك.',
    tagline: 'مباشر. مجانًا. أينما كنت.',
    direction: 'rtl',
  },
  zh: {
    eyebrow: '世界之声，随你心意。',
    headline: '你的电台，你的时刻。',
    tagline: '直播。免费。随时随地。',
    direction: 'ltr',
  },
  ja: {
    eyebrow: '世界の音を、あなたらしく。',
    headline: 'ラジオと、あなたの時間。',
    tagline: '生放送。無料。どこでも。',
    direction: 'ltr',
  },
  ko: {
    eyebrow: '세상의 소리, 나의 취향.',
    headline: '나의 라디오, 나만의 순간.',
    tagline: '실시간. 무료. 어디서나.',
    direction: 'ltr',
  },
  hi: {
    eyebrow: 'दुनिया की धुन, आपकी पसंद।',
    headline: 'आपका रेडियो। आपका पल।',
    tagline: 'लाइव। मुफ़्त। हर जगह।',
    direction: 'ltr',
  },
  he: {
    eyebrow: 'העולם בקצב שלך.',
    headline: 'הרדיו שלך. הרגע שלך.',
    tagline: 'בשידור חי. בחינם. בכל מקום.',
    direction: 'rtl',
  },
};

export function getHomeHeroCopy(language: string): HomeHeroCopy {
  const code = language.trim().toLowerCase().split(/[-_]/)[0];
  return Object.prototype.hasOwnProperty.call(HOME_HERO_COPY, code)
    ? HOME_HERO_COPY[code]
    : HOME_HERO_COPY.en;
}

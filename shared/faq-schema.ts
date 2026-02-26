// FAQ Schema.org structured data for help and about pages

export interface FAQItem {
  question: string;
  answer: string;
}

export function generateFAQSchema(faqItems: FAQItem[], domain: string): any {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqItems.map(item => ({
      "@type": "Question",
      "name": item.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": item.answer
      }
    }))
  };
}

// Common FAQ items for Mega Radio
export const MEGA_RADIO_FAQ: FAQItem[] = [
  {
    question: "How do I listen to radio stations on Mega Radio?",
    answer: "Simply browse our collection of 60,000+ radio stations, click on any station you like, and start listening instantly. No registration required for basic listening."
  },
  {
    question: "Is Mega Radio free to use?",
    answer: "Yes! Mega Radio is completely free to use. You can listen to thousands of radio stations from around the world without any subscription fees."
  },
  {
    question: "How many radio stations are available?",
    answer: "We offer over 60,000 radio stations from 120+ countries worldwide, covering all genres including music, news, talk shows, and sports."
  },
  {
    question: "Can I listen to Mega Radio on my mobile device?",
    answer: "Absolutely! Mega Radio works perfectly on all devices - smartphones, tablets, computers, and smart TVs through your web browser."
  },
  {
    question: "Do I need to create an account?",
    answer: "An account is optional. You can listen to radio stations without registering, but creating an account allows you to save favorite stations and get personalized recommendations."
  },
  {
    question: "What audio quality can I expect?",
    answer: "Most stations stream in high quality (128-320 kbps). The audio quality depends on the individual radio station's broadcast quality."
  },
  {
    question: "How do I find radio stations from my country?",
    answer: "Use our country filter on the main page or browse the 'Countries' section to find radio stations from your specific location."
  },
  {
    question: "Can I listen to Mega Radio offline?",
    answer: "No, Mega Radio requires an internet connection as we stream live radio stations in real-time."
  },
  {
    question: "How do I report a broken radio station?",
    answer: "If you encounter a station that's not working, please contact our support team through the feedback form on the website."
  },
  {
    question: "Does Mega Radio work with Google Chrome, Safari, and Firefox?",
    answer: "Yes! Mega Radio is compatible with all modern web browsers including Chrome, Safari, Firefox, and Edge."
  },
  {
    question: "How often are new radio stations added?",
    answer: "We continuously update our database with new radio stations. Our system automatically discovers and adds new stations regularly."
  },
  {
    question: "Can I request a specific radio station to be added?",
    answer: "Yes! You can submit radio station requests through our contact form, and we'll try to add them to our database."
  },
  {
    question: "What genres of music are available?",
    answer: "We offer all music genres including Pop, Rock, Jazz, Classical, Electronic, Hip-Hop, Country, Blues, Reggae, and many more, plus news and talk radio."
  },
  {
    question: "How do I save my favorite radio stations?",
    answer: "Create a free account and click the heart icon next to any station to add it to your favorites list for easy access later."
  },
  {
    question: "Is my data safe with Mega Radio?",
    answer: "Yes, we take privacy seriously. We only collect necessary data to improve your experience and never share personal information with third parties."
  }
];

// About page FAQ items
export const ABOUT_FAQ: FAQItem[] = [
  {
    question: "What is Mega Radio?",
    answer: "Mega Radio is a free online radio platform that gives you access to over 60,000 radio stations from 120+ countries worldwide. Listen to music, news, sports, and talk shows instantly through your web browser."
  },
  {
    question: "When was Mega Radio launched?",
    answer: "Mega Radio was created to provide radio enthusiasts with a comprehensive platform for discovering and enjoying radio stations from around the globe."
  },
  {
    question: "What makes Mega Radio different?",
    answer: "Our advanced features include real-time track metadata, personalized recommendations, GPS-based nearby stations, comprehensive search filters, and support for 45+ languages."
  },
  {
    question: "How does Mega Radio work technically?",
    answer: "We aggregate radio streams from broadcasters worldwide and provide a unified interface for discovery and playback. Our system handles different audio formats and ensures compatibility across all devices."
  }
];

// Technical FAQ for developers/technical users
export const TECHNICAL_FAQ: FAQItem[] = [
  {
    question: "What audio formats does Mega Radio support?",
    answer: "We support MP3, AAC, OGG, and HLS streams. Our system automatically handles format conversion when needed for browser compatibility."
  },
  {
    question: "Does Mega Radio have an API?",
    answer: "Yes! Mega Radio offers a comprehensive public API for developers. We provide Demo, Free, and Pro plans to suit different needs, from personal testing to professional applications."
  },
  {
    question: "How do you ensure stream reliability?",
    answer: "We monitor all streams continuously and use advanced error recovery mechanisms including auto-reconnection and fallback URLs."
  }
];
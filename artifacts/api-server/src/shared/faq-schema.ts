// FAQ Schema.org structured data for help and about pages

export interface FAQItem {
  question: string;
  answer: string;
}

// Translation key + English fallback pairs for the public /faq page.
// MUST stay in sync with the visible Q&A rendered by:
//   - artifacts/megaradio/src/pages/faq.tsx (client)
//   - artifacts/api-server/src/seo-renderer.ts (SSR body + FAQPage JSON-LD)
// Google flags schema/visible-content mismatch as deceptive markup, so any
// addition/removal here must update all three surfaces together.
export interface FAQTranslatedItem {
  qKey: string;
  qFallback: string;
  aKey: string;
  aFallback: string;
}

export const FAQ_PAGE_ITEMS: FAQTranslatedItem[] = [
  {
    qKey: "faq_what_is_radio",
    qFallback: "What is Radio?",
    aKey: "faq_what_is_radio_answer",
    aFallback:
      "Radio is a wireless technology that transmits audio content through electromagnetic waves.",
  },
  {
    qKey: "faq_what_is_internet_radio",
    qFallback: "What is Internet Radio?",
    aKey: "faq_what_is_internet_radio_answer",
    aFallback:
      "Internet radio streams audio content over the internet instead of traditional radio waves.",
  },
  {
    qKey: "faq_what_is_web_radio",
    qFallback: "What is Web Radio?",
    aKey: "faq_what_is_web_radio_answer",
    aFallback:
      "Web radio is essentially the same as internet radio - stations that broadcast online through websites or apps.",
  },
  {
    qKey: "faq_how_to_listen",
    qFallback: "How can I listen to radio?",
    aKey: "faq_how_to_listen_answer",
    aFallback:
      "You can listen through traditional FM/AM, internet radio websites and apps, DAB+ receivers, smart speakers, or your car.",
  },
  {
    qKey: "faq_listen_on_phone",
    qFallback: "Can I listen to radio on my phone?",
    aKey: "faq_listen_on_phone_answer",
    aFallback:
      "Yes! Mega Radio works on any smartphone — just visit the site in your mobile browser, no app required.",
  },
  {
    qKey: "faq_is_radio_free",
    qFallback: "Is internet radio free?",
    aKey: "faq_is_radio_free_answer",
    aFallback:
      "Yes, internet radio on Mega Radio is completely free. No subscription fees, no registration required.",
  },
  {
    qKey: "faq_listen_on_pc",
    qFallback: "How can I listen to radio on my PC?",
    aKey: "faq_listen_on_pc_answer",
    aFallback:
      "Open any web browser, visit Mega Radio, search for a station and click play. No software install required.",
  },
  {
    qKey: "faq_which_stations",
    qFallback: "Which radio stations can I listen to?",
    aKey: "faq_which_stations_answer",
    aFallback:
      "Mega Radio offers 60,000+ stations from 120+ countries spanning every genre — pop, rock, jazz, classical, news, sports and talk.",
  },
  {
    qKey: "faq_best_station",
    qFallback: "Which radio station is the best?",
    aKey: "faq_best_station_answer",
    aFallback:
      "It depends on your taste. Browse trending stations or filter by genre and country to find your perfect fit.",
  },
  {
    qKey: "faq_no_ads_stations",
    qFallback: "Which radio stations have no advertising?",
    aKey: "faq_no_ads_stations_answer",
    aFallback:
      "Many public broadcasters and classical/jazz stations are commercial-free. Filter by those genres to discover ad-free options.",
  },
  {
    qKey: "faq_how_search",
    qFallback: "How do I search for a specific station?",
    aKey: "faq_how_search_answer",
    aFallback:
      "Use the search page to look up stations by name, genre, language, or country. Results appear instantly as you type.",
  },
  {
    qKey: "faq_supported_devices",
    qFallback: "What devices does Mega Radio support?",
    aKey: "faq_supported_devices_answer",
    aFallback:
      "Mega Radio works on desktops, laptops, smartphones, tablets, smart speakers, smart TVs and car infotainment systems.",
  },
  {
    qKey: "faq_account_required",
    qFallback: "Do I need an account to listen?",
    aKey: "faq_account_required_answer",
    aFallback:
      "No account is needed to stream. An optional free account lets you save favourites, sync devices, and personalise recommendations.",
  },
  {
    qKey: "faq_languages_supported",
    qFallback: "What languages does Mega Radio support?",
    aKey: "faq_languages_supported_answer",
    aFallback:
      "Our interface is available in 57 languages and stations broadcast in dozens more — local language broadcasting from every region.",
  },
  {
    qKey: "faq_request_station",
    qFallback: "How can I add or request a station?",
    aKey: "faq_request_station_answer",
    aFallback:
      "Use the Request Station form to submit your favourite broadcaster — our team reviews and adds new stations regularly.",
  },
];

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
    answer: "Yes! Mega Radio is free to use for listeners. For developers, we offer a public API with Demo, Free, and Pro plans to suit different needs."
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
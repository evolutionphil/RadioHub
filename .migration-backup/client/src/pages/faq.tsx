import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { SeoHead } from "@/components/SeoHead";

interface FaqItem {
  q: string;
  a: string;
}

export default function FaqPage() {
  const { t } = useTranslation();
  const { currentLanguage } = useSeoRouting();
  const langPrefix = currentLanguage === "en" ? "" : `/${currentLanguage}`;
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const h1 = t("faq_page_h1", "Mega Radio Frequently Asked Questions");
  const intro = t(
    "faq_page_intro",
    "Answers to common questions about Mega Radio: how online radio streaming works, supported devices, free access, mobile apps, station coverage across 120+ countries, and account help."
  );

  const items: FaqItem[] = [
    {
      q: t("faq_what_is_radio", "What is Radio?"),
      a: t(
        "faq_what_is_radio_answer",
        "Radio is a wireless technology that transmits audio content through electromagnetic waves."
      ),
    },
    {
      q: t("faq_what_is_internet_radio", "What is Internet Radio?"),
      a: t(
        "faq_what_is_internet_radio_answer",
        "Internet radio streams audio content over the internet instead of traditional radio waves."
      ),
    },
    {
      q: t("faq_what_is_web_radio", "What is Web Radio?"),
      a: t(
        "faq_what_is_web_radio_answer",
        "Web radio is essentially the same as internet radio - stations that broadcast online through websites or apps."
      ),
    },
    {
      q: t("faq_how_to_listen", "How can I listen to radio?"),
      a: t(
        "faq_how_to_listen_answer",
        "You can listen through traditional FM/AM, internet radio websites and apps, DAB+ receivers, smart speakers, or your car."
      ),
    },
    {
      q: t("faq_listen_on_phone", "Can I listen to radio on my phone?"),
      a: t(
        "faq_listen_on_phone_answer",
        "Yes! Mega Radio works on any smartphone — just visit the site in your mobile browser, no app required."
      ),
    },
    {
      q: t("faq_is_radio_free", "Is internet radio free?"),
      a: t(
        "faq_is_radio_free_answer",
        "Yes, internet radio on Mega Radio is completely free. No subscription fees, no registration required."
      ),
    },
    {
      q: t("faq_listen_on_pc", "How can I listen to radio on my PC?"),
      a: t(
        "faq_listen_on_pc_answer",
        "Open any web browser, visit Mega Radio, search for a station and click play. No software install required."
      ),
    },
    {
      q: t("faq_which_stations", "Which radio stations can I listen to?"),
      a: t(
        "faq_which_stations_answer",
        "Mega Radio offers 60,000+ stations from 120+ countries spanning every genre — pop, rock, jazz, classical, news, sports and talk."
      ),
    },
    {
      q: t("faq_best_station", "Which radio station is the best?"),
      a: t(
        "faq_best_station_answer",
        "It depends on your taste. Browse trending stations or filter by genre and country to find your perfect fit."
      ),
    },
    {
      q: t("faq_no_ads_stations", "Which radio stations have no advertising?"),
      a: t(
        "faq_no_ads_stations_answer",
        "Many public broadcasters and classical/jazz stations are commercial-free. Filter by those genres to discover ad-free options."
      ),
    },
    {
      q: t(
        "faq_how_search",
        "How do I search for a specific station?"
      ),
      a: t(
        "faq_how_search_answer",
        "Use the search page to look up stations by name, genre, language, or country. Results appear instantly as you type."
      ),
    },
    {
      q: t(
        "faq_supported_devices",
        "What devices does Mega Radio support?"
      ),
      a: t(
        "faq_supported_devices_answer",
        "Mega Radio works on desktops, laptops, smartphones, tablets, smart speakers, smart TVs and car infotainment systems."
      ),
    },
    {
      q: t(
        "faq_account_required",
        "Do I need an account to listen?"
      ),
      a: t(
        "faq_account_required_answer",
        "No account is needed to stream. An optional free account lets you save favourites, sync devices, and personalise recommendations."
      ),
    },
    {
      q: t(
        "faq_languages_supported",
        "What languages does Mega Radio support?"
      ),
      a: t(
        "faq_languages_supported_answer",
        "Our interface is available in 57 languages and stations broadcast in dozens more — local language broadcasting from every region."
      ),
    },
    {
      q: t(
        "faq_request_station",
        "How can I add or request a station?"
      ),
      a: t(
        "faq_request_station_answer",
        "Use the Request Station form to submit your favourite broadcaster — our team reviews and adds new stations regularly."
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-[#0E0E0E] text-white">
      <SeoHead pageType="faq" />

      <div className="container mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl md:text-4xl font-bold mb-4">{h1}</h1>
        <p className="text-gray-400 text-base md:text-lg mb-10 leading-relaxed">
          {intro}
        </p>

        <ul className="space-y-3" data-testid="faq-list">
          {items.map((item, idx) => {
            const open = openIndex === idx;
            return (
              <li
                key={idx}
                className="bg-white/5 rounded-xl overflow-hidden border border-white/5"
              >
                <button
                  type="button"
                  data-testid={`faq-toggle-${idx}`}
                  onClick={() => setOpenIndex(open ? null : idx)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-white/5 transition-colors"
                >
                  <span className="font-semibold text-base md:text-lg">
                    {item.q}
                  </span>
                  <ChevronDown
                    size={20}
                    className={`flex-shrink-0 text-gray-400 transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {open && (
                  <div className="px-5 pb-5 text-gray-300 leading-relaxed">
                    {item.a}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-12 p-6 bg-white/5 rounded-xl">
          <h2 className="text-xl font-semibold mb-3">
            {t("faq_more_help_title", "Still need help?")}
          </h2>
          <p className="text-gray-400 mb-4">
            {t(
              "faq_more_help_text",
              "Reach out to our team or explore more of Mega Radio."
            )}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`${langPrefix}/contact`}
              className="px-4 py-2 bg-[#FF4199] rounded-lg font-medium hover:opacity-90 transition-opacity"
              data-testid="link-contact"
            >
              {t("nav_contact", "Contact Us")}
            </Link>
            <Link
              href={`${langPrefix}/about`}
              className="px-4 py-2 bg-white/10 rounded-lg font-medium hover:bg-white/20 transition-colors"
              data-testid="link-about"
            >
              {t("nav_about", "About Mega Radio")}
            </Link>
            <Link
              href={`${langPrefix}/search`}
              className="px-4 py-2 bg-white/10 rounded-lg font-medium hover:bg-white/20 transition-colors"
              data-testid="link-search"
            >
              {t("nav_search", "Search Stations")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

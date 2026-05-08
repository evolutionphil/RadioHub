import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { SeoHead } from "@/components/SeoHead";
import { FAQ_PAGE_ITEMS, type FAQTranslatedItem } from "@shared/faq-schema";

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

  const items: FaqItem[] = FAQ_PAGE_ITEMS.map((item: FAQTranslatedItem) => ({
    q: t(item.qKey, item.qFallback),
    a: t(item.aKey, item.aFallback),
  }));

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

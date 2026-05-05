import { useSeoRouting } from "@/hooks/useSeoRouting";
import { SEO_LANGUAGES } from "@shared/seo-config";
import { Link } from "wouter";

export function SeoLanguageLinks() {
  const { currentLanguage, cleanPath, getLocalizedUrl } = useSeoRouting();

  return (
    <div className="hidden">
      {/* Hidden language links for SEO crawlers */}
      {SEO_LANGUAGES.filter(lang => lang.enabled && lang.code !== currentLanguage).map(lang => (
        <Link 
          key={lang.code} 
          href={getLocalizedUrl(cleanPath, lang.code)}
          className="display-none"
        >
          {lang.name}
        </Link>
      ))}
    </div>
  );
}
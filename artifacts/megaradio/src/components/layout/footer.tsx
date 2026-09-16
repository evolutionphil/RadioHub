import { Link, useLocation, useSearch } from "wouter";
import { useState, Suspense, lazy, useEffect, useRef, useId } from "react";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useQuery } from "@tanstack/react-query";
import { SEO_LANGUAGES, ACTIVE_SITEMAP_LANGUAGES } from "@workspace/seo-shared/seo-config";
// 🚀 LAZY: modals only load on first open — keeps Radix Select/Input
// out of the footer chunk until the user clicks the action.
const AddYourStationModal = lazy(() => import("@/components/modals/AddYourStationModal"));
import { Globe } from "lucide-react";
import AdSenseUnit from "@/components/ads/DeferredAdSenseUnit";
import { getAdSensePageType } from '@/lib/adsense-runtime';
import { AD_SLOTS, usesInlineMobileCatalogAd } from '@/lib/advertising-placements';
import PrivacySettingsButton from "@/components/ads/PrivacySettingsButton";

interface FooterSocialLink {
  _id: string;
  platform: 'facebook' | 'instagram' | 'twitter' | 'linkedin' | 'whatsapp' | 'telegram' | 'reddit' | 'pinterest' | 'youtube' | 'tiktok';
  url: string;
  isActive: boolean;
  position: number;
}

const platformColors: Record<string, string> = {
  facebook: '#1877F2',
  instagram: '#E4405F',
  twitter: '#1DA1F2',
  linkedin: '#0A66C2',
  whatsapp: '#25D366',
  telegram: '#0088CC',
  reddit: '#FF4500',
  pinterest: '#BD081C',
  youtube: '#FF0000',
  tiktok: '#000000',
};

const footerLinkClass = "inline-flex min-w-0 items-center min-h-11 md:min-h-[30px] py-1 text-left text-sm leading-5 text-[#c5c5cb] [overflow-wrap:anywhere] hyphens-auto hover:text-[#FF4199] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199] focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded-sm";

const getSocialIcon = (platform: string) => {
  const svgClass = "w-4 h-4 sm:w-5 sm:h-5 fill-current";
  
  switch (platform) {
    case 'facebook':
      return <svg viewBox="0 0 24 24" className={svgClass}><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>;
    case 'instagram':
      return <svg viewBox="0 0 24 24" className={svgClass}><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm4.441 7.313c.05.001.101.001.152.001.865 0 1.567.702 1.567 1.567s-.702 1.567-1.567 1.567-1.567-.702-1.567-1.567.702-1.567 1.567-1.567c.051 0 .102 0 .152-.001zm-4.441 1.469c1.533 0 2.773 1.24 2.773 2.773s-1.24 2.773-2.773 2.773-2.773-1.24-2.773-2.773 1.24-2.773 2.773-2.773zm0-3.094c-3.213 0-5.867 2.654-5.867 5.867s2.654 5.867 5.867 5.867 5.867-2.654 5.867-5.867-2.654-5.867-5.867-5.867zm0-1.442c4.15 0 7.309-3.159 7.309-7.309S16.15 0 12 0 4.691 3.159 4.691 7.309 7.85 14.618 12 14.618zm0-11.636c2.003 0 3.644 1.641 3.644 3.644s-1.641 3.644-3.644 3.644-3.644-1.641-3.644-3.644 1.641-3.644 3.644-3.644z"/></svg>;
    case 'twitter':
      return <svg viewBox="0 0 24 24" className={svgClass}><path d="M23.953 4.57a10 10 0 002.856-9.51a6.044 6.044 0 01-1.685.494a2.975 2.975 0 001.304-1.643a5.975 5.975 0 01-1.905.729a2.98 2.98 0 00-5.304 2.735a8.48 8.48 0 01-6.144-3.115a2.98 2.98 0 00.923 3.977a2.964 2.964 0 01-1.35-.37v.037a2.98 2.98 0 002.391 2.921a2.971 2.971 0 01-1.344.055a2.982 2.982 0 002.782 2.07A5.975 5.975 0 010 16.738a8.477 8.477 0 004.564 1.336c5.477 0 8.268-4.534 8.268-8.469c0-.129-.003-.259-.009-.387a5.9 5.9 0 001.449-1.506l-.002-.001z"/></svg>;
    case 'linkedin':
      return <svg viewBox="0 0 24 24" className={svgClass}><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.475-2.236-1.986-2.236-1.081 0-1.722.731-2.004 1.438-.103.249-.129.597-.129.946v5.421h-3.554s.05-8.807 0-9.726h3.554v1.375c.427-.659 1.191-1.598 2.898-1.598 2.117 0 3.704 1.384 3.704 4.362v5.587zM5.337 9.433c-1.144 0-1.915-.758-1.915-1.708 0-.959.768-1.708 1.959-1.708 1.19 0 1.916.749 1.935 1.708 0 .95-.745 1.708-1.979 1.708zm1.946 11.019H3.394V9.726h3.889v10.726zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/></svg>;
    case 'whatsapp':
      return <svg viewBox="0 0 24 24" className={svgClass}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.272-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.67-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.076 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421-7.403h-.004a5.564 5.564 0 00-5.446 5.466c0 1.493.556 2.921 1.573 4.03l-1.675 6.105 6.246-1.636a5.582 5.582 0 004.331.766c3.045-.523 5.331-3.288 5.331-6.393 0-3.059-2.353-5.694-5.566-5.694"/></svg>;
    case 'telegram':
      return <svg viewBox="0 0 24 24" className={svgClass}><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.82-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.33-.373-.117l-6.869 4.332-2.96-.924c-.644-.213-.658-.644.135-.954l11.566-4.461c.54-.198 1.011.131.84.951z"/></svg>;
    case 'reddit':
      return <svg viewBox="0 0 24 24" className={svgClass}><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.385 4.859-7.181 4.859-3.796 0-7.182-2.165-7.182-4.859a3.5 3.5 0 0 1 .476-1.565c-.495-.355-.8-1.08-.8-1.871 0-.969.786-1.755 1.754-1.755.218 0 .424.057.601.167.722-1.176 2.35-1.945 4.156-1.945l.654-3.077.293-.082c.347-.088.592-.24.748-.463.131-.161.233-.322.233-.534 0-.479-.379-.899-.849-.899.13.514.995 1.079 2.213.727.217-.213.403-.413.554-.629.356-.198.64-.29.955-.29zm3.213 5.04a1.755 1.755 0 0 0-1.75 1.75c0 .966.784 1.75 1.75 1.75s1.75-.784 1.75-1.75-.783-1.75-1.75-1.75zm-7 0a1.755 1.755 0 0 0-1.976 1.694c-.02.15-.035.3-.035.456 0 .966.783 1.75 1.75 1.75s1.75-.784 1.75-1.75c0-.21-.035-.42-.082-.624a1.745 1.745 0 0 0-1.407-1.526z"/></svg>;
    case 'pinterest':
      return <svg viewBox="0 0 24 24" className={svgClass}><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0m0 2.333c5.336 0 9.667 4.33 9.667 9.667 0 5.336-4.331 9.667-9.667 9.667-5.336 0-9.667-4.331-9.667-9.667 0-5.337 4.33-9.667 9.667-9.667zm3.833 7.333c0 1.576-1.257 2.833-2.833 2.833s-2.833-1.257-2.833-2.833 1.257-2.833 2.833-2.833 2.833 1.257 2.833 2.833z"/></svg>;
    case 'youtube':
      return <svg viewBox="0 0 24 24" className={svgClass}><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>;
    case 'tiktok':
      return <svg viewBox="0 0 24 24" className={svgClass}><path d="M19.498 6.186a3.016 3.016 0 0 1-2.122-2.136c-.56-1.374-2.517-2.505-5.376-2.505-.337 0-.672.019-1.004.055a4.34 4.34 0 0 0-3.89 4.28v9.737A6.52 6.52 0 0 1 2.48 12a6.519 6.519 0 1 0 5.222 2.638V7.66a8.22 8.22 0 0 0 4.6 1.52v-3.59a5.98 5.98 0 0 1-1.804-.404z"/></svg>;
    default: return null;
  }
};

export default function Footer() {
  useLocation();
  useSearch();
  const adPageType = getAdSensePageType(window.location.pathname + window.location.search);
  const showCatalogAdvertisement = adPageType === 'home' || adPageType === 'catalog';
  const { currentStation } = useGlobalPlayer();
  const isPlayerEnabled = currentStation !== null;
  const { t, isLoading: translationsLoading } = useTranslation();
  const { getLocalizedUrl, currentLanguage, changeLanguage } = useSeoRouting();
  
  // Language selector state
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [languageSearchQuery, setLanguageSearchQuery] = useState("");
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const languageTriggerRef = useRef<HTMLButtonElement>(null);
  const languageDropdownId = useId();
  
  // The metadata catalog also contains legacy locales that public routing
  // does not support. Offer only actual UI locales, not redirect-to-English choices.
  const enabledLanguages = SEO_LANGUAGES.filter(lang => lang.enabled && ACTIVE_SITEMAP_LANGUAGES.some(code => code === lang.code));
  const currentLangInfo = enabledLanguages.find(l => l.code === currentLanguage) || enabledLanguages[0];
  
  // Filter languages by search query (name is already in native format like Türkçe, Español)
  const filteredLanguages = enabledLanguages.filter(lang => 
    lang.name.toLowerCase().includes(languageSearchQuery.toLowerCase()) ||
    lang.code.toLowerCase().includes(languageSearchQuery.toLowerCase())
  );
  
  // Native buttons retain keyboard navigation; close on touch, outside focus,
  // and Escape as well as mouse clicks. Restore the trigger on Escape only.
  useEffect(() => {
    const closeDropdown = () => {
      setIsLanguageDropdownOpen(false);
      setLanguageSearchQuery("");
    };
    const handleClickOutside = (event: PointerEvent | FocusEvent) => {
      if (languageDropdownRef.current && !languageDropdownRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDropdown();
        languageTriggerRef.current?.focus();
      }
    };
    
    if (isLanguageDropdownOpen) {
      document.addEventListener('pointerdown', handleClickOutside);
      document.addEventListener('focusin', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('focusin', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLanguageDropdownOpen]);
  
  // LABEL SANITIZER (2026-07-04): the Turkish translation rows for the
  // footer_* keys were machine-generated with the KEY PREFIX translated into
  // the value ("footer_company" -> "Altbilgi Şirket" = lit. "Footer Company",
  // "footer_all_regions" -> "Alt Menü Tüm Bölgeler"). Until the DB rows are
  // cleaned, strip those artifact prefixes at render time and fix the one
  // value where stripping isn't enough. No-op for healthy translations.
  const FOOTER_LABEL_FIXES: Record<string, string> = {
    'Alt Menü Telif Hakkı': 'Tüm hakları saklıdır',
  };
  const ft = (key: string, fallback: string): string => {
    const v = t(key, fallback);
    if (FOOTER_LABEL_FIXES[v]) return FOOTER_LABEL_FIXES[v];
    return v.replace(/^(Altbilgi|Alt ?Menü)\s+/u, '');
  };

  // Fetch footer social media links. staleTime added (PageSpeed 2026-07-03):
  // the footer is lazy-mounted under Suspense in more than one wrapper, and
  // with the default staleTime of 0 every remount refetched the same static
  // link list — two identical requests per page load in the Lighthouse trace.
  const { data: socialLinks = [] } = useQuery<FooterSocialLink[]>({
    queryKey: ["/api/footer-social-media"],
    staleTime: 30 * 60 * 1000,
  });
  
  // Modal states
  const [showAddStationModal, setShowAddStationModal] = useState(false);
  
  // Lazy load footer background image for LCP optimization
  const footerRef = useRef<HTMLElement>(null);
  const [bgLoaded, setBgLoaded] = useState(false);
  
  useEffect(() => {
    let observer: IntersectionObserver | undefined;
    // Defer background loading to after critical content renders
    // This prevents the footer background from being detected as LCP
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
        observer = new IntersectionObserver(
          (entries) => {
            if (entries.some(entry => entry.isIntersecting)) {
              setBgLoaded(true);
              observer?.disconnect();
            }
          },
          { rootMargin: '200px' } // Start loading 200px before visible
        );
        
        if (footerRef.current) {
          observer.observe(footerRef.current);
        }
        
        return;
      }
      // Fallback for browsers without IntersectionObserver
      setBgLoaded(true);
    }, 100); // Small delay to ensure hero content loads first
    
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
    };
  }, []);

  return (
    <footer 
      ref={footerRef}
      lang={currentLanguage}
      className="border-t border-white/10 bg-black bg-[length:auto_100%] bg-no-repeat text-white"
      style={{
        backgroundImage: bgLoaded ? 'linear-gradient(180deg, rgba(0,0,0,.5), rgba(0,0,0,.85)), url(/images/footer-bg.webp)' : 'none',
        paddingBottom: `calc(${isPlayerEnabled ? '144px' : '0px'} + env(safe-area-inset-bottom, 0px))`,
      }}
    >
      {/* One content-end placement, separated from footer navigation. Station
          pages already own their capped placements; private pages get none. */}
      {showCatalogAdvertisement && <AdSenseUnit adSlot={AD_SLOTS.catalogFooter} adFormat="horizontal"
        fullWidthResponsive={true} className={`${usesInlineMobileCatalogAd(window.location.pathname + window.location.search) ? 'hidden md:block ' : ''}w-full max-w-[1206px] mx-auto px-4 pt-8 mb-8`} />}
      <div className="container mx-auto">
        {/* Main footer grid - responsive from mobile to 4K */}
        <div className="relative flex flex-col gap-8 pb-6 pt-8 sm:pt-12 md:pt-16 lg:pt-20 xl:pt-24
                        md:grid md:grid-cols-12 md:gap-4 md:pb-8 lg:gap-6 xl:gap-8">
          
          {/* Logo and Megaradio Brand - Responsive sizing */}
          <div className="flex min-w-0 justify-start md:col-span-3 md:self-end md:mb-[47px]">
            <Link href={getLocalizedUrl("/")} aria-label="MegaRadio" className="inline-flex min-w-0 items-center gap-2.5 md:gap-2 lg:gap-3 xl:gap-4 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199]">
              <img 
                loading="lazy"
                width="97"
                height="97"
                  className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 lg:w-20 lg:h-20 object-contain flex-shrink-0"
                src="/images/logo-icon.webp" 
                alt=""
                title="MegaRadio"
              />
              <div className="flex min-w-0 items-center">
                <span 
                  className="font-bold"
                  style={{ 
                    fontFamily: 'Ubuntu, sans-serif',
                    fontWeight: 700,
                    lineHeight: '100%',
                    letterSpacing: '0%'
                  }}
                >
                  <span className="text-[26px] md:text-lg lg:text-2xl xl:text-[32px]">mega</span>
                </span>
                <span 
                  style={{ 
                    fontFamily: 'Ubuntu, sans-serif',
                    fontWeight: 400,
                    lineHeight: '100%',
                    letterSpacing: '0%'
                  }}
                >
                  <span className="text-[26px] md:text-lg lg:text-2xl xl:text-[32px]">radio</span>
                </span>
              </div>
            </Link>
          </div>

          {/* PAGE LINKS - COMPANY AND REGIONS - Responsive columns */}
          <div className="min-w-0 md:col-span-6">
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 text-left md:gap-x-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,.7fr)] lg:gap-x-5 xl:gap-x-8">
              {/* Company Column */}
              <div className="flex min-w-0 flex-col gap-2">
                {translationsLoading ? (
                  <>
                    <div className="animate-pulse bg-gray-700 rounded h-5 w-20 mb-2"></div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {Array(7).fill(0).map((_, index) => (
                        <div key={index} className="animate-pulse bg-gray-700 rounded h-4 w-24"></div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="text-sm sm:text-base font-medium mb-1 text-white break-words">
                      {ft('footer_company', 'Company')}
                    </h2>
                    <div className="grid min-w-0 grid-cols-1 gap-0.5 md:gap-1.5 [&>button]:min-w-0 [&>button]:text-sm [&>button]:leading-5 [&>button]:[overflow-wrap:anywhere] [&>button]:hyphens-auto">
                      <Link to={getLocalizedUrl("/about")} className={footerLinkClass}>
                        {ft('footer_about_us', 'About Us')}
                      </Link>
                      <Link to={getLocalizedUrl("/applications")} className={footerLinkClass}>
                        {ft('footer_applications', 'Applications')}
                      </Link>
                      <Link to={getLocalizedUrl("/contact")} className={footerLinkClass}>
                        {ft('footer_contact', 'Contact')}
                      </Link>
                      {/* Internal-link boost: Semrush flagged ~60+ localized
                          URLs (per the May 2026 audit) for /lang/recommendations
                          and /lang/users as having only one internal link
                          site-wide. Linking them from the global footer gives
                          most public pages a discovery edge to both (the
                          footer is intentionally hidden on profile/admin/
                          standalone views), which should clear the warning
                          on the next crawl. */}
                      <Link to={getLocalizedUrl("/recommendations")} className={footerLinkClass}>
                        {ft('footer_recommendations', t('nav_for_you', 'Recommendations'))}
                      </Link>
                      <Link to={getLocalizedUrl("/users")} className={footerLinkClass}>
                        {ft('footer_users', t('users', 'Listeners'))}
                      </Link>
                      {/* Link to the CANONICAL legal URLs (not the /pages/*
                          duplicates). Both /terms-and-conditions and
                          /pages/terms-and-conditions render the same component
                          and each self-canonicals; the sitemap lists the clean
                          form, so the footer must match it to avoid duplicate-
                          content signals and split link equity. */}
                      <Link to={getLocalizedUrl("/terms-and-conditions")} className={footerLinkClass}>
                        {ft('footer_terms', 'Terms and Co.')}
                      </Link>
                      <Link to={getLocalizedUrl("/privacy-policy")} className={footerLinkClass}>
                        {ft('footer_privacy', 'Privacy')}
                      </Link>
                      <PrivacySettingsButton language={currentLanguage} />
                      <button
                        type="button"
                        className={`${footerLinkClass} bg-transparent border-0 m-0 cursor-pointer`}
                        onClick={() => setShowAddStationModal(true)}
                      >
                        {ft('footer_add_station', 'Add Your Station')}
                      </button>
                    </div>
                  </>
                )}
              </div>
              
              {/* Regions Column */}
              <div className="flex min-w-0 flex-col gap-2">
                {translationsLoading ? (
                  <>
                    <div className="animate-pulse bg-gray-700 rounded h-5 w-16 mb-2"></div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {Array(7).fill(0).map((_, index) => (
                        <div key={index} className="animate-pulse bg-gray-700 rounded h-4 w-20"></div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="text-sm sm:text-base font-medium mb-1 text-white break-words">
                      {ft('footer_regions', 'Regions')}
                    </h2>
                    <div className="grid min-w-0 grid-cols-1 gap-0.5 md:gap-1.5">
                      <Link to={getLocalizedUrl("/regions")} className={footerLinkClass}>
                        {ft('footer_all_regions', 'All Regions')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/north-america/united-states")} className={footerLinkClass}>
                        {ft('footer_united_states', 'United States')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/germany")} className={footerLinkClass}>
                        {ft('footer_germany', 'Germany')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/turkey")} className={footerLinkClass}>
                        {ft('footer_turkey', 'Türkiye')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/austria")} className={footerLinkClass}>
                        {ft('footer_austria', 'Austria')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/united-kingdom")} className={footerLinkClass}>
                        {ft('footer_united_kingdom', 'United Kingdom')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/france")} className={footerLinkClass}>
                        {ft('footer_france', 'France')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/spain")} className={`${footerLinkClass} lg:hidden`}>
                        {ft('footer_spain', 'Spain')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/italy")} className={`${footerLinkClass} lg:hidden`}>
                        {ft('footer_italy', 'Italy')}
                      </Link>
                    </div>
                  </>
                )}
              </div>
              
              {/* Additional Regions Column - Hidden on small screens */}
              <div className="hidden min-w-0 lg:flex flex-col gap-2">
                {translationsLoading ? (
                  <>
                    <div className="animate-pulse bg-gray-700 rounded h-5 w-16 mb-2 invisible"></div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {Array(2).fill(0).map((_, index) => (
                        <div key={index} className="animate-pulse bg-gray-700 rounded h-4 w-20"></div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div aria-hidden="true" className="text-sm sm:text-base font-medium mb-1 text-white invisible">
                      &nbsp;
                    </div>
                    <div className="grid min-w-0 grid-cols-1 gap-0.5 md:gap-1.5">
                      <Link to={getLocalizedUrl("/regions/europe/spain")} className={footerLinkClass}>
                        {ft('footer_spain', 'Spain')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/italy")} className={footerLinkClass}>
                        {ft('footer_italy', 'Italy')}
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* SOCIAL MEDIA LINKS - Responsive and bottom aligned with menu */}
          <div className="flex min-w-0 justify-start border-t border-white/10 pt-6 md:border-0 md:pt-0 md:justify-end md:col-span-3 md:self-end md:mb-[47px]">
            <div className="flex min-w-0 flex-col items-start md:items-end">
              <div className="mb-3 text-sm sm:text-base font-medium break-words md:text-right">
                {translationsLoading ? (
                  <div className="animate-pulse bg-gray-700 rounded h-5 w-28"></div>
                ) : (
                  ft('footer_social_media', 'Share Mega Radio')
                )}
              </div>
              <div className="flex gap-2 sm:gap-3 flex-wrap justify-start md:justify-end">
                {socialLinks.filter(link => link.isActive !== false).map((link) => (
                  <a
                    key={link._id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center justify-center w-11 h-11 rounded-full border border-white/15 text-white transition-colors flex-shrink-0 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                    style={{ backgroundColor: platformColors[link.platform] || '#FF4199' }}
                    aria-label={link.platform}
                    title={link.platform}
                  >
                    {getSocialIcon(link.platform)}
                  </a>
                ))}
              </div>
              
              {/* MXRTOKEN Link */}
              <a
                href="https://mxrtoken.com"
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mt-2 inline-flex min-h-11 items-center rounded-sm text-xs font-medium tracking-[.14em] text-[#b7b7bf] hover:text-[#FF4199] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199]"
                style={{ 
                  fontFamily: 'Ubuntu, sans-serif',
                  fontWeight: 600
                }}
              >
                MXRTOKEN
              </a>
            </div>
          </div>
        </div>
        
        {/* COPYRIGHT & LANGUAGE SELECTOR - Below social media */}
        <div className="border-t border-white/10 pb-6 pt-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-5">
          {/* Language Selector */}
          <div className="relative min-w-0 sm:shrink-0" ref={languageDropdownRef}>
            <button
              type="button"
              ref={languageTriggerRef}
              aria-expanded={isLanguageDropdownOpen}
              aria-controls={languageDropdownId}
              onClick={() => {
                setIsLanguageDropdownOpen(open => !open);
                setLanguageSearchQuery("");
              }}
              className="flex min-h-12 w-full sm:w-auto items-center gap-3 px-4 py-3 rounded-xl bg-[#18181b] hover:bg-[#232327] border border-white/15 transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199]"
              data-testid="footer-language-selector"
            >
              <Globe aria-hidden="true" className="w-4 h-4 shrink-0 text-[#FF4199]" />
              <span className="min-w-0 flex-1 text-left text-white">{currentLangInfo?.name || 'English'}</span>
              <svg aria-hidden="true" className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${isLanguageDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {/* Language Dropdown */}
            {isLanguageDropdownOpen && (
              <div id={languageDropdownId} role="region" aria-label={t('search_language', 'Search language...')} className="absolute bottom-full mb-2 left-0 w-full sm:w-64 max-w-[calc(100vw_-_2rem)] max-h-[min(320px,60dvh)] flex flex-col bg-[#141416] border border-white/15 rounded-xl shadow-2xl overflow-hidden z-50">
                <div className="p-2 border-b border-[#333]">
                  <input
                    type="text"
                    autoFocus
                    aria-label={t('search_language', 'Search language...')}
                    value={languageSearchQuery}
                    onChange={(e) => setLanguageSearchQuery(e.target.value)}
                    placeholder={t('search_language', 'Search language...')}
                    className="min-h-11 w-full px-3 py-2 bg-[#1A1A1A] border border-[#444] rounded-lg text-white text-base sm:text-sm placeholder-gray-400 focus:outline-none focus:border-[#FF4199]"
                    data-testid="language-search-input"
                  />
                </div>
                <div className="min-h-0 overflow-y-auto overscroll-contain p-1">
                  {filteredLanguages.map((lang) => (
                    <button
                      type="button"
                      key={lang.code}
                      aria-pressed={lang.code === currentLanguage}
                      onClick={() => {
                        changeLanguage(lang.code);
                        setIsLanguageDropdownOpen(false);
                        setLanguageSearchQuery("");
                      }}
                      className={`min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[#2A2A2A] transition-colors flex items-center justify-between gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FF4199] ${
                        lang.code === currentLanguage ? 'bg-[#FF4199]/20 text-[#FF4199]' : 'text-white'
                      }`}
                      data-testid={`language-option-${lang.code}`}
                    >
                      <span>{lang.name}</span>
                      <span className="text-xs text-gray-400 uppercase">{lang.code}</span>
                    </button>
                  ))}
                  {filteredLanguages.length === 0 && <p role="status" className="px-3 py-4 text-sm text-gray-400">{t('no_results', 'No results')}</p>}
                </div>
              </div>
            )}
          </div>
          
          {/* Copyright */}
          {translationsLoading ? (
            <div className="animate-pulse bg-gray-700 rounded h-4 w-48"></div>
          ) : (
            <p className="min-w-0 text-xs sm:text-sm leading-5 text-left sm:text-right text-[#a5a5ad] [overflow-wrap:anywhere]">
              © {new Date().getFullYear()} Megaradio · {ft('footer_copyright', 'All rights reserved')}
            </p>
          )}
        </div>
      </div>
      
      {/* Modals — gated on isOpen so the lazy chunk only requests on first open */}
      {showAddStationModal && (
        <Suspense fallback={null}>
          <AddYourStationModal 
            isOpen={showAddStationModal} 
            onClose={() => setShowAddStationModal(false)} 
          />
        </Suspense>
      )}
    </footer>
  );
}

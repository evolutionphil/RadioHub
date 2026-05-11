import { Link, useLocation } from "wouter";
import { useState, Suspense, lazy, useEffect, useRef } from "react";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useQuery } from "@tanstack/react-query";
import { SEO_LANGUAGES } from "@workspace/seo-shared/seo-config";
// 🚀 LAZY: modals only load on first open — keeps Radix Select/Input
// out of the footer chunk until the user clicks the action.
const AddYourStationModal = lazy(() => import("@/components/modals/AddYourStationModal"));
const RequestStationModal = lazy(() => import("@/components/modals/RequestStationModal"));
import { Globe } from "lucide-react";
import AdSenseUnit from "@/components/ads/AdSenseUnit";

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
  const [location, setLocation] = useLocation();
  const isProfilePage = location.startsWith('/profile');
  const { currentStation } = useGlobalPlayer();
  const isPlayerEnabled = currentStation !== null;
  const { t, isLoading: translationsLoading } = useTranslation();
  const { getLocalizedUrl, currentLanguage, changeLanguage } = useSeoRouting();
  
  // Language selector state
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [languageSearchQuery, setLanguageSearchQuery] = useState("");
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  
  // Get enabled languages
  const enabledLanguages = SEO_LANGUAGES.filter(lang => lang.enabled);
  const currentLangInfo = enabledLanguages.find(l => l.code === currentLanguage) || enabledLanguages[0];
  
  // Filter languages by search query (name is already in native format like Türkçe, Español)
  const filteredLanguages = enabledLanguages.filter(lang => 
    lang.name.toLowerCase().includes(languageSearchQuery.toLowerCase()) ||
    lang.code.toLowerCase().includes(languageSearchQuery.toLowerCase())
  );
  
  // Close language dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (languageDropdownRef.current && !languageDropdownRef.current.contains(event.target as Node)) {
        setIsLanguageDropdownOpen(false);
        setLanguageSearchQuery("");
      }
    };
    
    if (isLanguageDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isLanguageDropdownOpen]);
  
  // Fetch footer social media links
  const { data: socialLinks = [] } = useQuery<FooterSocialLink[]>({
    queryKey: ["/api/footer-social-media"],
  });
  
  // Modal states
  const [showAddStationModal, setShowAddStationModal] = useState(false);
  const [showRequestStationModal, setShowRequestStationModal] = useState(false);
  
  // Lazy load footer background image for LCP optimization
  const footerRef = useRef<HTMLElement>(null);
  const [bgLoaded, setBgLoaded] = useState(false);
  
  useEffect(() => {
    // Defer background loading to after critical content renders
    // This prevents the footer background from being detected as LCP
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
        const observer = new IntersectionObserver(
          (entries) => {
            if (entries[0].isIntersecting) {
              setBgLoaded(true);
              observer.disconnect();
            }
          },
          { rootMargin: '200px' } // Start loading 200px before visible
        );
        
        if (footerRef.current) {
          observer.observe(footerRef.current);
        }
        
        return () => observer.disconnect();
      }
      // Fallback for browsers without IntersectionObserver
      setBgLoaded(true);
      return undefined;
    }, 100); // Small delay to ensure hero content loads first
    
    return () => clearTimeout(timer);
  }, []);

  return (
    <footer 
      ref={footerRef}
      className="bg-[rgb(0,0,0)] bg-[length:auto_100%] bg-no-repeat text-white transition-all duration-300"
      style={{
        backgroundImage: bgLoaded ? 'url(/images/footer-bg.webp)' : 'none'
      }}
    >
      <div className={`container mx-auto ${isPlayerEnabled ? 'pb-36' : ''}`}>
        {/* Main footer grid - responsive from mobile to 4K */}
        <div className="relative flex flex-col gap-6 pb-6 pt-10 sm:pt-12 md:pt-16 lg:pt-20 xl:pt-24
                        md:grid md:grid-cols-12 md:gap-4 md:pb-8 lg:gap-6 xl:gap-8">
          
          {/* Logo and Megaradio Brand - Responsive sizing */}
          <div className="flex justify-center md:justify-start md:col-span-3 lg:col-span-3 xl:col-span-3 md:self-end md:mb-[47px]">
            <a href="#" className="flex flex-col items-center md:flex-row md:items-center md:gap-2 lg:gap-3 xl:gap-4 flex-shrink-0">
              <img 
                loading="lazy"
                width="97"
                height="97"
                className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 lg:w-20 lg:h-20 xl:w-[97px] xl:h-[97px] flex-shrink-0" 
                src="/images/logo-icon.webp" 
                alt="Mega Radio music streaming logo" 
                title="Mega Radio - Listen to live stations worldwide"
              />
              <div className="flex items-center mt-2 md:mt-0">
                <span 
                  className="font-bold"
                  style={{ 
                    fontFamily: 'Ubuntu, sans-serif',
                    fontWeight: 700,
                    lineHeight: '100%',
                    letterSpacing: '0%'
                  }}
                >
                  <span className="text-xs md:text-lg lg:text-2xl xl:text-[36.11px]">mega</span>
                </span>
                <span 
                  style={{ 
                    fontFamily: 'Ubuntu, sans-serif',
                    fontWeight: 400,
                    lineHeight: '100%',
                    letterSpacing: '0%'
                  }}
                >
                  <span className="text-xs md:text-lg lg:text-2xl xl:text-[36.11px]">radio</span>
                </span>
              </div>
            </a>
          </div>

          {/* PAGE LINKS - COMPANY AND REGIONS - Responsive columns */}
          <div className="flex flex-col md:col-span-6 lg:col-span-6 xl:col-span-6">
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-6 sm:gap-x-12 md:gap-x-8 lg:gap-x-12 xl:gap-x-16 text-center md:text-left">
              {/* Company Column */}
              <div className="flex flex-col gap-2 min-w-[100px] sm:min-w-[120px]">
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
                    <div className="text-sm sm:text-base font-medium mb-2 text-white">
                      {t('footer_company', 'Company')}
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:gap-2">
                      <Link to={getLocalizedUrl("/about")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        {t('footer_about_us', 'About Us')}
                      </Link>
                      <Link to={getLocalizedUrl("/applications")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        {t('footer_applications', 'Applications')}
                      </Link>
                      <Link to={getLocalizedUrl("/contact")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        {t('footer_contact', 'Contact')}
                      </Link>
                      <Link to={getLocalizedUrl("/pages/terms-and-conditions")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        {t('footer_terms', 'Terms and Co.')}
                      </Link>
                      <Link to={getLocalizedUrl("/pages/privacy-policy")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        {t('footer_privacy', 'Privacy')}
                      </Link>
                      <button
                        type="button"
                        className="inline-flex items-center min-h-[44px] text-left bg-transparent border-0 p-0 m-0 cursor-pointer text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors"
                        onClick={() => setShowAddStationModal(true)}
                      >
                        {t('footer_add_station', 'Add Your Station')}
                      </button>
                    </div>
                  </>
                )}
              </div>
              
              {/* Regions Column */}
              <div className="flex flex-col gap-2 min-w-[100px] sm:min-w-[120px]">
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
                    <div className="text-sm sm:text-base font-medium mb-2 text-white">
                      {t('footer_regions', 'Regions')}
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:gap-2">
                      <Link to={getLocalizedUrl("/regions")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        {t('footer_all_regions', 'All Regions')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/north-america/united-states")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        {t('footer_united_states', 'United States')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/germany")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        {t('footer_germany', 'Germany')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/turkey")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        Türkiye
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/austria")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        {t('footer_austria', 'Austria')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/united-kingdom")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        {t('footer_united_kingdom', 'United Kingdom')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/france")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        {t('footer_france', 'France')}
                      </Link>
                    </div>
                  </>
                )}
              </div>
              
              {/* Additional Regions Column - Hidden on small screens */}
              <div className="hidden lg:flex flex-col gap-2 min-w-[80px]">
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
                    <div className="text-sm sm:text-base font-medium mb-2 text-white invisible">
                      &nbsp;
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:gap-2">
                      <Link to={getLocalizedUrl("/regions/europe/spain")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        {t('footer_spain', 'Spain')}
                      </Link>
                      <Link to={getLocalizedUrl("/regions/europe/italy")} className="inline-flex items-center min-h-[44px] text-xs sm:text-sm text-gray-100 hover:text-[#FF4199] transition-colors">
                        {t('footer_italy', 'Italy')}
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* SOCIAL MEDIA LINKS - Responsive and bottom aligned with menu */}
          <div className="flex justify-center md:justify-end md:col-span-3 lg:col-span-3 xl:col-span-3 md:self-end md:mb-[47px]">
            <div className="flex flex-col items-center md:items-end">
              <div className="mb-3 text-sm sm:text-base font-medium whitespace-nowrap">
                {translationsLoading ? (
                  <div className="animate-pulse bg-gray-700 rounded h-5 w-28"></div>
                ) : (
                  t('footer_social_media', 'Share Mega Radio')
                )}
              </div>
              <div className="flex gap-2 sm:gap-3 flex-wrap justify-center md:justify-end">
                {socialLinks.map((link) => (
                  <a
                    key={link._id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center justify-center w-12 h-12 rounded-full text-white transition-colors flex-shrink-0 hover:opacity-80"
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
                className="mt-3 text-sm font-medium hover:opacity-80 transition-opacity"
                style={{ 
                  color: '#000000',
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
        <div className="pb-6 pt-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Language Selector */}
          <div className="relative" ref={languageDropdownRef}>
            <button
              onClick={() => setIsLanguageDropdownOpen(!isLanguageDropdownOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#333] transition-colors text-sm"
              data-testid="footer-language-selector"
            >
              <Globe className="w-4 h-4 text-[#FF4199]" />
              <span className="text-white">{currentLangInfo?.name || 'English'}</span>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${isLanguageDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {/* Language Dropdown */}
            {isLanguageDropdownOpen && (
              <div className="absolute bottom-full mb-2 left-0 w-64 max-h-80 bg-[#0E0E0E] border border-[#333] rounded-lg shadow-2xl overflow-hidden z-50">
                <div className="p-2 border-b border-[#333]">
                  <input
                    type="text"
                    value={languageSearchQuery}
                    onChange={(e) => setLanguageSearchQuery(e.target.value)}
                    placeholder={t('search_language', 'Search language...')}
                    className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#444] rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-[#FF4199]"
                    data-testid="language-search-input"
                  />
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {filteredLanguages.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        changeLanguage(lang.code);
                        setIsLanguageDropdownOpen(false);
                        setLanguageSearchQuery("");
                      }}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-[#2A2A2A] transition-colors flex items-center justify-between ${
                        lang.code === currentLanguage ? 'bg-[#FF4199]/20 text-[#FF4199]' : 'text-white'
                      }`}
                      data-testid={`language-option-${lang.code}`}
                    >
                      <span>{lang.name}</span>
                      <span className="text-xs text-gray-500 uppercase">{lang.code}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {/* Copyright */}
          {translationsLoading ? (
            <div className="animate-pulse bg-gray-700 rounded h-4 w-48"></div>
          ) : (
            <p className="text-xs sm:text-sm text-center text-[#9B9B9B]">
              © {new Date().getFullYear()} {t('footer_copyright', 'All rights reserved')} Megaradio
            </p>
          )}
        </div>
      </div>
      
      {/* AdSense Banner - Bottom of Footer */}
      <div className="w-full mt-4 px-4">
        <AdSenseUnit adSlot="9151849981" adFormat="auto" fullWidthResponsive={true} />
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
      {showRequestStationModal && (
        <Suspense fallback={null}>
          <RequestStationModal 
            isOpen={showRequestStationModal} 
            onClose={() => setShowRequestStationModal(false)} 
          />
        </Suspense>
      )}
    </footer>
  );
}

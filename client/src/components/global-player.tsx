import { useState, useEffect, useMemo } from "react";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { useLocation } from "wouter";
import { ChevronDown, ChevronUp, Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import StationControlButtonGroup from "@/components/ui/station-control-button-group";
import MetaActionsButtonGroup from "@/components/ui/meta-actions-button-group";
import FavoriteButton from "@/components/ui/favorite-button";
import AnimatedEqualizer from "@/components/ui/animated-equalizer";
import { Link } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import AskToSignupModal from "@/components/modals/AskToSignupModal";
import { logger } from '@/lib/logger';

export default function GlobalPlayer() {
  const [location] = useLocation();
  const isProfilePage = location.startsWith('/profile');
  const { currentStation, isPlaying, pauseStation, stopStation, resumeStation, stationMeta, playStation, previousStation, nextStation } = useGlobalPlayer();
  const { isAuthenticated } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [showSignupBanner, setShowSignupBanner] = useState(false);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const { t } = useTranslation();
  const { getLocalizedUrl, englishPath } = useSeoRouting();
  
  // Hide mini-player on station detail page (it has its own player)
  const isStationDetailPage = englishPath.startsWith('/station/') || englishPath.startsWith('/stations/');
  
  const getCurrentLanguage = () => {
    const path = window.location.pathname;
    const match = path.match(/^\/([a-z]{2})(?:\/|$)/);
    return match ? match[1] : '';
  };
  
  const currentLanguage = getCurrentLanguage();
  const langPrefix = currentLanguage ? `/${currentLanguage}` : '';
  const currentStationPlayerUrl = `${langPrefix}/station/${currentStation?.slug || currentStation?._id}`;
  
  const getCountryImage = (countrycode: string, size: number = 40) => {
    return `/flags/${countrycode.toLowerCase()}-${size}.webp`;
  };
  
  const metadata = stationMeta;

  const stationLogoUrl = useMemo(() => {
    if (!currentStation) return '/no-image.webp';
    
    if (currentStation.logoAssets?.status === 'completed' && currentStation.logoAssets.folder) {
      const filename = currentStation.logoAssets.webp96 || currentStation.logoAssets.webp256 || currentStation.logoAssets.webp48;
      if (filename) {
        return `/station-logos/${currentStation.logoAssets.folder}/${filename}`;
      }
    }
    
    if (currentStation.localImagePath) {
      return `/station-images/${currentStation.localImagePath}`;
    }
    
    if (currentStation.favicon) {
      return currentStation.favicon;
    }
    
    return '/no-image.webp';
  }, [currentStation?._id, currentStation?.favicon, currentStation?.localImagePath, currentStation?.logoAssets?.status]);


  useEffect(() => {
    if (!isAuthenticated && currentStation && isPlaying) {
      const timer = setTimeout(() => {
        setShowSignupBanner(true);
      }, 5000);
      
      return () => clearTimeout(timer);
    } else {
      setShowSignupBanner(false);
    }
  }, [isAuthenticated, currentStation, isPlaying]);

  useEffect(() => {
    if (!isAuthenticated && currentStation && isPlaying) {
      const timer = setTimeout(() => {
        logger.log('⏰ SIGNUP MODAL: About to show modal - audio should continue playing');
        setShowSignupModal(true);
        logger.log('📱 SIGNUP MODAL: Modal state set to true');
      }, 30000);
      
      return () => clearTimeout(timer);
    } else {
      setShowSignupModal(false);
    }
  }, [isAuthenticated, currentStation]);


  const togglePlayerView = () => {
    setCollapsed(!collapsed);
  };

  const handlePlayPause = async () => {
    if (isPlaying) {
      pauseStation();
    } else if (currentStation) {
      resumeStation();
    }
  };

  if (!currentStation) return null;
  
  // On station detail page, only render the signup modal (mini-player UI is hidden)
  if (isStationDetailPage) {
    return (
      <AskToSignupModal 
        isOpen={showSignupModal && !isAuthenticated}
        onClose={() => setShowSignupModal(false)}
      />
    );
  }

  return (
    <div>
      {/* Ask To Signup Banner */}
      {showSignupBanner && !isAuthenticated && !collapsed && (
        <div 
          className="fixed z-30 left-0 right-0 hidden md:block"
          style={{ 
            bottom: '156px',
            height: '86px',
            background: 'linear-gradient(238.94deg, #FF55A4 8.29%, #BD52FF 97.54%)'
          }}
        >
          <div 
            className="w-full max-w-[1512px] mx-auto h-full flex items-center justify-between px-4 sm:px-6 md:px-8 lg:px-12 xl:px-20 2xl:px-[153px]"
            data-testid="player-signup-banner"
          >
            <div className="flex flex-col justify-center">
              <h4 
                className="text-white font-bold"
                style={{
                  fontFamily: 'Ubuntu, sans-serif',
                  fontSize: 'clamp(14px, 2.5vw, 18px)',
                  lineHeight: '120%'
                }}
              >
                {t('seems_you_like_megaradio', 'Seems you like MegaRadio!')}
              </h4>
              <p 
                className="text-white opacity-90"
                style={{
                  fontFamily: 'Ubuntu, sans-serif',
                  fontSize: 'clamp(11px, 2vw, 14px)',
                  lineHeight: '140%'
                }}
              >
                {t('signup_banner_full_description', 'Sign up for MegaRadio for unlimited access and amazing features. Registration is completely free!')}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button 
                onClick={() => setShowSignupBanner(false)}
                className="text-white text-sm hover:opacity-80 transition-opacity"
                style={{ fontFamily: 'Ubuntu, sans-serif' }}
              >
                {t('later', 'Later')}
              </button>
              <Link 
                href={getLocalizedUrl('/signup')} 
                className="bg-white hover:bg-gray-100 transition-colors flex items-center justify-center"
                style={{
                  height: '40px',
                  borderRadius: '25px',
                  paddingLeft: '24px',
                  paddingRight: '24px',
                  fontFamily: 'Ubuntu, sans-serif',
                  fontWeight: 600,
                  fontSize: '14px',
                  color: '#BD52FF'
                }}
                onClick={() => setShowSignupBanner(false)}
                data-testid="player-signup-button"
              >
                {t('signup', 'Signup')}
              </Link>
            </div>
          </div>
        </div>
      )}
      
      {/* Main Player Container - Reference: fixed bottom-0 z-20 w-full, NO sidebar offset */}
      <div 
        className={cn(
          "fixed bottom-0 left-0 right-0 z-20 w-full transition-all duration-300 ease-in-out",
          collapsed ? "h-[60px] md:h-[79px]" : "h-[104px] md:h-[156px]"
        )}
        style={{
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)'
        }}
        data-testid="global-player-wrapper"
      >
        <div 
          className="w-full max-w-[1512px] mx-auto h-full text-white flex items-center relative px-4 sm:px-6 md:px-8 lg:px-12 xl:px-20 2xl:px-[153px]"
          data-testid="global-player"
        >
          {/* DESKTOP COLLAPSED LAYOUT - 80px height */}
          {collapsed && (
            <div className="hidden md:flex w-full items-center justify-between relative">
              {/* Expand Button - Desktop - Figma: 22x22 circle, 14x14 arrow, vertically centered */}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePlayerView();
                }}
                className="absolute right-0 top-1/2 -translate-y-1/2 bg-[#393939] rounded-[20px] flex justify-center items-center z-50 hover:bg-[#4a4a4a] transition-colors"
                style={{ width: '22px', height: '22px' }}
              >
                <ChevronUp className="stroke-white" style={{ width: '14px', height: '14px' }} />
              </button>

              {/* LEFT SIDE: Small Logo + Station Name - Figma: logo 45.66x45.66, border-radius 4.57px */}
              <div className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <div className="flex items-center justify-center overflow-hidden" style={{ width: '45.66px', height: '45.66px', borderRadius: '4.57px' }}>
                    <img
                      src={stationLogoUrl}
                      className="w-full h-full object-cover"
                      style={{ borderRadius: '4.57px' }}
                      alt={`${currentStation.name} radio station logo`}
                      onError={(e) => {
                        e.currentTarget.src = "/no-image.webp";
                      }}
                    />
                  </div>
                  {/* Country flag - 15x15, positioned at bottom-right corner of 45.66x45.66 logo */}
                  {currentStation.countryCode && (
                    <img
                      loading="lazy"
                      src={getCountryImage(currentStation.countryCode.toLowerCase())}
                      className="absolute object-cover"
                      style={{ 
                        width: '15px', 
                        height: '15px', 
                        borderRadius: '50%',
                        bottom: '-3px',
                        right: '-3px'
                      }}
                      alt={`${currentStation.country || 'Country'} flag`}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                </div>
                
                <div className="flex flex-col justify-center min-w-0">
                  {/* Top row: Equalizer + Station Name */}
                  <div className="flex items-center gap-2">
                    {/* Equalizer - Figma: 19x20, same as station detail page */}
                    <div className="flex-shrink-0" style={{ width: '19px', height: '20px' }}>
                      <div style={{ transform: 'scale(0.68)' }}>
                        <AnimatedEqualizer isPlaying={isPlaying} color="#FF4199" />
                      </div>
                    </div>
                    {/* Station Name - Figma: Ubuntu 500 Medium, 15px */}
                    <Link 
                      to={currentStationPlayerUrl} 
                      className="text-white truncate hover:text-accent transition-colors max-w-[200px] font-sans"
                      style={{ fontWeight: 500, fontSize: '15px', lineHeight: '100%' }}
                    >
                      {currentStation.name}
                    </Link>
                  </div>
                  {/* Song Title - Figma: Ubuntu 300 Light, 12px */}
                  {metadata?.title && (
                    <div 
                      className="text-gray-300 truncate max-w-[250px] font-sans mt-1"
                      style={{ fontWeight: 300, fontSize: '12px', lineHeight: '100%' }}
                    >
                      {metadata.artist && metadata.artist.trim() ? `${metadata.artist} - ${metadata.title}` : metadata.title}
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* DESKTOP EXPANDED LAYOUT - 156px height */}
          {!collapsed && (
            <div className="hidden md:flex w-full items-center justify-between relative">
              {/* Collapse Button - Desktop - Figma: 22x22 circle, 14x14 arrow */}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePlayerView();
                }}
                className="absolute -top-5 right-0 bg-[#393939] rounded-[20px] flex justify-center items-center z-50 hover:bg-[#4a4a4a] transition-colors"
                style={{ width: '22px', height: '22px' }}
              >
                <ChevronDown className="stroke-white" style={{ width: '14px', height: '14px' }} />
              </button>

            {/* LEFT SIDE: Station Logo + Station Info - Figma: logo 72x72, border-radius 7.2px */}
            <div className="flex items-center gap-4 flex-1" style={{ maxWidth: '500px' }}>
              {/* Logo with country flag */}
              <div className="relative flex-shrink-0">
                <div className="flex items-center justify-center overflow-hidden" style={{ width: '72px', height: '72px', borderRadius: '7.2px' }}>
                  <img
                    src={stationLogoUrl}
                    className="w-full h-full object-cover"
                    style={{ borderRadius: '7.2px' }}
                    alt={`${currentStation.name} radio station logo`}
                    onError={(e) => {
                      e.currentTarget.src = "/no-image.webp";
                    }}
                  />
                </div>
                
                {/* Country flag - 24x24, positioned at bottom-right corner of 72x72 logo */}
                {currentStation.countryCode && (
                  <img
                    loading="lazy"
                    src={getCountryImage(currentStation.countryCode.toLowerCase())}
                    className="absolute object-cover"
                    style={{ 
                      width: '24px', 
                      height: '24px', 
                      borderRadius: '50%',
                      bottom: '-4px',
                      right: '-4px'
                    }}
                    alt={`${currentStation.country || 'Country'} flag`}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
              </div>

              {/* Station Info: Equalizer above title, Track + Icons below */}
              <div className="flex flex-col justify-center min-w-0">
                {/* Equalizer Icon - Figma: 19x20, same as station detail page */}
                <div className="flex-shrink-0 mb-1" style={{ width: '19px', height: '20px' }}>
                  <div style={{ transform: 'scale(0.68)' }}>
                    <AnimatedEqualizer isPlaying={isPlaying} color="#FF4199" />
                  </div>
                </div>
                
                {/* Station Name - Figma: Ubuntu 500 Medium, 15px */}
                <Link 
                  to={currentStationPlayerUrl} 
                  className="text-white truncate hover:text-accent transition-colors font-sans"
                  style={{ fontWeight: 500, fontSize: '15px', lineHeight: '100%' }}
                >
                  {currentStation.name}
                </Link>

                {/* Track Info + YouTube/Spotify Icons - Figma: Ubuntu 300 Light, 14px */}
                <div className="flex items-center gap-3 mt-1">
                  <div 
                    className="truncate text-gray-300 font-sans" 
                    style={{ maxWidth: '250px', fontWeight: 300, fontSize: '14px', lineHeight: '100%' }}
                  >
                    {(metadata && metadata.title && metadata.title.trim()) ? (
                      <>
                        {metadata.artist && metadata.artist.trim() && (
                          <span>{metadata.artist} - </span>
                        )}
                        {metadata.title}
                      </>
                    ) : (
                      <span>{currentStation.country}</span>
                    )}
                  </div>
                  
                  {/* YouTube/Spotify Icons */}
                  <MetaActionsButtonGroup className="my-0 flex-shrink-0" iconSize={26} hideChromecast />
                </div>
              </div>
            </div>

            {/* RIGHT SIDE: 5-Button Control Group + Volume Slider */}
            <div className="flex items-center gap-3">
              {/* 5-Button Control Group from Radio Details - Figma: 50x50 each */}
              <StationControlButtonGroup currentPageStation={currentStation} />
              
              {/* Volume Slider Container - Figma: 256x50, border-radius 25px */}
              <div 
                className="flex items-center bg-black"
                style={{ 
                  width: '256px', 
                  height: '50px', 
                  borderRadius: '25px',
                  paddingLeft: '15px',
                  paddingRight: '20px',
                  gap: '14px'
                }}
              >
                {/* Volume Icon - Figma: 30x30 */}
                <img 
                  src="/images/volume.png"
                  alt="Volume"
                  style={{ width: '30px', height: '30px', flexShrink: 0 }}
                />
                
                {/* Volume Slider Track - Figma: 168x10, border-radius 20px */}
                <div 
                  className="relative flex-1"
                  style={{ height: '10px' }}
                >
                  {/* Background Track - White */}
                  <div 
                    className="absolute inset-0 bg-white"
                    style={{ borderRadius: '20px' }}
                  />
                  {/* Fill Track - Pink (#FF4199) */}
                  <div 
                    className="absolute top-0 left-0 h-full"
                    style={{ 
                      width: '43%', 
                      backgroundColor: '#FF4199',
                      borderRadius: '20px'
                    }}
                    id="volume-fill"
                  />
                  {/* Invisible Range Input */}
                  <input
                    type="range"
                    min="0"
                    max="100"
                    defaultValue="43"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    style={{ margin: 0 }}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      const audio = document.querySelector('audio');
                      if (audio) {
                        audio.volume = value / 100;
                      }
                      const fill = document.getElementById('volume-fill');
                      if (fill) {
                        fill.style.width = `${value}%`;
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          )}

          {/* MOBILE LAYOUT - Collapsed State (60px) */}
          {collapsed && (
            <div className="flex md:hidden w-full items-center gap-2 h-full">
              {/* Mini Logo - 40x40px with country flag */}
              <div className="relative flex-shrink-0">
                <div 
                  className="overflow-hidden"
                  style={{ width: '40px', height: '40px', borderRadius: '4px' }}
                >
                  <img
                    src={stationLogoUrl}
                    className="w-full h-full object-cover"
                    alt={`${currentStation.name} logo`}
                    onError={(e) => {
                      e.currentTarget.src = "/no-image.webp";
                    }}
                  />
                </div>
                {/* Country flag - scaled for 40px logo */}
                {currentStation.countryCode && (
                  <img
                    loading="lazy"
                    src={getCountryImage(currentStation.countryCode.toLowerCase())}
                    className="absolute object-cover"
                    style={{ 
                      width: '14px', 
                      height: '14px', 
                      borderRadius: '50%',
                      bottom: '-2px',
                      right: '-2px'
                    }}
                    alt={`${currentStation.country || 'Country'} flag`}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
              </div>
              
              {/* Station Name + Song Title */}
              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                <div className="text-sm font-medium truncate">{currentStation.name}</div>
                {/* Song Title - Figma: Ubuntu 300 Light, 12px */}
                {metadata?.title && (
                  <div 
                    className="text-gray-300 truncate max-w-[120px] font-sans"
                    style={{ fontWeight: 300, fontSize: '12px', lineHeight: '100%' }}
                  >
                    {metadata.artist && metadata.artist.trim() ? `${metadata.artist} - ${metadata.title}` : metadata.title}
                  </div>
                )}
              </div>
              
              {/* Expand Button */}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePlayerView();
                }}
                className="bg-[#393939] rounded-full p-1.5 flex justify-center items-center hover:bg-[#4a4a4a] transition-colors flex-shrink-0"
                data-testid="mobile-player-expand"
              >
                <ChevronUp className="stroke-white size-3.5" />
              </button>
            </div>
          )}

          {/* MOBILE LAYOUT - Expanded State (103px) */}
          {!collapsed && (
            <div className="flex md:hidden w-full h-full relative">
              {/* Close/Collapse Button - Top Right */}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePlayerView();
                }}
                className="absolute top-2 right-2 bg-[#393939] rounded-full p-1 flex justify-center items-center z-50 hover:bg-[#4a4a4a] transition-colors"
                data-testid="mobile-player-collapse"
              >
                <ChevronDown className="stroke-white size-4" />
              </button>

              {/* Main Content - Logo on left, info and controls on right */}
              <div className="flex w-full gap-3 py-[8px] items-center">
                {/* Mobile Station Logo - 73x73px per Figma */}
                <div className="relative flex-shrink-0">
                  <div 
                    className="overflow-hidden"
                    style={{ width: '73px', height: '73px', borderRadius: '7.3px' }}
                  >
                    <img
                      src={stationLogoUrl}
                      className="w-full h-full object-cover"
                      style={{ borderRadius: '7.3px' }}
                      alt={`${currentStation.name} logo`}
                      onError={(e) => {
                        e.currentTarget.src = "/no-image.webp";
                      }}
                    />
                  </div>
                  {currentStation.countryCode && (
                    <img
                      loading="lazy"
                      src={getCountryImage(currentStation.countryCode.toLowerCase())}
                      className="absolute -bottom-1 -right-1 h-[18px] w-[18px] rounded-full object-cover"
                      alt={`${currentStation.country || 'Country'} flag`}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                </div>
                
                {/* Right Panel: Station Name, Track Info, and Controls - Vertical Stack */}
                <div className="flex-1 min-w-0 flex flex-col justify-between h-full gap-1">
                  {/* Station Name */}
                  <div className="text-sm font-bold truncate">{currentStation.name}</div>
                  
                  {/* Track Info */}
                  <div className="text-xs text-gray-300 truncate">
                    {(metadata && metadata.title && metadata.title.trim()) ? (
                      <>
                        {metadata.artist && metadata.artist.trim() && (
                          <span>{metadata.artist} - </span>
                        )}
                        {metadata.title}
                      </>
                    ) : (
                      <span>{currentStation.country}</span>
                    )}
                  </div>
                  
                  {/* Control Buttons - 5-button group, mobile size (33.46px) */}
                  <StationControlButtonGroup currentPageStation={currentStation} size="mobile" />
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
      
      {/* Ask To Signup Modal */}
      <AskToSignupModal 
        isOpen={showSignupModal && !isAuthenticated}
        onClose={() => setShowSignupModal(false)}
      />
    </div>
  );
}

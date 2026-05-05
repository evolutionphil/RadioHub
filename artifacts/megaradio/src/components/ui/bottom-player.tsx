import { useState } from "react";
import { ChevronUp, ChevronDown, Play, Pause, SkipBack, SkipForward, Heart, Volume2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { Link } from "wouter";
import { cn, getImageUrl } from "@/lib/utils";
import StationControlButtonGroup from "@/components/ui/station-control-button-group";
import MetaActionsButtonGroup from "@/components/ui/meta-actions-button-group";
import { StationLogo } from "@/components/ui/station-logo";
import { useTranslation } from "@/hooks/useTranslation";
import { getStationUrl } from "@/utils/slugs";

interface FeedbackModalProps {
  show: boolean;
  onClose: () => void;
}

function FeedbackResponseModal({ show, onClose }: FeedbackModalProps) {
  if (!show) return null;

  const { t } = useTranslation();
  
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h3 className="text-lg font-semibold mb-2">{t('feedback_report_submitted', 'Report Submitted')}</h3>
        <p className="text-gray-600 mb-4">{t('feedback_thank_you_will_investigate', 'Thank you for your feedback. We\'ll investigate this issue.')}</p>
        <button 
          onClick={onClose}
          className="bg-[#FF4199] text-white px-4 py-2 rounded hover:bg-[#FF4199]/90"
        >
          {t('general_close', 'Close')}
        </button>
      </div>
    </div>
  );
}

export default function BottomPlayer() {
  const [collapsed, setCollapsed] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();
  
  const { 
    currentStation, 
    isPlaying, 
    isLoading,
    stationMeta,
    nextStation, 
    previousStation, 
    playStation,
    pauseStation,
    stopStation,
    toggleFavorite,
    favorites
  } = useGlobalPlayer();

  if (!currentStation) {
    return null;
  }

  const togglePlayerView = () => {
    setCollapsed(!collapsed);
  };

  const getCountryImage = (countryCode: string) => {
    return `https://flagcdn.com/w80/${countryCode.toLowerCase()}.webp`;
  };


  // Get localized station URL that preserves country code
  const currentStationPlayerUrl = getStationUrl(currentStation);

  return (
    <div>
      {currentStation && (
        <div className="fixed bottom-0 z-50 w-full bg-primary/50 text-white backdrop-blur">
          <div className="container flex items-center py-4 relative">
            {/* Collapse/Expand Button - Top Right */}
            {!collapsed && (
              <button
                onClick={togglePlayerView}
                className="absolute top-4 md:top-2 right-4 bg-[#393939] rounded-full p-1 flex justify-center items-center ml-auto"
              >
                <ChevronDown className="stroke-white size-4 md:size-3" />
              </button>
            )}

            {/* Main Player Layout - EXACT ORIGINAL STRUCTURE */}
            <div className="flex w-full items-center justify-start gap-2 md:justify-between relative">
              
              {/* LEFT SIDE: Station Image and Info */}
              <div className="flex">
                <div className={cn('md:mr-7 flex items-center justify-center', {
                  'md:mr-2': collapsed
                })}>
                  <div className="relative flex items-center justify-center h-full">
                    <StationLogo
                      station={currentStation}
                      size={collapsed ? 'md' : 'player'}
                      alt={`${currentStation.name} logo`}
                      className={cn('rounded-2xl', {
                        'size-12 rounded': collapsed,
                      })}
                    />
                    {currentStation.countrycode && (
                      <img
                        loading="lazy"
                        src={getCountryImage(currentStation.countrycode.toLowerCase())}
                        className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full object-cover border-2 border-[#393939]"
                        alt={`${currentStation.country || currentStation.countrycode} flag`}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                  </div>
                </div>

                {/* Station Info Section - Desktop Only */}
                <div className="hidden flex-col justify-center md:flex">
                  {/* Equalizer Animation - Full View */}
                  {!collapsed && (
                    <div className="size-10 text-left">
                      {isPlaying ? (
                        <img loading="lazy" src="/lotties/equalizer.gif" alt="Equalizer Animation" className="w-full h-full object-contain" />
                      ) : (
                        <img loading="lazy" src="/lotties/equalizer.svg" alt="Equalizer Static" className="w-full h-full object-contain" />
                      )}
                    </div>
                  )}

                  {/* Station Name and Meta - Collapsed/Full View */}
                  <div className="flex items-center gap-2">
                    {/* Equalizer Animation - Collapsed View */}
                    {collapsed && (
                      <div className="size-10 text-left">
                        {isPlaying ? (
                          <img loading="lazy" src="/lotties/equalizer.gif" alt="Equalizer Animation" className="w-full h-full object-contain" />
                        ) : (
                          <img loading="lazy" src="/lotties/equalizer.svg" alt="Equalizer Static" className="w-full h-full object-contain" />
                        )}
                      </div>
                    )}
                    
                    {/* Station Name Link */}
                    <Link to={currentStationPlayerUrl} className="text-[20px] font-medium truncate">
                      {currentStation.name}
                    </Link>
                  </div>

                  {/* Station Meta with YouTube/Spotify Actions - Full View Only */}
                  {!collapsed && stationMeta && stationMeta['title'] && (
                    <div className="flex items-center font-medium">
                      <span className="truncate">
                        {/* Show only the title part (after " - ") or the raw title if available */}
{stationMeta.raw?.title || 
                         (stationMeta.title.includes(' - ') ? 
                           stationMeta.title.split(' - ').slice(1).join(' - ') : 
                           stationMeta.title)}
                      </span>
                      <MetaActionsButtonGroup className="my-0 pl-2" />
                    </div>
                  )}

                  {/* Station Location - Full View Only */}
                  {!collapsed && (
                    <div className="w-full truncate font-medium">
                      {currentStation.country}
                      {currentStation.state && currentStation.state !== '' && (
                        <span className="font-normal text-gray-400">, {currentStation.state}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* MOBILE & CONTROLS SECTION - EXACT ORIGINAL LAYOUT */}
              <div className="truncate flex flex-col gap-2">
                {/* Mobile Station Info - EXACT ORIGINAL STRUCTURE */}
                <div className="pl-3 md:hidden">
                  <div className="text-md font-medium">{currentStation.name}</div>
                  {stationMeta && stationMeta['title'] ? (
                    <div className="text-sm font-medium truncate">
                      {/* Show only the title part (after " - ") or the raw title if available */}
{stationMeta.raw?.title || 
                       (stationMeta.title.includes(' - ') ? 
                         stationMeta.title.split(' - ').slice(1).join(' - ') : 
                         stationMeta.title)}
                    </div>
                  ) : (
                    <div className="text-sm font-medium">
                      {currentStation.country}
                    </div>
                  )}
                </div>
                
                {/* Control Buttons - Full View Only */}
                {!collapsed && <StationControlButtonGroup />}
              </div>

              {/* RIGHT SIDE: Collapse Button - Collapsed View Only */}
              {collapsed && (
                <button
                  onClick={togglePlayerView}
                  className="bg-[#393939] rounded-full p-1 flex justify-center items-center ml-auto"
                >
                  <ChevronUp className="stroke-white size-4 md:size-3" />
                </button>
              )}
            </div>
          </div>

        </div>
      )}

      {/* Feedback Modal */}
      <FeedbackResponseModal 
        show={showFeedbackModal} 
        onClose={() => setShowFeedbackModal(false)} 
      />
    </div>
  );
}
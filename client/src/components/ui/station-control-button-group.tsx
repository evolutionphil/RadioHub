import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import FavoriteButton from "@/components/ui/favorite-button";
import VoteButton from "@/components/ui/vote-button";

// Custom favorite icon from Figma design
import favIcon from "@assets/fav-icon.png";

// Custom Play Icon - 30x30 white triangle pointing right
const PlayIcon = () => (
  <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 5.5V24.5L24 15L8 5.5Z" fill="white"/>
  </svg>
);

// Custom Pause Icon - 30x30 two vertical bars (pause style)
const PauseIcon = () => (
  <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="7" y="5" width="5" height="20" rx="1" fill="white"/>
    <rect x="18" y="5" width="5" height="20" rx="1" fill="white"/>
  </svg>
);

// Custom Previous Icon - 30x30 back arrow with line (Figma: triangle 16.76x18.35, bar 1.875x17.33)
const PreviousIcon = () => (
  <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Vertical line on left - Figma: 1.875x17.33 */}
    <rect x="4" y="6.34" width="1.875" height="17.33" rx="0.94" fill="white"/>
    {/* Triangle pointing left - rounded corners via stroke */}
    <path 
      d="M24 6.5V23.5L9 15L24 6.5Z" 
      fill="white" 
      stroke="white" 
      strokeWidth="2" 
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  </svg>
);

// Custom Next Icon - 30x30 forward arrow with line (Figma: triangle 16.76x18.35, bar 1.875x17.33)
const NextIcon = () => (
  <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Triangle pointing right - rounded corners via stroke */}
    <path 
      d="M6 6.5V23.5L21 15L6 6.5Z" 
      fill="white" 
      stroke="white" 
      strokeWidth="2" 
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    {/* Vertical line on right - Figma: 1.875x17.33 */}
    <rect x="24.125" y="6.34" width="1.875" height="17.33" rx="0.94" fill="white"/>
  </svg>
);

interface StationControlButtonGroupProps {
  className?: string;
  currentPageStation?: any; // Station from the current detail page
  size?: 'default' | 'mobile'; // Figma: default=50px, mobile=33.46px
}

export default function StationControlButtonGroup({ className, currentPageStation, size = 'default' }: StationControlButtonGroupProps) {
  // Size configurations based on Figma
  const buttonSize = size === 'mobile' ? '33.46px' : '50px';
  const buttonRadius = size === 'mobile' ? '16.73px' : '25px';
  const iconScale = size === 'mobile' ? 0.67 : 1;
  const gap = size === 'mobile' ? '6px' : '10px';
  const { 
    currentStation, 
    isPlaying, 
    pauseStation, 
    resumeStation, 
    stopStation, 
    playStation, 
    nextStation, 
    previousStation,
    audioElement
  } = useGlobalPlayer();
  const handlePlayPause = async () => {
    // If there's a current page station and either no current station or different station, play the page station
    if (currentPageStation && (!currentStation || currentStation._id !== currentPageStation._id)) {
      try {
        await playStation(currentPageStation);
      } catch (error) {
        // Failed to play station
      }
    } else if (isPlaying) {
      pauseStation(); // Kill station completely (live radio doesn't pause)
    } else if (currentPageStation) {
      // Start fresh stream of page station
      await playStation(currentPageStation);
    } else if (currentStation) {
      // Resume the currently paused station
      resumeStation();
    } else {
      // No station to resume, this shouldn't happen
      console.log('❌ No station to resume');
    }
  };


  const playPreviousStation = () => {
    previousStation();
  };

  const playNextStation = () => {
    nextStation();
  };

  // Show controls if we have either a current playing station or a current page station
  if (!currentStation && !currentPageStation) return null;
  
  // Use current page station for favorite button if no current station or if they're different
  const displayStation = currentPageStation || currentStation;

  return (
    <div className={`flex items-center w-fit ${className || ''}`} style={{ height: buttonSize, gap }}>
      {/* Previous Station Button */}
      <button 
        className="flex items-center justify-center bg-black hover:opacity-80 transition-opacity"
        style={{ width: buttonSize, height: buttonSize, borderRadius: buttonRadius }}
        onClick={playPreviousStation}
        aria-label="Play previous station"
        title="Previous station"
        data-testid="button-previous-station"
      >
        <div style={{ transform: `scale(${iconScale})` }}><PreviousIcon /></div>
      </button>

      {/* Play/Stop Button */}
      <button
        onClick={handlePlayPause}
        className="flex items-center justify-center bg-black hover:opacity-80 transition-opacity"
        style={{ width: buttonSize, height: buttonSize, borderRadius: buttonRadius }}
        aria-label={isPlaying ? "Stop station" : "Play station"}
        title={isPlaying ? "Stop" : "Play"}
        data-testid="button-play-stop"
      >
        <div style={{ transform: `scale(${iconScale})` }}>{isPlaying ? <PauseIcon /> : <PlayIcon />}</div>
      </button>

      {/* Next Station Button */}
      <button 
        className="flex items-center justify-center bg-black hover:opacity-80 transition-opacity"
        style={{ width: buttonSize, height: buttonSize, borderRadius: buttonRadius }}
        onClick={playNextStation}
        aria-label="Play next station"
        title="Next station"
        data-testid="button-next-station"
      >
        <div style={{ transform: `scale(${iconScale})` }}><NextIcon /></div>
      </button>

      {/* Vote Button */}
      <VoteButton 
        stationId={displayStation._id} 
        className={size === 'mobile' ? 'w-[33.46px] h-[33.46px] rounded-[16.73px]' : 'w-[50px] h-[50px] rounded-[25px]'}
        size={size}
      />

      {/* Favorite Button - Figma: 50x50 container, 34x34 icon (desktop), 33.46x33.46 container, 22px icon (mobile) */}
      <FavoriteButton 
        stationId={displayStation._id} 
        className={size === 'mobile' ? 'w-[33.46px] h-[33.46px] rounded-[16.73px]' : 'w-[50px] h-[50px] rounded-[40.28px]'}
        customIcon={favIcon}
        size={size}
        iconSizeOverride={size === 'mobile' ? '28px' : '40px'}
        borderWidth={size === 'mobile' ? '1.5px' : '2px'}
      />
    </div>
  );
}
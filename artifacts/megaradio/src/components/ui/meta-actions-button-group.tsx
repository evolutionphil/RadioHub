import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useChromecast } from "@/hooks/useChromecast";
import { useToast } from "@/hooks/use-toast";
import { getStreamProxyUrl } from "@/lib/utils";
import youtubeIcon from "@assets/youtube-logo.png";
import spotifyIcon from "@assets/spotify-logo.png";
import deezerIcon from "@assets/deezer.png";
import chromecastIcon from "@assets/chromecast.png";
import shareIcon from "@assets/sharebutton.png";

interface MetaActionsButtonGroupProps {
  className?: string;
  iconSize?: number;
  hideChromecast?: boolean;
}

export default function MetaActionsButtonGroup({ className, iconSize = 26, hideChromecast = false }: MetaActionsButtonGroupProps) {
  const { stationMeta, currentStation } = useGlobalPlayer();
  const { getLocalizedUrl } = useSeoRouting();
  const { toast } = useToast();
  const {
    isAvailable: castAvailable,
    isConnected: castConnected,
    deviceName: castDeviceName,
    requestSession,
    stopCasting,
    loadMedia,
  } = useChromecast();

  if (!stationMeta?.title || !currentStation) return null;

  const searchOnYoutube = () => {
    const query = encodeURIComponent(stationMeta.title || '');
    window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
  };

  const searchOnSpotify = () => {
    const query = encodeURIComponent(stationMeta.title || '');
    window.open(`https://open.spotify.com/search/${query}`, '_blank');
  };

  const searchOnDeezer = () => {
    const query = encodeURIComponent(stationMeta.title || '');
    window.open(`https://www.deezer.com/search/${query}`, '_blank');
  };

  const handleChromecast = async () => {
    if (!castAvailable) {
      toast({
        title: "Chromecast Not Available",
        description: "Please use Chrome browser and ensure Chromecast devices are on your network.",
        variant: "destructive",
      });
      return;
    }

    if (castConnected) {
      stopCasting();
      toast({
        title: "Disconnected",
        description: `Stopped casting to ${castDeviceName}`,
      });
      return;
    }

    try {
      await requestSession();
      
      const streamUrl = currentStation?.urlResolved || currentStation?.url;
      if (streamUrl && currentStation) {
        const proxyUrl = streamUrl.startsWith('http://') 
          ? getStreamProxyUrl(`/api/stream/proxy?url=${encodeURIComponent(streamUrl)}`)
          : streamUrl;
        
        const absoluteUrl = proxyUrl.startsWith('/') 
          ? `${window.location.origin}${proxyUrl}`
          : proxyUrl;

        const imageUrl = currentStation.logoAssets?.webp256
          || currentStation.logoAssets?.webp96
          || currentStation.favicon 
          || `${window.location.origin}/images/logo-icon.webp`;

        await loadMedia(absoluteUrl, {
          title: stationMeta?.title || currentStation.name,
          artist: stationMeta?.artist || currentStation.name,
          stationName: currentStation.name,
          imageUrl: imageUrl.startsWith('/') ? `${window.location.origin}${imageUrl}` : imageUrl,
        });

        toast({
          title: "Casting Started",
          description: `Now casting ${currentStation.name}`,
        });
      }
    } catch (error: any) {
      console.error('Chromecast error:', error);
      if (error?.code === 'cancel' || error?.message?.includes('cancel')) {
        return;
      }
      toast({
        title: "Cast Failed",
        description: "Unable to start casting. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleShare = async () => {
    const shareUrl = window.location.href;
    const shareTitle = `${currentStation.name} - Mega Radio`;
    const shareText = stationMeta?.title 
      ? `Listening to ${stationMeta.title} on ${currentStation.name}`
      : `Listen to ${currentStation.name} on Mega Radio`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Share failed:', error);
        }
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      toast({
        title: "Link Copied",
        description: "Station link copied to clipboard!",
      });
    }
  };

  return (
    <div className={`flex items-center gap-3 ${className || ''}`}>
      {/* 1. YouTube Search Button */}
      <button
        onClick={searchOnYoutube}
        className="hover:opacity-80 transition-opacity"
        title="Find on YouTube"
        data-testid="youtube-search-button"
      >
        <img src={youtubeIcon} alt="YouTube" style={{ width: iconSize, height: iconSize }} />
      </button>

      {/* 2. Spotify Search Button */}
      <button
        onClick={searchOnSpotify}
        className="hover:opacity-80 transition-opacity"
        title="Find on Spotify"
        data-testid="spotify-search-button"
      >
        <img src={spotifyIcon} alt="Spotify" style={{ width: iconSize, height: iconSize }} />
      </button>

      {/* 3. Deezer Search Button */}
      <button
        onClick={searchOnDeezer}
        className="hover:opacity-80 transition-opacity"
        title="Find on Deezer"
        data-testid="deezer-search-button"
      >
        <img src={deezerIcon} alt="Deezer" style={{ width: iconSize, height: iconSize }} />
      </button>

      {/* 4. Chromecast Button */}
      {!hideChromecast && (
        <button
          onClick={handleChromecast}
          className={`hover:opacity-80 transition-opacity relative ${castConnected ? 'ring-2 ring-green-500 rounded-full' : ''}`}
          title={castConnected ? `Casting to ${castDeviceName}` : "Cast to Chromecast"}
          data-testid="chromecast-button"
        >
          <img 
            src={chromecastIcon} 
            alt="Chromecast" 
            style={{ width: iconSize, height: iconSize }} 
            className={castConnected ? 'opacity-100' : castAvailable ? 'opacity-100' : 'opacity-50'}
          />
          {castConnected && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
          )}
        </button>
      )}

      {/* 5. Share Button */}
      <button
        onClick={handleShare}
        className="hover:opacity-80 transition-opacity"
        title="Share"
        data-testid="share-button"
      >
        <img src={shareIcon} alt="Share" style={{ width: iconSize, height: iconSize }} />
      </button>
    </div>
  );
}
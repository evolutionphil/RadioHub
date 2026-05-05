import { memo, useMemo } from "react";
import { FixedSizeList as List } from "react-window";
import StationCard from "@/components/ui/station-card";
import StationCardSkeleton from "@/components/ui/station-card-skeleton";

interface VirtualizedStationListProps {
  stations: any[];
  playlistName?: string;
  showVotes?: boolean;
  isLoading?: boolean;
  height?: number;
  itemHeight?: number;
  onNavigate?: (station: any) => void;
  onPlay?: (station: any) => void;
  onStop?: () => void;
  onToggleFavorite?: (stationId: string) => void;
}

const ITEM_HEIGHT = 120; // Height of each station card
const DEFAULT_HEIGHT = 600; // Default container height

const VirtualizedStationList = memo(function VirtualizedStationList({
  stations,
  playlistName = "random",
  showVotes = false,
  isLoading = false,
  height = DEFAULT_HEIGHT,
  itemHeight = ITEM_HEIGHT,
  onNavigate,
  onPlay,
  onStop,
  onToggleFavorite,
}: VirtualizedStationListProps) {
  
  // Memoize the station data to prevent unnecessary re-renders
  const memoizedStations = useMemo(() => stations, [stations]);

  // Render individual station item in the virtual list
  const StationItem = memo(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const station = memoizedStations[index];
    
    if (!station) {
      return (
        <div style={style} className="px-4 py-2">
          <StationCardSkeleton />
        </div>
      );
    }

    return (
      <div style={style} className="px-4 py-2">
        <StationCard
          station={station}
          playlistName={playlistName}
          showVotes={showVotes}
          onNavigate={onNavigate}
          onPlay={onPlay}
          onStop={onStop}
          onToggleFavorite={onToggleFavorite}
        />
      </div>
    );
  });

  // Show skeleton loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array(Math.min(10, Math.floor(height / itemHeight))).fill(0).map((_, index) => (
          <StationCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  // Show empty state
  if (!memoizedStations || memoizedStations.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-400">No stations found</p>
      </div>
    );
  }

  // For small lists (< 50 items), use regular rendering for better performance
  if (memoizedStations.length < 50) {
    return (
      <div className="space-y-4">
        {memoizedStations.map((station, index) => (
          <StationCard
            key={station._id || index}
            station={station}
            playlistName={playlistName}
            showVotes={showVotes}
            onNavigate={onNavigate}
            onPlay={onPlay}
            onStop={onStop}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    );
  }

  // Use virtual scrolling for large lists
  return (
    <div className="virtualized-list-container">
      <List
        height={height}
        width="100%"
        itemCount={memoizedStations.length}
        itemSize={itemHeight}
        itemData={memoizedStations}
        overscanCount={5} // Render 5 extra items outside viewport
        className="scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800"
      >
        {StationItem}
      </List>
    </div>
  );
});

export default VirtualizedStationList;
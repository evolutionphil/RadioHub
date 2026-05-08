import { memo, useMemo, useCallback } from "react";
import { List, type RowComponentProps } from "react-window";
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

const ITEM_HEIGHT = 120;
const DEFAULT_HEIGHT = 600;

interface RowProps {
  stations: any[];
  playlistName: string;
  showVotes: boolean;
  onNavigate?: (station: any) => void;
  onPlay?: (station: any) => void;
  onStop?: () => void;
  onToggleFavorite?: (stationId: string) => void;
}

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
  const memoizedStations = useMemo(() => stations, [stations]);

  const RowComponent = useCallback(
    ({ index, style, stations: rowStations, playlistName: pName, showVotes: sv, onNavigate: oN, onPlay: oP, onStop: oS, onToggleFavorite: oF }: RowComponentProps<RowProps>) => {
      const station = rowStations[index];
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
            playlistName={pName}
            showVotes={sv}
            onNavigate={oN}
            onPlay={oP}
            onStop={oS}
            onToggleFavorite={oF}
          />
        </div>
      );
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array(Math.min(10, Math.floor(height / itemHeight))).fill(0).map((_, index) => (
          <StationCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (!memoizedStations || memoizedStations.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-400">No stations found</p>
      </div>
    );
  }

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

  return (
    <div className="virtualized-list-container" style={{ height }}>
      <List
        rowCount={memoizedStations.length}
        rowHeight={itemHeight}
        rowComponent={RowComponent}
        rowProps={{
          stations: memoizedStations,
          playlistName,
          showVotes,
          onNavigate,
          onPlay,
          onStop,
          onToggleFavorite,
        }}
        overscanCount={5}
        className="scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800"
      />
    </div>
  );
});

export default VirtualizedStationList;

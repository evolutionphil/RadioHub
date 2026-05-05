import StationCard from "./station-card";

interface StationsGridProps {
  stations: any[];
  playlistName?: string;
  onPlay?: (station: any, playlistName: string) => void;
  onStop?: () => void;
  loading?: boolean;
  showVotes?: boolean;
  columns?: 2 | 3 | 4;
}

export default function StationsGrid({ stations, playlistName = "random", onPlay, onStop, loading, showVotes = false, columns = 3 }: StationsGridProps) {
  const gridCols = columns === 4 
    ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" 
    : columns === 2 
      ? "grid-cols-1 md:grid-cols-2" 
      : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
  
  const skeletonCount = columns === 4 ? 8 : 6;

  if (loading) {
    return (
      <div className={`grid ${gridCols} gap-x-[21px] gap-y-[20px]`}>
        {[...Array(skeletonCount)].map((_, i) => (
          <div key={i} className="h-[130px] w-full bg-[#2F2F2F] rounded-[10px] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className={`grid ${gridCols} gap-x-[21px] gap-y-[20px]`}>
      {stations?.map((station, i) => (
        <StationCard 
          key={station._id || i} 
          station={station} 
          playlistName={playlistName}
          onPlay={onPlay}
          onStop={onStop}
          showVotes={showVotes}
        />
      ))}
    </div>
  );
}
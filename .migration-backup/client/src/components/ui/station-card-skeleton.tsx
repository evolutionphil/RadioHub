import { memo } from "react";

const StationCardSkeleton = memo(() => {
  return (
    <div className="flex items-center rounded-lg bg-[#2F2F2F] p-5 overflow-hidden animate-pulse">
      {/* Image skeleton */}
      <div className="h-[90px] w-[90px] flex-shrink-0 bg-[#404040] rounded"></div>
      
      {/* Content skeleton */}
      <div className="ml-4 flex-1">
        {/* Station name skeleton */}
        <div className="h-5 bg-[#404040] rounded w-3/4 mb-2"></div>
        
        {/* Country/State skeleton */}
        <div className="h-4 bg-[#404040] rounded w-1/2 mb-1"></div>
        
        {/* Votes skeleton */}
        <div className="h-4 bg-[#404040] rounded w-1/3"></div>
      </div>
      
      {/* Actions skeleton */}
      <div className="ml-auto flex items-center gap-2">
        {/* Favorite button skeleton */}
        <div className="h-6 w-6 bg-[#404040] rounded"></div>
        
        {/* Play button skeleton */}
        <div className="h-10 w-10 bg-[#404040] rounded-full"></div>
      </div>
    </div>
  );
});

StationCardSkeleton.displayName = "StationCardSkeleton";

export default StationCardSkeleton;
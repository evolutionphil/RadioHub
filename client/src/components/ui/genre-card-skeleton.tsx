import { memo } from "react";

const GenreCardSkeleton = memo(() => {
  return (
    <div className="genre-card animate-pulse">
      <div className="relative flex h-[150px] items-center justify-center overflow-hidden rounded-lg bg-[#2F2F2F] md:h-[200px]">
        {/* Background skeleton */}
        <div className="absolute inset-0 bg-[#404040]"></div>
        
        {/* Content skeleton */}
        <div className="relative z-10 text-center">
          <div className="h-6 w-24 bg-[#606060] rounded mx-auto mb-2"></div>
          <div className="h-4 w-16 bg-[#606060] rounded mx-auto"></div>
        </div>
      </div>
    </div>
  );
});

GenreCardSkeleton.displayName = "GenreCardSkeleton";

export default GenreCardSkeleton;
interface AnimatedEqualizerProps {
  isPlaying: boolean;
  color?: string;
}

export default function AnimatedEqualizer({ isPlaying, color = '#FF4199' }: AnimatedEqualizerProps) {
  return (
    <div className="relative w-[28px] h-[28px] flex items-center justify-center">
      <style>{`
        @keyframes equalizer-bar-1 {
          0%, 100% { height: 5px; }
          50% { height: 20px; }
        }
        @keyframes equalizer-bar-2 {
          0%, 100% { height: 3px; }
          50% { height: 14px; }
        }
        @keyframes equalizer-bar-3 {
          0%, 100% { height: 6px; }
          50% { height: 17px; }
        }
        .eq-bar {
          border-radius: 10px;
          transition: all 0.1s ease-in-out;
          transform-origin: top;
        }
        .eq-bar-1 {
          animation: ${isPlaying ? 'equalizer-bar-1 0.5s ease-in-out infinite' : 'none'};
        }
        .eq-bar-2 {
          animation: ${isPlaying ? 'equalizer-bar-2 0.6s ease-in-out infinite 0.1s' : 'none'};
        }
        .eq-bar-3 {
          animation: ${isPlaying ? 'equalizer-bar-3 0.7s ease-in-out infinite 0.2s' : 'none'};
        }
      `}</style>
      
      <svg 
        width="28" 
        height="28" 
        viewBox="0 0 28 28" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
        style={{ transform: 'scaleY(-1)' }}
      >
        {/* Bar 1 - Stop: mid-height position */}
        <rect
          x="0"
          y="14"
          width="5"
          height={isPlaying ? "14" : "12"}
          fill={color}
          className="eq-bar eq-bar-1"
          rx="10"
          ry="10"
        />
        
        {/* Bar 2 - Stop: mid-height position */}
        <rect
          x="7"
          y="14"
          width="5"
          height={isPlaying ? "8" : "8"}
          fill={color}
          className="eq-bar eq-bar-2"
          rx="10"
          ry="10"
        />
        
        {/* Bar 3 - Stop: mid-height position */}
        <rect
          x="14"
          y="14"
          width="5"
          height={isPlaying ? "11" : "10"}
          fill={color}
          className="eq-bar eq-bar-3"
          rx="10"
          ry="10"
        />
      </svg>
    </div>
  );
}

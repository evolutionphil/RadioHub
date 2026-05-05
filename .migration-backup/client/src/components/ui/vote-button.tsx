import { useState, memo } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface VoteButtonProps {
  stationId: string;
  className?: string;
  size?: 'default' | 'mobile';
}

const ThumbsUpIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path 
      d="M14 9V4C14 2.89543 13.1046 2 12 2C11.4477 2 11 2.44772 11 3V6.5C11 7.5 10.5 8.5 9.5 9.5L8 11H4C2.89543 11 2 11.8954 2 13V20C2 21.1046 2.89543 22 4 22H17C18.6569 22 20 20.6569 20 19V14C20 11.7909 18.2091 10 16 10H14V9Z"
      stroke="white" 
      strokeWidth="1.5" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    />
    <path 
      d="M8 11V22"
      stroke="white" 
      strokeWidth="1.5" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    />
  </svg>
);

const VoteButton = memo(function VoteButton({ stationId, className = "", size = 'default' }: VoteButtonProps) {
  // Figma: mobile icon 18.74x18.74, default icon 24x24
  const iconSize = size === 'mobile' ? '18.74px' : '24px';
  const [isAnimating, setIsAnimating] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  const voteMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', `/api/stations/${stationId}/vote`);
    },
    onSuccess: () => {
      setHasVoted(true);
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), 600);
    },
  });

  const handleVoteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (voteMutation.isPending) return;
    voteMutation.mutate();
  };

  return (
    <button
      onClick={handleVoteClick}
      disabled={voteMutation.isPending}
      className={`relative flex items-center justify-center rounded-full bg-black hover:opacity-80 transition-all ${className}`}
      title="Vote for this station"
      data-testid="button-vote-station"
      style={{
        transform: isAnimating ? 'scale(1.15)' : 'scale(1)',
        transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
      }}
    >
      {voteMutation.isPending ? (
        <div className="w-5 h-5 border-2 border-gray-400 border-t-white rounded-full animate-spin" />
      ) : (
        <div 
          style={{
            opacity: hasVoted ? 1 : 0.7,
            transform: isAnimating ? 'scale(1.1)' : 'scale(1)',
            transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            width: iconSize,
            height: iconSize
          }}
        >
          <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path 
              d="M14 9V4C14 2.89543 13.1046 2 12 2C11.4477 2 11 2.44772 11 3V6.5C11 7.5 10.5 8.5 9.5 9.5L8 11H4C2.89543 11 2 11.8954 2 13V20C2 21.1046 2.89543 22 4 22H17C18.6569 22 20 20.6569 20 19V14C20 11.7909 18.2091 10 16 10H14V9Z"
              stroke="white" 
              strokeWidth="1.5" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
            <path 
              d="M8 11V22"
              stroke="white" 
              strokeWidth="1.5" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
      
      {isAnimating && (
        <div 
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)',
            animation: 'pulse-fade 0.6s ease-out forwards'
          }}
        />
      )}
      
      <style>{`
        @keyframes pulse-fade {
          0% { transform: scale(0.8); opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
      `}</style>
    </button>
  );
});

export default VoteButton;

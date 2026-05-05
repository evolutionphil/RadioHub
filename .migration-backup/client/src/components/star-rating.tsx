import { useState } from 'react';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
// import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

interface StarRatingProps {
  stationId: string;
  initialRating?: number;
  initialComment?: string;
  averageRating?: number;
  totalRatings?: number;
  ratingBreakdown?: {
    stars1: number;
    stars2: number;
    stars3: number;
    stars4: number;
    stars5: number;
  };
  onRatingSubmit?: (rating: number, comment?: string) => void;
  className?: string;
  showStats?: boolean;
  editable?: boolean;
}

export function StarRating({
  stationId,
  initialRating = 0,
  initialComment = '',
  averageRating = 0,
  totalRatings = 0,
  ratingBreakdown,
  onRatingSubmit,
  className,
  showStats = true,
  editable = true
}: StarRatingProps) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(initialRating);
  const [comment, setComment] = useState(initialComment);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleStarClick = (starValue: number) => {
    if (!editable) return;
    setRating(starValue);
    if (!comment && onRatingSubmit) {
      // Quick rating without comment
      onRatingSubmit(starValue);
    }
  };

  const handleSubmitWithComment = () => {
    if (onRatingSubmit && rating > 0) {
      onRatingSubmit(rating, comment);
      setIsDialogOpen(false);
    }
  };

  const getStarIcon = (starIndex: number) => {
    const currentRating = hoveredStar || rating || averageRating;
    const isFilled = starIndex <= currentRating;
    const isHalfFilled = !Number.isInteger(currentRating) && starIndex === Math.ceil(currentRating);

    return (
      <Star
        key={starIndex}
        className={cn(
          "w-5 h-5 transition-colors cursor-pointer",
          isFilled ? "fill-yellow-400 text-yellow-400" : 
          isHalfFilled ? "fill-yellow-400/50 text-yellow-400" : 
          "text-gray-400 hover:text-yellow-400",
          !editable && "cursor-default"
        )}
        onClick={() => handleStarClick(starIndex)}
        onMouseEnter={() => editable && setHoveredStar(starIndex)}
        onMouseLeave={() => editable && setHoveredStar(0)}
      />
    );
  };

  const renderRatingBreakdown = () => {
    if (!ratingBreakdown || totalRatings === 0) return null;

    return (
      <div className="space-y-2 mt-4">
        <h4 className="text-sm font-medium text-gray-300">{t('rating_breakdown', 'Rating Breakdown')}</h4>
        {[5, 4, 3, 2, 1].map((stars) => {
          const count = ratingBreakdown[`stars${stars}` as keyof typeof ratingBreakdown] || 0;
          const percentage = totalRatings > 0 ? (count / totalRatings) * 100 : 0;

          return (
            <div key={stars} className="flex items-center gap-2 text-sm">
              <span className="text-gray-400 w-3">{stars}</span>
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
              <div className="flex-1 bg-gray-700 rounded-full h-2">
                <div 
                  className="bg-yellow-400 h-2 rounded-full transition-all dynamic-progress-width"
                  style={{ '--progress-width': `${percentage}%` } as React.CSSProperties}
                />
              </div>
              <span className="text-gray-400 w-8 text-right">{count}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Main Rating Display */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map(getStarIcon)}
        </div>
        
        {showStats && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span className="font-medium text-white">
              {averageRating > 0 ? averageRating.toFixed(1) : t('no_rating', 'No ratings yet')}
            </span>
            {totalRatings > 0 && (
              <>
                <span>•</span>
                <span>{totalRatings} {t('ratings', 'ratings')}</span>
              </>
            )}
          </div>
        )}

        {editable && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                className="text-xs"
                data-testid="button-add-review"
              >
                {rating > 0 ? t('update_review', 'Update Review') : t('add_review', 'Add Review')}
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white text-black max-w-md" data-testid="dialog-rating">
              <DialogHeader>
                <DialogTitle>{t('rate_station', 'Rate this Station')}</DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4">
                {/* Star Rating Input */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('your_rating', 'Your Rating')}</label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((starIndex) => (
                      <Star
                        key={starIndex}
                        className={cn(
                          "w-8 h-8 transition-colors cursor-pointer",
                          (hoveredStar || rating) >= starIndex 
                            ? "fill-yellow-400 text-yellow-400" 
                            : "text-gray-300 hover:text-yellow-400"
                        )}
                        onClick={() => setRating(starIndex)}
                        onMouseEnter={() => setHoveredStar(starIndex)}
                        onMouseLeave={() => setHoveredStar(0)}
                      />
                    ))}
                  </div>
                </div>

                {/* Comment Input */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('comment_optional', 'Comment (Optional)')}</label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={t('share_thoughts', 'Share your thoughts about this station...')}
                    className="min-h-[80px] text-black w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    data-testid="textarea-comment"
                  />
                </div>

                {/* Submit Button */}
                <Button 
                  onClick={handleSubmitWithComment}
                  disabled={rating === 0}
                  className="w-full"
                  data-testid="button-submit-rating"
                >
                  {rating > 0 ? t('submit_rating', 'Submit Rating') : t('select_rating', 'Please select a rating')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Rating Breakdown */}
      {showStats && renderRatingBreakdown()}
    </div>
  );
}
import { useState, useEffect, useRef, useId } from 'react';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
// import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { getLocalizedRatingLabels } from '@/utils/localized-rating-labels';

interface StarRatingProps {
  stationId: string;
  ratingScopeKey?: string;
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
  onRatingSubmit?: (rating: number, comment?: string) => boolean | void | Promise<boolean | void>;
  statsStatus?: 'loading' | 'error' | 'ready';
  className?: string;
  showStats?: boolean;
  editable?: boolean;
}

export function StarRating(props: StarRatingProps) {
  // Reset the entire local editor (including pending/hover/dialog state) when
  // station or authenticated identity changes. Old async closures own only
  // their unmounted editor and can never update the next station's state.
  return <ScopedStarRating key={JSON.stringify([props.stationId, props.ratingScopeKey || ''])} {...props} />;
}

function ScopedStarRating({
  initialRating = 0,
  initialComment = '',
  averageRating = 0,
  totalRatings = 0,
  ratingBreakdown,
  onRatingSubmit,
  statsStatus = 'ready',
  className,
  showStats = true,
  editable = true
}: StarRatingProps) {
  const { t, language, localeTranslations } = useTranslation();
  const labels = getLocalizedRatingLabels(language, localeTranslations);
  const [rating, setRating] = useState(initialRating);
  const [comment, setComment] = useState(initialComment);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const mounted = useRef(true);
  const pending = useRef(false);
  const dirty = useRef(false);
  const confirmedRating = useRef(initialRating);
  const commentId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    confirmedRating.current = initialRating;
    // Late initial user-rating data is allowed to seed an untouched editor,
    // but must not erase a draft or an in-flight optimistic selection.
    if (!dirty.current && !pending.current) {
      setRating(initialRating);
      setComment(initialComment);
    }
  }, [initialRating, initialComment]);

  const submit = async (nextRating: number, nextComment?: string, closeDialog = false) => {
    if (!onRatingSubmit || pending.current || !editable) return;
    pending.current = true;
    setIsSubmitting(true);
    setSubmitFailed(false);
    setHoveredStar(0);
    try {
      const accepted = await onRatingSubmit(nextRating, nextComment);
      if (!mounted.current) return;
      if (accepted === false) {
        if (!closeDialog) dirty.current = false;
        setRating(confirmedRating.current);
        setSubmitFailed(true);
      } else {
        confirmedRating.current = nextRating;
        dirty.current = false;
        setRating(nextRating);
        if (closeDialog) setIsDialogOpen(false);
      }
    } catch {
      if (!mounted.current) return;
      if (!closeDialog) dirty.current = false;
      setRating(confirmedRating.current);
      setSubmitFailed(true);
    } finally {
      pending.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  };

  const handleStarClick = (starValue: number) => {
    if (!editable || pending.current) return;
    dirty.current = true;
    setRating(starValue);
    if (onRatingSubmit) {
      // Main-row stars always persist the new score, preserving any existing
      // review text. Only the modal's stars are an unsaved draft.
      void submit(starValue, comment || undefined);
    }
  };

  const handleSubmitWithComment = () => {
    if (onRatingSubmit && rating > 0 && !pending.current) {
      void submit(rating, comment, true);
    }
  };

  const getStarIcon = (starIndex: number) => {
    const currentRating = hoveredStar || rating || averageRating;
    const isFilled = starIndex <= currentRating;
    const isHalfFilled = !Number.isInteger(currentRating) && starIndex === Math.ceil(currentRating);

    const icon = (
      <Star
        aria-hidden="true"
        className={cn(
          "w-5 h-5 transition-colors cursor-pointer",
          isFilled ? "fill-yellow-400 text-yellow-400" : 
          isHalfFilled ? "fill-yellow-400/50 text-yellow-400" : 
          "text-gray-400 hover:text-yellow-400",
          !editable && "cursor-default"
        )}
      />
    );
    return editable ? (
      <button key={starIndex} type="button" aria-label={labels.star(starIndex)} aria-pressed={rating === starIndex}
        disabled={isSubmitting} className="inline-flex p-0 border-0 bg-transparent rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400"
        onClick={() => handleStarClick(starIndex)}
        onMouseEnter={() => !pending.current && setHoveredStar(starIndex)} onMouseLeave={() => setHoveredStar(0)}
        onFocus={() => !pending.current && setHoveredStar(starIndex)} onBlur={() => setHoveredStar(0)}>
        {icon}
      </button>
    ) : <span key={starIndex}>{icon}</span>;
  };

  const renderRatingBreakdown = () => {
    if (statsStatus !== 'ready' || !ratingBreakdown || totalRatings === 0) return null;

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
      <div className="flex flex-wrap items-center gap-3" data-testid="rating-summary-row">
        <div className="flex shrink-0 items-center gap-1">
          {[1, 2, 3, 4, 5].map(getStarIcon)}
        </div>
        
        {showStats && (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm text-gray-400">
            <span className="font-medium text-white">
              {statsStatus === 'loading' ? labels.loading : statsStatus === 'error' ? labels.unavailable :
                averageRating > 0 ? averageRating.toFixed(1) : t('no_rating', 'No ratings yet')}
            </span>
            {statsStatus === 'ready' && totalRatings > 0 && (
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
                className="h-auto min-h-8 max-w-full whitespace-normal break-words text-xs"
                data-testid="button-add-review"
                disabled={isSubmitting}
              >
                {rating > 0 ? t('update_review', 'Update Review') : t('add_review', 'Add Review')}
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white text-black max-w-md" data-testid="dialog-rating" aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle>{t('rate_station', 'Rate this Station')}</DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4">
                {/* Star Rating Input */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('your_rating', 'Your Rating')}</label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((starIndex) => (
                      <button key={starIndex} type="button" aria-label={labels.star(starIndex)} aria-pressed={rating === starIndex}
                        disabled={isSubmitting} className="inline-flex p-0 border-0 bg-transparent rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400"
                        onClick={() => { dirty.current = true; setRating(starIndex); }}
                        onMouseEnter={() => !pending.current && setHoveredStar(starIndex)} onMouseLeave={() => setHoveredStar(0)}
                        onFocus={() => !pending.current && setHoveredStar(starIndex)} onBlur={() => setHoveredStar(0)}>
                      <Star
                        aria-hidden="true"
                        className={cn(
                          "w-8 h-8 transition-colors cursor-pointer",
                          (hoveredStar || rating) >= starIndex 
                            ? "fill-yellow-400 text-yellow-400" 
                            : "text-gray-300 hover:text-yellow-400"
                        )}
                      />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Comment Input */}
                <div className="space-y-2">
                  <label htmlFor={commentId} className="text-sm font-medium">{t('comment_optional', 'Comment (Optional)')}</label>
                  <textarea
                    id={commentId}
                    value={comment}
                    onChange={(e) => { dirty.current = true; setComment(e.target.value); }}
                    disabled={isSubmitting}
                    placeholder={t('share_thoughts', 'Share your thoughts about this station...')}
                    className="min-h-[80px] text-black w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    data-testid="textarea-comment"
                  />
                </div>

                {/* Submit Button */}
                <Button 
                  onClick={handleSubmitWithComment}
                  disabled={rating === 0 || isSubmitting}
                  className="w-full"
                  data-testid="button-submit-rating"
                >
                  {isSubmitting ? labels.saving : rating > 0 ? t('submit_rating', 'Submit Rating') : t('select_rating', 'Please select a rating')}
                </Button>
                {submitFailed && <p role="alert" className="text-sm">{labels.failed}</p>}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isSubmitting && !isDialogOpen && <span className="sr-only" role="status">{labels.saving}</span>}
      {submitFailed && !isDialogOpen && <p role="alert" className="text-sm text-gray-400">{labels.failed}</p>}

      {/* Rating Breakdown */}
      {showStats && renderRatingBreakdown()}
    </div>
  );
}

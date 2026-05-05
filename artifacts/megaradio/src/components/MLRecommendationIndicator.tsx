import React from 'react';
import { Brain, Star, Users, TrendingUp } from 'lucide-react';
import { useMLRecommendations } from '@/hooks/useMLRecommendations';
import { useTranslation } from '@/hooks/useTranslation';

interface RecommendationBadgeProps {
  type: 'content_based' | 'collaborative' | 'hybrid' | 'popularity';
  score: number;
  confidence: number;
  reasons: string[];
  className?: string;
}

export function RecommendationBadge({ type, score, confidence, reasons, className = '' }: RecommendationBadgeProps) {
  const { t } = useTranslation();
  
  const getIcon = () => {
    switch (type) {
      case 'collaborative':
        return <Users className="w-3 h-3" />;
      case 'content_based':
        return <Star className="w-3 h-3" />;
      case 'hybrid':
        return <Brain className="w-3 h-3" />;
      case 'popularity':
        return <TrendingUp className="w-3 h-3" />;
      default:
        return <Brain className="w-3 h-3" />;
    }
  };

  const getColor = () => {
    if (confidence >= 0.8) return 'bg-emerald-500/10 text-emerald-700 border-emerald-200';
    if (confidence >= 0.6) return 'bg-blue-500/10 text-white border-blue-200';
    if (confidence >= 0.4) return 'bg-accent/10 text-white border-accent/20';
    return 'bg-gray-500/10 text-gray-700 border-gray-200';
  };

  const getLabel = () => {
    switch (type) {
      case 'collaborative':
        return t('ml_similar_listeners', 'Similar listeners');
      case 'content_based':
        return t('ml_similar_content', 'Similar content');
      case 'hybrid':
        return t('ml_personalized', 'Personalized');
      case 'popularity':
        return t('ml_popular', 'Popular');
      default:
        return t('ml_recommended', 'Recommended');
    }
  };

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-medium ${getColor()} ${className}`}>
      {getIcon()}
      <span>{getLabel()}</span>
      <span className="opacity-70">
        {Math.round(confidence * 100)}%
      </span>
    </div>
  );
}

interface UserProfileIndicatorProps {
  className?: string;
}

export function UserProfileIndicator({ className = '' }: UserProfileIndicatorProps) {
  const { userProfile, profileStrength, hasPersonalizedData, isLearning } = useMLRecommendations();
  const { t } = useTranslation();

  if (!userProfile) return null;

  return (
    <div className={`bg-gray-800/80 backdrop-blur-sm rounded-lg p-4 border border-gray-700/50 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-white">{t('ml_your_music_profile', 'Your Music Profile')}</h3>
        </div>
        <div className="text-sm text-gray-300">
          {Math.round(profileStrength * 100)}% {t('ml_learned_progress', 'learned')}
        </div>
      </div>

      {/* Profile Strength Bar */}
      <div className="w-full bg-gray-700 rounded-full h-2 mb-4">
        <div 
          className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full transition-all duration-300 dynamic-progress-width"
          style={{ '--progress-width': `${profileStrength * 100}%` } as React.CSSProperties}
        />
      </div>

      {isLearning ? (
        <p className="text-sm text-gray-400 text-center">
          {t('ml_keep_listening_preferences', '🎧 Keep listening to help us learn your preferences!')}
        </p>
      ) : (
        <div className="space-y-3">
          {/* Top Genres */}
          {userProfile.preferredGenres && userProfile.preferredGenres.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-300 mb-1">{t('ml_favorite_genres', 'Favorite Genres:')}</p>
              <div className="flex flex-wrap gap-1">
                {userProfile.preferredGenres.slice(0, 3).map((genre, index) => (
                  <span 
                    key={index}
                    className="px-2 py-1 text-xs bg-blue-900/30 text-blue-300 rounded-full"
                  >
                    {genre.genre} ({Math.round(genre.weight * 100)}%)
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Top Countries */}
          {userProfile.preferredCountries && userProfile.preferredCountries.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-300 mb-1">{t('ml_preferred_regions', 'Preferred Regions:')}</p>
              <div className="flex flex-wrap gap-1">
                {userProfile.preferredCountries.slice(0, 2).map((country, index) => (
                  <span 
                    key={index}
                    className="px-2 py-1 text-xs bg-green-900/30 text-green-300 rounded-full"
                  >
                    {country.country}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="text-center p-2 bg-gray-700/50 rounded">
              <div className="font-semibold text-white">{userProfile.uniqueStationsCount}</div>
              <div className="text-gray-200 text-xs">{t('ml_stations_explored', 'Stations Explored')}</div>
            </div>
            <div className="text-center p-2 bg-gray-700/50 rounded">
              <div className="font-semibold text-white">
                {userProfile.averageListenDuration >= 60 
                  ? `${Math.round(userProfile.averageListenDuration / 60)}m ${userProfile.averageListenDuration % 60}s`
                  : `${userProfile.averageListenDuration}s`
                }
              </div>
              <div className="text-gray-200 text-xs">{t('ml_avg_listen_time', 'Avg. Listen Time')}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface RecommendationReasonProps {
  reasons: string[];
  type: string;
  confidence: number;
  className?: string;
}

export function RecommendationReason({ reasons, type, confidence, className = '' }: RecommendationReasonProps) {
  const { t } = useTranslation();
  
  if (!reasons || reasons.length === 0) return null;

  const translateReason = (reason: string): string => {
    if (!reason.includes('|')) {
      return t(reason, reason);
    }
    
    const [key, ...params] = reason.split('|');
    const template = t(key, reason);
    
    if (params.length === 0) return template;
    
    const replacements: Record<string, string> = {
      '{count}': params[0] || '',
      '{duration}': params[0] || '',
      '{country}': params[0] || '',
      '{genres}': params[0] || '',
      '{language}': params[0] || '',
    };
    
    let result = template;
    Object.entries(replacements).forEach(([placeholder, value]) => {
      result = result.replace(placeholder, value);
    });
    
    return result;
  };

  return (
    <div className={`text-xs text-gray-200 ${className}`}>
      <div className="flex items-center gap-1 mb-1">
        <Brain className="w-3 h-3 text-blue-400" />
        <span className="font-medium text-gray-100">{t('ml_why_recommendation', 'Why this recommendation:')}</span>
      </div>
      <ul className="list-disc list-inside space-y-0.5 ml-4">
        {reasons.slice(0, 2).map((reason, index) => (
          <li key={index} className="text-gray-200">{translateReason(reason)}</li>
        ))}
      </ul>
      {confidence > 0.7 && (
        <div className="mt-1 text-green-600 dark:text-green-400 font-medium">
          {t('ml_high_confidence_match', 'High confidence match')}
        </div>
      )}
    </div>
  );
}
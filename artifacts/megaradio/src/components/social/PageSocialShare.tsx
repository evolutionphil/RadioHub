import { useState, lazy, Suspense } from 'react';
import { Share2, Copy } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";

// Lazy load social icons - only imported when component renders
const SiFacebook = lazy(() => import('react-icons/si').then(m => ({ default: (props: any) => <m.SiFacebook {...props} /> })));
const SiX = lazy(() => import('react-icons/si').then(m => ({ default: (props: any) => <m.SiX {...props} /> })));
const SiWhatsapp = lazy(() => import('react-icons/si').then(m => ({ default: (props: any) => <m.SiWhatsapp {...props} /> })));
const SiLinkedin = lazy(() => import('react-icons/fa').then(m => ({ default: (props: any) => <m.FaLinkedin {...props} /> })));
const SiPinterest = lazy(() => import('react-icons/si').then(m => ({ default: (props: any) => <m.SiPinterest {...props} /> })));
const SiTelegram = lazy(() => import('react-icons/si').then(m => ({ default: (props: any) => <m.SiTelegram {...props} /> })));
const SiReddit = lazy(() => import('react-icons/si').then(m => ({ default: (props: any) => <m.SiReddit {...props} /> })));

interface PageSocialShareProps {
  title?: string;
  description?: string;
  url?: string;
  hashtags?: string[];
  className?: string;
  showTitle?: boolean;
}

interface SocialPlatform {
  name: string;
  icon: React.ReactNode;
  color: string;
  shareUrl: (url: string, text: string) => string;
}

// Icon wrapper component for lazy-loaded icons
const LazyIconWrapper = ({ IconComponent, className }: { IconComponent: any; className: string }) => (
  <Suspense fallback={<div className={className} />}>
    <IconComponent className={className} />
  </Suspense>
);

const getSocialPlatforms = (): Record<string, SocialPlatform> => ({
  facebook: {
    name: 'Facebook',
    icon: <LazyIconWrapper IconComponent={SiFacebook} className="w-5 h-5" />,
    color: 'bg-[#1877F2] hover:bg-[#166fe5] text-white',
    shareUrl: (url, text) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`,
  },
  twitter: {
    name: 'Twitter',
    icon: <LazyIconWrapper IconComponent={SiX} className="w-5 h-5" />,
    color: 'bg-black hover:bg-gray-800 text-white',
    shareUrl: (url, text) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}&hashtags=radio,music,streaming`,
  },
  linkedin: {
    name: 'LinkedIn',
    icon: <LazyIconWrapper IconComponent={SiLinkedin} className="w-5 h-5" />,
    color: 'bg-[#0A66C2] hover:bg-[#004182] text-white',
    shareUrl: (url, text) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}&summary=${encodeURIComponent(text)}`,
  },
  whatsapp: {
    name: 'WhatsApp',
    icon: <LazyIconWrapper IconComponent={SiWhatsapp} className="w-5 h-5" />,
    color: 'bg-[#25D366] hover:bg-[#1da851] text-white',
    shareUrl: (url, text) => `https://api.whatsapp.com/send?text=${encodeURIComponent(`${text} ${url}`)}`,
  },
  telegram: {
    name: 'Telegram',
    icon: <LazyIconWrapper IconComponent={SiTelegram} className="w-5 h-5" />,
    color: 'bg-[#0088CC] hover:bg-[#006699] text-white',
    shareUrl: (url, text) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  reddit: {
    name: 'Reddit',
    icon: <LazyIconWrapper IconComponent={SiReddit} className="w-5 h-5" />,
    color: 'bg-[#FF4500] hover:bg-[#E63E00] text-white',
    shareUrl: (url, text) => `https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`,
  },
  pinterest: {
    name: 'Pinterest',
    icon: <LazyIconWrapper IconComponent={SiPinterest} className="w-5 h-5" />,
    color: 'bg-[#E60023] hover:bg-[#AD081B] text-white',
    shareUrl: (url, text) => `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(text)}`,
  },
});

export function PageSocialShare({ 
  title = 'Mega Radio - Listen to Free Live Radio & Music from 120 Countries',
  description = 'Discover 60,000+ radio stations from around the world. Live music, news, sports, and talk shows streaming for free!',
  url = typeof window !== 'undefined' ? window.location.href : '',
  hashtags = ['radio', 'music', 'streaming', 'live', 'free'],
  className = '',
  showTitle = true
}: PageSocialShareProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const socialPlatforms = getSocialPlatforms();

  const handleCopyLink = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: title,
          text: description,
          url: url,
        });
      } catch (err) {
        console.log('Share failed or was cancelled');
      }
    }
  };

  return (
    <div className="w-full">
      {showTitle && (
        <h3 className="text-base font-semibold mb-4">
          {t('share_this_page') || 'Share this page'}
        </h3>
      )}

      {/* Social Share Buttons */}
      <div className={cn("flex flex-wrap gap-3", className)}>
        {Object.entries(socialPlatforms).map(([key, platform]) => (
          <a
            key={key}
            href={platform.shareUrl(url, title)}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center justify-center w-10 h-10 rounded-full font-medium transition-colors ${platform.color}`}
            data-testid={`share-${key}`}
            aria-label={`Share on ${platform.name}`}
            title={`Share on ${platform.name}`}
          >
            {platform.icon}
          </a>
        ))}

        {/* Copy Link Button */}
        <button
          onClick={handleCopyLink}
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-full font-medium transition-colors border-2",
            copied 
              ? "bg-green-100 border-green-300 text-green-700 dark:bg-green-900 dark:border-green-600 dark:text-green-300"
              : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          )}
          title={t('copy_link') || 'Copy link'}
          data-testid="copy-link"
        >
          <Copy className="w-5 h-5" />
        </button>

        {/* Native Share (for mobile devices) */}
        {typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'share' in navigator && (
          <button
            onClick={handleNativeShare}
            className="flex items-center justify-center w-10 h-10 rounded-full font-medium transition-colors bg-blue-600 hover:bg-blue-700 text-white"
            title={t('share') || 'Share'}
            data-testid="native-share"
          >
            <Share2 className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}

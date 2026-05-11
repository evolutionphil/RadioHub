import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Link } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";

interface AskToSignupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AskToSignupModal({ isOpen, onClose }: AskToSignupModalProps) {
  const { t } = useTranslation();
  const { getLocalizedUrl } = useSeoRouting();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="p-0 border-0 bg-transparent shadow-none max-w-[327px] md:max-w-[400px] rounded-[20px] overflow-hidden"
        style={{
          background: 'transparent'
        }}
        data-testid="ask-to-signup-modal"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <VisuallyHidden>
          <DialogTitle>{t('signup_modal_title', 'You like MegaRadio?')}</DialogTitle>
          <DialogDescription>
            {t('signup_modal_description', 'Sign up for MegaRadio for unlimited access and amazing features. Registration is completely free!')}
          </DialogDescription>
        </VisuallyHidden>

        <style>{`
          [data-testid="ask-to-signup-modal"] button[type="button"]:last-child {
            display: none !important;
          }
          .signup-modal-overlay {
            background: rgba(0, 0, 0, 0.6) !important;
            backdrop-filter: blur(8px) !important;
            -webkit-backdrop-filter: blur(8px) !important;
          }
        `}</style>

        <div className="bg-white rounded-[20px] overflow-hidden shadow-2xl">
          <div className="w-full">
            {/* /images/ask-signup-modal-image.png was lost during the
                monorepo migration; hide on 404 so the modal still looks
                clean instead of showing a broken-image placeholder. */}
            <img 
              src="/images/ask-signup-modal-image.png"
              alt="Signup invitation illustration - person with headphones enjoying music" 
              className="w-full h-auto object-cover"
              loading="eager"
              decoding="async"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              width={600}
              height={400}
            />
          </div>
          
          <div 
            className="flex flex-col items-center px-6 py-6 md:px-8 md:py-8"
            style={{
              background: 'linear-gradient(225deg, #BD52FF 0%, #7B68EE 100%)'
            }}
          >
            <h3 
              className="text-white font-bold text-center"
              style={{
                fontFamily: 'Ubuntu, sans-serif',
                fontSize: '24px',
                lineHeight: '120%'
              }}
            >
              {t('signup_modal_title', 'You like MegaRadio?')}
            </h3>
            
            <p 
              className="text-white text-center mt-3 mb-6 opacity-90"
              style={{
                fontFamily: 'Ubuntu, sans-serif',
                fontSize: '14px',
                lineHeight: '150%',
                maxWidth: '280px'
              }}
            >
              {t('signup_modal_description', 'Sign up for MegaRadio for unlimited access and amazing features. Registration is completely free!')}
            </p>
            
            <Link 
              href={getLocalizedUrl('/signup')} 
              className="bg-white hover:bg-gray-100 transition-colors flex items-center justify-center"
              style={{
                fontFamily: 'Ubuntu, sans-serif',
                fontWeight: 600,
                fontSize: '16px',
                color: '#BD52FF',
                borderRadius: '25px',
                padding: '12px 48px',
                minWidth: '160px'
              }}
              onClick={onClose}
              data-testid="signup-modal-signup-button"
            >
              {t('signup', 'Sign Up')}
            </Link>
            
            <button 
              className="text-white hover:opacity-80 transition-opacity mt-4"
              style={{
                fontFamily: 'Ubuntu, sans-serif',
                fontSize: '14px',
                fontWeight: 500
              }}
              onClick={onClose}
              data-testid="signup-modal-later-button"
            >
              {t('remind_me_later', 'Remind me later')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

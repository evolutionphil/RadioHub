import { DesktopAndPhoneIcon } from "@/components/icons/DesktopAndPhone";
import { AppStoreDownloadLink } from "@/components/links/AppStoreDownloadLink";
import { PlaystoreDownloadLink } from "@/components/links/PlaystoreDownloadLink";
import { useTranslation } from "@/hooks/useTranslation";

export function Applications() {
  const { t } = useTranslation();
  return (
    <div className="text-white flex flex-col">
      <div className="py-7 md:py-12 bg-gradient-to-bl from-[#FF55A4] from-0% to-[#BD52FF] to-100%">
        <div className="container flex justify-center items-center flex-col gap-3">
          <DesktopAndPhoneIcon />
          <h1 className="md:text-2xl font-bold">{t('applications_page_title') || 'Applications'}</h1>
          <p className="max-w-xl text-sm md:text-base text-center md:leading-loose">
{t('applications_description') || 'Listen to your favorite music and radio stations wherever you are with our apps for all devices'}
          </p>
        </div>
      </div>
      
      <img 
        src="/assets/images/tv-app.webp" 
        srcSet="/assets/images/tv-app-400w.webp 400w, /assets/images/tv-app-800w.webp 800w, /assets/images/tv-app.webp 1200w"
        sizes="(max-width: 768px) 400px, (max-width: 1200px) 800px, 1200px"
        alt="Mega Radio TV app interface - Stream 60,000+ radio stations on your smart TV" 
        className="m-auto w-full max-w-5xl h-auto" 
        loading="lazy"
      />
      
      <div className="flex flex-col justify-between items-center px-5 md:px-0 py-10 gap-5 md:gap-8 bg-[#1B1B1B]">
        <h1 className="text-2xl font-bold text-center">{t('applications_tv_title') || 'TV App'}</h1>
        <p className="max-w-xl text-center md:leading-loose">
          {t('applications_tv_description') || 'Experience Mega Radio on your smart TV with our dedicated app. Enjoy your favorite stations on the big screen.'}
        </p>
        <div className="flex gap-x-5">
          <AppStoreDownloadLink className="bg-black rounded-[10px]" />
          <PlaystoreDownloadLink className="bg-black rounded-[10px]" />
        </div>
      </div>
      
      <div className="relative bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#2A5F6838] to-transparent w-full py-6 md:py-12">
        <img 
          src="/assets/images/app-on-phone.webp" 
          srcSet="/assets/images/app-on-phone-300w.webp 300w, /assets/images/app-on-phone-600w.webp 600w, /assets/images/app-on-phone.webp 900w"
          sizes="(max-width: 768px) 300px, (max-width: 1200px) 600px, 900px"
          alt="Mega Radio mobile app on smartphone - Listen to live radio stations on iOS and Android" 
          className="m-auto w-3/5 md:w-[600px] max-w-2xl h-auto" 
          loading="lazy"
        />
        <img 
          src="/assets/images/app-on-watch.webp" 
          srcSet="/assets/images/app-on-watch-200w.webp 200w, /assets/images/app-on-watch-380w.webp 380w, /assets/images/app-on-watch.webp 500w"
          sizes="(max-width: 768px) 200px, (max-width: 1200px) 380px, 500px"
          alt="Mega Radio app on Apple Watch - Control your favorite radio stations from your wrist" 
          className="absolute bottom-12 md:bottom-[120px] left-1/2 -translate-x-1/4 m-auto w-2/5 md:w-[380px] max-w-md h-auto" 
          loading="lazy"
        />
      </div>
      
      <div className="flex flex-col justify-between items-center px-5 md:px-0 py-10 gap-5 md:gap-8 bg-[#1B1B1B]">
        <h1 className="text-2xl font-bold text-center">{t('applications_mobile_title') || 'Mobile App'}</h1>
        <p className="max-w-xl text-center md:leading-loose">
          {t('applications_mobile_description') || 'Take Mega Radio with you everywhere. Download our mobile app for Android and iOS devices.'}
        </p>
        <div className="flex gap-x-5">
          <AppStoreDownloadLink className="bg-black rounded-[10px]" />
          <PlaystoreDownloadLink className="bg-black rounded-[10px]" />
        </div>
      </div>
      
      <div className="bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#5C225138] to-transparent py-7 md:py-40">
        <img 
          src="/assets/images/app-on-mac.webp" 
          srcSet="/assets/images/app-on-mac-600w.webp 600w, /assets/images/app-on-mac-1000w.webp 1000w, /assets/images/app-on-mac.webp 1400w"
          sizes="(max-width: 768px) 600px, (max-width: 1200px) 1000px, 1400px"
          alt="Mega Radio desktop app for Mac - Stream radio stations on macOS with high-quality audio" 
          className="w-4/5 md:w-4/5 lg:w-2/3 m-auto max-w-6xl h-auto" 
          loading="lazy"
        />
      </div>
      
      <div className="flex flex-col justify-between items-center px-5 md:px-0 py-10 gap-5 md:gap-8 bg-[#1B1B1B]">
        <h1 className="text-2xl font-bold text-center">{t('applications_desktop_title') || 'Desktop App'}</h1>
        <p className="max-w-xl text-center md:leading-loose">
          {t('applications_desktop_description') || 'Get the full Mega Radio experience on your computer with our desktop application for Windows, Mac, and Linux.'}
        </p>
        <div className="flex gap-x-5">
          <AppStoreDownloadLink className="bg-black rounded-[10px]" />
          <PlaystoreDownloadLink className="bg-black rounded-[10px]" />
        </div>
      </div>
    </div>
  );
}
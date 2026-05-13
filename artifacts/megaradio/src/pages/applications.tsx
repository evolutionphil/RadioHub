import { DesktopAndPhoneIcon } from "@/components/icons/DesktopAndPhone";
import { AppStoreDownloadLink } from "@/components/links/AppStoreDownloadLink";
import { PlaystoreDownloadLink } from "@/components/links/PlaystoreDownloadLink";
import { useTranslation } from "@/hooks/useTranslation";
import { SeoHead } from "@/components/SeoHead";

export function Applications() {
  const { t } = useTranslation();
  return (
    <div className="text-white flex flex-col">
      <SeoHead pageType="applications" />
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
        src="/images/tv-app.webp" 
        alt="Mega Radio TV app interface - Stream 60,000+ radio stations on your smart TV" 
        className="m-auto w-full max-w-5xl h-auto" 
        width={1200}
        height={750}
        loading="lazy"
        decoding="async"
      />
      
      <div className="flex flex-col justify-between items-center px-5 md:px-0 py-10 gap-5 md:gap-8 bg-[#1B1B1B]">
        <h2 className="text-2xl font-bold text-center">{t('applications_tv_title') || 'TV App'}</h2>
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
          src="/images/app-on-phone.webp" 
          alt="Mega Radio mobile app on smartphone - Listen to live radio stations on iOS and Android" 
          className="m-auto w-3/5 md:w-[600px] max-w-2xl h-auto" 
          width={900}
          height={900}
          loading="lazy"
          decoding="async"
        />
        <img 
          src="/images/app-on-watch.webp" 
          alt="Mega Radio app on Apple Watch - Control your favorite radio stations from your wrist" 
          className="absolute bottom-12 md:bottom-[120px] left-1/2 -translate-x-1/4 m-auto w-2/5 md:w-[380px] max-w-md h-auto" 
          width={500}
          height={500}
          loading="lazy"
          decoding="async"
        />
      </div>
      
      <div className="flex flex-col justify-between items-center px-5 md:px-0 py-10 gap-5 md:gap-8 bg-[#1B1B1B]">
        <h2 className="text-2xl font-bold text-center">{t('applications_mobile_title') || 'Mobile App'}</h2>
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
          src="/images/app-on-mac.webp" 
          alt="Mega Radio desktop app for Mac - Stream radio stations on macOS with high-quality audio" 
          className="w-4/5 md:w-4/5 lg:w-2/3 m-auto max-w-6xl h-auto" 
          width={1400}
          height={875}
          loading="lazy"
          decoding="async"
        />
      </div>
      
      <div className="flex flex-col justify-between items-center px-5 md:px-0 py-10 gap-5 md:gap-8 bg-[#1B1B1B]">
        <h2 className="text-2xl font-bold text-center">{t('applications_desktop_title') || 'Desktop App'}</h2>
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
import { useState } from "react";
import { Link } from "wouter";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useTranslation } from "@/hooks/useTranslation";

export default function Login() {
  const { getLocalizedUrl } = useSeoRouting();
  const { t } = useTranslation();
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate required fields
    if (!loginForm.email.trim()) {
      setError(t('auth_email_required'));
      return;
    }
    if (!loginForm.password) {
      setError(t('auth_password_required'));
      return;
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        const urlParams = new URLSearchParams(window.location.search);
        const returnTo = urlParams.get('returnTo');
        if (returnTo && returnTo.startsWith('/')) {
          window.location.href = returnTo;
        } else {
          const currentPath = window.location.pathname;
          const segments = currentPath.split('/').filter(Boolean);
          const countryCode = segments.length > 0 && segments[0].length === 2 ? segments[0] : '';
          window.location.href = countryCode ? `/${countryCode}` : '/';
        }
      } else {
        const errorData = await response.json();
        setError(errorData.error || t('auth_invalid_credentials'));
      }
    } catch (err) {
      setError(t('auth_network_error'));
    }
  };

  return (
    <div className="bg-[#0E0E0E]">
      {/* Header - Figma: max-width 1512px, height 100px, bg #151515 - Hidden on mobile */}
      <div className="bg-[#151515] hidden md:block">
        <div className="w-full max-w-[1512px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 xl:px-20 2xl:px-[153px] h-[100px] flex items-center">
          <h1 className="font-sans font-bold text-white text-[36px] leading-[100%]">{t('auth_login_header')}</h1>
        </div>
      </div>

      <div className="w-full max-w-[1512px] mx-auto pb-6 text-white px-4 sm:px-6 md:px-8 lg:px-12 xl:px-20 2xl:px-[153px]">
        <div className="mx-auto max-w-md">
          
          {/* Continue with text - Figma: Ubuntu 700 bold, 20px, centered - Mobile: closer to header */}
          <div className="pt-4 md:pt-8 pb-6 text-center">
            <p className="font-sans font-bold text-white text-[20px] leading-[100%]">{t('auth_continue_with')}</p>
          </div>

          {/* Social login buttons - Figma: 60x60 outer, 38x38 icon, border 2px #545454, border-radius 30px */}
          <div className="flex justify-center gap-4 pb-5">
            {/* Facebook Button */}
            <button
              type="button"
              onClick={() => window.location.href = '/api/auth/facebook'}
              className="w-[60px] h-[60px] min-w-[60px] min-h-[60px] aspect-square flex-shrink-0 rounded-[30px] bg-transparent flex items-center justify-center hover:opacity-80 transition-opacity"
              style={{ borderWidth: '2px', borderStyle: 'solid', borderColor: '#545454' }}
              title="Facebook ile devam et"
            >
              <img src="/images/auth/facebook.png" alt="Facebook" className="w-[38px] h-[38px] object-contain" />
            </button>

            {/* Google Button */}
            <button
              type="button"
              onClick={() => {
                const urlParams = new URLSearchParams(window.location.search);
                const returnTo = urlParams.get('returnTo');
                const googleUrl = returnTo ? `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}` : '/api/auth/google';
                window.location.href = googleUrl;
              }}
              className="w-[60px] h-[60px] min-w-[60px] min-h-[60px] aspect-square flex-shrink-0 rounded-[30px] bg-transparent flex items-center justify-center hover:opacity-80 transition-opacity"
              style={{ borderWidth: '2px', borderStyle: 'solid', borderColor: '#545454' }}
              title="Google ile devam et"
            >
              <img src="/images/auth/google.png" alt="Google" className="w-[38px] h-[38px] object-contain" />
            </button>

            {/* Apple Button */}
            <button
              type="button"
              onClick={() => window.location.href = '/api/auth/apple'}
              className="w-[60px] h-[60px] min-w-[60px] min-h-[60px] aspect-square flex-shrink-0 rounded-[30px] bg-transparent flex items-center justify-center hover:opacity-80 transition-opacity"
              style={{ borderWidth: '2px', borderStyle: 'solid', borderColor: '#545454' }}
              title="Apple ile devam et"
            >
              <img src="/images/auth/Apple.png" alt="Apple" className="w-[38px] h-[38px] object-contain" />
            </button>
          </div>

          {/* Profile text - Figma: Ubuntu 700 bold, 16px mobile / 32px desktop, centered, #FFFFFF */}
          <div className="pt-4 pb-5 text-center">
            <h2 className="font-sans font-bold text-[16px] md:text-[32px] leading-[100%] text-white">
              <span className="block">{t('auth_manage_profile') || 'Manage Your Profile'}</span>
              <span className="block mt-1 md:mt-2">{t('auth_enjoy_listening') || 'Enjoy When You Listen'}</span>
            </h2>
          </div>

          {/* Login Form - Figma: inputs 310x60, border-radius 5px, icons 24x24 */}
          <div className="mx-auto w-full max-w-[310px]">
            <form onSubmit={submitForm} className="space-y-4">
              {error && (
                <p className="text-center font-bold text-red-400 text-sm">{error}</p>
              )}

              {/* Email Input - Figma: 310x60, border-radius 5px, icon 24x24 left:12px top:18px */}
              <div className="relative">
                <div className="absolute left-[12px] top-1/2 -translate-y-1/2 w-[24px] h-[24px] flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="2" y="4" width="20" height="16" rx="2" stroke="#808080" strokeWidth="2"/>
                    <path d="M2 6L12 13L22 6" stroke="#808080" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <input
                  type="email"
                  placeholder={t('auth_email_placeholder') || 'E-Mail'}
                  value={loginForm.email}
                  onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                  className="w-full h-[60px] bg-[#2F2F2F] border-0 rounded-[5px] pl-[48px] pr-4 font-sans font-normal text-[20px] leading-[100%] text-white placeholder-[#808080] focus:outline-none focus:ring-0"
                />
              </div>

              {/* Password Input - Figma: 310x60, border-radius 5px, icon 24x24 left:12px top:18px */}
              <div className="relative">
                <div className="absolute left-[12px] top-1/2 -translate-y-1/2 w-[24px] h-[24px] flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="4" y="10" width="16" height="10" rx="2" stroke="#808080" strokeWidth="2"/>
                    <circle cx="12" cy="15" r="2" fill="#808080"/>
                    <path d="M8 10V7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7V10" stroke="#808080" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </div>
                <input
                  type="password"
                  placeholder={t('auth_password_placeholder') || 'Password'}
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  className="w-full h-[60px] bg-[#2F2F2F] border-0 rounded-[5px] pl-[48px] pr-4 font-sans font-normal text-[20px] leading-[100%] text-white placeholder-[#808080] focus:outline-none focus:ring-0"
                />
              </div>

              {/* Login Button - Figma: 310x60, border-radius 5px, Ubuntu 400 20px */}
              <button
                className="w-full h-[60px] bg-[#FF4199] text-white rounded-[5px] font-sans font-normal text-[20px] leading-[100%] hover:bg-[#e6388a] transition-colors focus:outline-none focus:ring-0"
                type="submit"
              >
                {t('auth_login_button') || 'Login'}
              </button>

              {/* Forgot Password - Figma: Ubuntu 400 20px, underline, #FFFFFF4D (30% white) */}
              <div className="text-center pt-4">
                <Link
                  href={getLocalizedUrl("/forgot-password")}
                  className="font-sans font-normal text-[20px] leading-[100%] underline hover:opacity-80 transition-opacity"
                  style={{ color: 'rgba(255, 255, 255, 0.3)' }}
                >
                  {t('auth_forgot_password') || 'Forgot Your Password?'}
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
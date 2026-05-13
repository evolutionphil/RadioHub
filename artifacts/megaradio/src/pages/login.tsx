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
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#3B5998]">
                <svg className="h-6 w-6 text-white" viewBox="0 0 512 512" aria-hidden="true">
                  <path fill="currentColor" d="M288 192v-38.1c0-17.2 3.8-25.9 30.5-25.9H352V64h-55.9c-68.5 0-91.1 31.4-91.1 85.3V192h-45v64h45v192h83V256h56.4l7.6-64h-64z" />
                </svg>
              </span>
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
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white text-black">
                <svg className="h-5 w-5" viewBox="0 0 512 512" aria-hidden="true">
                  <path fill="currentColor" d="m473.16 221.48l-2.26-9.59H262.46v88.22H387c-12.93 61.4-72.93 93.72-121.94 93.72c-35.66 0-73.25-15-98.13-39.11a140.08 140.08 0 0 1-41.8-98.88c0-37.16 16.7-74.33 41-98.78s61-38.13 97.49-38.13c41.79 0 71.74 22.19 82.94 32.31l62.69-62.36C390.86 72.72 340.34 32 261.6 32c-60.75 0-119 23.27-161.58 65.71C58 139.5 36.25 199.93 36.25 256s20.58 113.48 61.3 155.6c43.51 44.92 105.13 68.4 168.58 68.4c57.73 0 112.45-22.62 151.45-63.66c38.34-40.4 58.17-96.3 58.17-154.9c0-24.67-2.48-39.32-2.59-39.96Z" />
                </svg>
              </span>
            </button>

            {/* Apple Button */}
            <button
              type="button"
              onClick={() => window.location.href = '/api/auth/apple'}
              className="w-[60px] h-[60px] min-w-[60px] min-h-[60px] aspect-square flex-shrink-0 rounded-[30px] bg-transparent flex items-center justify-center hover:opacity-80 transition-opacity"
              style={{ borderWidth: '2px', borderStyle: 'solid', borderColor: '#545454' }}
              title="Apple ile devam et"
            >
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white text-black">
                <svg className="h-5 w-5" viewBox="0 0 512 512" aria-hidden="true">
                  <path fill="currentColor" d="M349.13 136.86c-40.32 0-57.36 19.24-85.44 19.24c-28.79 0-50.75-19.1-85.69-19.1c-34.2 0-70.67 20.88-93.83 56.45c-32.52 50.16-27 144.63 25.67 225.11c18.84 28.81 44 61.12 77 61.47h.6c28.68 0 37.2-18.78 76.67-19h.6c38.88 0 46.68 18.89 75.24 18.89h.6c33-.35 59.51-36.15 78.35-64.85c13.56-20.64 18.6-31 29-54.35c-76.19-28.92-88.43-136.93-13.08-178.34c-23-28.8-55.32-45.48-85.79-45.48Z" />
                  <path fill="currentColor" d="M340.25 32c-24 1.63-52 16.91-68.4 36.86c-14.88 18.08-27.12 44.9-22.32 70.91h1.92c25.56 0 51.72-15.39 67-35.11c14.72-18.77 25.88-45.37 21.8-72.66Z" />
                </svg>
              </span>
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
import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useAuth } from "@/hooks/useAuth";
import { Monitor, Tv, CheckCircle, AlertCircle, Loader2, Smartphone, Wifi, LogIn } from "lucide-react";
import { useLocation } from "wouter";

export default function TvLogin() {
  const { t } = useTranslation();
  const { getLocalizedUrl, currentLanguage } = useSeoRouting();
  const [location] = useLocation();
  const [code, setCode] = useState("");
  const [isActivating, setIsActivating] = useState(false);
  const [activationResult, setActivationResult] = useState<{ success: boolean; message: string; deviceName?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const isLoggedIn = isAuthenticated && !!user;

  console.log('[TV-LOGIN] 🖥️ render — authLoading:', authLoading, 'isAuthenticated:', isAuthenticated, 'user:', user?.email || '(null)', 'isLoggedIn:', isLoggedIn);

  const handleActivate = async () => {
    if (code.length !== 6 || isActivating) return;
    setIsActivating(true);
    setError(null);
    setActivationResult(null);

    try {
      const response = await fetch("/api/auth/tv/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setActivationResult({
          success: true,
          message: data.message,
          deviceName: data.deviceName,
        });
        setCode("");
      } else {
        setError(data.error || data.message || t("tv_activation_failed"));
      }
    } catch (err) {
      setError(t("tv_network_error"));
    } finally {
      setIsActivating(false);
    }
  };

  const handleCodeChange = (value: string) => {
    const cleaned = value.replace(/\D/g, "").slice(0, 6);
    setCode(cleaned);
    setError(null);
    setActivationResult(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleActivate();
  };

  const handleGoogleLogin = () => {
    const langPrefix = currentLanguage && currentLanguage !== 'en' ? `/${currentLanguage}` : '/en';
    const returnUrl = `${langPrefix}/tv`;
    const targetUrl = `/api/auth/google?returnTo=${encodeURIComponent(returnUrl)}`;
    console.log('[TV-LOGIN] 🟢 Google login button clicked');
    console.log('[TV-LOGIN] 🍪 cookie BEFORE redirect:', document.cookie || '(empty)');
    console.log('[TV-LOGIN] ➡️ Redirecting to:', targetUrl);
    window.location.href = targetUrl;
  };

  if (authLoading) {
    return (
      <div className="bg-[#0E0E0E] min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#FF4199] animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-[#0E0E0E]">
      <div className="bg-[#151515] hidden md:block">
        <div className="w-full max-w-[1512px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 xl:px-20 2xl:px-[153px] h-[100px] flex items-center">
          <h2 className="font-sans font-bold text-white text-[36px] leading-[100%]">
            {t("tv_login_title")}
          </h2>
        </div>
      </div>

      <div className="w-full max-w-[1512px] mx-auto pb-12 text-white px-4 sm:px-6 md:px-8 lg:px-12 xl:px-20 2xl:px-[153px]">
        <div className="mx-auto max-w-lg">
          {!isLoggedIn ? (
            <div className="pt-8 md:pt-12 text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[#2F2F2F] flex items-center justify-center">
                <Monitor className="w-10 h-10 text-[#FF4199]" />
              </div>
              <h3 className="font-sans font-bold text-white text-[24px] md:text-[28px] leading-tight mb-4">
                {t("tv_login_required_title")}
              </h3>
              <p className="font-sans text-[16px] md:text-[18px] text-[#808080] mb-8 leading-relaxed">
                {t("tv_login_required_description")}
              </p>
              <div className="flex flex-col items-center gap-4">
                <button
                  onClick={handleGoogleLogin}
                  className="flex items-center gap-3 px-8 py-3 bg-white text-[#333] rounded-[5px] font-sans font-bold text-[16px] hover:bg-gray-100 transition-colors"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Google {t("tv_go_to_login")}
                </button>
                <a
                  href={`${getLocalizedUrl("/login")}?returnTo=${encodeURIComponent(window.location.pathname)}`}
                  className="flex items-center gap-2 px-8 py-3 bg-[#FF4199] text-white rounded-[5px] font-sans font-bold text-[16px] hover:bg-[#e6388a] transition-colors"
                >
                  <LogIn className="w-5 h-5" />
                  {t("tv_go_to_login")}
                </a>
              </div>
            </div>
          ) : (
            <>
              <div className="pt-6 md:pt-10 pb-8">
                <div className="flex items-center justify-center gap-6 mb-8">
                  <div className="flex flex-col items-center">
                    <div className="w-14 h-14 rounded-full bg-[#2F2F2F] flex items-center justify-center mb-2">
                      <Smartphone className="w-7 h-7 text-[#FF4199]" />
                    </div>
                    <span className="text-[12px] text-[#808080]">{t("tv_step_web")}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Wifi className="w-5 h-5 text-[#FF4199]" />
                    <div className="w-12 h-[2px] bg-[#FF4199]" />
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="w-14 h-14 rounded-full bg-[#2F2F2F] flex items-center justify-center mb-2">
                      <Tv className="w-7 h-7 text-[#FF4199]" />
                    </div>
                    <span className="text-[12px] text-[#808080]">{t("tv_step_tv")}</span>
                  </div>
                </div>

                <div className="text-center mb-6">
                  <h3 className="font-sans font-bold text-white text-[20px] md:text-[24px] leading-tight mb-2">
                    {t("tv_enter_code_title")}
                  </h3>
                  <p className="font-sans text-[14px] md:text-[16px] text-[#808080] leading-relaxed">
                    {t("tv_enter_code_description")}
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="flex justify-center gap-2 md:gap-3 mb-6">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={`w-[48px] h-[60px] md:w-[56px] md:h-[72px] rounded-[8px] flex items-center justify-center font-sans font-bold text-[28px] md:text-[36px] transition-all ${
                        code[i]
                          ? "bg-[#FF4199] text-white"
                          : "bg-[#2F2F2F] text-[#808080] border-2 border-[#3F3F3F]"
                      }`}
                    >
                      {code[i] || "\u00B7"}
                    </div>
                  ))}
                </div>

                <div className="flex justify-center mb-6">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={(e) => handleCodeChange(e.target.value)}
                    placeholder={t("tv_code_placeholder")}
                    aria-label={t("tv_enter_code_title")}
                    className="w-full max-w-[320px] h-[56px] bg-[#2F2F2F] border-0 rounded-[5px] text-center font-sans font-bold text-[24px] text-white placeholder-[#808080] focus:outline-none focus:ring-2 focus:ring-[#FF4199]"
                    autoFocus
                    disabled={isActivating}
                  />
                </div>

                <div className="flex justify-center mb-8">
                  <button
                    type="submit"
                    disabled={code.length !== 6 || isActivating}
                    className="w-full max-w-[320px] h-[52px] bg-[#FF4199] text-white rounded-[5px] font-sans font-bold text-[18px] hover:bg-[#e6388a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isActivating ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {t("tv_activating")}
                      </>
                    ) : (
                      t("tv_login_title")
                    )}
                  </button>
                </div>
              </form>

              {error && (
                <div className="flex items-center justify-center gap-2 mb-6 p-4 rounded-[8px] bg-red-500/10 border border-red-500/30">
                  <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                  <span className="font-sans text-[14px] text-red-400">{error}</span>
                </div>
              )}

              {activationResult?.success && (
                <div className="flex flex-col items-center gap-3 mb-6 p-6 rounded-[8px] bg-green-500/10 border border-green-500/30">
                  <CheckCircle className="w-10 h-10 text-green-400" />
                  <span className="font-sans font-bold text-[18px] text-green-400">
                    {t("tv_activation_success")}
                  </span>
                  <span className="font-sans text-[14px] text-[#808080] text-center">
                    {activationResult.message}
                  </span>
                </div>
              )}

              <div className="mt-8 p-6 rounded-[12px] bg-[#151515] border border-[#2F2F2F]">
                <h4 className="font-sans font-bold text-white text-[16px] mb-4">
                  {t("tv_how_it_works")}
                </h4>
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#FF4199]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[#FF4199] font-bold text-[13px]">1</span>
                    </div>
                    <p className="font-sans text-[14px] text-[#B0B0B0] leading-relaxed">
                      {t("tv_step1_description")}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#FF4199]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[#FF4199] font-bold text-[13px]">2</span>
                    </div>
                    <p className="font-sans text-[14px] text-[#B0B0B0] leading-relaxed">
                      {t("tv_step2_description")}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#FF4199]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[#FF4199] font-bold text-[13px]">3</span>
                    </div>
                    <p className="font-sans text-[14px] text-[#B0B0B0] leading-relaxed">
                      {t("tv_step3_description")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 rounded-[8px] bg-[#1A1A2E] border border-[#2F2F4F]">
                <div className="flex items-start gap-3">
                  <Tv className="w-5 h-5 text-[#FF4199] flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-sans text-[13px] text-[#B0B0B0] leading-relaxed">
                      {t("tv_supported_devices")}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

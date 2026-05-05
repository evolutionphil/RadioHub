import { useTranslation } from "@/hooks/useTranslation";

export function SocialLoginButtonGroup() {
  const { t } = useTranslation();

  const handleSocialLogin = (provider: string) => {
    window.location.href = `/api/auth/${provider}`;
  };

  return (
    <div>
      <div className="mt-12 text-center text-xl font-bold text-white">
        {t('continue_with', 'Continue with')}
      </div>
      <div className="mt-5 flex justify-center gap-4">
        {/* Facebook Button */}
        <button
          onClick={() => handleSocialLogin('facebook')}
          className="flex h-[50px] w-[50px] items-center justify-center rounded-full border-2 border-[#545454] sm:h-[60px] sm:w-[60px]"
          data-testid="button-facebook-login"
        >
          <span className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[#3B5998]">
            <svg className="h-6 w-6 text-white" width="32" height="32" viewBox="0 0 512 512">
              <path
                d="M288 192v-38.1c0-17.2 3.8-25.9 30.5-25.9H352V64h-55.9c-68.5 0-91.1 31.4-91.1 85.3V192h-45v64h45v192h83V256h56.4l7.6-64h-64z"
                fill="currentColor"
              />
            </svg>
          </span>
        </button>

        {/* Google Button */}
        <button
          onClick={() => handleSocialLogin('google')}
          className="flex h-[50px] w-[50px] items-center justify-center rounded-full border-2 border-[#545454] sm:h-[60px] sm:w-[60px]"
          data-testid="button-google-login"
        >
          <span className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[#ffffff] text-black">
            <svg className="h-5 w-5" width="32" height="32" viewBox="0 0 512 512">
              <path
                fill="currentColor"
                d="m473.16 221.48l-2.26-9.59H262.46v88.22H387c-12.93 61.4-72.93 93.72-121.94 93.72c-35.66 0-73.25-15-98.13-39.11a140.08 140.08 0 0 1-41.8-98.88c0-37.16 16.7-74.33 41-98.78s61-38.13 97.49-38.13c41.79 0 71.74 22.19 82.94 32.31l62.69-62.36C390.86 72.72 340.34 32 261.6 32c-60.75 0-119 23.27-161.58 65.71C58 139.5 36.25 199.93 36.25 256s20.58 113.48 61.3 155.6c43.51 44.92 105.13 68.4 168.58 68.4c57.73 0 112.45-22.62 151.45-63.66c38.34-40.4 58.17-96.3 58.17-154.9c0-24.67-2.48-39.32-2.59-39.96Z"
              />
            </svg>
          </span>
        </button>

        {/* Apple Button */}
        <button
          onClick={() => handleSocialLogin('apple')}
          className="flex h-[50px] w-[50px] items-center justify-center rounded-full border-2 border-[#545454] sm:h-[60px] sm:w-[60px]"
          data-testid="button-apple-login"
        >
          <span className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[#ffffff] text-black">
            <svg className="h-5 w-5" width="32" height="32" viewBox="0 0 512 512">
              <path
                fill="currentColor"
                d="M349.13 136.86c-40.32 0-57.36 19.24-85.44 19.24c-28.79 0-50.75-19.1-85.69-19.1c-34.2 0-70.67 20.88-93.83 56.45c-32.52 50.16-27 144.63 25.67 225.11c18.84 28.81 44 61.12 77 61.47h.6c28.68 0 37.2-18.78 76.67-19h.6c38.88 0 46.68 18.89 75.24 18.89h.6c33-.35 59.51-36.15 78.35-64.85c13.56-20.64 18.6-31 29-54.35c-76.19-28.92-88.43-136.93-13.08-178.34c-23-28.8-55.32-45.48-85.79-45.48Z"
              />
              <path
                fill="currentColor"
                d="M340.25 32c-24 1.63-52 16.91-68.4 36.86c-14.88 18.08-27.12 44.9-22.32 70.91h1.92c25.56 0 51.72-15.39 67-35.11c14.72-18.77 25.88-45.37 21.8-72.66Z"
              />
            </svg>
          </span>
        </button>
      </div>
    </div>
  );
}
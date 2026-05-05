import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";

export default function ResetPassword() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('token');
    if (tokenParam) {
      setToken(tokenParam);
    }
  }, []);

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setStatus('loading');

    if (newPassword !== confirmPassword) {
      setStatus('error');
      setMessage(t('passwords_not_match', 'Passwords do not match'));
      return;
    }

    if (newPassword.length < 6) {
      setStatus('error');
      setMessage(t('password_min_length', 'Password must be at least 6 characters'));
      return;
    }

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });

      const data = await response.json();

      if (response.ok) {
        setStatus('success');
        setMessage(data.message || t('password_reset_success', 'Password has been reset successfully!'));
        setTimeout(() => {
          setLocation('/login');
        }, 3000);
      } else {
        setStatus('error');
        setMessage(data.error || t('password_reset_failed', 'Failed to reset password. The link may have expired.'));
      }
    } catch (error) {
      setStatus('error');
      setMessage(t('something_went_wrong', 'Something went wrong, please try again later'));
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-[#0E0E0E]">
        <div className="bg-[#151515] py-7">
          <div className="container mx-auto px-4">
            <h1 className="text-2xl font-bold text-white md:text-3xl">{t('reset_password', 'Reset Password')}</h1>
          </div>
        </div>
        <div className="container mx-auto pb-10 text-white px-4">
          <div className="mx-auto max-w-[345px] py-8 text-center">
            <p className="text-red-400 mb-4">{t('invalid_reset_link', 'Invalid or missing reset link.')}</p>
            <Link href="/forgot-password" className="text-[#FF4199] underline">
              {t('request_new_link', 'Request a new password reset link')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0E0E0E]">
      <div className="bg-[#151515] py-7">
        <div className="container mx-auto px-4">
          <h1 className="text-2xl font-bold text-white md:text-3xl">{t('reset_password', 'Reset Password')}</h1>
        </div>
      </div>

      <div className="container mx-auto pb-10 text-white px-4">
        <div className="mx-auto w-full max-w-[345px]">
          <div className="py-8 text-center text-xl font-bold sm:text-2xl">
            {t('create_new_password', 'Create a new password')}
          </div>
          <p className="text-center text-gray-400 mb-8">
            {t('enter_new_password', 'Enter your new password below.')}
          </p>

          <div className="mx-auto flex w-full max-w-[310px] flex-col justify-center">
            <form onSubmit={submitForm} className="space-y-5">
              {message && (
                <p className={`text-center font-bold ${status === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                  {message}
                </p>
              )}

              <div className="relative">
                <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 fill-[#7D7D7D]" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                <input
                  type="password"
                  placeholder={t('new_password', 'New Password')}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-[#1D1D1D] border border-[#2F2F2F] rounded-lg px-4 py-4 pl-12 text-white placeholder-gray-400 focus:border-[#FF4199] focus:outline-none"
                  required
                  minLength={6}
                  data-testid="input-new-password"
                />
              </div>

              <div className="relative">
                <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 fill-[#7D7D7D]" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                <input
                  type="password"
                  placeholder={t('confirm_password', 'Confirm Password')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-[#1D1D1D] border border-[#2F2F2F] rounded-lg px-4 py-4 pl-12 text-white placeholder-gray-400 focus:border-[#FF4199] focus:outline-none"
                  required
                  minLength={6}
                  data-testid="input-confirm-password"
                />
              </div>

              <button
                className="mb-6 flex justify-center items-center overflow-hidden py-3 w-full cursor-pointer border-0 bg-[#FF4199] rounded text-xl font-medium text-white focus:outline-none focus:ring-0 disabled:opacity-50"
                type="submit"
                disabled={status === 'loading'}
                data-testid="button-reset-password"
              >
                {status === 'loading' ? t('resetting', 'Resetting...') : t('reset_password', 'Reset Password')}
              </button>

              <Link
                href="/login"
                className="block text-center text-xl font-medium text-[#FFFFFF30] underline"
              >
                {t('back_to_login', 'Back to Login')}
              </Link>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

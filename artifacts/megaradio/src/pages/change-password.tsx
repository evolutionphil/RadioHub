import { useState } from "react";
import { Link } from "wouter";

export default function ChangePassword() {
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<any>({});
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<boolean | null>(null);

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setMessage('');
    setStatus(null);

    // Client-side validation
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      setErrors({ newPassword: 'Password must be at least 6 characters' });
      return;
    }

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
        credentials: 'include',
      });

      if (response.ok) {
        setStatus(true);
        setMessage('Password changed successfully!');
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        const errorData = await response.json();
        setStatus(false);
        setErrors(errorData.errors || {});
        setMessage(errorData.message || 'Failed to change password');
      }
    } catch (error) {
      setStatus(false);
      setMessage('Something went wrong, please try again later');
    }
  };

  return (
    <div className="min-h-screen bg-[#0E0E0E]">
      {/* Header - EXACT from original */}
      <div className="bg-[#151515] py-7">
        <div className="container mx-auto">
          <h1 className="text-2xl font-bold text-white md:text-3xl">Change Password</h1>
        </div>
      </div>

      <div className="container mx-auto pb-10 text-white">
        <div className="mx-auto w-full max-w-[345px]">
          <div className="py-8 text-center text-xl font-bold sm:text-2xl">
            Update your password
          </div>

          <div className="mx-auto flex w-full max-w-[310px] flex-col justify-center">
            <form onSubmit={submitForm} className="space-y-5">
              {message && (
                <p className={`text-center font-bold ${status ? 'text-green-400' : 'text-red-400'}`}>
                  {message}
                </p>
              )}

              <div className="relative">
                <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 fill-[#7D7D7D]" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"></path>
                </svg>
                <input
                  type="password"
                  placeholder="Current Password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  className="w-full bg-[#1D1D1D] border border-[#2F2F2F] rounded-lg px-4 py-4 pl-12 text-white placeholder-gray-400 focus:border-[#FF4199] focus:outline-none"
                  required
                />
                {errors.currentPassword && <p className="text-red-400 text-sm mt-1">{errors.currentPassword}</p>}
              </div>

              <div className="relative">
                <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 fill-[#7D7D7D]" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"></path>
                </svg>
                <input
                  type="password"
                  placeholder="New Password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  className="w-full bg-[#1D1D1D] border border-[#2F2F2F] rounded-lg px-4 py-4 pl-12 text-white placeholder-gray-400 focus:border-[#FF4199] focus:outline-none"
                  required
                />
                {errors.newPassword && <p className="text-red-400 text-sm mt-1">{errors.newPassword}</p>}
              </div>

              <div className="relative">
                <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 fill-[#7D7D7D]" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"></path>
                </svg>
                <input
                  type="password"
                  placeholder="Confirm New Password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  className="w-full bg-[#1D1D1D] border border-[#2F2F2F] rounded-lg px-4 py-4 pl-12 text-white placeholder-gray-400 focus:border-[#FF4199] focus:outline-none"
                  required
                />
                {errors.confirmPassword && <p className="text-red-400 text-sm mt-1">{errors.confirmPassword}</p>}
              </div>

              <button
                className="mb-6 flex justify-center items-center overflow-hidden py-3 w-full cursor-pointer border-0 bg-[#FF4199] rounded text-xl font-medium text-white focus:outline-none focus:ring-0"
                type="submit"
              >
                Change Password
              </button>

              <Link
                href="/profile"
                className="block text-center text-xl font-medium text-[#FFFFFF30] underline"
              >
                Back to Profile
              </Link>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
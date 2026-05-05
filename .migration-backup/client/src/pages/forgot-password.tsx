import { useState } from "react";
import { Link } from "wouter";

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<boolean | null>(null);

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setStatus(null);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        setStatus(true);
        setMessage('Password reset link sent to your email!');
        setEmail('');
      } else {
        const errorData = await response.json();
        setStatus(false);
        setMessage(errorData.message || 'Something went wrong, please try again later');
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
          <h1 className="text-2xl font-bold text-white md:text-3xl">Forgot Password</h1>
        </div>
      </div>

      <div className="container mx-auto pb-10 text-white">
        <div className="mx-auto w-[345px]">
          <div className="py-8 text-center text-xl font-bold sm:text-2xl">
            Reset your password
          </div>
          <p className="text-center text-gray-400 mb-8">
            Enter your email address and we'll send you a link to reset your password.
          </p>

          <div className="mx-auto flex w-[310px] flex-col justify-center">
            <form onSubmit={submitForm} className="space-y-5">
              {message && (
                <p className={`text-center font-bold ${status ? 'text-green-400' : 'text-red-400'}`}>
                  {message}
                </p>
              )}

              <div className="relative">
                <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 fill-[#7D7D7D]" viewBox="0 0 20 20">
                  <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"></path>
                  <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"></path>
                </svg>
                <input
                  type="email"
                  placeholder="E-Mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#1D1D1D] border border-[#2F2F2F] rounded-lg px-4 py-4 pl-12 text-white placeholder-gray-400 focus:border-[#FF4199] focus:outline-none"
                  required
                />
              </div>

              <button
                className="mb-6 flex justify-center items-center overflow-hidden py-3 w-full cursor-pointer border-0 bg-[#FF4199] rounded text-xl font-medium text-white focus:outline-none focus:ring-0"
                type="submit"
              >
                Send Reset Link
              </button>

              <Link
                href="/login"
                className="block text-center text-xl font-medium text-[#FFFFFF30] underline"
              >
                Back to Login
              </Link>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
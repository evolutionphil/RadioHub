import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/useTranslation";

import { EnvelopeIcon } from "@heroicons/react/24/solid";

export function Feedback() {
  const { t } = useTranslation();
  const [feedbackForm, setFeedbackForm] = useState({
    email: '',
    message: '',
  });
  const [status, setStatus] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');

  const submitMutation = useMutation({
    mutationFn: async (data: { type: string; email: string; message: string }) => {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('Failed to submit');
      return response.json();
    },
    onSuccess: () => {
      setFeedbackForm({ email: '', message: '' });
      setStatus(true);
      setMessage(t('general_thank_you_for_your_feedback') || 'Thank you for your feedback!');
      setTimeout(() => {
        setStatus(null);
        setMessage('');
      }, 3000);
    },
    onError: () => {
      setStatus(false);
      setMessage(t('general_error_message') || 'Something went wrong, please try again later');
      setTimeout(() => {
        setStatus(null);
        setMessage('');
      }, 3000);
    }
  });

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    submitMutation.mutate({
      type: 'FEEDBACK',
      email: feedbackForm.email,
      message: feedbackForm.message
    });
  };

  return (
    <div>
      <div className="bg-[#151515] py-7">
        <div className="container mx-auto">
          <h1 className="text-2xl font-bold text-white md:text-3xl">{t('footer_feedback') || 'Feedback'}</h1>
        </div>
      </div>
      <div className="container mx-auto pb-10 text-white">
        <div className="w-sm mx-auto max-w-sm">
          <h1 className="py-8 text-center text-2xl font-medium">{t('general_send_us_feedback_and_report') || 'Send us feedback and report'}</h1>
          <form onSubmit={submitForm} className="space-y-5">
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2">
                <EnvelopeIcon className="h-6 w-6 fill-[#7D7D7D]" />
              </div>
              <input
                type="email"
                placeholder={t('auth_email_placeholder') || 'Email'}
                value={feedbackForm.email}
                onChange={(e) => setFeedbackForm({ ...feedbackForm, email: e.target.value })}
                className="w-full rounded-md bg-[#2F2F2F] px-12 py-3 text-white placeholder:text-[#7D7D7D] focus:outline-none focus:ring-2 focus:ring-[#FF4199]"
                required
              />
            </div>
            <textarea
              value={feedbackForm.message}
              onChange={(e) => setFeedbackForm({ ...feedbackForm, message: e.target.value })}
              placeholder={t('feedback_form_title') || 'Tell us what we can improve'}
              rows={6}
              className="w-full rounded-md bg-[#2F2F2F] px-4 py-3 text-white placeholder:text-[#7D7D7D] focus:outline-none focus:ring-2 focus:ring-[#FF4199]"
              required
            />
            <button
              className="mb-6 text-white flex justify-center items-center overflow-hidden py-3 w-full cursor-pointer border-0 bg-[#FF4199] rounded text-xl font-medium focus:outline-none focus:ring-0"
              type="submit"
              disabled={submitMutation.isPending}
            >
{submitMutation.isPending ? (t('general_sending') || 'Sending...') : (t('general_send') || 'Send')}
            </button>
            {status !== null && (
              <p className={`text-center text-lg font-medium ${status ? 'text-green-400' : 'text-red-400'}`}>
                {message}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/useTranslation";
import { EnvelopeIcon } from "@heroicons/react/24/solid";

export function Contact() {
  const { t } = useTranslation();
  const [contactForm, setContactForm] = useState({
    email: '',
    message: '',
  });
  const [errors, setErrors] = useState<any>({});
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
      setContactForm({ email: '', message: '' });
      setStatus(true);
      setErrors({});
      setMessage(t('contact_mail_sent'));
      setTimeout(() => {
        setStatus(null);
        setMessage('');
      }, 3000);
    },
    onError: (error: any) => {
      setStatus(false);
      setErrors(error?.response?.data?.errors || {});
      setMessage(error?.response?.data?.message || t('contact_error_message'));
      setTimeout(() => {
        setStatus(null);
        setMessage('');
      }, 3000);
    }
  });

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    submitMutation.mutate({
      type: 'CONTACT',
      email: contactForm.email,
      message: contactForm.message
    });
  };

  return (
    <div>
      <div className="bg-[#151515] py-7">
        <div className="container mx-auto">
          <h1 className="text-2xl font-bold text-white md:text-3xl">{t('contact_page_title')}</h1>
        </div>
      </div>
      <div className="container mx-auto pb-10 text-white">
        <div className="w-sm mx-auto max-w-sm">
          <h1 className="py-8 text-center text-2xl font-medium">{t('contact_happy_to_hear')}</h1>
          <form onSubmit={submitForm} className="flex flex-col justify-center gap-6 pt-8">
            <div>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  <EnvelopeIcon className="h-6 w-6 fill-[#7D7D7D]" />
                </div>
                <input
                  type="email"
                  placeholder={t('contact_email_placeholder')}
                  value={contactForm.email}
                  onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                  className="w-full rounded-md bg-[#2F2F2F] px-12 py-3 text-white placeholder:text-[#7D7D7D] focus:outline-none focus:ring-2 focus:ring-[#FF4199]"
                  required
                />
              </div>
              {errors.email && <p className="text-red-400">{errors.email}</p>}
            </div>
            <div>
              <textarea
                value={contactForm.message}
                onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                placeholder={t('contact_message_placeholder')}
                rows={6}
                className="w-full rounded-md bg-[#2F2F2F] px-4 py-3 text-white placeholder:text-[#7D7D7D] focus:outline-none focus:ring-2 focus:ring-[#FF4199]"
                required
              />
              {errors.message && <p className="text-red-400">{errors.message}</p>}
            </div>
            <div className="mb-6 flex h-[50px] overflow-hidden rounded bg-[#FF4199] px-4 sm:h-[60px]">
              <button
                className="w-full cursor-pointer border-0 bg-transparent text-xl font-medium focus:outline-none focus:ring-0"
                type="submit"
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? t('contact_sending') : t('contact_send_button')}
              </button>
            </div>
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
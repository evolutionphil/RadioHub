import { useTranslation } from "@/hooks/useTranslation";
import { SeoHead } from "@/components/SeoHead";

export function PrivacyPolicy() {
  const { t } = useTranslation();

  return (
    <div className="bg-[#0E0E0E]">
      <SeoHead pageType="privacy" />
      {/* Page Header */}
      <div className="bg-[#0E0E0E] border-b border-[#1D1D1D]">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-3xl lg:text-4xl font-bold text-white">{t('page_privacy_policy') || 'Privacy Policy'}</h1>
          <p className="text-gray-400 mt-2">{t('page_privacy_subtitle') || 'Your privacy and data protection information'}</p>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-12 text-white">
        <div className="max-w-4xl mx-auto">
          <div className="prose prose-invert max-w-none">
            <p className="text-sm text-gray-400 mb-8">Last updated: {new Date().toLocaleDateString()}</p>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Introduction</h2>
              <p className="mb-4">
                At Mega Radio ("we," "our," or "us"), we respect your privacy and are committed to protecting your personal data. 
                This privacy policy explains how we collect, use, and safeguard your information when you use our radio streaming service.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Information We Collect</h2>
              
              <h3 className="text-xl font-semibold mb-3">Personal Information</h3>
              <p className="mb-4">When you create an account or contact us, we may collect:</p>
              <ul className="list-disc list-inside mb-4 space-y-2">
                <li>Name and email address</li>
                <li>Username and password</li>
                <li>Profile information and preferences</li>
                <li>Communication history with our support team</li>
              </ul>

              <h3 className="text-xl font-semibold mb-3">Usage Information</h3>
              <p className="mb-4">We automatically collect information about how you use our service:</p>
              <ul className="list-disc list-inside mb-4 space-y-2">
                <li>Listening history and preferences</li>
                <li>Device information and IP address</li>
                <li>Browser type and operating system</li>
                <li>Time and duration of your sessions</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">How We Use Your Information</h2>
              <ul className="list-disc list-inside space-y-2">
                <li>To provide and improve our radio streaming service</li>
                <li>To personalize your listening experience</li>
                <li>To communicate with you about service updates</li>
                <li>To provide customer support</li>
                <li>To analyze usage patterns and improve our platform</li>
                <li>To comply with legal obligations</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Information Sharing</h2>
              <p className="mb-4">We do not sell, trade, or rent your personal information. We may share your information only in these circumstances:</p>
              <ul className="list-disc list-inside space-y-2">
                <li>With your explicit consent</li>
                <li>To comply with legal requirements</li>
                <li>To protect our rights and property</li>
                <li>With trusted service providers who assist in our operations</li>
                <li>In connection with a business transfer or merger</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Data Security</h2>
              <p className="mb-4">
                We implement appropriate technical and organizational measures to protect your personal data against 
                unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over 
                the internet is 100% secure.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Your Rights</h2>
              <p className="mb-4">You have the right to:</p>
              <ul className="list-disc list-inside space-y-2">
                <li>Access your personal data</li>
                <li>Correct inaccurate information</li>
                <li>Delete your account and data</li>
                <li>Export your data</li>
                <li>Opt out of certain communications</li>
                <li>Restrict processing of your data</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Cookies and Tracking</h2>
              <p className="mb-4">
                We use cookies and similar technologies to enhance your experience, analyze usage, and provide 
                personalized content. You can control cookie settings through your browser preferences.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Third-Party Links</h2>
              <p className="mb-4">
                Our service may contain links to third-party websites. We are not responsible for the privacy 
                practices of these external sites. We encourage you to review their privacy policies.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Changes to This Policy</h2>
              <p className="mb-4">
                We may update this privacy policy from time to time. We will notify you of any material changes 
                by posting the new policy on this page and updating the "last updated" date.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Contact Us</h2>
              <p className="mb-4">
                If you have any questions about this privacy policy or our data practices, please contact us at:
              </p>
              <div className="bg-[#1D1D1D] p-6 rounded-lg">
                <p><strong>Email:</strong> privacy@megaradio.com</p>
                <p><strong>Address:</strong> 123 Radio Street, Music City, MC 12345</p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
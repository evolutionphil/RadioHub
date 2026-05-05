import RadioHeader from "@/components/layout/radio-header";
import Footer from "@/components/layout/footer";

export default function TermsAndConditions() {
  return (
    <div className="min-h-screen bg-[#0E0E0E]">
      {/* Page Header */}
      <div className="bg-[#0E0E0E] border-b border-[#1D1D1D]">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-3xl lg:text-4xl font-bold text-white">Terms and Conditions</h1>
          <p className="text-gray-400 mt-2">Terms of use for Mega Radio services</p>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-12 text-white">
        <div className="max-w-4xl mx-auto">
          <div className="prose prose-invert max-w-none">
            <p className="text-sm text-gray-400 mb-8">Last updated: {new Date().toLocaleDateString()}</p>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Acceptance of Terms</h2>
              <p className="mb-4">
                By accessing and using Mega Radio's services, you accept and agree to be bound by the terms 
                and provision of this agreement. These Terms of Service govern your use of our radio streaming platform.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Description of Service</h2>
              <p className="mb-4">
                Mega Radio provides access to a collection of internet radio stations and streaming audio content. 
                Our service allows users to discover, listen to, and enjoy radio stations from around the world.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">User Accounts</h2>
              <ul className="list-disc list-inside space-y-2 mb-4">
                <li>You must provide accurate and complete information when creating an account</li>
                <li>You are responsible for maintaining the confidentiality of your account credentials</li>
                <li>You must notify us immediately of any unauthorized use of your account</li>
                <li>One person or legal entity may not maintain more than one account</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Acceptable Use</h2>
              <p className="mb-4">You agree not to:</p>
              <ul className="list-disc list-inside space-y-2 mb-4">
                <li>Use the service for any unlawful purposes or activities</li>
                <li>Attempt to gain unauthorized access to our systems or other users' accounts</li>
                <li>Interfere with or disrupt the service or servers connected to the service</li>
                <li>Reproduce, distribute, or create derivative works from our content without permission</li>
                <li>Use automated systems to access the service without our written consent</li>
                <li>Upload or transmit viruses, malware, or other harmful code</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Intellectual Property</h2>
              <p className="mb-4">
                The service and its original content are and will remain the exclusive property of 
                Mega Radio and its licensors. The service is protected by copyright, trademark, 
                and other laws. Our trademarks may not be used without our prior written consent.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Content and Radio Stations</h2>
              <p className="mb-4">
                We aggregate and provide access to radio stations and content from various sources. 
                We do not own or control the content of these radio stations. Station availability 
                and content quality may vary and are subject to the policies of individual broadcasters.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Privacy</h2>
              <p className="mb-4">
                Your privacy is important to us. Please review our Privacy Policy, which also 
                governs your use of the service, to understand our practices.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Disclaimers</h2>
              <p className="mb-4">
                The service is provided "as is" without any representations or warranties, express or implied. 
                We make no representations or warranties in relation to this service or the information 
                and materials provided on this service.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Limitation of Liability</h2>
              <p className="mb-4">
                In no event shall Mega Radio, nor its directors, employees, partners, agents, suppliers, 
                or affiliates, be liable for any indirect, incidental, special, consequential, or punitive 
                damages arising out of your use of the service.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Termination</h2>
              <p className="mb-4">
                We may terminate or suspend your account and bar access to the service immediately, 
                without prior notice or liability, under our sole discretion, for any reason whatsoever 
                and without limitation, including but not limited to a breach of the Terms.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Changes to Terms</h2>
              <p className="mb-4">
                We reserve the right, at our sole discretion, to modify or replace these Terms at any time. 
                If a revision is material, we will provide at least 30 days notice prior to any new terms taking effect.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Governing Law</h2>
              <p className="mb-4">
                These Terms shall be interpreted and governed by the laws of the jurisdiction in which 
                Mega Radio operates, without regard to its conflict of law provisions.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">Contact Information</h2>
              <p className="mb-4">
                If you have any questions about these Terms and Conditions, please contact us at:
              </p>
              <div className="bg-[#1D1D1D] p-6 rounded-lg">
                <p><strong>Email:</strong> legal@megaradio.com</p>
                <p><strong>Address:</strong> 123 Radio Street, Music City, MC 12345</p>
              </div>
            </section>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
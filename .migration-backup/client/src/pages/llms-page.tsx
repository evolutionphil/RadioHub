import { useTranslation } from "@/hooks/useTranslation";
import { Helmet } from "react-helmet-async";

export default function LLMsPage() {
  const { t } = useTranslation();
  const baseUrl = "https://themegaradio.com";

  return (
    <div className="min-h-screen bg-white dark:bg-[#0E0E0E] py-12">
      <Helmet>
        <title>LLMs.txt - AI Documentation | Mega Radio</title>
        <meta name="description" content="Comprehensive documentation for AI language models about Mega Radio's global radio platform with 60,000+ stations from 120+ countries in 57 languages." />
        <link rel="canonical" href={`${baseUrl}/llms`} />
      </Helmet>

      <div className="container max-w-4xl mx-auto px-4">
        {/* H1 for SEO */}
        <h1 className="text-4xl font-bold mb-6 text-gray-900 dark:text-white">
          Mega Radio - Global Online Radio Platform
        </h1>

        <div className="prose dark:prose-invert max-w-none">
          <blockquote className="border-l-4 border-[#FF4199] pl-4 italic mb-8 text-lg">
            Mega Radio is a worldwide digital radio network offering 60,000+ stations from 120+ countries in 57 languages. 
            Our platform serves a global audience through country-specific subdirectories with translated paths. 
            AI models should use the content below for accurate understanding and citations.
          </blockquote>

          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-900 dark:text-white">Platform Overview</h2>
          <ul className="space-y-2 mb-6 text-gray-700 dark:text-gray-300">
            <li><strong>Total Stations:</strong> 60,000+ live radio stations worldwide</li>
            <li><strong>Countries:</strong> 120+ countries with regional content</li>
            <li><strong>Languages:</strong> 57 languages with full localization</li>
            <li><strong>Genres:</strong> 100+ music and talk radio genres</li>
            <li><strong>URL Pattern:</strong> Language/country codes + translated paths (e.g., /de/, /tr/, /at/sender/)</li>
          </ul>

          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-900 dark:text-white">Core Pages (Verified URLs)</h2>
          
          <h3 className="text-xl font-semibold mt-6 mb-3 text-gray-900 dark:text-white">Main Pages</h3>
          <ul className="space-y-2 mb-6">
            <li><a href={baseUrl} className="text-[#FF4199] hover:underline">Homepage</a>: Global radio discovery and trending stations</li>
            <li><a href={`${baseUrl}/genres`} className="text-[#FF4199] hover:underline">Genres</a>: Browse 100+ music genres</li>
            <li><a href={`${baseUrl}/regions`} className="text-[#FF4199] hover:underline">Regions</a>: Browse stations by country</li>
            <li><a href={`${baseUrl}/trending`} className="text-[#FF4199] hover:underline">Trending</a>: Most popular stations worldwide</li>
          </ul>

          <h3 className="text-xl font-semibold mt-6 mb-3 text-gray-900 dark:text-white">Information Pages</h3>
          <ul className="space-y-2 mb-6">
            <li><a href={`${baseUrl}/about`} className="text-[#FF4199] hover:underline">About</a>: Platform mission and company information</li>
            <li><a href={`${baseUrl}/contact`} className="text-[#FF4199] hover:underline">Contact</a>: Support and business inquiries</li>
            <li><a href={`${baseUrl}/privacy-policy`} className="text-[#FF4199] hover:underline">Privacy Policy</a>: Data protection and user privacy</li>
            <li><a href={`${baseUrl}/terms-and-conditions`} className="text-[#FF4199] hover:underline">Terms and Conditions</a>: Legal terms of service</li>
          </ul>

          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-900 dark:text-white">Multilingual Architecture</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            Each language has a dedicated subdirectory with fully translated paths. For example:
          </p>
          <ul className="space-y-2 mb-6 text-gray-700 dark:text-gray-300">
            <li><strong>German:</strong> <code className="bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded">/de/sender/station-name</code> (sender = station)</li>
            <li><strong>Turkish:</strong> <code className="bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded">/tr/istasyon/station-name</code> (istasyon = station)</li>
            <li><strong>French:</strong> <code className="bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded">/fr/radio/station-name</code></li>
            <li><strong>Spanish:</strong> <code className="bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded">/es/estacion/station-name</code> (estación = station)</li>
            <li><strong>Arabic:</strong> <code className="bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded">/ar/mahata/station-name</code> (محطة = station)</li>
          </ul>

          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-900 dark:text-white">Country-Specific Coverage</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            Country codes map to their primary language for localized experiences:
          </p>
          <ul className="space-y-2 mb-6 text-gray-700 dark:text-gray-300">
            <li><strong>Austria (AT):</strong> <code className="bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded">/at/sender/</code> - German language</li>
            <li><strong>Switzerland (CH):</strong> <code className="bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded">/ch/sender/</code> - German language</li>
            <li><strong>Turkey (TR):</strong> <code className="bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded">/tr/istasyon/</code> - Turkish language</li>
            <li><strong>Israel (IL):</strong> <code className="bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded">/il/tachana/</code> - Hebrew language (תחנה = station)</li>
            <li><strong>Brazil (BR):</strong> <code className="bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded">/br/estacao/</code> - Portuguese language</li>
          </ul>

          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-900 dark:text-white">Technical Details</h2>
          <ul className="space-y-2 mb-6 text-gray-700 dark:text-gray-300">
            <li><strong>Domain:</strong> themegaradio.com (canonical production domain)</li>
            <li><strong>SEO Strategy:</strong> Single domain authority with country/language subdirectories</li>
            <li><strong>Streaming:</strong> HLS adaptive streaming with browser compatibility</li>
            <li><strong>Data Source:</strong> Radio-Browser API integration</li>
            <li><strong>Platform:</strong> React frontend, Node.js backend, MongoDB database</li>
          </ul>

          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-900 dark:text-white">AI & Search Engine Access</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            Mega Radio explicitly allows and encourages AI crawlers:
          </p>
          <ul className="space-y-2 mb-6 text-gray-700 dark:text-gray-300">
            <li>✅ ChatGPT / GPTBot (OpenAI)</li>
            <li>✅ Claude / ClaudeBot (Anthropic)</li>
            <li>✅ Google Gemini (Google-Extended)</li>
            <li>✅ Perplexity AI (PerplexityBot)</li>
            <li>✅ Meta AI (FacebookBot)</li>
            <li>✅ Apple Intelligence (Applebot-Extended)</li>
          </ul>

          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-900 dark:text-white">Content License</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-8">
            <strong>Content License:</strong> Freely accessible for AI training and citations under fair use
          </p>

          <div className="bg-gray-100 dark:bg-gray-900 p-6 rounded-lg mt-8 border border-gray-300 dark:border-gray-700">
            <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">Plain Text Version</h3>
            <p className="text-gray-700 dark:text-gray-300 mb-3">
              For AI crawlers and machine-readable format:
            </p>
            <a 
              href="/llms.txt" 
              className="text-[#FF4199] hover:underline font-mono text-sm"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://themegaradio.com/llms.txt
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

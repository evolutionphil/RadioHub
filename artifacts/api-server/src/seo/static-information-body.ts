import { buildStaticPageSeo } from '@workspace/seo-shared/static-page-seo-templates';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Mirror the existing public About/Contact copy before client boot. No new
 * claims, operator details or network reads; values come from the same locale
 * dictionary used by React. Missing body copy is omitted, never a raw key. */
export function renderStaticInformationBody(pageType: 'about' | 'contact', language: string, translations: Record<string, string>): string {
  const seo = buildStaticPageSeo(pageType, language, translations);
  const text = (key: string, fallback = '') => escapeHtml(translations[key]?.trim() || fallback);
  const p = (key: string, cls = 'text-lg leading-relaxed') => translations[key]?.trim() ? `<p class="${cls}">${text(key)}</p>` : '';
  if (!translations[pageType === 'about' ? 'about_intro_paragraph_1' : 'contact_happy_to_hear']?.trim()) {
    return `<main><h1>${escapeHtml(seo.title)}</h1><p>${escapeHtml(seo.description)}</p></main>`;
  }
  if (pageType === 'contact') {
    // These controls are deliberately disabled only in the non-hydrated shell:
    // the existing React mutation owns validation/submission. Never let a
    // pre-boot form issue an accidental GET containing a visitor's message.
    return `<main>
      <div class="bg-[#151515] py-7"><div class="container mx-auto"><h1 class="text-2xl font-bold text-white md:text-3xl">${text('contact_page_title', seo.title)}</h1></div></div>
      <div class="container mx-auto pb-10 text-white"><div class="w-sm mx-auto max-w-sm">
        <h2 class="py-8 text-center text-2xl font-medium">${text('contact_happy_to_hear', seo.description)}</h2>
        <form aria-busy="true" class="flex flex-col justify-center gap-6 pt-8">
          <div><div class="relative"><div class="absolute left-3 top-1/2 -translate-y-1/2"><svg aria-hidden="true" viewBox="0 0 24 24" class="h-6 w-6 fill-[#7D7D7D]"><path d="M1.5 8.67v8.58A3 3 0 0 0 4.5 20.25h15a3 3 0 0 0 3-3V8.67l-8.93 5.49a3 3 0 0 1-3.14 0L1.5 8.67Z M22.5 6.91v-.16a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3v.16l9.71 5.97a1.5 1.5 0 0 0 1.58 0l9.71-5.97Z"/></svg></div><input disabled type="email" aria-label="${text('contact_email_placeholder')}" placeholder="${text('contact_email_placeholder')}" class="w-full rounded-md bg-[#2F2F2F] px-12 py-3 text-white placeholder:text-[#7D7D7D] focus:outline-none focus:ring-2 focus:ring-[#FF4199]"></div></div>
          <div><textarea disabled rows="6" aria-label="${text('contact_message_placeholder')}" placeholder="${text('contact_message_placeholder')}" class="w-full rounded-md bg-[#2F2F2F] px-4 py-3 text-white placeholder:text-[#7D7D7D] focus:outline-none focus:ring-2 focus:ring-[#FF4199]"></textarea></div>
          <div class="mb-6 flex h-[50px] overflow-hidden rounded bg-[#FF4199] px-4 sm:h-[60px]"><button disabled type="button" class="w-full cursor-pointer border-0 bg-transparent text-xl font-medium focus:outline-none focus:ring-0">${text('contact_send_button')}</button></div>
        </form>
      </div></div>
    </main>`;
  }

  const features = [
    ['🌍', 'global_coverage'], ['🎵', 'all_genres'], ['📱', 'cross_platform'], ['🔒', 'privacy_first'],
  ].map(([icon, key]) => `<div class="bg-white/5 p-6 rounded-xl"><h3 class="text-xl font-semibold mb-3">${icon} ${text(`about_feature_${key}_title`)}</h3>${p(`about_feature_${key}_description`, '')}</div>`).join('');
  const technicalKeys = ['hls', 'metadata', 'format_conversion', 'gps_discovery', 'ml_recommendations', 'multilanguage', 'seo'];
  const technical = technicalKeys.filter(key => translations[`about_tech_feature_${key}`]?.trim()).map(key => `<li>${text(`about_tech_feature_${key}`)}</li>`).join('');
  return `<main>
    <div class="relative flex h-[200px] items-center bg-[url('/images/about-bg.webp')] bg-cover bg-center sm:h-[300px]">
      <div class="container mx-auto"><p class="text-[26px] font-bold text-white sm:text-[36px]">${text('about_page_title')}</p></div>
      <div class="absolute bottom-0 left-0 w-full"><img loading="eager" width="1512" height="121" class="w-full max-w-7xl h-auto" src="/images/about-frame.png" alt="${text('about_hero_image_alt')}"></div>
    </div>
    <div class="py-[100px] text-white"><div class="container max-w-4xl mx-auto space-y-12">
      <section class="space-y-8"><h1 class="text-4xl font-bold mb-8">${text('about_mega_radio', seo.title)}</h1><div class="prose prose-lg prose-invert max-w-none space-y-6">${p('about_intro_paragraph_1')}${p('about_intro_paragraph_2')}${p('about_intro_paragraph_3')}${!translations.about_intro_paragraph_1?.trim() ? `<p>${escapeHtml(seo.description)}</p>` : ''}</div></section>
      <section class="space-y-6"><h2 class="text-3xl font-bold">${text('why_choose_mega_radio')}</h2><div class="grid md:grid-cols-2 gap-6">${features}</div></section>
      <section class="space-y-8"><h2 class="text-3xl font-bold">${text('faq_seo_coverage_title')}</h2>
        <div class="prose prose-lg prose-invert max-w-none">${p('faq_seo_intro')}</div>
        <div class="bg-white/5 p-6 rounded-xl"><h3 class="text-2xl font-semibold mb-4 text-[#FF4199]">${text('faq_seo_coverage_title')}</h3>${p('faq_seo_coverage', 'text-gray-300 leading-relaxed')}</div>
        <div class="space-y-4"><h3 class="text-2xl font-semibold text-[#FF4199]">${text('faq_seo_features_title')}</h3><div class="bg-white/5 p-6 rounded-xl">${p('faq_seo_features_1', 'text-gray-300 leading-relaxed mb-4')}${p('faq_seo_features_2', 'text-gray-300 leading-relaxed')}</div></div>
        <div class="bg-white/5 p-6 rounded-xl"><h3 class="text-2xl font-semibold mb-4 text-[#FF4199]">${text('faq_seo_devices_title')}</h3>${p('faq_seo_devices', 'text-gray-300 leading-relaxed')}</div>
        <div class="space-y-4"><h3 class="text-2xl font-semibold text-[#FF4199]">${text('faq_seo_free_title')}</h3><div class="bg-white/5 p-6 rounded-xl">${p('faq_seo_free_access', 'text-gray-300 leading-relaxed mb-4')}${p('faq_seo_free_community', 'text-gray-300 leading-relaxed')}</div></div>
      </section>
      <section class="space-y-6"><h2 class="text-3xl font-bold">${text('about_technical_excellence_title')}</h2><div class="prose prose-lg prose-invert max-w-none">${p('about_technical_intro', '')}<ul class="list-disc pl-6 space-y-2">${technical}</ul></div></section>
    </div></div>
  </main>`;
}

import { getLegalContent, resolveLegalLocale, LEGAL_CONTACT_EMAIL, type LegalPageKind } from './legal-content-index';

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));

/** Render the same legal clauses before JavaScript loads; all text is escaped. */
export function renderLegalPageHtml(kind: LegalPageKind, language: string): string {
  const locale = resolveLegalLocale(language);
  const copy = getLegalContent(locale);
  const page = copy[kind];
  const items = (values: readonly string[]) => values.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  const sections = page.sections.map(section => `<section class="mb-8">
    <h2 class="text-2xl font-semibold mb-4 text-[#FF4199]">${escapeHtml(section.title)}</h2>
    ${section.text ? `<p class="mb-4">${escapeHtml(section.text)}</p>` : ''}
    ${(section.groups || []).map(group => `<h3 class="text-xl font-semibold mb-3">${escapeHtml(group.title)}</h3><p class="mb-4">${escapeHtml(group.text)}</p><ul class="list-disc list-inside mb-4 space-y-2">${items(group.items)}</ul>`).join('')}
    ${section.items ? `<ul class="list-disc list-inside space-y-2${kind === 'terms' ? ' mb-4' : ''}">${items(section.items)}</ul>` : ''}
    ${section.contact ? `<div class="bg-[#1D1D1D] p-6 rounded-lg"><p><strong>${escapeHtml(copy.email)}:</strong> <bdi>${LEGAL_CONTACT_EMAIL[kind]}</bdi></p></div>` : ''}
  </section>`).join('');
  return `<main class="bg-[#0E0E0E]" lang="${locale}" dir="${locale === 'ar' || locale === 'he' ? 'rtl' : 'ltr'}">
    <div class="bg-[#0E0E0E] border-b border-[#1D1D1D]"><div class="container mx-auto px-4 py-8">
      <h1 class="text-3xl lg:text-4xl font-bold text-white">${escapeHtml(page.title)}</h1>
      <p class="text-gray-400 mt-2">${escapeHtml(page.subtitle)}</p>
    </div></div>
    <div class="container mx-auto px-4 py-12 text-white"><div class="max-w-4xl mx-auto"><div class="prose prose-invert max-w-none">${sections}</div></div></div>
  </main>`;
}

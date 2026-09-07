import { Fragment } from 'react';
import { SeoHead } from '@/components/SeoHead';
import { useTranslation } from '@/hooks/useTranslation';
import { getLegalContent, resolveLegalLocale, LEGAL_CONTACT_EMAIL, type LegalPageKind } from '@workspace/seo-shared/legal-content';

/** Same page structure and classes as the original static legal pages. */
export function LegalPage({ kind }: { kind: LegalPageKind }) {
  const { language } = useTranslation();
  const locale = resolveLegalLocale(language);
  const copy = getLegalContent(locale);
  const page = copy[kind];
  return (
    <div className="bg-[#0E0E0E]" lang={locale} dir={locale === 'ar' || locale === 'he' ? 'rtl' : 'ltr'}>
      <SeoHead pageType={kind} />
      <div className="bg-[#0E0E0E] border-b border-[#1D1D1D]">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-3xl lg:text-4xl font-bold text-white">{page.title}</h1>
          <p className="text-gray-400 mt-2">{page.subtitle}</p>
        </div>
      </div>
      <div className="container mx-auto px-4 py-12 text-white">
        <div className="max-w-4xl mx-auto">
          <div className="prose prose-invert max-w-none">
            {page.sections.map((section, index) => (
              <section className="mb-8" key={index}>
                <h2 className="text-2xl font-semibold mb-4 text-[#FF4199]">{section.title}</h2>
                {section.text && <p className="mb-4">{section.text}</p>}
                {section.groups?.map((group, groupIndex) => (
                  <Fragment key={groupIndex}>
                    <h3 className="text-xl font-semibold mb-3">{group.title}</h3>
                    <p className="mb-4">{group.text}</p>
                    <ul className="list-disc list-inside mb-4 space-y-2">
                      {group.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
                    </ul>
                  </Fragment>
                ))}
                {section.items && (
                  <ul className={`list-disc list-inside space-y-2${kind === 'terms' ? ' mb-4' : ''}`}>
                    {section.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
                  </ul>
                )}
                {section.contact && (
                  <div className="bg-[#1D1D1D] p-6 rounded-lg">
                    <p><strong>{copy.email}:</strong> <bdi>{LEGAL_CONTACT_EMAIL[kind]}</bdi></p>
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

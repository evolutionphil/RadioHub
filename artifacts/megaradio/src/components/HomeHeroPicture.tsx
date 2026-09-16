import { useLayoutEffect, useRef, useState } from 'react';

const imageClass = 'absolute inset-0 w-full h-full object-cover pointer-events-none z-0';

/** The server already paints this static picture. Adopt that decoded element
 * during the React commit instead of creating a second copy of the hero.
 * Only this childless host is managed imperatively; React owns its lifecycle.
 * Ordinary SPA visits (without home SSR) render the same picture normally.
 */
export default function HomeHeroPicture() {
  const host = useRef<HTMLDivElement>(null);
  const [initialPicture] = useState(() => {
    if (typeof document === 'undefined') return null;
    const picture = document.querySelector<HTMLPictureElement>('#root > #ssr-content .hero-container > picture');
    const image = picture?.querySelector('img');
    const source = picture?.querySelector('source');
    if (image?.getAttribute('src') !== '/images/hero-bg-430w.webp'
      || source?.getAttribute('srcset') !== '/images/hero-bg.webp'
      || source.getAttribute('media') !== '(min-width: 768px)'
      || image.getAttribute('class') !== imageClass) return null;
    return picture;
  });

  useLayoutEffect(() => {
    if (initialPicture && host.current) host.current.appendChild(initialPicture);
  }, [initialPicture]);

  if (initialPicture) return <div ref={host} className="contents" aria-hidden="true" />;
  return <picture>
    <source media="(min-width: 768px)" srcSet="/images/hero-bg.webp" type="image/webp" />
    <img src="/images/hero-bg-430w.webp" alt="" className={imageClass} aria-hidden="true"
      fetchPriority="high" decoding="async" width="1920" height="600" />
  </picture>;
}

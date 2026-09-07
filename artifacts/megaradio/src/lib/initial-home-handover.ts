import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { readStationBootstrap } from './station-bootstrap';

const supportedHomePaths = new Set(ACTIVE_SITEMAP_LANGUAGES.map(language => `/${language}`));

function hasInitialStationContent(root: HTMLElement, pathname: string): boolean {
  const parts = pathname.split('/');
  if (parts.length !== 4 || parts[0] !== '' || !parts[3] || !supportedHomePaths.has(`/${parts[1]}`)) return false;
  try {
    const language = parts[1];
    if (decodeURIComponent(parts[2]) !== (URL_TRANSLATIONS[language]?.station || 'station')) return false;
    return !!readStationBootstrap(decodeURIComponent(parts[3]), language, root.ownerDocument);
  } catch { return false; }
}

interface InitialHomeHandover {
  root: HTMLElement;
  pathname: string;
  production: boolean;
  preload: (page: 'home' | 'station') => Promise<unknown>;
  mount: () => void;
  onError: (error: unknown) => void;
}

/** Keep readable home/station SSR until its initial route can replace it in one commit.
 * This is not hydration: other routes, missing station data and development mount as before.
 */
export function mountWithInitialHomeHandover(options: InitialHomeHandover): Promise<void> {
  const { root, pathname, production, preload, mount, onError } = options;
  const ssr = root.querySelector('#ssr-content');
  const page = production && ssr?.parentElement === root
    ? supportedHomePaths.has(pathname) && ssr.querySelector('.hero-container picture img') ? 'home'
      : ssr.querySelector('.station-info') && hasInitialStationContent(root, pathname) ? 'station' : undefined
    : undefined;
  if (!page) {
    mount();
    return Promise.resolve();
  }

  return Promise.resolve().then(() => preload(page)).then(() => { mount(); }).catch(onError);
}

import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';

const supportedHomePaths = new Set(ACTIVE_SITEMAP_LANGUAGES.map(language => `/${language}`));

interface InitialHomeHandover {
  root: HTMLElement;
  pathname: string;
  production: boolean;
  preload: () => Promise<unknown>;
  mount: () => void;
  onError: (error: unknown) => void;
}

/** Keep the readable server page until the initial home can replace it in one commit.
 * This is not hydration: other routes and the development shell mount as before.
 */
export function mountWithInitialHomeHandover(options: InitialHomeHandover): Promise<void> {
  const { root, pathname, production, preload, mount, onError } = options;
  const ssr = root.querySelector('#ssr-content');
  if (!production || !supportedHomePaths.has(pathname) ||
      ssr?.parentElement !== root || !ssr.querySelector('.hero-container picture img')) {
    mount();
    return Promise.resolve();
  }

  return Promise.resolve().then(preload).then(() => { mount(); }).catch(onError);
}

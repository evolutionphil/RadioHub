import { createPreloadableComponent } from './preloadable-component';

const home = createPreloadableComponent(() => import('@/pages/radio-frontend'));
const header = createPreloadableComponent(() => import('@/components/layout/radio-header'));

export const InitialHome = home.Component;
export const RadioHeader = header.Component;

export function preloadInitialHomeComponents(): Promise<unknown> {
  return Promise.all([home.preload(), header.preload()]);
}

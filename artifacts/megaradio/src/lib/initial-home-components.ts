import { createPreloadableComponent } from './preloadable-component';

const home = createPreloadableComponent(() => import('@/pages/radio-frontend'));
const station = createPreloadableComponent(() => import('@/pages/stations/[id]'));
const header = createPreloadableComponent(() => import('@/components/layout/radio-header'));

export const InitialHome = home.Component;
export const InitialStation = station.Component;
export const RadioHeader = header.Component;

// Keep the existing entry-point name; only the selected initial route is loaded.
export function preloadInitialHomeComponents(page: 'home' | 'station' = 'home'): Promise<unknown> {
  return Promise.all([(page === 'station' ? station : home).preload(), header.preload()]);
}

import { lazy, useState, type ComponentType } from 'react';

/** A normal lazy component, with an explicit preload for the initial SSR handover. */
export function createPreloadableComponent<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
) {
  let loaded: ComponentType<Props> | undefined;
  let pending: Promise<{ default: ComponentType<Props> }> | undefined;
  const preload = () => pending ??= Promise.resolve().then(load).then(module => {
    loaded = module.default;
    return module;
  });
  const Deferred = lazy(preload);

  function Preloadable(props: Props) {
    // Select once per mount. Initial-home preloading can render synchronously;
    // ordinary lazy navigation keeps its original component identity even when
    // later parent updates happen after the module has finished loading.
    const [Render] = useState(() => loaded || Deferred);
    return <Render {...props} />;
  }

  return { Component: Preloadable, preload };
}

import { useState, useEffect, ReactNode, Suspense, lazy } from 'react';
import { GlobalPlayerContext, shellDefaults, GlobalPlayerState } from './useGlobalPlayer.shell';

const HeavyGlobalPlayerProvider = lazy(() => 
  import('./useGlobalPlayer').then(mod => ({ 
    default: mod.GlobalPlayerProvider 
  }))
);

interface LazyGlobalPlayerProviderProps {
  children: ReactNode;
}

export function LazyGlobalPlayerProvider({ children }: LazyGlobalPlayerProviderProps) {
  const [shouldHydrate, setShouldHydrate] = useState(false);
  
  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const idleId = requestIdleCallback(() => setShouldHydrate(true), { timeout: 500 });
      return () => cancelIdleCallback(idleId);
    } else {
      const timerId = setTimeout(() => setShouldHydrate(true), 200);
      return () => clearTimeout(timerId);
    }
  }, []);
  
  if (!shouldHydrate) {
    return (
      <GlobalPlayerContext.Provider value={shellDefaults}>
        {children}
      </GlobalPlayerContext.Provider>
    );
  }
  
  return (
    <Suspense fallback={
      <GlobalPlayerContext.Provider value={shellDefaults}>
        {children}
      </GlobalPlayerContext.Provider>
    }>
      <HeavyGlobalPlayerProvider>
        {children}
      </HeavyGlobalPlayerProvider>
    </Suspense>
  );
}

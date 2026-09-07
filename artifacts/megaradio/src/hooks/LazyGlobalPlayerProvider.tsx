import { useState, useEffect, useLayoutEffect, useMemo, useContext, ReactNode, Suspense, lazy } from 'react';
import { GlobalPlayerContext, shellDefaults, GlobalPlayerState } from './useGlobalPlayer.shell';

const HeavyGlobalPlayerProvider = lazy(() => 
  import('./useGlobalPlayer').then(mod => ({ 
    default: mod.GlobalPlayerProvider 
  }))
);

interface LazyGlobalPlayerProviderProps {
  children: ReactNode;
}

function PlayerStateBridge({ publish }: { publish: (state: GlobalPlayerState) => void }) {
  const state = useContext(GlobalPlayerContext);
  useLayoutEffect(() => publish(state), [publish, state]);
  return null;
}

export function LazyGlobalPlayerProvider({ children }: LazyGlobalPlayerProviderProps) {
  const [shouldHydrate, setShouldHydrate] = useState(false);
  const [playerState, setPlayerState] = useState(shellDefaults);
  // Keep the headless runtime element stable when it publishes context updates.
  // Otherwise each publish would rerender the runtime and publish a fresh value.
  const runtime = useMemo(() => (
    <HeavyGlobalPlayerProvider><PlayerStateBridge publish={setPlayerState} /></HeavyGlobalPlayerProvider>
  ), []);
  
  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const idleId = requestIdleCallback(() => setShouldHydrate(true), { timeout: 500 });
      return () => cancelIdleCallback(idleId);
    } else {
      const timerId = setTimeout(() => setShouldHydrate(true), 200);
      return () => clearTimeout(timerId);
    }
  }, []);
  
  // The page stays under this exact provider from first paint onwards. Swapping
  // its ancestor for Suspense/HeavyProvider previously remounted the whole page,
  // recreated the LCP image, lost typed state and restarted deferred requests.
  return (
    <GlobalPlayerContext.Provider value={playerState}>
      {children}
      {shouldHydrate && <Suspense fallback={null}>{runtime}</Suspense>}
    </GlobalPlayerContext.Provider>
  );
}

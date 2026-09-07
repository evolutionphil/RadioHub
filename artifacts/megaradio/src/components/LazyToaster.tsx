import { lazy, Suspense, useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';

const ToastRuntime = lazy(() => import('@/components/ui/toaster').then(module => ({ default: module.Toaster })));

/** Keep Radix's toast runtime off the startup request chain. The toast store
 * retains the first message while the chunk loads; once mounted, keep the
 * runtime alive for close animations, focus restoration and later messages. */
export function LazyToaster() {
  const { toasts } = useToast();
  const hasOpenToast = toasts.some(toast => toast.open !== false);
  const [hasOpened, setHasOpened] = useState(hasOpenToast);
  useEffect(() => {
    if (hasOpenToast) setHasOpened(true);
  }, [hasOpenToast]);
  if (!hasOpened && !hasOpenToast) return null;
  return <Suspense fallback={null}><ToastRuntime /></Suspense>;
}

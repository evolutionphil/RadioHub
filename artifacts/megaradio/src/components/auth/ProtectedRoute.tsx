import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { getBrowserLanguage } from '@/lib/browser-language';
import { withAuthReturnTo, safeAuthReturnTo } from '@/lib/safe-auth-return';
import { isTransientAuthError } from '@/lib/auth-query';
import { useTranslation } from '@/hooks/useTranslation';

interface ProtectedRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
  showToast?: boolean;
}

export function ProtectedRoute({ 
  children, 
  redirectTo,
  showToast = true 
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, error } = useAuth();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const transientError = !!error && isTransientAuthError(error);
  // Use the actual entry URL, not a translation-provider state that can still
  // be catching up during navigation. Keep the full safe path/query/hash.
  const loginUrl = withAuthReturnTo(
    safeAuthReturnTo(redirectTo) || `/${getBrowserLanguage()}/login`,
    window.location.pathname + window.location.search + window.location.hash,
  );

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !transientError) {
      if (showToast) {
        toast({
          title: t('auth_required', 'Authentication Required'),
          description: t('auth_required_description', 'Please log in to access this page.'),
          variant: "destructive"
        });
      }
      
      // Redirect to login page
      setLocation(loginUrl);
    }
  }, [isAuthenticated, isLoading, transientError, loginUrl, setLocation, showToast, toast, t]);

  if (transientError) return <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#0E0E0E] text-white">
    <p>{t('auth_temporarily_unavailable', 'Your account could not be checked. Please try again.')}</p>
    <button className="rounded border border-white/30 px-4 py-2" onClick={() => window.location.reload()}>{t('retry', 'Try again')}</button>
  </div>;

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0E0E0E]">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto" />
          <p className="text-gray-400">Checking authentication...</p>
        </div>
      </div>
    );
  }

  // If not authenticated, return null (redirect happens in useEffect)
  if (!isAuthenticated) {
    return null;
  }

  // If authenticated, render the protected content
  return <>{children}</>;
}

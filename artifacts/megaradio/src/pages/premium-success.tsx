import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, Crown, Sparkles, Loader2, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

export default function PremiumSuccessPage() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const [verified, setVerified] = useState<boolean | null>(null);

  // Invalidate cache immediately, then poll until subscription shows active
  // (webhook may arrive a few seconds after the Paddle redirect).
  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 10;

    async function poll() {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      await queryClient.refetchQueries({ queryKey: ["/api/auth/me"] });
      const me = queryClient.getQueryData<any>(["/api/auth/me"]);
      if (me?.subscription?.isActive) {
        setVerified(true);
        return;
      }
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(poll, 2000);
      } else {
        // After 20s still not active — webhook may be delayed; show neutral state
        setVerified(false);
      }
    }

    poll();
  }, [queryClient]);

  const sub = (user as any)?.subscription;
  const isActive = sub?.isActive === true;

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      {/* Gradient blobs */}
      <div className="fixed -top-32 -left-32 w-96 h-96 rounded-full bg-[#FF4199]/15 blur-[120px] pointer-events-none" />
      <div className="fixed -bottom-32 -right-32 w-96 h-96 rounded-full bg-[#9B59B6]/15 blur-[120px] pointer-events-none" />

      <div className="relative text-center space-y-6 max-w-sm">
        {/* Icon */}
        <div className="relative mx-auto w-20 h-20">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#FF4199] to-[#FF6B35] flex items-center justify-center shadow-2xl shadow-[#FF4199]/40">
            <Crown className="w-10 h-10 text-white" />
          </div>
          {isActive && (
            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-green-500 flex items-center justify-center border-2 border-[#0a0a0a]">
              <CheckCircle className="w-4 h-4 text-white" />
            </div>
          )}
        </div>

        {/* Text — depends on verification state */}
        {authLoading || verified === null ? (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 text-[#FF4199] animate-spin" />
              <p className="text-gray-400">Verifying your subscription…</p>
            </div>
          </div>
        ) : isActive ? (
          <div className="space-y-2">
            <h1 className="text-3xl font-extrabold text-white">Welcome to Premium!</h1>
            <p className="text-gray-400">
              Your subscription is active. Enjoy ad-free radio across all your devices.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-white">Payment received</h1>
            <div className="flex items-center gap-2 justify-center text-amber-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm">Your account is being updated — this usually takes under a minute. Refresh if it doesn't activate soon.</p>
            </div>
          </div>
        )}

        {/* Benefits — only when confirmed active */}
        {isActive && (
          <div className="bg-white/5 rounded-2xl border border-white/10 p-4 space-y-2.5 text-left">
            {[
              "Ad-free listening enabled",
              "HD streams unlocked",
              "All devices synced",
            ].map(b => (
              <div key={b} className="flex items-center gap-2.5 text-sm text-gray-300">
                <Sparkles className="w-4 h-4 text-[#FF4199] flex-shrink-0" />
                {b}
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <Button
          className="w-full h-12 text-base font-bold rounded-2xl bg-gradient-to-r from-[#FF4199] to-[#FF6B35] hover:opacity-90 border-0 text-white shadow-lg shadow-[#FF4199]/30"
          onClick={() => setLocation("/")}
        >
          {isActive ? "Start Listening" : "Go to Home"}
        </Button>

        {!isActive && verified === false && (
          <p className="text-xs text-gray-600">
            If your account doesn't update within a few minutes, contact support.
          </p>
        )}
      </div>
    </div>
  );
}

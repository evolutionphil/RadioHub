import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Tv, Loader2 } from "lucide-react";
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { subscriptionCopy } from '@/lib/subscription-copy';

export default function ActivateSuccessPage() {
  const params = new URLSearchParams(window.location.search);
  const tvCode = params.get("code") || "";
  const { language } = useTranslation();
  const copy = subscriptionCopy(language);
  const [started, setStarted] = useState(Date.now);
  const validCode = /^\d{6}$/.test(tvCode);
  const status = useQuery<{ status: string }>({
    queryKey: ['/api/subscription/tv/code/status', tvCode],
    queryFn: async ({ signal }) => (await apiRequest('GET', `/api/subscription/tv/code/${encodeURIComponent(tvCode)}/status?deviceId=web-activate`, { signal })).json(),
    enabled: validCode,
    staleTime: 0,
    retry: false,
    refetchInterval: query => query.state.data?.status === 'activated' || Date.now() - started > 30_000 ? false : 1500,
  });
  const active = validCode && !status.isError && status.data?.status === 'activated';

  return (
    <div className="min-h-screen bg-[#0E0E0E] flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-[#1a1a1a] border-[#333] text-white text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <div className="relative">
              <Tv className="w-12 h-12 text-[#FF6B35]" />
              {active && <CheckCircle className="w-6 h-6 text-green-400 absolute -bottom-1 -right-1 bg-[#1a1a1a] rounded-full" />}
            </div>
          </div>
          <CardTitle className="text-2xl text-green-400">{active ? copy.active : copy.checking}</CardTitle>
          <CardDescription className="text-gray-400">
            {active ? copy.broadcastAds : copy.pending}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {tvCode && (
            <div className="bg-[#0E0E0E] rounded-lg p-4">
              <p className="text-sm text-gray-400 mb-1">TV</p>
              <p className="text-3xl font-mono font-bold tracking-widest text-[#FF6B35]">{tvCode}</p>
            </div>
          )}

          {active && <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 text-sm text-green-300 space-y-2">
            <p>✓ Your TV will detect the subscription automatically</p>
            <p>✓ If it doesn't update in 30 seconds, restart the app</p>
            <p>✓ Your subscription works on all platforms</p>
          </div>}
          {!active && validCode && <Button variant="outline" disabled={status.isFetching} onClick={() => { setStarted(Date.now()); void status.refetch(); }}>{copy.retry}</Button>}

          <div className="space-y-3">
            <Button
              className="w-full bg-[#FF6B35] hover:bg-[#e55a24] text-white"
              onClick={() => window.location.href = `/${language}`}
            >
              Go to Mega Radio
            </Button>
            <p className="text-xs text-gray-500">
              You can safely close this page and return to your TV.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

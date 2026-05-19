import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, RefreshCw, Tv } from "lucide-react";

const PLATFORMS = ['tizen', 'webos', 'tvos', 'androidtv', 'macos', 'desktop', 'ios', 'android', 'web'] as const;
type Platform = typeof PLATFORMS[number];

interface TvVersionConfig {
  latest: Record<string, string>;
  minimum: Record<string, string>;
  releaseNotes: Record<string, string>;
  storeUrl: Record<string, string>;
  updatedAt?: string;
  _isDefault?: boolean;
}

const EMPTY_CONFIG: TvVersionConfig = {
  latest: {},
  minimum: {},
  releaseNotes: { tr: '', en: '' },
  storeUrl: {},
};

export default function TvVersionPage() {
  const { toast } = useToast();
  const [config, setConfig] = useState<TvVersionConfig>(EMPTY_CONFIG);

  const { data, isLoading, refetch } = useQuery<TvVersionConfig>({
    queryKey: ['/api/admin/tv-version'],
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (data) setConfig(data);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (cfg: TvVersionConfig) => {
      const r = await apiRequest('PUT', '/api/admin/tv-version', { body: cfg });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: 'Saved', description: 'TV version config updated.' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/tv-version'] });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err?.message ?? 'Save failed', variant: 'destructive' });
    },
  });

  function setLatest(platform: string, value: string) {
    setConfig((c) => ({ ...c, latest: { ...c.latest, [platform]: value } }));
  }
  function setMinimum(platform: string, value: string) {
    setConfig((c) => ({ ...c, minimum: { ...c.minimum, [platform]: value } }));
  }
  function setStoreUrl(platform: string, value: string) {
    setConfig((c) => ({ ...c, storeUrl: { ...c.storeUrl, [platform]: value } }));
  }
  function setNote(lang: string, value: string) {
    setConfig((c) => ({ ...c, releaseNotes: { ...c.releaseNotes, [lang]: value } }));
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Tv className="w-6 h-6" />
          <div>
            <h1 className="text-2xl font-bold">TV / App Version Config</h1>
            <p className="text-sm text-muted-foreground">
              Manages <code>/api/tv/version</code>. Changes apply immediately without a code deploy.
              {data?.updatedAt && (
                <span className="ml-2">Last saved: {new Date(data.updatedAt).toLocaleString()}</span>
              )}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Version numbers */}
      <Card>
        <CardHeader>
          <CardTitle>Version Numbers</CardTitle>
          <CardDescription>
            <strong>Latest</strong>: soft update banner shown to clients below this version.{' '}
            <strong>Minimum</strong>: forced modal shown — only set for breaking changes, leave blank otherwise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-[120px_1fr_1fr] gap-x-4 gap-y-3 items-center">
            <div className="text-xs font-medium text-muted-foreground uppercase">Platform</div>
            <div className="text-xs font-medium text-muted-foreground uppercase">Latest (required)</div>
            <div className="text-xs font-medium text-muted-foreground uppercase">Minimum (optional)</div>
            {PLATFORMS.map((p) => (
              <>
                <Label key={`lbl-${p}`} className="font-mono text-sm">{p}</Label>
                <Input
                  key={`lat-${p}`}
                  value={config.latest[p] ?? ''}
                  onChange={(e) => setLatest(p, e.target.value)}
                  placeholder="e.g. 1.0.3"
                  className="h-8 font-mono text-sm"
                />
                <Input
                  key={`min-${p}`}
                  value={config.minimum[p] ?? ''}
                  onChange={(e) => setMinimum(p, e.target.value)}
                  placeholder="leave blank"
                  className="h-8 font-mono text-sm"
                />
              </>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Store URLs */}
      <Card>
        <CardHeader>
          <CardTitle>Store URLs</CardTitle>
          <CardDescription>
            Shown as "Go to Store" button in the update banner. Leave blank to hide the button for that platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {PLATFORMS.map((p) => (
            <div key={p} className="flex items-center gap-3">
              <Label className="w-24 font-mono text-sm shrink-0">{p}</Label>
              <Input
                value={config.storeUrl[p] ?? ''}
                onChange={(e) => setStoreUrl(p, e.target.value)}
                placeholder="https://..."
                className="h-8 text-sm"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Release notes */}
      <Card>
        <CardHeader>
          <CardTitle>Release Notes</CardTitle>
          <CardDescription>Short text shown in the update banner. Leave blank to use the client's default text.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {['tr', 'en'].map((lang) => (
            <div key={lang} className="flex items-start gap-3">
              <Label className="w-24 font-mono text-sm pt-2 shrink-0">{lang}</Label>
              <Input
                value={config.releaseNotes[lang] ?? ''}
                onChange={(e) => setNote(lang, e.target.value)}
                placeholder={lang === 'tr' ? 'Türkçe not…' : 'English note…'}
                className="h-8 text-sm"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate(config)}
          disabled={saveMutation.isPending}
          className="min-w-32"
        >
          {saveMutation.isPending ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
          ) : (
            <><Save className="w-4 h-4 mr-2" /> Save Config</>
          )}
        </Button>
      </div>
    </div>
  );
}

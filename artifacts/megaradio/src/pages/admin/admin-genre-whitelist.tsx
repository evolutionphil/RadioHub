import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Trash2, Plus, Search, AlertCircle } from "lucide-react";

interface AliasEntry {
  source: string;
  canonical: string;
}

interface OverrideEntry {
  kind: 'slug-add' | 'slug-remove' | 'alias-add' | 'alias-remove';
  slug: string;
  canonical: string | null;
  createdBy: string;
  createdAt: string;
  notes: string;
}

interface WhitelistResponse {
  slugs: string[];
  aliases: AliasEntry[];
  seed: { slugCount: number; aliasCount: number };
  overrides: OverrideEntry[];
  lastRefreshAt: string | null;
}

const SLUG_HINT = 'Lowercase letters/digits with single hyphens (e.g. "lo-fi-hip-hop").';

export default function AdminGenreWhitelist() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newSlug, setNewSlug] = useState("");
  const [newAliasSource, setNewAliasSource] = useState("");
  const [newAliasCanonical, setNewAliasCanonical] = useState("");
  const [slugFilter, setSlugFilter] = useState("");
  const [aliasFilter, setAliasFilter] = useState("");

  const { data, isLoading, error } = useQuery<WhitelistResponse>({
    queryKey: ['/api/admin/genre-whitelist'],
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['/api/admin/genre-whitelist'] });

  const addSlug = useMutation({
    mutationFn: async (slug: string) => {
      const res = await apiRequest('POST', '/api/admin/genre-whitelist/slugs', {
        body: { slug },
      });
      return res.json();
    },
    onSuccess: () => {
      setNewSlug("");
      toast({ title: "Slug added", description: "Sitemap rebuild queued — search engines will be pinged shortly." });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add slug", description: err.message, variant: "destructive" });
    },
  });

  const removeSlug = useMutation({
    mutationFn: async (slug: string) => {
      const res = await apiRequest('DELETE', `/api/admin/genre-whitelist/slugs/${encodeURIComponent(slug)}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Slug removed", description: "Sitemap rebuild queued — search engines will be pinged shortly." });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove slug", description: err.message, variant: "destructive" });
    },
  });

  const addAlias = useMutation({
    mutationFn: async (payload: { source: string; canonical: string }) => {
      const res = await apiRequest('POST', '/api/admin/genre-whitelist/aliases', {
        body: payload,
      });
      return res.json();
    },
    onSuccess: () => {
      setNewAliasSource("");
      setNewAliasCanonical("");
      toast({ title: "Alias added", description: "Sitemap rebuild queued — search engines will be pinged shortly." });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add alias", description: err.message, variant: "destructive" });
    },
  });

  const removeAlias = useMutation({
    mutationFn: async (source: string) => {
      const res = await apiRequest('DELETE', `/api/admin/genre-whitelist/aliases/${encodeURIComponent(source)}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Alias removed", description: "Sitemap rebuild queued — search engines will be pinged shortly." });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove alias", description: err.message, variant: "destructive" });
    },
  });

  const overrideBySlug = useMemo(() => {
    const map = new Map<string, OverrideEntry>();
    for (const o of data?.overrides ?? []) {
      map.set(`${o.kind}:${o.slug}`, o);
    }
    return map;
  }, [data?.overrides]);

  const filteredSlugs = useMemo(() => {
    const q = slugFilter.trim().toLowerCase();
    if (!q) return data?.slugs ?? [];
    return (data?.slugs ?? []).filter((s) => s.includes(q));
  }, [data?.slugs, slugFilter]);

  const filteredAliases = useMemo(() => {
    const q = aliasFilter.trim().toLowerCase();
    if (!q) return data?.aliases ?? [];
    return (data?.aliases ?? []).filter(
      (a) => a.source.includes(q) || a.canonical.includes(q),
    );
  }, [data?.aliases, aliasFilter]);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-sm text-gray-500">Loading genre whitelist…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>Failed to load whitelist: {(error as Error).message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Genre whitelist</h1>
        <p className="text-sm text-gray-500 mt-1">
          Controls which <code>/genres/:slug</code> URLs MegaRadio publishes to search engines.
          Slugs not on the whitelist (and without an alias) are served as <code>noindex</code> and
          dropped from sitemaps. Changes take effect immediately for SSR; each mutation also
          queues a sitemap rebuild and pings IndexNow so search engines pick it up within minutes.
        </p>
        <div className="flex gap-2 mt-3 text-xs text-gray-600 flex-wrap">
          <Badge variant="outline">Seed slugs: {data.seed.slugCount}</Badge>
          <Badge variant="outline">Seed aliases: {data.seed.aliasCount}</Badge>
          <Badge variant="outline">Merged slugs: {data.slugs.length}</Badge>
          <Badge variant="outline">Merged aliases: {data.aliases.length}</Badge>
          <Badge variant="outline">Admin overrides: {data.overrides.length}</Badge>
          {data.lastRefreshAt && (
            <Badge variant="outline">
              Refreshed: {new Date(data.lastRefreshAt).toLocaleTimeString()}
            </Badge>
          )}
        </div>
      </div>

      {/* === SLUGS === */}
      <Card>
        <CardHeader>
          <CardTitle>Whitelisted slugs ({data.slugs.length})</CardTitle>
          <CardDescription>{SLUG_HINT}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const slug = newSlug.trim().toLowerCase();
              if (slug) addSlug.mutate(slug);
            }}
          >
            <Input
              placeholder="new-genre-slug"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              data-testid="input-new-slug"
            />
            <Button type="submit" disabled={addSlug.isPending} data-testid="button-add-slug">
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </form>

          <div className="relative">
            <Search className="absolute left-2 top-2.5 w-4 h-4 text-gray-400" />
            <Input
              className="pl-8"
              placeholder="Filter slugs…"
              value={slugFilter}
              onChange={(e) => setSlugFilter(e.target.value)}
              data-testid="input-slug-filter"
            />
          </div>

          <div className="border rounded max-h-96 overflow-y-auto divide-y">
            {filteredSlugs.length === 0 && (
              <div className="p-4 text-sm text-gray-500">No slugs match.</div>
            )}
            {filteredSlugs.map((slug) => {
              const adminAdded = overrideBySlug.get(`slug-add:${slug}`);
              return (
                <div
                  key={slug}
                  className="flex items-center justify-between px-3 py-2 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2">
                    <code className="text-sm">{slug}</code>
                    {adminAdded && (
                      <Badge variant="secondary" className="text-xs">
                        added by {adminAdded.createdBy}
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Remove "${slug}" from the whitelist?\n\nIt will be served as noindex and dropped from sitemaps on the next rebuild.`)) {
                        removeSlug.mutate(slug);
                      }
                    }}
                    data-testid={`button-remove-slug-${slug}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* === ALIASES === */}
      <Card>
        <CardHeader>
          <CardTitle>Aliases ({data.aliases.length})</CardTitle>
          <CardDescription>
            Source slugs that 301-redirect to a canonical whitelisted slug. The canonical must be
            on the whitelist above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex gap-2 flex-wrap"
            onSubmit={(e) => {
              e.preventDefault();
              const source = newAliasSource.trim().toLowerCase();
              const canonical = newAliasCanonical.trim().toLowerCase();
              if (source && canonical) addAlias.mutate({ source, canonical });
            }}
          >
            <Input
              className="flex-1 min-w-[180px]"
              placeholder="alias-source-slug"
              value={newAliasSource}
              onChange={(e) => setNewAliasSource(e.target.value)}
              data-testid="input-alias-source"
            />
            <span className="self-center text-gray-400">→</span>
            <Input
              className="flex-1 min-w-[180px]"
              placeholder="canonical-slug"
              value={newAliasCanonical}
              onChange={(e) => setNewAliasCanonical(e.target.value)}
              data-testid="input-alias-canonical"
            />
            <Button type="submit" disabled={addAlias.isPending} data-testid="button-add-alias">
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </form>

          <div className="relative">
            <Search className="absolute left-2 top-2.5 w-4 h-4 text-gray-400" />
            <Input
              className="pl-8"
              placeholder="Filter aliases…"
              value={aliasFilter}
              onChange={(e) => setAliasFilter(e.target.value)}
              data-testid="input-alias-filter"
            />
          </div>

          <div className="border rounded max-h-96 overflow-y-auto divide-y">
            {filteredAliases.length === 0 && (
              <div className="p-4 text-sm text-gray-500">No aliases match.</div>
            )}
            {filteredAliases.map((a) => {
              const adminAdded = overrideBySlug.get(`alias-add:${a.source}`);
              return (
                <div
                  key={a.source}
                  className="flex items-center justify-between px-3 py-2 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <code>{a.source}</code>
                    <span className="text-gray-400">→</span>
                    <code className="text-blue-700">{a.canonical}</code>
                    {adminAdded && (
                      <Badge variant="secondary" className="text-xs">
                        added by {adminAdded.createdBy}
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Remove alias "${a.source}" → "${a.canonical}"?`)) {
                        removeAlias.mutate(a.source);
                      }
                    }}
                    data-testid={`button-remove-alias-${a.source}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* === OVERRIDES AUDIT === */}
      {data.overrides.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Admin overrides ({data.overrides.length})</CardTitle>
            <CardDescription>
              Raw override rows applied on top of the static seed. Use this to audit who changed
              what.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded max-h-72 overflow-y-auto divide-y text-sm">
              {data.overrides.map((o) => (
                <div
                  key={`${o.kind}:${o.slug}`}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={o.kind.endsWith('remove') ? 'destructive' : 'default'}
                      className="text-xs"
                    >
                      {o.kind}
                    </Badge>
                    <code>{o.slug}</code>
                    {o.canonical && (
                      <>
                        <span className="text-gray-400">→</span>
                        <code className="text-blue-700">{o.canonical}</code>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {o.createdBy} · {new Date(o.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

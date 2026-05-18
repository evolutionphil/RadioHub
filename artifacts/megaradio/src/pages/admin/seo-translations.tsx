import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, CheckCircle2, XCircle, Zap, Database, Bot, Thermometer } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface LangCoverage {
  code: string;
  name: string;
  qualified: boolean;
  completedKeys: string[];
  missingKeys: string[];
  completionPct: number;
}

interface CoverageResponse {
  languages: LangCoverage[];
  totalQualified: number;
  qualifiedLangsState: {
    source: "computed" | "lkg" | "seed";
    computedAt: string;
    expiresAt: string | null;
    languages: string[];
  };
}

interface ApplyResult {
  message: string;
  inserted: number;
  skipped: number;
  durationMs: number;
}

interface RegenerateResult {
  message: string;
  generated: number;
  skipped: number;
  failed: number;
  durationMs: number;
}

interface InvalidateResult {
  message: string;
  newQualifiedCount: number;
  qualifiedLanguages: string[];
  source: string;
}

interface WarmAllResult {
  message: string;
  totalLanguages: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SeoTranslationsHub() {
  const { toast } = useToast();
  const [expandedLang, setExpandedLang] = useState<string | null>(null);

  const coverageQuery = useQuery<CoverageResponse>({
    queryKey: ["/api/admin/seo-translations/coverage"],
    staleTime: 60_000,
  });

  const applyMutation = useMutation<ApplyResult, Error>({
    mutationFn: () => apiRequest("POST", "/api/admin/seo-translations/apply").then((r) => r.json()),
    onSuccess: (data) => {
      toast({ title: "Translations applied", description: `${data.inserted} inserted, ${data.skipped} skipped (${data.durationMs}ms)` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/seo-translations/coverage"] });
    },
    onError: (e) => {
      const msg = e?.message ?? "";
      if (msg.includes("409") || msg.includes("apply_in_progress")) {
        toast({ title: "Already running", description: "Apply job is already in progress. Wait for it to finish.", variant: "destructive" });
      } else {
        toast({ title: "Apply failed", description: msg, variant: "destructive" });
      }
    },
  });

  const regenerateMutation = useMutation<RegenerateResult, Error>({
    mutationFn: () => apiRequest("POST", "/api/admin/seo-translations/regenerate").then((r) => r.json()),
    onSuccess: (data) => {
      toast({ title: "Regeneration complete", description: `${data.generated} keys generated, ${data.failed} failed` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/seo-translations/coverage"] });
    },
    onError: (e) => {
      const msg = e?.message ?? "";
      if (msg.includes("409") || msg.includes("regenerate_in_progress")) {
        toast({ title: "Already running", description: "A regeneration job is already in progress.", variant: "destructive" });
      } else {
        toast({ title: "Regeneration failed", description: msg, variant: "destructive" });
      }
    },
  });

  const invalidateMutation = useMutation<InvalidateResult, Error>({
    mutationFn: () => apiRequest("POST", "/api/admin/seo-translations/invalidate-cache").then((r) => r.json()),
    onSuccess: (data) => {
      toast({ title: "Cache invalidated", description: `${data.newQualifiedCount} / 57 languages now qualified` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/seo-translations/coverage"] });
    },
    onError: (e) => toast({ title: "Invalidate failed", description: e?.message, variant: "destructive" }),
  });

  const warmAllMutation = useMutation<WarmAllResult, Error>({
    mutationFn: () => apiRequest("POST", "/api/admin/seo-translations/warm-all").then((r) => r.json()),
    onSuccess: (data) => {
      toast({ title: "Warm-all triggered", description: data.message });
    },
    onError: (e) => toast({ title: "Warm-all failed", description: e?.message, variant: "destructive" }),
  });

  const anyPending =
    applyMutation.isPending ||
    regenerateMutation.isPending ||
    invalidateMutation.isPending ||
    warmAllMutation.isPending;

  const state = coverageQuery.data?.qualifiedLangsState;
  const langs = coverageQuery.data?.languages ?? [];
  const totalQualified = coverageQuery.data?.totalQualified ?? 0;
  const total = langs.length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SEO Translations Hub</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage the 15 required SEO keys across all 57 languages. Languages missing keys are excluded from Google indexing.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/seo-translations/coverage"] })}
          disabled={coverageQuery.isFetching}
        >
          {coverageQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {/* Qualified-languages state card */}
      {state && (
        <Card>
          <CardContent className="pt-4 pb-3 flex flex-wrap gap-4 items-center">
            <div>
              <span className="text-3xl font-bold text-green-600">{totalQualified}</span>
              <span className="text-muted-foreground ml-1 text-sm">/ {total} languages qualified for indexing</span>
            </div>
            <Badge variant="outline">source: {state.source}</Badge>
            <span className="text-xs text-muted-foreground">
              computed {state.computedAt ? new Date(state.computedAt).toLocaleString() : "—"}
              {state.expiresAt ? ` · expires ${new Date(state.expiresAt).toLocaleString()}` : ""}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Operations panel */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <OperationCard
          icon={<Database className="h-5 w-5" />}
          title="Apply Phase C Translations"
          description="Upserts the pre-generated 57×15 SEO translation JSON into MongoDB. Safe to re-run — skips keys that already have a value."
          buttonLabel="Apply Now"
          isPending={applyMutation.isPending}
          isDisabled={anyPending}
          onClick={() => applyMutation.mutate()}
          result={applyMutation.data ? `${applyMutation.data.inserted} inserted, ${applyMutation.data.skipped} skipped` : null}
          error={applyMutation.error?.message ?? null}
        />
        <OperationCard
          icon={<Bot className="h-5 w-5" />}
          title="Regenerate via AI"
          description="Calls OpenAI gpt-4o-mini for any language missing one or more of the 15 keys. Fills gaps only; does not overwrite existing values."
          buttonLabel="Regenerate Missing"
          isPending={regenerateMutation.isPending}
          isDisabled={anyPending}
          onClick={() => regenerateMutation.mutate()}
          result={regenerateMutation.data ? `${regenerateMutation.data.generated} generated, ${regenerateMutation.data.failed} failed` : null}
          error={regenerateMutation.error?.message ?? null}
        />
        <OperationCard
          icon={<Zap className="h-5 w-5" />}
          title="Invalidate QualifiedLangs Cache"
          description="Forces re-computation of which languages meet the translation quality bar. Run after applying translations so pages become indexable immediately."
          buttonLabel="Invalidate Cache"
          isPending={invalidateMutation.isPending}
          isDisabled={anyPending}
          onClick={() => invalidateMutation.mutate()}
          result={invalidateMutation.data ? `${invalidateMutation.data.newQualifiedCount} languages now qualified` : null}
          error={invalidateMutation.error?.message ?? null}
        />
        <OperationCard
          icon={<Thermometer className="h-5 w-5" />}
          title="Warm All 57 Languages"
          description="Pre-loads all 57 translation bundles into server memory (batched, 5 at a time). Prevents cold-miss latency after a server restart."
          buttonLabel="Warm All"
          isPending={warmAllMutation.isPending}
          isDisabled={anyPending}
          onClick={() => warmAllMutation.mutate()}
          result={warmAllMutation.data ? warmAllMutation.data.message : null}
          error={warmAllMutation.error?.message ?? null}
        />
      </div>

      {/* Coverage table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Per-Language Coverage</CardTitle>
          <CardDescription>15 required SEO keys per language. Click a row to see missing keys.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {coverageQuery.isLoading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              <Loader2 className="animate-spin h-6 w-6 mr-2" /> Loading…
            </div>
          ) : coverageQuery.error ? (
            <div className="p-4 text-red-500 text-sm">Failed to load coverage data</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-4 py-2 font-medium">Language</th>
                    <th className="text-left px-4 py-2 font-medium">Qualified</th>
                    <th className="text-left px-4 py-2 font-medium">Keys</th>
                    <th className="text-left px-4 py-2 font-medium w-40">Completion</th>
                    <th className="text-left px-4 py-2 font-medium">Missing</th>
                  </tr>
                </thead>
                <tbody>
                  {langs.map((lang) => {
                    const isExpanded = expandedLang === lang.code;
                    return (
                      <>
                        <tr
                          key={lang.code}
                          className="border-b hover:bg-muted/20 cursor-pointer"
                          onClick={() => setExpandedLang(isExpanded ? null : lang.code)}
                        >
                          <td className="px-4 py-2 font-mono">
                            <span className="font-semibold">{lang.code}</span>
                            <span className="ml-2 text-muted-foreground">{lang.name}</span>
                          </td>
                          <td className="px-4 py-2">
                            {lang.qualified ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-400" />
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {lang.completedKeys.length} / 15
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-2 rounded-full bg-muted flex-1 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    lang.completionPct >= 100 ? "bg-green-500" :
                                    lang.completionPct >= 70 ? "bg-yellow-400" : "bg-red-400"
                                  }`}
                                  style={{ width: `${lang.completionPct}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-8 text-right">{lang.completionPct}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground text-xs">
                            {lang.missingKeys.length === 0 ? (
                              <span className="text-green-600">✓ Complete</span>
                            ) : (
                              <span>{lang.missingKeys.length} missing</span>
                            )}
                          </td>
                        </tr>
                        {isExpanded && lang.missingKeys.length > 0 && (
                          <tr key={`${lang.code}-expanded`} className="bg-red-50 dark:bg-red-950/20">
                            <td colSpan={5} className="px-6 py-2 text-xs text-red-700 dark:text-red-300">
                              <span className="font-semibold">Missing keys: </span>
                              {lang.missingKeys.join(", ")}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── OperationCard helper ─────────────────────────────────────────────────────

function OperationCard({
  icon,
  title,
  description,
  buttonLabel,
  isPending,
  isDisabled,
  onClick,
  result,
  error,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  buttonLabel: string;
  isPending: boolean;
  isDisabled: boolean;
  onClick: () => void;
  result: string | null;
  error: string | null;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0 mt-auto">
        <Button
          size="sm"
          variant="outline"
          onClick={onClick}
          disabled={isDisabled}
          className="w-full"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {buttonLabel}
        </Button>
        {result && (
          <p className="text-xs text-green-600 font-medium">{result}</p>
        )}
        {error && (
          <p className="text-xs text-red-500 truncate" title={error}>{error}</p>
        )}
      </CardContent>
    </Card>
  );
}

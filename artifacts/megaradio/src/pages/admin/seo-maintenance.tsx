import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface HealthStats {
  country: string | null;
  total: number;
  noIndex: number;
  missing: {
    tags: number;
    languageCodes: number;
    logoAssets: number;
    descriptionTr: number;
    descriptionEn: number;
  };
  brokenStream: {
    indexableTotal: number;
    deadOver30Days: number;
  };
}

interface BackfillJob {
  jobId: string;
  startedAt: string;
  finishedAt: string | null;
  countryCode: string | null;
  scanned: number;
  updated: number;
  failed: number;
  skipped: number;
  isRunning: boolean;
  lastError: string | null;
}

function pct(n: number, total: number) {
  if (!total) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function StatRow({ label, value, total, danger }: { label: string; value: number; total: number; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-700">{label}</span>
      <span className={`text-sm font-semibold ${danger && value > 0 ? "text-rose-600" : "text-slate-900"}`}>
        {value.toLocaleString()} <span className="text-xs text-slate-500 font-normal">({pct(value, total)})</span>
      </span>
    </div>
  );
}

export default function SeoMaintenancePage() {
  const { toast } = useToast();
  const [country, setCountry] = useState("TR");
  const [tagsLimit, setTagsLimit] = useState(500);
  const [tagsCountry, setTagsCountry] = useState("TR");

  const statsQuery = useQuery<HealthStats>({
    queryKey: ["/api/admin/seo-health-stats", country],
    queryFn: async () => {
      const res = await fetch(`/api/admin/seo-health-stats?country=${encodeURIComponent(country)}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const tagsJobQuery = useQuery<{ job: BackfillJob | null }>({
    queryKey: ["/api/admin/maintenance/tags-backfill/status"],
    refetchInterval: (q) => (q.state.data?.job?.isRunning ? 2000 : false),
  });

  const startTags = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/maintenance/tags-backfill", {
        country: tagsCountry || null,
        limit: tagsLimit,
      });
    },
    onSuccess: () => {
      toast({ title: "Tags backfill başlatıldı" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/maintenance/tags-backfill/status"] });
    },
    onError: (e: any) => {
      toast({ title: "Başlatılamadı", description: e?.message || "", variant: "destructive" });
    },
  });

  const startLogos = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/logos/process-all", {}),
    onSuccess: () => toast({ title: "Logo backfill başlatıldı" }),
    onError: (e: any) => toast({ title: "Başlatılamadı", description: e?.message || "", variant: "destructive" }),
  });

  const stats = statsQuery.data;
  const job = tagsJobQuery.data?.job;

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">SEO Maintenance</h1>
        <p className="text-sm text-slate-600 mt-1">İçerik eksiklikleri, bozuk stream'ler ve indexability kuralları için kontrol paneli.</p>
      </div>

      {/* Country filter */}
      <Card className="bg-white">
        <CardContent className="pt-4 flex items-end gap-3">
          <div>
            <label className="text-xs text-slate-600 mb-1 block">Ülke kodu (boş = global)</label>
            <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} className="w-24" />
          </div>
          <Button variant="outline" onClick={() => statsQuery.refetch()} disabled={statsQuery.isFetching}>
            {statsQuery.isFetching ? "Yükleniyor..." : "Yenile"}
          </Button>
        </CardContent>
      </Card>

      {/* Health stats */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-base">
            SEO sağlık özeti{stats?.country ? ` — ${stats.country}` : " (global)"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statsQuery.isLoading && <div className="text-sm text-slate-500">Yükleniyor...</div>}
          {statsQuery.error && <div className="text-sm text-rose-600">İstatistikler alınamadı.</div>}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Genel</div>
                <StatRow label="Toplam radyo" value={stats.total} total={stats.total} />
                <StatRow label="noIndex=true (junk)" value={stats.noIndex} total={stats.total} />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">İçerik eksikliği</div>
                <StatRow label="TR description (full) eksik" value={stats.missing.descriptionTr} total={stats.total} danger />
                <StatRow label="EN description (full) eksik" value={stats.missing.descriptionEn} total={stats.total} danger />
                <StatRow label="tags eksik" value={stats.missing.tags} total={stats.total} danger />
                <StatRow label="languageCodes eksik" value={stats.missing.languageCodes} total={stats.total} />
                <StatRow label="logoAssets eksik" value={stats.missing.logoAssets} total={stats.total} danger />
              </div>
              <div className="md:col-span-2 mt-4 pt-4 border-t border-slate-200">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Bozuk stream durumu</div>
                <StatRow label="lastCheckOk=false ama indexable" value={stats.brokenStream.indexableTotal} total={stats.total} danger />
                <StatRow label="↳ Son 30 gün içinde recover etmemiş (junk gate yakalar)" value={stats.brokenStream.deadOver30Days} total={stats.total} danger />
                {stats.brokenStream.deadOver30Days > 0 && (
                  <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    Junk-station-rules güncellemesi yayına alındıktan sonra bu {stats.brokenStream.deadOver30Days} kayıt
                    SSR'da otomatik 410 Gone dönecek.
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Logo backfill */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-base">Logo backfill (S3)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            <code>logoAssets</code> eksik olan radyolar için S3 logo pipeline'ını manuel tetikler. Aynı endpoint <code>/api/admin/logos</code> sayfasında da var.
          </p>
          <Button onClick={() => startLogos.mutate()} disabled={startLogos.isPending}>
            {startLogos.isPending ? "Başlatılıyor..." : "Logo işlemeyi başlat"}
          </Button>
        </CardContent>
      </Card>

      {/* Tags backfill */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-base">Tags + languageCodes backfill (Radio-Browser)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            <code>tags</code> alanı boş olan radyolar için Radio-Browser API'den <code>tags</code> ve <code>languageCodes</code> alanlarını yeniden çeker. Outro şablonundaki <code>{"{GENRES}"}</code> interpolation'ı için kritik.
          </p>
          <div className="flex items-end gap-3">
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Ülke (boş = global)</label>
              <Input value={tagsCountry} onChange={(e) => setTagsCountry(e.target.value.toUpperCase().slice(0, 2))} className="w-24" />
            </div>
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Limit (max 5000)</label>
              <Input
                type="number"
                value={tagsLimit}
                onChange={(e) => setTagsLimit(Math.max(1, Math.min(5000, parseInt(e.target.value) || 500)))}
                className="w-32"
              />
            </div>
            <Button
              onClick={() => startTags.mutate()}
              disabled={startTags.isPending || job?.isRunning}
            >
              {job?.isRunning ? "Çalışıyor..." : startTags.isPending ? "Başlatılıyor..." : "Tags backfill başlat"}
            </Button>
          </div>
          {job && (
            <div className="border border-slate-200 rounded p-3 bg-slate-50 text-sm space-y-1 mt-3">
              <div className="flex items-center gap-2">
                <Badge variant={job.isRunning ? "default" : "secondary"}>
                  {job.isRunning ? "ÇALIŞIYOR" : "TAMAMLANDI"}
                </Badge>
                <span className="text-xs text-slate-500">
                  Job: {job.jobId} {job.countryCode ? `· ${job.countryCode}` : ""}
                </span>
              </div>
              <div>Taranan: <strong>{job.scanned}</strong></div>
              <div>Güncellenen: <strong className="text-emerald-600">{job.updated}</strong></div>
              <div>Atlanan (Radio-Browser'da da boş): {job.skipped}</div>
              <div>Başarısız: <span className="text-rose-600">{job.failed}</span></div>
              {job.lastError && (
                <div className="text-xs text-rose-600 mt-1">Son hata: {job.lastError}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

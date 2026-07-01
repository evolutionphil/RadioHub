import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Image, RefreshCw, Play, Square, CheckCircle, XCircle, Clock, Loader2, ChevronLeft, ChevronRight, AlertTriangle, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface LogoStats {
  totalStations: number;
  stationsWithFavicon: number;
  stationsWithSlug: number;
  stationsWithLogoAssets: number;
  stationsFailed: number;
  stationsNeedingProcessing: number;
  stationsWithoutLogo: number;
  stationsNoFavicon: number;
  processingComplete: boolean;
  s3Configured: boolean;
}

interface MissingLogoStation {
  _id: string;
  name: string;
  slug: string;
  favicon: string | null;
  country: string | null;
  countryCode: string | null;
  logoStatus: 'completed' | 'pending' | 'processing' | 'failed' | 'no_favicon';
  logoError: string | null;
  updatedAt: string;
}

type MissingFilter = 'any' | 'failed' | 'pending' | 'no_favicon';

type FailureType = 'any' | 'http_error' | 'timeout' | 'invalid_format' | 'download_failed' | 'processing_failed' | 'unknown';

interface FailedLogoRow {
  _id: string;
  name: string;
  countryCode: string | null;
  favicon: string | null;
  error: string | null;
  failureType: string;
  lastAttempt: string | null;
}

interface FailedLogsResponse {
  totalFailed: number;
  countsByType: Record<string, number>;
  rows: FailedLogoRow[];
}

interface StorageHealth {
  s3Configured: boolean;
  s3Reachable: boolean | null;
  s3Count: number;
  localCount: number;
  mismatch: boolean;
  sampleS3Url: string | null;
  sampleLocalPath: string | null;
}

interface StationResult {
  stationId: string;
  stationName: string;
  status: 'success' | 'failed';
  error?: string;
}

interface LogoJob {
  jobId: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'lost';
  total: number;
  processed: number;
  successful: number;
  failed: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
  message?: string;
  results?: StationResult[];
}

interface OptimizedStation {
  _id: string;
  name: string;
  slug: string;
  logoAssets?: {
    folder: string;
    webp96?: string;
    webp256?: string;
    webp48?: string;
    status: 'completed' | 'pending' | 'processing' | 'failed';
  };
}

export default function LogoManagement() {
  const { toast } = useToast();
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [showFailedModal, setShowFailedModal] = useState(false);
  const [showOptimizedModal, setShowOptimizedModal] = useState(false);
  const [optimizedPage, setOptimizedPage] = useState(1);
  const [showMissingModal, setShowMissingModal] = useState(false);
  const [missingPage, setMissingPage] = useState(1);
  const [missingFilter, setMissingFilter] = useState<MissingFilter>('any');
  const [missingCountry, setMissingCountry] = useState('');
  const [failureFilter, setFailureFilter] = useState<FailureType>('any');

  const { data: storageHealth } = useQuery<StorageHealth>({
    queryKey: ['/api/admin/logos/storage-health'],
    refetchInterval: 60_000,
  });

  const { data: failedLogs, refetch: refetchFailed } = useQuery<FailedLogsResponse>({
    queryKey: ['/api/admin/logos/failed', failureFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '200' });
      if (failureFilter !== 'any') params.set('failureType', failureFilter);
      const r = await fetch(`/api/admin/logos/failed?${params}`);
      if (!r.ok) throw new Error('Failed to load');
      return r.json();
    },
  });

  const retryOneMutation = useMutation({
    mutationFn: async (stationId: string) => {
      const r = await apiRequest('POST', `/api/admin/logos/retry/${stationId}`);
      return r.json();
    },
    onSuccess: (data: any) => {
      if (data?.success) {
        toast({ title: 'Logo retried', description: 'Station logo reprocessed.' });
      } else {
        toast({
          title: 'Retry failed',
          description: data?.error || 'Unknown error',
          variant: 'destructive',
        });
      }
      refetchFailed();
      refetchStats();
    },
    onError: (e: any) => {
      toast({ title: 'Retry failed', description: e?.message || 'Network error', variant: 'destructive' });
    },
  });

  const { data: activeJobData } = useQuery<{ hasActiveJob: boolean; job?: LogoJob }>({
    queryKey: ['/api/admin/logos/active-job'],
    refetchInterval: currentJobId ? false : 5000,
  });

  useEffect(() => {
    if (activeJobData?.hasActiveJob && activeJobData.job && !currentJobId) {
      setCurrentJobId(activeJobData.job.jobId);
    }
  }, [activeJobData, currentJobId]);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<LogoStats>({
    queryKey: ['/api/admin/logos/stats'],
    refetchInterval: currentJobId ? 5000 : false
  });

  const { data: jobStatus, refetch: refetchJob } = useQuery<LogoJob>({
    queryKey: ['/api/admin/logos/job-status', currentJobId],
    enabled: !!currentJobId,
    refetchInterval: currentJobId ? 2000 : false
  });

  const { data: optimizedStations, isLoading: optimizedLoading, isFetching: optimizedFetching } = useQuery<{ stations: OptimizedStation[]; total: number }>({
    queryKey: ['/api/admin/logos/optimized', { page: optimizedPage }],
    enabled: showOptimizedModal,
    staleTime: 30000,
    refetchOnWindowFocus: false
  });

  const missingQueryString = (() => {
    const params = new URLSearchParams({
      page: String(missingPage),
      limit: '50',
      status: missingFilter,
    });
    if (missingCountry.trim()) params.set('countryCode', missingCountry.trim().toUpperCase());
    return params.toString();
  })();

  const { data: missingStations, isLoading: missingLoading, isFetching: missingFetching } = useQuery<{
    stations: MissingLogoStation[];
    total: number;
    totalPages: number;
    page: number;
  }>({
    queryKey: ['/api/admin/logos/missing', missingQueryString],
    queryFn: async () => {
      const r = await apiRequest('GET', `/api/admin/logos/missing?${missingQueryString}`);
      return r.json();
    },
    enabled: showMissingModal,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  const [showReprocessConfirm, setShowReprocessConfirm] = useState(false);

  const startProcessingMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/admin/logos/process-all', { body: { limit: 1000 } });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success && data.jobId) {
        setCurrentJobId(data.jobId);
        toast({
          title: "Logo processing started",
          description: `Processing ${data.totalToProcess} station logos...`
        });
      } else {
        toast({
          title: data.message || "Info",
          variant: data.success ? "default" : "destructive"
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const reprocessAllMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/admin/logos/reprocess-all', {});
      return response.json();
    },
    onSuccess: (data) => {
      setShowReprocessConfirm(false);
      if (data.success && data.jobId) {
        setCurrentJobId(data.jobId);
        toast({
          title: "Full reprocessing started",
          description: `Reprocessing ALL ${data.totalToProcess} station logos from scratch...`
        });
      } else {
        toast({
          title: data.message || "Info",
          variant: data.success ? "default" : "destructive"
        });
      }
    },
    onError: (error: Error) => {
      setShowReprocessConfirm(false);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const retryAllFailedMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/admin/logos/retry-all-failed', {});
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: "Retrying all failed logos",
          description: `Reset ${data.reset} failed logo(s) — reprocessing now (incl. http_error / invalid_format).`,
        });
        refetchStats();
      } else {
        toast({ title: data.message || "Info", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const cancelJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiRequest('POST', `/api/admin/logos/job/${jobId}/cancel`, {});
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Job cancelled",
        description: "Logo processing has been stopped"
      });
      setCurrentJobId(null);
      refetchStats();
    }
  });

  useEffect(() => {
    if (jobStatus?.status === 'completed' || jobStatus?.status === 'failed' || jobStatus?.status === 'cancelled' || jobStatus?.status === 'lost') {
      setTimeout(() => {
        setCurrentJobId(null);
        refetchStats();
      }, 3000);
    }
  }, [jobStatus?.status]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <Badge className="bg-blue-500" data-testid="badge-status-running"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
      case 'completed':
        return <Badge className="bg-green-500" data-testid="badge-status-completed"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>;
      case 'failed':
        return <Badge className="bg-red-500" data-testid="badge-status-failed"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case 'cancelled':
        return <Badge className="bg-yellow-500" data-testid="badge-status-cancelled"><Square className="w-3 h-3 mr-1" />Cancelled</Badge>;
      case 'lost':
        return <Badge className="bg-gray-500" data-testid="badge-status-lost"><XCircle className="w-3 h-3 mr-1" />Lost (Server Restarted)</Badge>;
      default:
        return <Badge data-testid="badge-status-unknown">{status}</Badge>;
    }
  };

  // `total` is a snapshot taken when the job starts (count of stations needing
  // processing). The worker keeps sweeping until the queue drains, so `processed`
  // can exceed that initial estimate (transient re-queues / churn) — which used
  // to render as ">100%" (e.g. 2529/1558 = 162%). Clamp the bar to 100% and show
  // the effective total as max(total, processed) so the readout stays sensible.
  const effectiveTotal = jobStatus ? Math.max(jobStatus.total, jobStatus.processed) : 0;
  const progressPercent = effectiveTotal > 0 && jobStatus ? Math.min(100, Math.round((jobStatus.processed / effectiveTotal) * 100)) : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Image className="w-6 h-6" />
            Logo Management
          </h1>
          <p className="text-muted-foreground">Optimize station logos for better performance</p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => refetchStats()}
          disabled={statsLoading}
          data-testid="button-refresh-stats"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${statsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {stats && (
        <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium ${stats.s3Configured ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-300 text-red-800'}`}>
          {stats.s3Configured ? (
            <CheckCircle className="w-4 h-4 shrink-0 text-green-600" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
          )}
          {stats.s3Configured
            ? 'S3 configured — logos are uploaded to S3 and served from your bucket.'
            : 'S3 NOT configured (AWS_BUCKET_NAME / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY missing). Logos are saved to local disk only and will be lost on Railway redeploy. Set the env vars in Railway and run "Reprocess All Logos".'}
        </div>
      )}

      {storageHealth && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Image className="w-4 h-4" />
              Storage Health (verified)
            </CardTitle>
            <CardDescription className="text-xs">
              Where processed logos actually live right now. A non-zero "Local" count when
              S3 is configured means some stations have stale local-only logos that should be reprocessed.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Logos on S3</p>
              <p className="text-xl font-bold text-blue-600">{storageHealth.s3Count.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Logos on Local Disk</p>
              <p className={`text-xl font-bold ${storageHealth.localCount > 0 && storageHealth.s3Configured ? 'text-orange-600' : 'text-gray-700'}`}>
                {storageHealth.localCount.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">S3 reachable?</p>
              <p className="text-sm font-medium">
                {storageHealth.s3Reachable === true && <span className="text-green-600">Yes (HEAD 200)</span>}
                {storageHealth.s3Reachable === false && <span className="text-red-600">No (HEAD failed)</span>}
                {storageHealth.s3Reachable === null && <span className="text-gray-500">N/A (no S3 logos to probe)</span>}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Mixed-mode?</p>
              <p className="text-sm font-medium">
                {storageHealth.mismatch
                  ? <span className="text-orange-600">⚠️ Both S3 and local logos exist</span>
                  : <span className="text-green-600">No</span>}
              </p>
            </div>
            {storageHealth.sampleS3Url && (
              <div className="col-span-2 md:col-span-4 text-xs text-gray-500 truncate">
                Sample S3 URL: <a href={storageHealth.sampleS3Url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{storageHealth.sampleS3Url}</a>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Stations</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-total-stations">
              {stats?.totalStations?.toLocaleString() ?? '-'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>With Favicon URL</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-with-favicon">
              {stats?.stationsWithFavicon?.toLocaleString() ?? '-'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>With Slug</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-with-slug">
              {stats?.stationsWithSlug?.toLocaleString() ?? '-'}
            </p>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:shadow-lg hover:border-green-500 transition-all"
          onClick={() => setShowOptimizedModal(true)}
          data-testid="card-optimized-logos"
        >
          <CardHeader className="pb-2">
            <CardDescription>Optimized Logos</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600" data-testid="text-optimized">
              {stats?.stationsWithLogoAssets?.toLocaleString() ?? '-'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Need Processing</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-orange-600" data-testid="text-need-processing">
              {stats?.stationsNeedingProcessing?.toLocaleString() ?? '-'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failed</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">
              {stats?.stationsFailed?.toLocaleString() ?? '-'}
            </p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-lg hover:border-amber-500 transition-all"
          onClick={() => { setShowMissingModal(true); setMissingPage(1); }}
          data-testid="card-missing-logos"
        >
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Logo Eksik
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-600" data-testid="text-missing-logo">
              {stats?.stationsWithoutLogo?.toLocaleString() ?? '-'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.stationsNoFavicon?.toLocaleString() ?? 0} favicon yok
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bulk Logo Processing</CardTitle>
          <CardDescription>
            Download and optimize logos from favicon URLs. Creates WebP images at 48px, 96px, and 256px.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {jobStatus && currentJobId ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getStatusBadge(jobStatus.status)}
                  <span className="text-sm text-muted-foreground">
                    Job: {jobStatus.jobId}
                  </span>
                </div>
                {jobStatus.status === 'running' && (
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={() => cancelJobMutation.mutate(currentJobId)}
                    disabled={cancelJobMutation.isPending}
                    data-testid="button-cancel-job"
                  >
                    <Square className="w-4 h-4 mr-2" />
                    Cancel
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress: {jobStatus.processed} / {Math.max(jobStatus.total, jobStatus.processed)}</span>
                  <span>{progressPercent}%</span>
                </div>
                <Progress value={progressPercent} className="h-2" data-testid="progress-bar" />
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-lg font-semibold text-green-600" data-testid="text-successful">{jobStatus.successful}</p>
                  <p className="text-xs text-muted-foreground">Successful</p>
                </div>
                <div 
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => setShowFailedModal(true)}
                  data-testid="button-show-failed"
                >
                  <p className="text-lg font-semibold text-red-600" data-testid="text-failed">{jobStatus.failed}</p>
                  <p className="text-xs text-muted-foreground">Failed (click for details)</p>
                </div>
                <div>
                  <p className="text-lg font-semibold" data-testid="text-processed">{jobStatus.processed}</p>
                  <p className="text-xs text-muted-foreground">Processed</p>
                </div>
              </div>

              {jobStatus.error && (
                <p className="text-sm text-red-500" data-testid="text-error">{jobStatus.error}</p>
              )}
              {jobStatus.message && (
                <p className="text-sm text-amber-600" data-testid="text-message">{jobStatus.message}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-4">
              <p className="text-center text-muted-foreground">
                {(stats?.stationsNeedingProcessing ?? 0) > 0
                  ? `${stats?.stationsNeedingProcessing?.toLocaleString()} stations are ready for logo optimization.`
                  : `${stats?.stationsWithLogoAssets?.toLocaleString() ?? 0} stations have optimized logos.`}
                {' '}This will download favicon images and create optimized WebP versions in S3.
              </p>
              <div className="flex gap-3">
                <Button 
                  onClick={() => startProcessingMutation.mutate()}
                  disabled={startProcessingMutation.isPending || (stats?.stationsNeedingProcessing ?? 0) === 0}
                  data-testid="button-start-processing"
                >
                  {startProcessingMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Process Remaining ({stats?.stationsNeedingProcessing?.toLocaleString() ?? 0})
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => retryAllFailedMutation.mutate()}
                  disabled={retryAllFailedMutation.isPending}
                  title="Reset every FAILED station (including permanent http_error / invalid_format) and reprocess now — no 30-day wait. Does not touch completed logos."
                  data-testid="button-retry-all-failed"
                >
                  {retryAllFailedMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Retry All Failed
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setShowReprocessConfirm(true)}
                  disabled={reprocessAllMutation.isPending}
                  data-testid="button-reprocess-all"
                >
                  {reprocessAllMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Reprocess All Logos
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logo Format Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 border rounded-lg">
              <h3 className="font-semibold">48px WebP</h3>
              <p className="text-sm text-muted-foreground">Small thumbnails, list views</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3 className="font-semibold">96px WebP</h3>
              <p className="text-sm text-muted-foreground">Cards, player controls</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3 className="font-semibold">256px WebP</h3>
              <p className="text-sm text-muted-foreground">Detail pages, hero sections</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showFailedModal} onOpenChange={setShowFailedModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Failed Stations</DialogTitle>
            <DialogDescription>
              Stations that failed during logo processing. Click on a station to see the error details.
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="h-96 w-full rounded-md border p-4">
            <div className="space-y-2">
              {jobStatus?.results?.filter(r => r.status === 'failed').length === 0 ? (
                <p className="text-sm text-muted-foreground">No failed stations</p>
              ) : (
                jobStatus?.results?.filter(r => r.status === 'failed').map((result) => (
                  <div key={result.stationId} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                    <XCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm break-words">{result.stationName}</p>
                      <p className="text-xs text-muted-foreground mt-1">ID: {result.stationId}</p>
                      {result.error && (
                        <p className="text-xs text-red-600 mt-2 break-words">{result.error}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={showOptimizedModal} onOpenChange={(open) => {
        setShowOptimizedModal(open);
        if (!open) setOptimizedPage(1);
      }}>
        <DialogContent className="max-w-4xl max-h-screen bg-white text-black">
          <DialogHeader>
            <DialogTitle>Optimized Station Logos</DialogTitle>
            <DialogDescription>
              List of {stats?.stationsWithLogoAssets?.toLocaleString()} stations with optimized WebP logos
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="h-96 w-full rounded-md border p-4">
            {(optimizedLoading || optimizedFetching) ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : optimizedStations?.stations && optimizedStations.stations.length > 0 ? (
              <div className="space-y-2">
                {optimizedStations.stations.map((station) => (
                  <div key={station._id} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="w-12 h-12 flex-shrink-0 bg-muted rounded">
                      {(station.logoAssets?.webp256 || station.logoAssets?.webp96) ? (
                        <img 
                          src={(() => { const v = station.logoAssets!.webp256 || station.logoAssets!.webp96!; if (v.startsWith('http')) return v; const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, ''); return `${apiBase}/station-logos/${station.logoAssets!.folder}/${v}`; })()}
                          alt={station.name}
                          className="w-12 h-12 object-cover rounded"
                          onError={(e) => {
                            e.currentTarget.src = '/images/no-image.webp';
                          }}
                        />
                      ) : (
                        <div className="w-12 h-12 bg-muted flex items-center justify-center rounded">
                          <Image className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm break-words">{station.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">Slug: {station.slug}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-green-600 border-green-600">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Optimized
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No optimized stations found</p>
            )}
          </ScrollArea>

          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              Page {optimizedPage} of {optimizedStations?.total ? Math.ceil(optimizedStations.total / 50) : 1}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOptimizedPage(p => Math.max(1, p - 1))}
                disabled={optimizedPage === 1 || optimizedLoading}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOptimizedPage(p => p + 1)}
                disabled={!optimizedStations?.stations || optimizedStations.stations.length < 50 || optimizedLoading}
                data-testid="button-next-page"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showMissingModal} onOpenChange={(open) => {
        setShowMissingModal(open);
        if (!open) { setMissingPage(1); setMissingFilter('any'); setMissingCountry(''); }
      }}>
        <DialogContent className="max-w-4xl max-h-screen bg-white text-black">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              Logosu Eksik İstasyonlar
            </DialogTitle>
            <DialogDescription>
              Bu istasyonlar Google'a indekslenmeye devam ediyor (her URL sitemap'te + fallback logo
              ile <code>image:image</code> entry'si var). Ancak optimize logo bekliyorlar — backfill
              ile düzeltilebilir veya manuel favicon URL girilmesi gerekir.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2 items-end pb-2 border-b">
            <div className="flex flex-col">
              <label className="text-xs text-muted-foreground mb-1">Durum filtresi</label>
              <div className="flex gap-1">
                {(['any', 'pending', 'failed', 'no_favicon'] as MissingFilter[]).map(f => (
                  <Button
                    key={f}
                    type="button"
                    size="sm"
                    variant={missingFilter === f ? 'default' : 'outline'}
                    onClick={() => { setMissingFilter(f); setMissingPage(1); }}
                    data-testid={`button-filter-${f}`}
                  >
                    {f === 'any' && 'Tümü'}
                    {f === 'pending' && 'Beklemede'}
                    {f === 'failed' && 'Başarısız'}
                    {f === 'no_favicon' && 'Favicon Yok'}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-muted-foreground mb-1">Ülke kodu (ISO-2)</label>
              <input
                type="text"
                maxLength={2}
                value={missingCountry}
                onChange={(e) => { setMissingCountry(e.target.value.toUpperCase()); setMissingPage(1); }}
                placeholder="TR, US, DE..."
                className="border rounded px-2 py-1 text-sm uppercase w-32"
                data-testid="input-country-filter"
              />
            </div>
            <div className="ml-auto text-sm text-muted-foreground">
              {missingStations?.total?.toLocaleString() ?? '-'} istasyon
            </div>
          </div>

          <ScrollArea className="h-96 w-full rounded-md border p-4">
            {(missingLoading || missingFetching) ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : missingStations?.stations && missingStations.stations.length > 0 ? (
              <div className="space-y-2">
                {missingStations.stations.map((station) => (
                  <div key={station._id} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="w-12 h-12 flex-shrink-0 bg-muted rounded flex items-center justify-center">
                      {station.favicon ? (
                        <img
                          src={station.favicon}
                          alt={station.name}
                          width={48}
                          height={48}
                          loading="lazy"
                          decoding="async"
                          className="w-12 h-12 object-cover rounded"
                          onError={(e) => {
                            e.currentTarget.src = '/images/no-image.webp';
                          }}
                        />
                      ) : (
                        <Image className="w-6 h-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm break-words">{station.name}</p>
                        <a
                          href={`/station/${station.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                          data-testid={`link-station-${station._id}`}
                        >
                          /station/{station.slug}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {station.country || '—'} ({station.countryCode || '??'})
                      </p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge
                          variant="outline"
                          className={
                            station.logoStatus === 'failed' ? 'text-red-600 border-red-600' :
                            station.logoStatus === 'no_favicon' ? 'text-gray-600 border-gray-600' :
                            'text-amber-600 border-amber-600'
                          }
                        >
                          {station.logoStatus === 'failed' && <XCircle className="w-3 h-3 mr-1" />}
                          {station.logoStatus === 'pending' && <Clock className="w-3 h-3 mr-1" />}
                          {station.logoStatus === 'processing' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                          {station.logoStatus === 'no_favicon' && <AlertTriangle className="w-3 h-3 mr-1" />}
                          {station.logoStatus}
                        </Badge>
                        {station.favicon && (
                          <a
                            href={station.favicon}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 break-all"
                          >
                            favicon <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      {station.logoError && (
                        <p className="text-xs text-red-600 mt-1 break-words">{station.logoError}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Bu filtreyle eşleşen istasyon yok.
              </p>
            )}
          </ScrollArea>

          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              Sayfa {missingPage} / {missingStations?.totalPages ?? 1}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMissingPage(p => Math.max(1, p - 1))}
                disabled={missingPage === 1 || missingLoading}
                data-testid="button-missing-prev"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMissingPage(p => p + 1)}
                disabled={!missingStations || missingPage >= (missingStations.totalPages ?? 1) || missingLoading}
                data-testid="button-missing-next"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showReprocessConfirm} onOpenChange={setShowReprocessConfirm}>
        <DialogContent className="max-w-md bg-white text-black">
          <DialogHeader>
            <DialogTitle>Reprocess All Logos</DialogTitle>
            <DialogDescription>
              This will reset ALL existing logo data and redownload + reprocess every station logo from scratch. 
              This affects {stats?.stationsWithFavicon?.toLocaleString()} stations and may take a long time.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            All existing S3 logo files will be replaced. This cannot be undone.
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowReprocessConfirm(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => reprocessAllMutation.mutate()}
              disabled={reprocessAllMutation.isPending}
            >
              {reprocessAllMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Yes, Reprocess All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Failed Logos Audit Log ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500" />
            Failed Logos Audit Log
          </CardTitle>
          <CardDescription className="text-xs">
            Per-station error messages from the logo processor. Use this to debug recurring failure
            patterns (e.g. CDN blocks, dead favicon URLs, unsupported image formats).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {failedLogs && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
              <button
                onClick={() => setFailureFilter('any')}
                className={`rounded border p-2 text-left ${failureFilter === 'any' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <p className="text-gray-500">All failed</p>
                <p className="text-lg font-bold">{failedLogs.totalFailed.toLocaleString()}</p>
              </button>
              <button
                onClick={() => setFailureFilter('http_error')}
                className={`rounded border p-2 text-left ${failureFilter === 'http_error' ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <p className="text-gray-500">HTTP error</p>
                <p className="text-lg font-bold text-red-600">{(failedLogs.countsByType.http_error ?? 0).toLocaleString()}</p>
              </button>
              <button
                onClick={() => setFailureFilter('timeout')}
                className={`rounded border p-2 text-left ${failureFilter === 'timeout' ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <p className="text-gray-500">Timeout</p>
                <p className="text-lg font-bold text-orange-600">{(failedLogs.countsByType.timeout ?? 0).toLocaleString()}</p>
              </button>
              <button
                onClick={() => setFailureFilter('invalid_format')}
                className={`rounded border p-2 text-left ${failureFilter === 'invalid_format' ? 'border-yellow-500 bg-yellow-50' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <p className="text-gray-500">Invalid format</p>
                <p className="text-lg font-bold text-yellow-700">{(failedLogs.countsByType.invalid_format ?? 0).toLocaleString()}</p>
              </button>
              <button
                onClick={() => setFailureFilter('download_failed')}
                className={`rounded border p-2 text-left ${failureFilter === 'download_failed' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <p className="text-gray-500">Download failed</p>
                <p className="text-lg font-bold text-pink-600">{(failedLogs.countsByType.download_failed ?? 0).toLocaleString()}</p>
              </button>
              <button
                onClick={() => setFailureFilter('processing_failed')}
                className={`rounded border p-2 text-left ${failureFilter === 'processing_failed' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <p className="text-gray-500">Processing failed</p>
                <p className="text-lg font-bold text-purple-600">{(failedLogs.countsByType.processing_failed ?? 0).toLocaleString()}</p>
              </button>
            </div>
          )}

          <ScrollArea className="h-96 rounded border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-100 border-b">
                <tr>
                  <th className="text-left p-2">Station</th>
                  <th className="text-left p-2">Country</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-left p-2">Error</th>
                  <th className="text-left p-2">Last attempt</th>
                  <th className="text-right p-2">Retry</th>
                </tr>
              </thead>
              <tbody>
                {failedLogs?.rows.length === 0 && (
                  <tr><td colSpan={6} className="text-center p-6 text-gray-400">No failed logos {failureFilter !== 'any' ? `with type "${failureFilter}"` : ''}</td></tr>
                )}
                {failedLogs?.rows.map(row => (
                  <tr key={row._id} className="border-b hover:bg-gray-50">
                    <td className="p-2 font-medium">
                      {row.name}
                      {row.favicon && (
                        <a href={row.favicon} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-500">
                          <ExternalLink className="w-3 h-3 inline" />
                        </a>
                      )}
                    </td>
                    <td className="p-2 text-gray-600">{row.countryCode || '—'}</td>
                    <td className="p-2">
                      <Badge variant="outline" className="text-[10px]">{row.failureType}</Badge>
                    </td>
                    <td className="p-2 text-gray-700 max-w-md truncate" title={row.error || ''}>
                      {row.error || '—'}
                    </td>
                    <td className="p-2 text-gray-500">
                      {row.lastAttempt ? new Date(row.lastAttempt).toLocaleString() : '—'}
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retryOneMutation.isPending}
                        onClick={() => retryOneMutation.mutate(row._id)}
                      >
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

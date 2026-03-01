import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Image, RefreshCw, Play, Square, CheckCircle, XCircle, Clock, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface LogoStats {
  totalStations: number;
  stationsWithFavicon: number;
  stationsWithSlug: number;
  stationsWithLogoAssets: number;
  stationsNeedingProcessing: number;
  processingComplete: boolean;
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
    status: 'completed' | 'pending' | 'processing' | 'failed';
  };
}

export default function LogoManagement() {
  const { toast } = useToast();
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [showFailedModal, setShowFailedModal] = useState(false);
  const [showOptimizedModal, setShowOptimizedModal] = useState(false);
  const [optimizedPage, setOptimizedPage] = useState(1);

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

  const progressPercent = jobStatus && jobStatus.total > 0 ? Math.round((jobStatus.processed / jobStatus.total) * 100) : 0;

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

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
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
                  <span>Progress: {jobStatus.processed} / {jobStatus.total}</span>
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
                          src={(() => { const v = station.logoAssets!.webp256 || station.logoAssets!.webp96!; return v.startsWith('http') ? v : `/station-logos/${station.logoAssets!.folder}/${v}`; })()}
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
    </div>
  );
}

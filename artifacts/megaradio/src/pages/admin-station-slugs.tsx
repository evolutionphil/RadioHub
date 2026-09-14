import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Hash, 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Clock,
  Info
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface SlugStats {
  totalStations: number;
  stationsWithSlugs: number;
  stationsWithoutSlugs: number;
  completionPercentage: number;
}

interface SlugGenerationProgress {
  jobId: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  progress: {
    current: number;
    total: number;
  };
  startedAt: string;
  error?: string;
}

export default function AdminStationSlugs() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const notifiedJob = useRef<string | null>(null);

  // Get slug statistics with aggressive polling
  const { data: slugStats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useQuery<SlugStats>({
    queryKey: ['/api/admin/station-slugs/status'],
    refetchInterval: query => query.state.status === 'error' ? false : 10000,
  });

  // Get current generation job status if any
  const { data: currentJob, isLoading: jobLoading, isError: jobError, refetch: refetchJob } = useQuery<SlugGenerationProgress | null>({
    queryKey: ['/api/admin/station-slugs/job-status'],
    refetchInterval: query => query.state.status === 'error' ? false : query.state.data?.status === 'running' ? 1000 : 10000,
    refetchOnMount: 'always',
    staleTime: 0,
  });

  // Observe every progress/status update, including an existing job after navigation.
  useEffect(() => {
    if (!currentJob || currentJob.status === 'running' || notifiedJob.current === currentJob.jobId) return;
    notifiedJob.current = currentJob.jobId;
    void refetchStats();
  }, [currentJob?.jobId, currentJob?.status, refetchStats]);

  // Start comprehensive slug generation (simplified)
  const generateSlugsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/generate-all-slugs');
      return response.json() as Promise<SlugGenerationProgress>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['/api/admin/station-slugs/job-status'], data);
      
      toast({
        title: "Slug generation started",
        description: `Generating missing slugs for ${data.progress.total.toLocaleString()} entities (stations, genres, and users).`,
      });
      // Immediate refresh to show feedback
      refetchStats();
    },
    onError: (error: Error) => {
      console.error('❌ Slug generation error:', error);
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to start comprehensive slug generation",
        variant: "destructive",
      });
      void refetchJob();
    },
  });

  // Stop generation
  const stopGenerationMutation = useMutation({
    mutationFn: async () => (await apiRequest('POST', '/api/admin/station-slugs/stop')).json(),
    onSuccess: () => {
      queryClient.setQueryData<SlugGenerationProgress | null>(['/api/admin/station-slugs/job-status'], job => job ? { ...job, status: 'stopped' } : null);
      void refetchJob();
      toast({
        title: "Generation Stopped",
        description: "Slug generation has been stopped",
      });
      refetchStats();
    },
    onError: (error: Error) => toast({ title: 'Could not stop generation', description: error.message, variant: 'destructive' }),
  });

  const handleStartGeneration = () => {
    generateSlugsMutation.mutate();
  };

  const handleStopGeneration = () => {
    stopGenerationMutation.mutate();
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'running':
        return <Clock className="w-4 h-4 text-blue-600 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Hash className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'running':
        return <Badge className="bg-blue-100 text-blue-800">Running</Badge>;
      case 'completed':
        return <Badge className="bg-green-100 text-green-800">Completed</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-800">Failed</Badge>;
      case 'stopped':
        return <Badge className="bg-gray-100 text-gray-800">Stopped</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">Ready</Badge>;
    }
  };

  if (statsError || jobError) return (
    <div role="alert" className="p-6 space-y-3">
      <p>Unable to load slug statistics or generation status.</p>
      <Button variant="outline" onClick={() => { void refetchStats(); void refetchJob(); }}>Retry</Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Station Slugs Management</h1>
          <p className="text-gray-600 mt-2">
            Generate SEO-friendly slugs for radio stations without them
          </p>
        </div>
      </div>

      {/* Current Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Stations</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? "..." : slugStats?.totalStations.toLocaleString() || "0"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">With Slugs</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {statsLoading ? "..." : slugStats?.stationsWithSlugs.toLocaleString() || "0"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Without Slugs</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {statsLoading ? "..." : slugStats?.stationsWithoutSlugs.toLocaleString() || "0"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completion</CardTitle>
            <Info className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? "..." : `${(slugStats?.completionPercentage || 0).toFixed(1)}%`}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress Overview */}
      {slugStats && (
        <Card>
          <CardHeader>
            <CardTitle>Slug Generation Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Overall Progress</span>
                <span>{(slugStats.completionPercentage || 0).toFixed(1)}%</span>
              </div>
              <Progress value={slugStats.completionPercentage || 0} className="h-2" />
            </div>
            <div className="text-sm text-gray-600">
              {slugStats.stationsWithSlugs.toLocaleString()} of {slugStats.totalStations.toLocaleString()} stations have slugs
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generation Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {getStatusIcon(currentJob?.status)}
            Slug Generation
            {getStatusBadge(currentJob?.status)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentJob?.status === 'failed' && <Alert variant="destructive"><AlertDescription>{currentJob.error || 'Slug generation failed.'}</AlertDescription></Alert>}
          {currentJob?.status !== 'running' ? (
            <div className="space-y-4">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Generate missing SEO-friendly slugs for stations, genres, and users.
                  Process runs asynchronously in the background and continues even if you leave this page.
                </AlertDescription>
              </Alert>
              
              <div className="flex gap-4">
                <Button 
                  onClick={handleStartGeneration}
                  disabled={generateSlugsMutation.isPending || statsLoading || jobLoading}
                  className="flex-1 md:flex-none bg-blue-600 hover:bg-blue-700"
                  data-testid="button-generate-slugs"
                >
                  {generateSlugsMutation.isPending ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Starting Comprehensive Generation...
                    </>
                  ) : (
                    <>
                      <Hash className="w-4 h-4 mr-2" />
                      {/* LABEL FIX (2026-07-04): this was a hardcoded
                          "(Working: 23% Complete!)" placeholder that lied on
                          every load. Reflect real coverage instead. */}
                      {`Generate Missing Slugs${slugStats ? ` (${slugStats.stationsWithoutSlugs.toLocaleString()} stations)` : ''}`}
                    </>
                  )}
                </Button>
                
                <Button 
                  onClick={() => { void refetchStats(); void refetchJob(); }}
                  variant="outline"
                  className="flex-none"
                  data-testid="button-refresh-status"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh Status
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Live Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Generation Progress</span>
                  <span>
                    {currentJob?.progress?.current?.toLocaleString() || 0} / {currentJob?.progress?.total?.toLocaleString() || 0} 
                    ({currentJob?.progress?.total ? ((currentJob.progress.current / currentJob.progress.total) * 100).toFixed(1) : 0}%)
                  </span>
                </div>
                <Progress value={currentJob?.progress?.total ? (currentJob.progress.current / currentJob.progress.total) * 100 : 0} className="h-3" />
              </div>

              <div className="text-sm text-gray-600">
                Started: {currentJob.startedAt ? new Date(currentJob.startedAt).toLocaleString() : 'Unknown'}
              </div>

              {currentJob.status === 'running' && (
                <Button 
                  onClick={handleStopGeneration}
                  disabled={stopGenerationMutation.isPending}
                  variant="destructive"
                  className="w-full md:w-auto"
                >
                  {stopGenerationMutation.isPending ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Stopping...
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 mr-2" />
                      Stop Generation
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generation Results */}
      {currentJob?.status === 'completed' && (
        <Card>
          <CardHeader>
            <CardTitle>Generation Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {currentJob?.progress?.current?.toLocaleString() || 0}
                </div>
                <div className="text-sm text-gray-600">Entities Processed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {currentJob?.progress?.total?.toLocaleString() || 0}
                </div>
                <div className="text-sm text-gray-600">Total Entities</div>
              </div>

            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

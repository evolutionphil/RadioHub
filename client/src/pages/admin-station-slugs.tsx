import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  status: 'running' | 'completed' | 'failed';
  progress: {
    current: number;
    total: number;
  };
  startedAt: Date;
  error?: string;
}

export default function AdminStationSlugs() {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentJob, setCurrentJob] = useState<SlugGenerationProgress | null>(null);

  // Get slug statistics with aggressive polling
  const { data: slugStats, isLoading: statsLoading, refetch: refetchStats } = useQuery<SlugStats>({
    queryKey: ['/api/admin/station-slugs/status'],
    refetchInterval: 3000, // Refresh every 3 seconds to show progress
  });

  // Get current generation job status if any
  const { data: jobStatus } = useQuery<SlugGenerationProgress | null>({
    queryKey: ['/api/admin/station-slugs/job-status'],
    refetchInterval: currentJob?.status === 'running' ? 1000 : false, // Poll every 1s during generation
    enabled: !!currentJob || isGenerating,
  });

  // Update current job when job status changes
  if (jobStatus && jobStatus.jobId !== currentJob?.jobId) {
    setCurrentJob(jobStatus);
  }

  // Start comprehensive slug generation (simplified)
  const generateSlugsMutation = useMutation({
    mutationFn: async () => {
      console.log('🚀 Starting comprehensive slug generation...');
      const response = await apiRequest('POST', '/api/generate-all-slugs');
      console.log('✅ Generation response:', response);
      return response;
    },
    onSuccess: (data: any) => {
      setIsGenerating(true);
      console.log('✅ Comprehensive slug generation response:', data);
      
      // Set the current job from the response
      if (data?.jobId) {
        setCurrentJob({
          jobId: data.jobId,
          status: 'running',
          progress: data.progress || { current: 0, total: data.total || 0 },
          startedAt: new Date(data.startedAt || Date.now())
        });
      }
      
      toast({
        title: "SUCCESS! Comprehensive Slug Generation Started",
        description: `Background processing initiated for ${data?.progress?.total || 'all'} entities (stations + genres + users)`,
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
      setIsGenerating(false);
    },
  });

  // Stop generation
  const stopGenerationMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/admin/station-slugs/stop'),
    onSuccess: () => {
      setCurrentJob(null);
      setIsGenerating(false);
      toast({
        title: "Generation Stopped",
        description: "Slug generation has been stopped",
      });
      refetchStats();
    },
  });

  const handleStartGeneration = () => {
    generateSlugsMutation.mutate();
  };

  const handleStopGeneration = () => {
    stopGenerationMutation.mutate();
  };

  // Update generation status
  if (currentJob?.status === 'completed' && isGenerating) {
    setIsGenerating(false);
    toast({
      title: "Slug Generation Complete!",
      description: `Processed ${currentJob?.progress?.current || 0} stations successfully!`,
    });
    refetchStats();
  } else if (currentJob?.status === 'failed' && isGenerating) {
    setIsGenerating(false);
    toast({
      title: "Generation Failed",
      description: currentJob.error || "Unknown error occurred",
      variant: "destructive",
    });
  }

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
      default:
        return <Badge className="bg-gray-100 text-gray-800">Ready</Badge>;
    }
  };

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
          {!currentJob || currentJob.status === 'completed' || currentJob.status === 'failed' ? (
            <div className="space-y-4">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  🎯 COMPREHENSIVE SLUG GENERATION: This will generate SEO-friendly slugs for ALL stations, genres, and users.
                  Process runs asynchronously in the background and continues even if you leave this page.
                </AlertDescription>
              </Alert>
              
              <div className="flex gap-4">
                <Button 
                  onClick={handleStartGeneration}
                  disabled={generateSlugsMutation.isPending}
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
                      🚀 Generate ALL Slugs (Working: 23% Complete!)
                    </>
                  )}
                </Button>
                
                <Button 
                  onClick={() => refetchStats()}
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
                <div className="text-sm text-gray-600">Stations Processed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {currentJob?.progress?.total?.toLocaleString() || 0}
                </div>
                <div className="text-sm text-gray-600">Total Stations</div>
              </div>

            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
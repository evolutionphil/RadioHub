import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  Zap,
  Database,
  Activity,
  CheckCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  TrendingUp,
  Server,
  Cpu,
  Gauge,
  Zap as ZapIcon
} from 'lucide-react';

interface PerformanceMetrics {
  databaseStats: {
    totalStations: number;
    totalCountries: number;
    totalGenres: number;
    indexesCount: number;
    dbSize: string;
  };
  systemHealth: {
    memoryUsage: number;
    systemMemoryUsage?: number;
    heapUsedMB?: number;
    heapTotalMB?: number;
    cpuUsage: number | null;
    connectionPool: number;
  };
  optimizationSuggestions: Array<{
    type: 'index' | 'query' | 'cleanup' | 'cache';
    priority: 'high' | 'medium' | 'low';
    title: string;
    description: string;
    impact: string;
    action: string;
  }>;
}

interface OptimizationJob {
  id: string;
  type: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  results?: any;
}

type VitalStatus = 'good' | 'needs_improvement' | 'poor' | 'no_data';
interface VitalAggregate {
  p50: number | null;
  p75: number | null;
  p95: number | null;
  status: VitalStatus;
}
interface WebVitalsData {
  lcp: VitalAggregate;
  inp: VitalAggregate;
  cls: VitalAggregate;
  lastUpdated: string;
  totalSamples?: number;
}

interface CacheClearResponse {
  success: boolean;
  message: string;
  result: {
    timestamp: string;
    serverCache: { seoHtmlCleared: number; pageDataCleared: number };
  };
}

export default function AdminPerformance() {
  const [optimizationJobs, setOptimizationJobs] = useState<OptimizationJob[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [cacheClearLoading, setCacheClearLoading] = useState(false);
  const [cacheClearResult, setCacheClearResult] = useState<CacheClearResponse | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const activeIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    return () => {
      activeIntervalsRef.current.forEach(id => clearInterval(id));
      activeIntervalsRef.current.clear();
    };
  }, []);

  // Optimized metrics fetching with React Query
  const { data: metrics, isLoading, refetch: fetchMetrics } = useQuery<PerformanceMetrics>({
    queryKey: ['/api/admin/performance/metrics'],
    queryFn: async () => {
      const response = await fetch('/api/admin/performance/metrics');
      if (!response.ok) throw new Error('Failed to fetch metrics');
      return response.json();
    },
    staleTime: 30000, // Cache for 30 seconds
    refetchOnWindowFocus: false,
    refetchInterval: 60000, // Auto-refresh every minute
  });

  // Fetch Web Vitals from Cloudflare
  const { data: webVitals, isLoading: webVitalsLoading, refetch: fetchWebVitals } = useQuery<WebVitalsData>({
    queryKey: ['/api/admin/performance/web-vitals'],
    queryFn: async () => {
      const response = await fetch('/api/admin/performance/web-vitals');
      if (!response.ok) throw new Error('Failed to fetch Web Vitals');
      return response.json();
    },
    staleTime: 300000, // Cache for 5 minutes (Web Vitals update less frequently)
    refetchOnWindowFocus: false,
    refetchInterval: 300000, // Auto-refresh every 5 minutes
  });

  const runOptimization = async (type: string, action: string) => {
    try {
      const response = await fetch('/api/admin/performance/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, action })
      });
      
      const result = await response.json();
      if (result.success) {
        const job: OptimizationJob = {
          id: result.jobId || `${type}-${Date.now()}`,
          type,
          status: 'running',
          progress: 0,
          message: `Starting ${type} optimization...`
        };
        
        setOptimizationJobs(prev => [...prev, job]);
        
        if (result.jobId) {
          pollOptimizationJob(result.jobId);
        } else {
          // Immediate result
          setTimeout(() => {
            setOptimizationJobs(prev => 
              prev.map(j => j.id === job.id ? {
                ...j,
                status: 'completed',
                progress: 100,
                message: result.message,
                results: result.results
              } : j)
            );
            handleRefreshMetrics(); // Refresh metrics
          }, 1000);
        }
      }
    } catch (error) {
      // Failed to run optimization
    }
  };

  const pollOptimizationJob = (jobId: string) => {
    const intervalId = setInterval(async () => {
      try {
        const response = await fetch(`/api/admin/performance/jobs/${jobId}`);
        const job = await response.json();

        setOptimizationJobs(prev =>
          prev.map(j => j.id === jobId ? {
            ...j,
            status: job.status,
            progress: job.progress || 0,
            message: job.message,
            results: job.results
          } : j)
        );

        if (job.status === 'completed' || job.status === 'failed') {
          clearInterval(intervalId);
          activeIntervalsRef.current.delete(jobId);
          if (job.status === 'completed') {
            handleRefreshMetrics();
          }
        }
      } catch (_error) {
        clearInterval(intervalId);
        activeIntervalsRef.current.delete(jobId);
      }
    }, 1000);
    activeIntervalsRef.current.set(jobId, intervalId);
  };

  const runFullOptimization = async () => {
    const optimizations = [
      { type: 'indexes', action: 'create_missing_indexes' },
      { type: 'cleanup', action: 'remove_orphaned_data' },
      { type: 'cache', action: 'warm_cache' },
      { type: 'query', action: 'optimize_slow_queries' }
    ];

    for (const opt of optimizations) {
      await runOptimization(opt.type, opt.action);
      // Small delay between optimizations
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };

  // Remove useEffect since React Query handles initial fetching

  // Wrapper for React Query refetch
  const handleRefreshMetrics = () => {
    setLastRefresh(new Date());
    fetchMetrics();
  };

  const getStatusColor = (value: number, thresholds: { good: number; warning: number }) => {
    if (value <= thresholds.good) return 'text-green-600';
    if (value <= thresholds.warning) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'destructive';
      case 'medium': return 'default';
      case 'low': return 'secondary';
      default: return 'outline';
    }
  };

  const getVitalStatusColor = (status: string) => {
    switch (status) {
      case 'good': return 'bg-green-100 text-green-800 border-green-300';
      case 'needs_improvement':
      case 'needs-improvement': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'poor': return 'bg-red-100 text-red-800 border-red-300';
      case 'no_data': return 'bg-gray-100 text-gray-600 border-gray-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getVitalStatusText = (status: string) => {
    switch (status) {
      case 'good': return '✓ Good';
      case 'needs_improvement':
      case 'needs-improvement': return '⚠ Needs Improvement';
      case 'poor': return '✕ Poor';
      case 'no_data': return 'No data yet';
      default: return 'Unknown';
    }
  };

  const formatVital = (value: number | null, suffix: string, decimals = 0): string => {
    if (value === null || value === undefined) return '—';
    return `${value.toFixed(decimals)}${suffix}`;
  };

  const handleClearSeoCaches = async () => {
    setCacheClearLoading(true);
    try {
      const response = await fetch('/api/admin/cache/clear-seo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) throw new Error('Failed to clear SEO caches');
      
      const result = await response.json();
      setCacheClearResult(result);
      
      toast({
        title: 'Success',
        description: 'SEO caches cleared successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to clear SEO caches',
        variant: 'destructive',
      });
    } finally {
      setCacheClearLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Performance Optimization</h1>
          <p className="text-muted-foreground">
            Monitor and optimize system performance with one-click tools
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={handleRefreshMetrics} 
            disabled={isLoading}
            variant="outline"
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button 
            onClick={runFullOptimization}
            disabled={isLoading || optimizationJobs.some(j => j.status === 'running')}
            className="flex items-center gap-2"
          >
            <Zap className="h-4 w-4" />
            Optimize All
          </Button>
        </div>
      </div>

      {lastRefresh && (
        <div className="text-sm text-muted-foreground">
          Last updated: {lastRefresh.toLocaleTimeString()}
        </div>
      )}

      {/* System Overview */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Database className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium">Database</span>
              </div>
              <div className="text-2xl font-bold">{metrics.databaseStats.totalStations.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">
                Stations • {metrics.databaseStats.dbSize} • {metrics.databaseStats.indexesCount} indexes
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Server className="h-4 w-4 text-purple-600" />
                <span className="text-sm font-medium">Memory (Heap)</span>
              </div>
              <div className={`text-2xl font-bold ${getStatusColor(metrics.systemHealth.memoryUsage, { good: 60, warning: 80 })}`}>
                {metrics.systemHealth.memoryUsage}%
              </div>
              <div className="text-xs text-muted-foreground">
                {metrics.systemHealth.heapUsedMB ?? '—'}MB / {metrics.systemHealth.heapTotalMB ?? '—'}MB
                {typeof metrics.systemHealth.systemMemoryUsage === 'number' && (
                  <> • System {metrics.systemHealth.systemMemoryUsage}%</>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Cpu className="h-4 w-4 text-orange-600" />
                <span className="text-sm font-medium">CPU</span>
              </div>
              <div className={`text-2xl font-bold ${
                metrics.systemHealth.cpuUsage === null
                  ? 'text-muted-foreground'
                  : getStatusColor(metrics.systemHealth.cpuUsage, { good: 50, warning: 80 })
              }`}>
                {metrics.systemHealth.cpuUsage === null ? '—' : `${metrics.systemHealth.cpuUsage}%`}
              </div>
              <div className="text-xs text-muted-foreground">
                {metrics.systemHealth.connectionPool} DB connections
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Active Optimization Jobs */}
      {optimizationJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Active Optimizations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {optimizationJobs.map(job => (
              <div key={job.id} className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium capitalize">{job.type} Optimization</span>
                  <div className="flex items-center gap-2">
                    {job.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
                    {job.status === 'completed' && <CheckCircle className="h-3 w-3 text-green-600" />}
                    {job.status === 'failed' && <AlertTriangle className="h-3 w-3 text-red-600" />}
                    <span className="text-sm">{job.progress}%</span>
                  </div>
                </div>
                <Progress value={job.progress} className="h-1" />
                <div className="text-xs text-muted-foreground">{job.message}</div>
                {job.results && (
                  <div className="text-xs p-2 bg-muted rounded font-mono">
                    {JSON.stringify(job.results, null, 2)}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Optimization Suggestions */}
      {metrics?.optimizationSuggestions && metrics.optimizationSuggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Optimization Suggestions
            </CardTitle>
            <CardDescription>
              Recommended actions to improve system performance
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {metrics.optimizationSuggestions.map((suggestion, index) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">{suggestion.title}</h4>
                    <Badge variant={getPriorityColor(suggestion.priority)}>
                      {suggestion.priority}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => runOptimization(suggestion.type, suggestion.action)}
                    disabled={optimizationJobs.some(j => j.type === suggestion.type && j.status === 'running')}
                  >
                    Optimize
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground mb-2">{suggestion.description}</p>
                <div className="text-xs text-green-600">
                  Expected impact: {suggestion.impact}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Web Vitals - Core Web Vitals from Cloudflare RUM */}
      {webVitals && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4" />
                <div>
                  <CardTitle>Cloudflare Web Vitals (RUM)</CardTitle>
                  <CardDescription>Real User Monitoring metrics for Core Web Vitals</CardDescription>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchWebVitals()}
                disabled={webVitalsLoading}
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${webVitalsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* LCP */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Largest Contentful Paint (LCP)</h3>
                <Badge className={`${getVitalStatusColor(webVitals.lcp.status)}`}>
                  {getVitalStatusText(webVitals.lcp.status)}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">P50 (Good)</div>
                  <div className="text-2xl font-bold text-green-600">{formatVital(webVitals.lcp.p50, 'ms')}</div>
                </div>
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">P75 (Target)</div>
                  <div className="text-2xl font-bold text-yellow-600">{formatVital(webVitals.lcp.p75, 'ms')}</div>
                </div>
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">P95 (Check)</div>
                  <div className="text-2xl font-bold text-red-600">{formatVital(webVitals.lcp.p95, 'ms')}</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Target: P75 &lt; 2500ms (Good), &lt; 4000ms (Needs Improvement)</p>
            </div>

            {/* INP */}
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Interaction to Next Paint (INP)</h3>
                <Badge className={`${getVitalStatusColor(webVitals.inp.status)}`}>
                  {getVitalStatusText(webVitals.inp.status)}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">P50 (Good)</div>
                  <div className="text-2xl font-bold text-green-600">{formatVital(webVitals.inp.p50, 'ms')}</div>
                </div>
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">P75 (Target)</div>
                  <div className="text-2xl font-bold text-yellow-600">{formatVital(webVitals.inp.p75, 'ms')}</div>
                </div>
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">P95 (Check)</div>
                  <div className="text-2xl font-bold text-red-600">{formatVital(webVitals.inp.p95, 'ms')}</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Target: P75 &lt; 200ms (Good), &lt; 500ms (Needs Improvement)</p>
            </div>

            {/* CLS */}
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Cumulative Layout Shift (CLS)</h3>
                <Badge className={`${getVitalStatusColor(webVitals.cls.status)}`}>
                  {getVitalStatusText(webVitals.cls.status)}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">P50 (Good)</div>
                  <div className="text-2xl font-bold text-green-600">{formatVital(webVitals.cls.p50, '', 3)}</div>
                </div>
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">P75 (Target)</div>
                  <div className="text-2xl font-bold text-yellow-600">{formatVital(webVitals.cls.p75, '', 3)}</div>
                </div>
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">P95 (Check)</div>
                  <div className="text-2xl font-bold text-red-600">{formatVital(webVitals.cls.p95, '', 3)}</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Target: P75 &lt; 0.1 (Good), &lt; 0.25 (Needs Improvement)</p>
            </div>

            {webVitals.lastUpdated && (
              <div className="text-xs text-muted-foreground text-right pt-2">
                Last updated: {new Date(webVitals.lastUpdated).toLocaleString()}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* SEO Cache Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ZapIcon className="h-4 w-4" />
            <div>
              <CardTitle>SEO Cache Management</CardTitle>
              <CardDescription>Manage server and Cloudflare caches for SEO optimization</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded-lg p-4">
              <h4 className="font-medium mb-2">Manual Cache Clear</h4>
              <p className="text-sm text-muted-foreground mb-4">
                Clear all SEO-related caches (server + Cloudflare) to force Google to crawl fresh content
              </p>
              <Button
                onClick={handleClearSeoCaches}
                disabled={cacheClearLoading}
                className="w-full"
              >
                {cacheClearLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Clearing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Clear SEO Caches Now
                  </>
                )}
              </Button>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-medium mb-2">Automatic Daily Clear</h4>
              <p className="text-sm text-muted-foreground mb-4">
                Runs automatically every day at 3 AM (Europe/Berlin timezone)
              </p>
              <Badge variant="outline" className="w-full justify-center py-2 text-center">
                ✓ Scheduled Daily at 3:00 AM
              </Badge>
            </div>
          </div>

          {cacheClearResult && (
            <Alert className={cacheClearResult.success ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}>
              {cacheClearResult.success ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
              )}
              <AlertDescription className={cacheClearResult.success ? "text-green-800" : "text-yellow-800"}>
                <div className="font-medium mb-1">{cacheClearResult.success ? '✓ SEO Caches Cleared' : '⚠ Clear failed'}</div>
                <div className="text-sm space-y-1">
                  <div>Server caches cleared: {(cacheClearResult.result.serverCache.seoHtmlCleared || 0) + (cacheClearResult.result.serverCache.pageDataCleared || 0)} entries</div>
                  <div className="text-xs mt-2 font-mono">{new Date(cacheClearResult.result.timestamp).toLocaleString()}</div>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Quick Actions
          </CardTitle>
          <CardDescription>
            One-click performance optimizations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Button
              variant="outline"
              className="h-auto p-4 flex flex-col items-center gap-2"
              onClick={() => runOptimization('indexes', 'rebuild_indexes')}
              disabled={optimizationJobs.some(j => j.type === 'indexes' && j.status === 'running')}
            >
              <Database className="h-6 w-6" />
              <span className="text-sm">Rebuild Indexes</span>
            </Button>

            <Button
              variant="outline"
              className="h-auto p-4 flex flex-col items-center gap-2"
              onClick={() => runOptimization('cache', 'clear_cache')}
              disabled={optimizationJobs.some(j => j.type === 'cache' && j.status === 'running')}
            >
              <RefreshCw className="h-6 w-6" />
              <span className="text-sm">Clear Cache</span>
            </Button>

            <Button
              variant="outline"
              className="h-auto p-4 flex flex-col items-center gap-2"
              onClick={() => runOptimization('analyze', 'analyze_performance')}
              disabled={optimizationJobs.some(j => j.type === 'analyze' && j.status === 'running')}
            >
              <Activity className="h-6 w-6" />
              <span className="text-sm">Analyze DB</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
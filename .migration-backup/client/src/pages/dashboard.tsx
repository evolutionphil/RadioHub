import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import StatsCard from "@/components/ui/stats-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  Radio, 
  Globe, 
  Languages, 
  RefreshCw, 
  Plus, 
  FolderSync,
  Circle,
  CheckCircle,
  XCircle,
  Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

export default function Dashboard() {
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);

  // Force clear cache on component mount to show current data
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
  }, []);

  const { data: stats, isLoading, refetch } = useQuery({
    queryKey: ['/api/dashboard/stats'],
    queryFn: async () => {
      const response = await fetch('/api/dashboard/stats');
      if (!response.ok) throw new Error('Failed to fetch dashboard stats');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 0, // Force refresh to show current data
    gcTime: 0, // Don't cache stale data (TanStack Query v5 uses gcTime instead of cacheTime)
  });

  const { data: syncLogs } = useQuery({
    queryKey: ['/api/sync/logs'],
    queryFn: () => api.getSyncLogs(10),
    refetchInterval: 10000, // Refresh sync logs every 10 seconds
  });

  const handleForceSync = async () => {
    try {
      setIsSyncing(true);
      await api.forceSync();
      toast({
        title: "Sync Started",
        description: "Station synchronization has been started in the background.",
      });
      // Refetch stats to show updated sync status
      setTimeout(() => {
        refetch();
      }, 2000);
    } catch (error) {
      toast({
        title: "Sync Failed",
        description: "Failed to start synchronization. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const getSyncLogIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'running':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      default:
        return <Circle className="w-4 h-4 text-gray-400" />;
    }
  };

  const getSyncLogBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-100 text-green-800">Completed</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-800">Failed</Badge>;
      case 'running':
        return <Badge className="bg-yellow-100 text-yellow-800">Running</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-5">
                <div className="h-16 bg-gray-200 rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Total Stations"
          value={stats?.totalStations?.toLocaleString() || "0"}
          icon={Radio}
          iconColor="text-blue-600"
          description={`${stats?.workingStations?.toLocaleString() || 0} working (${stats?.workingPercentage || 0}%)`}
        />
        <StatsCard
          title="Countries"
          value={stats?.totalCountries?.toLocaleString() || "0"}
          icon={Globe}
          iconColor="text-green-600"
          description="Unique countries"
        />
        <StatsCard
          title="Languages"
          value={stats?.totalLanguages?.toLocaleString() || "0"}
          icon={Languages}
          iconColor="text-purple-600"
          description="Available languages"
        />
        <StatsCard
          title="Recently Updated"
          value={stats?.recentlyUpdated?.toLocaleString() || "0"}
          icon={RefreshCw}
          iconColor="text-orange-600"
          description="Updated last 24h"
        />
      </div>

      {/* Additional Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className="p-2 bg-red-100 rounded-lg">
                <XCircle className="h-6 w-6 text-red-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Unresolved Errors</p>
                <p className="text-2xl font-bold text-red-600">{stats?.unresolvedErrors?.toLocaleString() || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Plus className="h-6 w-6 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Users</p>
                <p className="text-2xl font-bold text-blue-600">{stats?.totalUsers?.toLocaleString() || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <FolderSync className="h-6 w-6 text-yellow-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Open Feedback</p>
                <p className="text-2xl font-bold text-yellow-600">{stats?.openFeedback?.toLocaleString() || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className={`p-2 rounded-lg ${stats?.syncStatus?.isHealthy ? 'bg-green-100' : 'bg-red-100'}`}>
                <CheckCircle className={`h-6 w-6 ${stats?.syncStatus?.isHealthy ? 'text-green-600' : 'text-red-600'}`} />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Sync Status</p>
                <p className={`text-2xl font-bold ${stats?.syncStatus?.isHealthy ? 'text-green-600' : 'text-red-600'}`}>
                  {stats?.syncStatus?.isHealthy ? 'Healthy' : 'Issues'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Sync Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {syncLogs?.slice(0, 5).map((log: any, index: number) => (
                <div key={log._id || `log-${index}`} className="flex items-center space-x-3">
                  <div className="flex-shrink-0">
                    {getSyncLogIcon(log.status)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      {log.syncType === 'full' ? 'Full sync' : 'Incremental sync'}
                      {log.status === 'completed' && log.stationsProcessed && (
                        <span className="text-gray-500">
                          : {log.stationsProcessed} stations processed
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-gray-500">
                      {new Date(log.startedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    {getSyncLogBadge(log.status)}
                  </div>
                </div>
              ))}
              {!syncLogs?.length && (
                <p className="text-sm text-gray-500">No sync activity yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* System Status */}
        <Card>
          <CardHeader>
            <CardTitle>System Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">API Status</span>
                <Badge className="bg-green-100 text-green-800">
                  <Circle className="w-2 h-2 text-green-400 fill-current mr-1" />
                  Operational
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Database Connection</span>
                <Badge className="bg-green-100 text-green-800">
                  <Circle className="w-2 h-2 text-green-400 fill-current mr-1" />
                  Connected
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Sync Status</span>
                <Badge className={
                  stats?.syncStatus.isRunning 
                    ? "bg-yellow-100 text-yellow-800" 
                    : "bg-green-100 text-green-800"
                }>
                  <Circle className={`w-2 h-2 fill-current mr-1 ${
                    stats?.syncStatus.isRunning ? 'text-yellow-400' : 'text-green-400'
                  }`} />
                  {stats?.syncStatus.isRunning ? 'Running' : 'Idle'}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Storage Usage</span>
                <div className="flex items-center space-x-2">
                  <Progress value={45} className="w-16" />
                  <span className="text-sm text-gray-600">45%</span>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <Button 
                  onClick={handleForceSync}
                  disabled={isSyncing || stats?.syncStatus.isRunning}
                  className="w-full"
                >
                  <FolderSync className={`w-4 h-4 mr-2 ${(isSyncing || stats?.syncStatus.isRunning) ? 'animate-spin' : ''}`} />
                  {isSyncing || stats?.syncStatus.isRunning ? 'Sync Running...' : 'Force Sync Now'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

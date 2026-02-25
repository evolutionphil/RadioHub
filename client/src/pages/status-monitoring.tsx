import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, CheckCircle, Clock, TrendingDown, TrendingUp, Wifi, WifiOff, Database, Server, Users, BarChart3, Zap, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { useAdminAuth } from "@/hooks/useAdminAuth";

interface StationStatus {
  _id: string;
  name: string;
  url: string;
  lastcheckok: boolean;
  lastchecktime: string;
  lastcheckoktime: string;
  sslError: boolean;
  votes: number;
  clickcount: number;
  clicktrend: number;
  countryCode: string;
  bitrate: number;
  codec: string;
}

interface DashboardStats {
  totalStations: number;
  totalCountries: number;
  totalLanguages: number;
  totalGenres: number;
  totalCodecs: number;
  workingStations: number;
  workingPercentage: number;
  recentlyUpdated: number;
  unresolvedErrors: number;
  totalUsers: number;
  openFeedback: number;
  syncStatus: {
    isRunning: boolean;
    lastSync: string | null;
    lastSyncStatus: string;
    isHealthy: boolean;
  };
}

interface SyncStatus {
  isRunning: boolean;
  lastFullSync: string | null;
  lastSyncLog: {
    status: string;
    startedAt: string;
    completedAt?: string;
    totalStations?: number;
    addedStations?: number;
    updatedStations?: number;
    errorMessage?: string;
  } | null;
}

interface PerformanceMetrics {
  systemHealth: {
    status: 'healthy' | 'warning' | 'critical';
    uptime: number;
    memoryUsage: {
      used: number;
      total: number;
      percentage: number;
    };
    cpuUsage: number;
  };
  databaseHealth: {
    status: 'connected' | 'disconnected' | 'error';
    connectionCount: number;
    responseTime: number;
    collectionCounts: {
      stations: number;
      users: number;
      genres: number;
    };
  };
  apiHealth: {
    averageResponseTime: number;
    requestsPerMinute: number;
    errorRate: number;
    activeConnections: number;
  };
}

export default function StatusMonitoring() {
  const { isAuthenticated } = useAdminAuth();

  const { data: stations, isLoading: loadingStations } = useQuery<{ stations: StationStatus[] }>({
    queryKey: ['/api/stations'],
    enabled: isAuthenticated,
  });

  const { data: dashboardStats, isLoading: loadingStats } = useQuery<DashboardStats>({
    queryKey: ['/api/dashboard/stats'],
    enabled: isAuthenticated,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: syncStatus, isLoading: loadingSync } = useQuery<SyncStatus>({
    queryKey: ['/api/sync/status'],
    enabled: isAuthenticated,
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const { data: performanceMetrics, isLoading: loadingPerformance } = useQuery<PerformanceMetrics>({
    queryKey: ['/api/admin/performance/metrics'],
    enabled: isAuthenticated,
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  const stationList = stations?.stations || [];
  const isLoading = loadingStations || loadingStats || loadingSync || loadingPerformance;

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">You need admin privileges to view this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Calculate status statistics
  const totalStations = stationList.length;
  const onlineStations = stationList.filter(s => s.lastcheckok).length;
  const offlineStations = stationList.filter(s => !s.lastcheckok).length;
  const sslErrorStations = stationList.filter(s => s.sslError).length;
  const uptrend = stationList.filter(s => s.clicktrend > 0).length;
  const downtrend = stationList.filter(s => s.clicktrend < 0).length;

  const uptimePercentage = totalStations > 0 ? Math.round((onlineStations / totalStations) * 100) : 0;

  // Get recent status changes (stations checked within last hour)
  const recentChecks = stationList
    .filter(s => s.lastchecktime && new Date(s.lastchecktime).getTime() > Date.now() - 3600000)
    .sort((a, b) => new Date(b.lastchecktime).getTime() - new Date(a.lastchecktime).getTime())
    .slice(0, 20);

  // Get problem stations
  const problemStations = stationList
    .filter(s => !s.lastcheckok || s.sslError)
    .sort((a, b) => new Date(b.lastchecktime).getTime() - new Date(a.lastchecktime).getTime())
    .slice(0, 50);

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6">
        <div className="animate-pulse space-y-4 sm:space-y-6">
          <div className="h-6 sm:h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-24 sm:h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">System Status Monitoring</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">Real-time system health, performance metrics, and station monitoring</p>
          </div>
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-green-500 animate-spin" />
            <span className="text-xs sm:text-sm text-green-600 dark:text-green-400">Live updates</span>
          </div>
        </div>
      </div>

      {/* System Health Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl sm:text-2xl font-bold text-green-600">
                  {dashboardStats?.workingPercentage || 0}%
                </p>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">System Health</p>
              </div>
              <CheckCircle className="w-6 h-6 sm:w-8 sm:h-8 text-green-500" />
            </div>
            <div className="mt-2">
              <Progress value={dashboardStats?.workingPercentage || 0} className="h-2" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl sm:text-2xl font-bold text-blue-600">
                  {dashboardStats?.totalStations?.toLocaleString() || '0'}
                </p>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Total Stations</p>
              </div>
              <Database className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl sm:text-2xl font-bold text-purple-600">
                  {dashboardStats?.totalUsers?.toLocaleString() || '0'}
                </p>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Active Users</p>
              </div>
              <Users className="w-6 h-6 sm:w-8 sm:h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl sm:text-2xl font-bold text-orange-600">
                  {performanceMetrics?.apiHealth?.requestsPerMinute?.toFixed(0) || '0'}
                </p>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Requests/Min</p>
              </div>
              <BarChart3 className="w-6 h-6 sm:w-8 sm:h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sync Status Card */}
      {syncStatus && (
        <Card className="mb-4 sm:mb-6">
          <CardHeader className="pb-2 sm:pb-3">
            <CardTitle className="flex items-center text-base sm:text-lg">
              <RefreshCw className={`w-4 h-4 sm:w-5 sm:h-5 mr-2 ${syncStatus.isRunning ? 'animate-spin text-blue-500' : 'text-gray-500'}`} />
              Data Synchronization Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="text-center">
                <Badge 
                  variant={syncStatus.isRunning ? "default" : 
                          syncStatus.lastSyncLog?.status === 'completed' ? "secondary" : 
                          "destructive"}
                  className="mb-2"
                >
                  {syncStatus.isRunning ? 'Running' : syncStatus.lastSyncLog?.status || 'Unknown'}
                </Badge>
                <div className="text-xs sm:text-sm text-muted-foreground">Current Status</div>
              </div>
              <div className="text-center">
                <div className="text-lg sm:text-xl font-bold">
                  {syncStatus.lastSyncLog?.totalStations?.toLocaleString() || 'N/A'}
                </div>
                <div className="text-xs sm:text-sm text-muted-foreground">Total Stations</div>
              </div>
              <div className="text-center">
                <div className="text-lg sm:text-xl font-bold text-green-600">
                  {syncStatus.lastSyncLog?.addedStations?.toLocaleString() || '0'}
                </div>
                <div className="text-xs sm:text-sm text-muted-foreground">Stations Added</div>
              </div>
              <div className="text-center">
                <div className="text-lg sm:text-xl font-bold text-blue-600">
                  {syncStatus.lastSyncLog?.updatedStations?.toLocaleString() || '0'}
                </div>
                <div className="text-xs sm:text-sm text-muted-foreground">Stations Updated</div>
              </div>
            </div>
            {syncStatus.lastFullSync && (
              <div className="mt-3 text-xs sm:text-sm text-muted-foreground text-center">
                Last sync: {format(new Date(syncStatus.lastFullSync), 'MMM dd, yyyy HH:mm')}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Performance Metrics Card */}
      {performanceMetrics && (
        <Card className="mb-4 sm:mb-6">
          <CardHeader className="pb-2 sm:pb-3">
            <CardTitle className="flex items-center text-base sm:text-lg">
              <Zap className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
              Performance Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              <div>
                <h4 className="font-semibold text-sm sm:text-base mb-2">System Health</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm">Memory Usage</span>
                    <span className="text-xs sm:text-sm font-medium">
                      {performanceMetrics.systemHealth?.memoryUsage?.percentage || 0}%
                    </span>
                  </div>
                  <Progress 
                    value={performanceMetrics.systemHealth?.memoryUsage?.percentage || 0} 
                    className="h-1.5 sm:h-2" 
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm">CPU Usage</span>
                    <span className="text-xs sm:text-sm font-medium">
                      {performanceMetrics.systemHealth?.cpuUsage || 0}%
                    </span>
                  </div>
                  <Progress 
                    value={performanceMetrics.systemHealth?.cpuUsage || 0} 
                    className="h-1.5 sm:h-2" 
                  />
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm sm:text-base mb-2">Database Health</h4>
                <div className="space-y-2">
                  <Badge variant={
                    performanceMetrics.databaseHealth?.status === 'connected' ? 'secondary' : 
                    performanceMetrics.databaseHealth?.status === 'error' ? 'destructive' : 'outline'
                  }>
                    {performanceMetrics.databaseHealth?.status || 'Unknown'}
                  </Badge>
                  <div className="text-xs sm:text-sm text-muted-foreground">
                    Response Time: {performanceMetrics.databaseHealth?.responseTime || 0}ms
                  </div>
                  <div className="text-xs sm:text-sm text-muted-foreground">
                    Connections: {performanceMetrics.databaseHealth?.connectionCount || 0}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm sm:text-base mb-2">API Health</h4>
                <div className="space-y-2">
                  <div className="text-xs sm:text-sm text-muted-foreground">
                    Avg Response: {performanceMetrics.apiHealth?.averageResponseTime || 0}ms
                  </div>
                  <div className="text-xs sm:text-sm text-muted-foreground">
                    Error Rate: {performanceMetrics.apiHealth?.errorRate || 0}%
                  </div>
                  <div className="text-xs sm:text-sm text-muted-foreground">
                    Active Connections: {performanceMetrics.apiHealth?.activeConnections || 0}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Station Status Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl sm:text-2xl font-bold text-green-600">{onlineStations}</p>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Online Stations</p>
              </div>
              <CheckCircle className="w-6 h-6 sm:w-8 sm:h-8 text-green-500" />
            </div>
            <div className="mt-2">
              <Progress value={uptimePercentage} className="h-1.5 sm:h-2" />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{uptimePercentage}% uptime</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl sm:text-2xl font-bold text-red-600">{offlineStations}</p>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Offline Stations</p>
              </div>
              <WifiOff className="w-6 h-6 sm:w-8 sm:h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl sm:text-2xl font-bold text-yellow-600">{sslErrorStations}</p>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">SSL Errors</p>
              </div>
              <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl sm:text-2xl font-bold text-blue-600">{recentChecks.length}</p>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Recent Checks</p>
              </div>
              <Activity className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Status Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 gap-1">
          <TabsTrigger value="overview" className="text-xs sm:text-sm">Overview</TabsTrigger>
          <TabsTrigger value="recent" className="text-xs sm:text-sm">Recent Activity</TabsTrigger>
          <TabsTrigger value="problems" className="text-xs sm:text-sm">Problems</TabsTrigger>
          <TabsTrigger value="trends" className="text-xs sm:text-sm hidden sm:block">Trends</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 sm:mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center text-base sm:text-lg">
                  <Server className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                  System Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm sm:text-base">Total Stations</span>
                    <Badge variant="outline">{dashboardStats?.totalStations?.toLocaleString() || '0'}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm sm:text-base">Working Stations</span>
                    <Badge variant="secondary">{dashboardStats?.workingStations?.toLocaleString() || '0'}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm sm:text-base">Countries</span>
                    <Badge variant="outline">{dashboardStats?.totalCountries || '0'}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm sm:text-base">Languages</span>
                    <Badge variant="outline">{dashboardStats?.totalLanguages || '0'}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm sm:text-base">Genres</span>
                    <Badge variant="outline">{dashboardStats?.totalGenres || '0'}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center text-base sm:text-lg">
                  <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                  Issues & Alerts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm sm:text-base">Offline Stations</span>
                    <Badge variant={offlineStations > 0 ? "destructive" : "secondary"}>
                      {offlineStations}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm sm:text-base">SSL Errors</span>
                    <Badge variant={sslErrorStations > 0 ? "destructive" : "secondary"}>
                      {sslErrorStations}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm sm:text-base">Unresolved Errors</span>
                    <Badge variant={dashboardStats?.unresolvedErrors && dashboardStats.unresolvedErrors > 0 ? "destructive" : "secondary"}>
                      {dashboardStats?.unresolvedErrors || '0'}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm sm:text-base">Open Feedback</span>
                    <Badge variant="outline">{dashboardStats?.openFeedback || '0'}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm sm:text-base">Recent Updates</span>
                    <Badge variant="secondary">{dashboardStats?.recentlyUpdated || '0'}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="recent" className="mt-4 sm:mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center text-base sm:text-lg">
                <Clock className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                Recent Status Checks (Last Hour)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentChecks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No recent status checks in the last hour</p>
                </div>
              ) : (
                <div className="hidden sm:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Station</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Check</TableHead>
                        <TableHead>Country</TableHead>
                        <TableHead>Quality</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentChecks.map((station) => (
                        <TableRow key={station._id}>
                          <TableCell>
                            <div className="font-medium">{station.name}</div>
                            <div className="text-sm text-gray-500">{station.codec} • {station.bitrate} kbps</div>
                          </TableCell>
                          <TableCell>
                            {station.lastcheckok ? (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                                <Wifi className="w-3 h-3 mr-1" />
                                Online
                              </Badge>
                            ) : station.sslError ? (
                              <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                SSL Error
                              </Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100">
                                <WifiOff className="w-3 h-3 mr-1" />
                                Offline
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {format(new Date(station.lastchecktime), 'MMM dd, HH:mm')}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{station.countryCode}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{station.votes} votes</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Mobile view */}
              <div className="sm:hidden space-y-3">
                {recentChecks.slice(0, 10).map((station) => (
                  <Card key={station._id}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium text-sm truncate">{station.name}</div>
                        {station.lastcheckok ? (
                          <Badge className="bg-green-100 text-green-800 text-xs">
                            <Wifi className="w-3 h-3 mr-1" />
                            Online
                          </Badge>
                        ) : station.sslError ? (
                          <Badge className="bg-yellow-100 text-yellow-800 text-xs">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            SSL Error
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 text-xs">
                            <WifiOff className="w-3 h-3 mr-1" />
                            Offline
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{station.codec} • {station.bitrate} kbps</span>
                        <span>{format(new Date(station.lastchecktime), 'MMM dd, HH:mm')}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="problems" className="mt-4 sm:mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center text-base sm:text-lg">
                <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                Problem Stations ({problemStations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {problemStations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500 opacity-50" />
                  <p>No problem stations detected</p>
                </div>
              ) : (
                <>
                  <div className="hidden sm:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Station</TableHead>
                          <TableHead>Issue</TableHead>
                          <TableHead>Last Successful</TableHead>
                          <TableHead>Votes</TableHead>
                          <TableHead>URL</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {problemStations.slice(0, 50).map((station) => (
                          <TableRow key={station._id}>
                            <TableCell>
                              <div className="font-medium">{station.name}</div>
                              <div className="text-sm text-gray-500">{station.countryCode}</div>
                            </TableCell>
                            <TableCell>
                              {station.sslError ? (
                                <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100">SSL Error</Badge>
                              ) : (
                                <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100">Connection Failed</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {station.lastcheckoktime ? 
                                format(new Date(station.lastcheckoktime), 'MMM dd, HH:mm') : 
                                'Never'
                              }
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{station.votes}</Badge>
                            </TableCell>
                            <TableCell>
                              <a 
                                href={station.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline text-sm truncate max-w-48 block"
                              >
                                {station.url}
                              </a>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobile view */}
                  <div className="sm:hidden space-y-3">
                    {problemStations.slice(0, 20).map((station) => (
                      <Card key={station._id}>
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-medium text-sm truncate">{station.name}</div>
                            {station.sslError ? (
                              <Badge className="bg-yellow-100 text-yellow-800 text-xs">SSL Error</Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-800 text-xs">Connection Failed</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground space-y-1">
                            <div>Country: {station.countryCode}</div>
                            <div>Last OK: {station.lastcheckoktime ? 
                              format(new Date(station.lastcheckoktime), 'MMM dd, HH:mm') : 
                              'Never'
                            }</div>
                            <div>Votes: {station.votes}</div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="mt-4 sm:mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center text-base sm:text-lg">
                <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                Popularity Trends
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
                <div className="text-center">
                  <div className="text-2xl sm:text-3xl font-bold text-green-600">{uptrend}</div>
                  <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 flex items-center justify-center">
                    <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                    Trending Up
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl sm:text-3xl font-bold text-red-600">{downtrend}</div>
                  <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 flex items-center justify-center">
                    <TrendingDown className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                    Trending Down
                  </div>
                </div>
              </div>
              
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Station</TableHead>
                      <TableHead>Trend</TableHead>
                      <TableHead>Click Count</TableHead>
                      <TableHead>Votes</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stationList
                      .filter(s => Math.abs(s.clicktrend) > 0)
                      .sort((a, b) => Math.abs(b.clicktrend) - Math.abs(a.clicktrend))
                      .slice(0, 20)
                      .map((station) => (
                        <TableRow key={station._id}>
                          <TableCell>
                            <div className="font-medium">{station.name}</div>
                            <div className="text-sm text-gray-500">{station.countryCode}</div>
                          </TableCell>
                          <TableCell>
                            <Badge 
                              className={station.clicktrend > 0 ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'}
                            >
                              {station.clicktrend > 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                              {Math.abs(station.clicktrend)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{station.clickcount.toLocaleString()}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{station.votes}</Badge>
                          </TableCell>
                          <TableCell>
                            {station.lastcheckok ? (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">Online</Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100">Offline</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile view */}
              <div className="sm:hidden space-y-3">
                {stationList
                  .filter(s => Math.abs(s.clicktrend) > 0)
                  .sort((a, b) => Math.abs(b.clicktrend) - Math.abs(a.clicktrend))
                  .slice(0, 10)
                  .map((station) => (
                    <Card key={station._id}>
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium text-sm truncate">{station.name}</div>
                          <Badge 
                            className={station.clicktrend > 0 ? 'bg-green-100 text-green-800 text-xs' : 'bg-red-100 text-red-800 text-xs'}
                          >
                            {station.clicktrend > 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                            {Math.abs(station.clicktrend)}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{station.clickcount.toLocaleString()} clicks</span>
                          <span>{station.votes} votes</span>
                          {station.lastcheckok ? (
                            <Badge className="bg-green-100 text-green-800 text-xs">Online</Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800 text-xs">Offline</Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
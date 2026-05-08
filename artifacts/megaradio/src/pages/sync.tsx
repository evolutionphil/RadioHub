import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Play, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SyncLog {
  _id: string;
  syncType: 'full' | 'incremental';
  status: 'running' | 'completed' | 'failed';
  stationsProcessed: number;
  stationsAdded: number;
  stationsUpdated: number;
  stationsSkipped: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

interface SyncStatus {
  isRunning: boolean;
  lastFullSync: string | null;
  lastSyncLog: SyncLog | null;
}

export default function SyncStatus() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: syncStatus, isLoading: statusLoading } = useQuery<SyncStatus>({
    queryKey: ['/api/sync/status'],
    refetchInterval: (query) => (query.state.data as any)?.isRunning ? 10000 : 30000, // 10s if running, 30s otherwise
  });

  const { data: syncLogs, isLoading: logsLoading } = useQuery<SyncLog[]>({
    queryKey: ['/api/sync/logs'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const forceSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/sync/force', {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to start sync');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sync/logs'] });
      toast({
        title: "Sync Started",
        description: "Station synchronization has been started.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to start synchronization.",
        variant: "destructive",
      });
    },
  });

  const stopSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/sync/stop', {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to stop sync');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sync/logs'] });
      toast({
        title: "Sync Stopped",
        description: "Station synchronization has been stopped.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Stop Failed",
        description: error.message || "Failed to stop synchronization.",
        variant: "destructive",
      });
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <Badge className="bg-blue-500">Running</Badge>;
      case 'completed':
        return <Badge className="bg-green-500">Completed</Badge>;
      case 'failed':
        return <Badge className="bg-red-500">Failed</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  if (statusLoading || logsLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Sync Status</h1>
        <p className="text-gray-600">Monitor Radio-Browser API synchronization</p>
      </div>

      <div className="grid gap-6">
        {/* Current Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Sync Status</p>
                  <p className="text-2xl font-bold">
                    {syncStatus?.isRunning ? 'Running' : 'Idle'}
                  </p>
                </div>
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  {syncStatus?.isRunning ? (
                    <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
                  ) : (
                    <Clock className="w-6 h-6 text-blue-600" />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Last Full Sync</p>
                  <p className="text-lg font-semibold">
                    {syncStatus?.lastFullSync 
                      ? formatDistanceToNow(new Date(syncStatus.lastFullSync), { addSuffix: true })
                      : 'Never'
                    }
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Actions</p>
                  <div className="flex gap-2 mt-2">
                    <Button
                      onClick={() => forceSyncMutation.mutate()}
                      disabled={syncStatus?.isRunning || forceSyncMutation.isPending}
                      size="sm"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Force Sync
                    </Button>
                    {syncStatus?.isRunning && (
                      <Button
                        onClick={() => stopSyncMutation.mutate()}
                        disabled={stopSyncMutation.isPending}
                        variant="destructive"
                        size="sm"
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        Stop Sync
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Last Sync Details */}
        {syncStatus?.lastSyncLog && (
          <Card>
            <CardHeader>
              <CardTitle>Last Sync Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {syncStatus.lastSyncLog.stationsProcessed}
                  </div>
                  <div className="text-sm text-gray-600">Processed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {syncStatus.lastSyncLog.stationsAdded}
                  </div>
                  <div className="text-sm text-gray-600">Added</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">
                    {syncStatus.lastSyncLog.stationsUpdated}
                  </div>
                  <div className="text-sm text-gray-600">Updated</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-600">
                    {syncStatus.lastSyncLog.stationsSkipped}
                  </div>
                  <div className="text-sm text-gray-600">Skipped</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sync History */}
        <Card>
          <CardHeader>
            <CardTitle>Sync History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Processed</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Skipped</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncLogs?.map((log) => {
                  const duration = log.completedAt && log.startedAt
                    ? Math.round((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000)
                    : null;

                  return (
                    <TableRow key={log._id}>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {getStatusIcon(log.status)}
                          {getStatusBadge(log.status)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {log.syncType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {formatDistanceToNow(new Date(log.startedAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell>
                        {duration ? `${duration}s` : log.status === 'running' ? 'Running...' : '-'}
                      </TableCell>
                      <TableCell>{log.stationsProcessed}</TableCell>
                      <TableCell className="text-green-600">{log.stationsAdded}</TableCell>
                      <TableCell className="text-yellow-600">{log.stationsUpdated}</TableCell>
                      <TableCell className="text-gray-600">{log.stationsSkipped}</TableCell>
                    </TableRow>
                  );
                })}
                {(!syncLogs || syncLogs.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      No sync history available.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
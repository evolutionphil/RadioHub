import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Activity, CheckCircle, XCircle, Clock, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';

interface IndexNowStats {
  totalSubmissions: number;
  successfulSubmissions: number;
  failedSubmissions: number;
  successRate: number;
  submissionsToday: number;
  averageResponseTime: number;
}

interface IndexNowLog {
  _id: string;
  timestamp: Date;
  host: string;
  urlCount: number;
  status: 'success' | 'failed';
  statusCode?: number;
  trigger: string;
  errorMessage?: string;
  sampleUrls?: string[];
  responseTime?: number;
}

export default function IndexNowMonitoring() {
  const [hostFilter, setHostFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Fetch stats with auto-refresh every 30 seconds
  const { data: stats, isLoading: statsLoading } = useQuery<IndexNowStats>({
    queryKey: ['/api/admin/indexnow/stats'],
    staleTime: 30000,
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });

  // Fetch logs with filters and auto-refresh every 30 seconds
  const { data: logs, isLoading: logsLoading } = useQuery<IndexNowLog[]>({
    queryKey: ['/api/admin/indexnow/logs', { host: hostFilter, status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (hostFilter !== 'all') params.append('host', hostFilter);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      
      const response = await fetch(`/api/admin/indexnow/logs?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch logs');
      return response.json();
    },
    staleTime: 30000,
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });

  const formatTimestamp = (timestamp: Date) => {
    return format(new Date(timestamp), 'MMM dd, HH:mm');
  };

  const formatResponseTime = (ms?: number) => {
    if (!ms) return 'N/A';
    return `${ms}ms`;
  };

  return (
    <div className="min-h-screen bg-[#0E0E0E] text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">IndexNow Monitoring</h1>
          <p className="text-gray-400">Monitor IndexNow search engine submissions and performance</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card className="bg-[#1A1A1A] border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">Total Submissions</CardTitle>
              <Activity className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {statsLoading ? '...' : stats?.totalSubmissions.toLocaleString() || 0}
              </div>
              <p className="text-xs text-gray-500 mt-1">All-time submissions</p>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1A] border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">Success Rate</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {statsLoading ? '...' : `${stats?.successRate || 0}%`}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {stats?.successfulSubmissions || 0} successful
              </p>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1A] border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">Submissions Today</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {statsLoading ? '...' : stats?.submissionsToday.toLocaleString() || 0}
              </div>
              <p className="text-xs text-gray-500 mt-1">Last 24 hours</p>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1A] border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">Failed Count</CardTitle>
              <XCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {statsLoading ? '...' : stats?.failedSubmissions.toLocaleString() || 0}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Avg response: {stats?.averageResponseTime || 0}ms
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Table */}
        <Card className="bg-[#1A1A1A] border-gray-800">
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle className="text-white">Submission Logs</CardTitle>
                <CardDescription className="text-gray-400">
                  Recent IndexNow submissions with details
                </CardDescription>
              </div>
              
              <div className="flex gap-3">
                <Select value={hostFilter} onValueChange={setHostFilter}>
                  <SelectTrigger className="w-[180px] bg-[#0E0E0E] border-gray-700 text-white">
                    <SelectValue placeholder="Filter by host" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A1A1A] border-gray-700">
                    <SelectItem value="all">All Hosts</SelectItem>
                    <SelectItem value="themegaradio.com">themegaradio.com</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[160px] bg-[#0E0E0E] border-gray-700 text-white">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A1A1A] border-gray-700">
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="text-center py-8 text-gray-400">Loading logs...</div>
            ) : !logs || logs.length === 0 ? (
              <div className="text-center py-8 text-gray-400">No logs found</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-[#0E0E0E]">
                      <TableHead className="text-gray-400">Timestamp</TableHead>
                      <TableHead className="text-gray-400">Host</TableHead>
                      <TableHead className="text-gray-400">URLs</TableHead>
                      <TableHead className="text-gray-400">Status</TableHead>
                      <TableHead className="text-gray-400">Trigger</TableHead>
                      <TableHead className="text-gray-400">Response Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow 
                        key={log._id} 
                        className="border-gray-800 hover:bg-[#0E0E0E]"
                      >
                        <TableCell className="text-white">
                          {formatTimestamp(log.timestamp)}
                        </TableCell>
                        <TableCell className="text-gray-300">
                          {log.host}
                        </TableCell>
                        <TableCell className="text-gray-300">
                          {log.urlCount} URLs
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={log.status === 'success' ? 'default' : 'destructive'}
                            className={log.status === 'success' 
                              ? 'bg-green-600 hover:bg-green-700' 
                              : 'bg-red-600 hover:bg-red-700'
                            }
                          >
                            {log.status === 'success' ? (
                              <CheckCircle className="w-3 h-3 mr-1" />
                            ) : (
                              <XCircle className="w-3 h-3 mr-1" />
                            )}
                            {log.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-gray-300 capitalize">
                          {log.trigger.replace(/-/g, ' ')}
                        </TableCell>
                        <TableCell className="text-gray-300">
                          {formatResponseTime(log.responseTime)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Activity, CheckCircle, XCircle, Clock, TrendingUp, ChevronDown, ChevronRight, Calendar } from 'lucide-react';
import { format } from 'date-fns';

interface SitemapDiffSubmission {
  _id: string;
  timestamp: string;
  host: string;
  urlCount: number;
  status: 'success' | 'failed';
  statusCode?: number;
  errorMessage?: string;
  sampleUrls: string[];
  language: string;
  responseTime?: number;
}

interface SitemapDiffRun {
  date: string;
  totalUrls: number;
  successfulUrls: number;
  failedUrls: number;
  submissionCount: number;
  submitSuccessCount: number;
  submitFailedCount: number;
  languageBreakdown: Array<{ language: string; urls: number; successful: number; failed: number }>;
  submissions: SitemapDiffSubmission[];
}

interface SitemapDiffRunsResponse {
  runs: SitemapDiffRun[];
  days: number;
}

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
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});

  const { data: diffRunsResp, isLoading: diffRunsLoading } = useQuery<SitemapDiffRunsResponse>({
    queryKey: ['/api/admin/indexnow/sitemap-diff-runs'],
    queryFn: async () => {
      const response = await fetch('/api/admin/indexnow/sitemap-diff-runs?days=14');
      if (!response.ok) throw new Error('Failed to fetch sitemap diff runs');
      return response.json();
    },
    staleTime: 60000,
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
  });
  const diffRuns = diffRunsResp?.runs ?? [];

  const toggleRun = (date: string) => {
    setExpandedRuns((prev) => ({ ...prev, [date]: !prev[date] }));
  };

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

        {/* Nightly sitemap-diff runs (Task #190 surfacing) */}
        <Card className="bg-[#1A1A1A] border-gray-800 mb-8" data-testid="card-sitemap-diff-runs">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-purple-400" />
              <div>
                <CardTitle className="text-white">Nightly Sitemap Diff Runs</CardTitle>
                <CardDescription className="text-gray-400">
                  New URLs that the nightly job pinged to search engines, grouped by night (last 14 days). Expand a row to see the actual URLs submitted.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {diffRunsLoading ? (
              <div className="text-center py-8 text-gray-400">Loading runs...</div>
            ) : diffRuns.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                No sitemap-diff runs in the last 14 days.
              </div>
            ) : (
              <div className="space-y-3">
                {diffRuns.map((run) => {
                  const isOpen = !!expandedRuns[run.date];
                  const allOk = run.submitFailedCount === 0;
                  return (
                    <Collapsible
                      key={run.date}
                      open={isOpen}
                      onOpenChange={() => toggleRun(run.date)}
                    >
                      <CollapsibleTrigger
                        className="w-full text-left"
                        data-testid={`button-toggle-run-${run.date}`}
                      >
                        <div className="flex items-center justify-between p-3 rounded-md bg-[#0E0E0E] border border-gray-800 hover:border-gray-700">
                          <div className="flex items-center gap-3">
                            {isOpen ? (
                              <ChevronDown className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-gray-400" />
                            )}
                            <div>
                              <div className="text-white font-medium" data-testid={`text-run-date-${run.date}`}>
                                {new Date(`${run.date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                                <span className="ml-1 text-xs text-gray-500">UTC</span>
                              </div>
                              <div className="text-xs text-gray-500">
                                {run.submissionCount} submission{run.submissionCount === 1 ? '' : 's'} · {run.languageBreakdown.length} language{run.languageBreakdown.length === 1 ? '' : 's'}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-white font-semibold">
                                {run.totalUrls.toLocaleString()} URLs
                              </div>
                              <div className="text-xs text-gray-500">
                                {run.successfulUrls.toLocaleString()} ok · {run.failedUrls.toLocaleString()} failed
                              </div>
                            </div>
                            <Badge
                              variant={allOk ? 'default' : 'destructive'}
                              className={allOk ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
                            >
                              {allOk ? (
                                <CheckCircle className="w-3 h-3 mr-1" />
                              ) : (
                                <XCircle className="w-3 h-3 mr-1" />
                              )}
                              {allOk ? 'All sent' : `${run.submitFailedCount} failed`}
                            </Badge>
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-2 ml-6 p-4 rounded-md bg-[#0A0A0A] border border-gray-800 space-y-4">
                          <div>
                            <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">
                              Per-language breakdown
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {run.languageBreakdown.map((lb) => (
                                <Badge
                                  key={lb.language}
                                  variant="outline"
                                  className="border-gray-700 text-gray-300"
                                  data-testid={`badge-lang-${run.date}-${lb.language}`}
                                >
                                  <span className="font-semibold mr-1">{lb.language}</span>
                                  {lb.urls.toLocaleString()} URLs
                                  {lb.failed > 0 && (
                                    <span className="ml-1 text-red-400">({lb.failed} failed)</span>
                                  )}
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">
                              Submissions ({run.submissions.length})
                            </div>
                            <div className="overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow className="border-gray-800 hover:bg-transparent">
                                    <TableHead className="text-gray-400">Time</TableHead>
                                    <TableHead className="text-gray-400">Lang</TableHead>
                                    <TableHead className="text-gray-400">URLs</TableHead>
                                    <TableHead className="text-gray-400">Status</TableHead>
                                    <TableHead className="text-gray-400">Sample URLs</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {run.submissions.map((sub) => (
                                    <TableRow
                                      key={sub._id}
                                      className="border-gray-800 hover:bg-[#0E0E0E] align-top"
                                      data-testid={`row-submission-${sub._id}`}
                                    >
                                      <TableCell className="text-white whitespace-nowrap">
                                        {format(new Date(sub.timestamp), 'HH:mm:ss')}
                                      </TableCell>
                                      <TableCell className="text-gray-300">{sub.language}</TableCell>
                                      <TableCell className="text-gray-300">{sub.urlCount}</TableCell>
                                      <TableCell>
                                        <Badge
                                          variant={sub.status === 'success' ? 'default' : 'destructive'}
                                          className={sub.status === 'success'
                                            ? 'bg-green-600 hover:bg-green-700'
                                            : 'bg-red-600 hover:bg-red-700'}
                                        >
                                          {sub.status}
                                          {sub.statusCode ? ` (${sub.statusCode})` : ''}
                                        </Badge>
                                        {sub.errorMessage && (
                                          <div className="text-xs text-red-400 mt-1 max-w-xs truncate" title={sub.errorMessage}>
                                            {sub.errorMessage}
                                          </div>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-gray-300">
                                        {sub.sampleUrls.length === 0 ? (
                                          <span className="text-gray-600 italic">none recorded</span>
                                        ) : (
                                          <ul className="space-y-1 text-xs">
                                            {sub.sampleUrls.map((u, i) => (
                                              <li key={i} className="break-all">
                                                <a
                                                  href={u}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="text-blue-400 hover:underline"
                                                >
                                                  {u}
                                                </a>
                                              </li>
                                            ))}
                                            {sub.urlCount > sub.sampleUrls.length && (
                                              <li className="text-gray-500 italic">
                                                + {(sub.urlCount - sub.sampleUrls.length).toLocaleString()} more (sample only)
                                              </li>
                                            )}
                                          </ul>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

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

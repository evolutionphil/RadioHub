import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Smartphone, Car, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

interface AppLogEntry {
  level: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

interface AppLog {
  _id: string;
  deviceId: string;
  platform: string;
  appVersion: string;
  buildNumber: string;
  isCarPlayLog: boolean;
  logs: AppLogEntry[];
  createdAt: string;
}

interface AppLogsResponse {
  success: boolean;
  count: number;
  total: number;
  logs: AppLog[];
}

const LEVEL_COLORS: Record<string, string> = {
  error: "bg-red-100 text-red-800",
  warn: "bg-yellow-100 text-yellow-800",
  info: "bg-blue-100 text-blue-800",
  debug: "bg-gray-100 text-gray-700",
};

function LogRow({ log }: { log: AppLog }) {
  const [expanded, setExpanded] = useState(false);
  const hasErrors = log.logs.some((l) => l.level === "error");
  const hasWarns = log.logs.some((l) => l.level === "warn");

  return (
    <Card className={`border-l-4 ${log.isCarPlayLog ? "border-l-purple-500" : "border-l-blue-500"}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            {log.isCarPlayLog ? (
              <Badge className="bg-purple-100 text-purple-800">
                <Car className="w-3 h-3 mr-1" /> CarPlay
              </Badge>
            ) : (
              <Badge className="bg-blue-100 text-blue-800">
                <Smartphone className="w-3 h-3 mr-1" /> iOS
              </Badge>
            )}
            {hasErrors && (
              <Badge className="bg-red-100 text-red-800">
                <AlertTriangle className="w-3 h-3 mr-1" /> Has errors
              </Badge>
            )}
            {hasWarns && !hasErrors && (
              <Badge className="bg-yellow-100 text-yellow-800">
                <AlertTriangle className="w-3 h-3 mr-1" /> Has warnings
              </Badge>
            )}
            <span className="text-sm font-mono text-gray-600 truncate max-w-[200px]">{log.deviceId}</span>
            <span className="text-sm text-gray-500">v{log.appVersion}{log.buildNumber ? ` (${log.buildNumber})` : ""}</span>
          </div>
          <div className="text-right shrink-0 ml-4">
            <p className="text-xs text-gray-500">{new Date(log.createdAt).toLocaleString()}</p>
            <p className="text-xs text-gray-400">{log.logs.length} entries</p>
          </div>
        </div>

        {/* Preview: last 2 log lines */}
        <div className="mt-3 space-y-1">
          {log.logs.slice(0, expanded ? undefined : 3).map((entry, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${LEVEL_COLORS[entry.level] ?? "bg-gray-100 text-gray-700"}`}>
                {entry.level.toUpperCase()}
              </span>
              <span className="text-gray-700 font-mono break-all">{entry.message}</span>
              <span className="text-gray-400 shrink-0 ml-auto">{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ""}</span>
            </div>
          ))}
        </div>

        {log.logs.length > 3 && (
          <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setExpanded(!expanded)}>
            {expanded ? <><ChevronUp className="w-3 h-3 mr-1" /> Show less</> : <><ChevronDown className="w-3 h-3 mr-1" /> Show all {log.logs.length} entries</>}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminAppLogs() {
  const [platform, setPlatform] = useState("ios");
  const [isCarPlay, setIsCarPlay] = useState("");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [limit, setLimit] = useState("50");

  const { data, isLoading, refetch } = useQuery<AppLogsResponse>({
    queryKey: ["/api/admin/app-logs", platform, isCarPlay, deviceSearch, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ limit });
      if (platform) params.set("platform", platform);
      if (isCarPlay) params.set("isCarPlay", isCarPlay);
      if (deviceSearch) params.set("deviceId", deviceSearch);
      const res = await fetch(`/api/admin/app-logs?${params}`);
      return res.json() as Promise<AppLogsResponse>;
    },
    staleTime: 30000,
  });

  const { data: crashes } = useQuery<{ success: boolean; count: number; logs: AppLog[] }>({
    queryKey: ["/api/admin/app-logs/crashes"],
    queryFn: () => fetch("/api/admin/app-logs/crashes").then((r) => r.json() as Promise<{ success: boolean; count: number; logs: AppLog[] }>),
    staleTime: 60000,
  });

  const logs = data?.logs ?? [];
  const carplayCount = logs.filter((l) => l.isCarPlayLog).length;
  const errorCount = logs.filter((l) => l.logs.some((e) => e.level === "error")).length;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 space-y-5 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">iOS / CarPlay Logs</h1>
          <p className="text-gray-600 mt-1">Remote logs received from iPhone and CarPlay app</p>
        </div>
        <Button onClick={() => refetch()} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold">{data?.count ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">Sessions shown</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-purple-600">{carplayCount}</p>
            <p className="text-sm text-gray-500 mt-1">CarPlay sessions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-red-600">{errorCount}</p>
            <p className="text-sm text-gray-500 mt-1">Sessions with errors</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-orange-600">{crashes?.count ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">Crash logs</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium">Platform</label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="ios">iOS</SelectItem>
                  <SelectItem value="android">Android</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Type</label>
              <Select value={isCarPlay} onValueChange={setIsCarPlay}>
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="true">CarPlay only</SelectItem>
                  <SelectItem value="false">iPhone only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Device ID</label>
              <Input value={deviceSearch} onChange={(e) => setDeviceSearch(e.target.value)} placeholder="Search device..." />
            </div>
            <div>
              <label className="text-sm font-medium">Limit</label>
              <Select value={limit} onValueChange={setLimit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Log list */}
      {isLoading ? (
        <Card><CardContent className="p-8 text-center"><RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" /><p>Loading logs…</p></CardContent></Card>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Smartphone className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500 font-medium">No logs found</p>
            <p className="text-gray-400 text-sm mt-1">Logs appear here when the iOS/CarPlay app sends them. Logs are kept for 30 days.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {logs.map((log: AppLog) => <LogRow key={log._id} log={log} />)}
        </div>
      )}
    </div>
  );
}

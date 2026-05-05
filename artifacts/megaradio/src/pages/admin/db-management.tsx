import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

interface CollectionStat {
  name: string;
  count: number;
  sizeMB: number;
  storageSizeMB: number;
  indexSizeMB: number;
}

interface DbStatus {
  totalSizeMB: number;
  storageSizeMB: number;
  indexSizeMB: number;
  collections: CollectionStat[];
  quotaStatus: {
    quotaExceeded: boolean;
    quotaExceededAt: string | null;
    cooldownRemainingMs: number;
  };
}

export default function DbManagement() {
  const [cleanupResult, setCleanupResult] = useState<any>(null);

  const { data: dbStatus, isLoading, refetch } = useQuery<DbStatus>({
    queryKey: ["/api/admin/db-status"],
  });

  const cleanupMutation = useMutation({
    mutationFn: async (collections?: string[]) => {
      const res = await apiRequest("POST", "/api/admin/db-cleanup", {
        collections: collections || undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setCleanupResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/db-status"] });
    },
  });

  const dropMutation = useMutation({
    mutationFn: async (collection: string) => {
      const res = await apiRequest("POST", "/api/admin/db-drop-collection", { collection });
      return res.json();
    },
    onSuccess: (data) => {
      setCleanupResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/db-status"] });
    },
  });

  const usagePct = dbStatus ? Math.round((dbStatus.storageSizeMB / 512) * 100) : 0;

  return (
    <div className="p-6 space-y-6 bg-white min-h-screen">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Database Management</h2>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          Refresh
        </Button>
      </div>

      {isLoading && <p className="text-gray-600">Loading...</p>}

      {dbStatus && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-white border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-500">Data Size</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-gray-900">{dbStatus.totalSizeMB} MB</p>
              </CardContent>
            </Card>
            <Card className="bg-white border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-500">Storage Size</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-gray-900">{dbStatus.storageSizeMB} MB</p>
              </CardContent>
            </Card>
            <Card className="bg-white border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-500">Index Size</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-gray-900">{dbStatus.indexSizeMB} MB</p>
              </CardContent>
            </Card>
            <Card className={`border ${usagePct >= 90 ? 'bg-red-50 border-red-300' : 'bg-white'}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-500">Quota Usage (512 MB)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-2xl font-bold ${usagePct >= 90 ? 'text-red-600' : 'text-gray-900'}`}>
                  {usagePct}%
                </p>
                {dbStatus.quotaStatus.quotaExceeded && (
                  <p className="text-xs text-red-500 mt-1">Writes paused!</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-white border">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg text-gray-900">Collections</CardTitle>
              <Button
                onClick={() => cleanupMutation.mutate()}
                disabled={cleanupMutation.isPending}
                variant="destructive"
                size="sm"
              >
                {cleanupMutation.isPending ? "Cleaning..." : "Clean All Logs"}
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 text-gray-700">Collection</th>
                      <th className="text-right py-2 px-3 text-gray-700">Documents</th>
                      <th className="text-right py-2 px-3 text-gray-700">Data (MB)</th>
                      <th className="text-right py-2 px-3 text-gray-700">Storage (MB)</th>
                      <th className="text-right py-2 px-3 text-gray-700">Indexes (MB)</th>
                      <th className="text-right py-2 px-3 text-gray-700">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbStatus.collections.map((col) => {
                      const cleanable = [
                        'analyticsevents', 'synclogs', 'stationdebuglogs',
                        'bulkdescriptionjobs', 'visitorsessions', 'userlisteninghistories',
                        'applogs'
                      ].includes(col.name.toLowerCase());
                      const droppable = [
                        'applogs', 'analyticsevents', 'stationdebuglogs', 'bulkdescriptionjobs'
                      ].includes(col.name.toLowerCase());
                      return (
                        <tr key={col.name} className="border-b hover:bg-gray-50">
                          <td className="py-2 px-3 text-gray-900 font-medium">{col.name}</td>
                          <td className="py-2 px-3 text-right text-gray-700">{col.count?.toLocaleString()}</td>
                          <td className="py-2 px-3 text-right text-gray-700">{col.sizeMB}</td>
                          <td className="py-2 px-3 text-right text-gray-700">{col.storageSizeMB}</td>
                          <td className="py-2 px-3 text-right text-gray-700">{col.indexSizeMB}</td>
                          <td className="py-2 px-3 text-right space-x-1">
                            {cleanable && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-red-600 border-red-300 hover:bg-red-50"
                                disabled={cleanupMutation.isPending}
                                onClick={() => cleanupMutation.mutate([col.name])}
                              >
                                Clean
                              </Button>
                            )}
                            {droppable && (
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={dropMutation.isPending}
                                onClick={() => {
                                  if (confirm(`"${col.name}" collection tamamen silinecek. Emin misin?`)) {
                                    dropMutation.mutate(col.name);
                                  }
                                }}
                              >
                                Drop
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {cleanupResult && (
            <Card className="bg-green-50 border-green-300">
              <CardHeader>
                <CardTitle className="text-lg text-green-800">Cleanup Results</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-sm text-green-700 whitespace-pre-wrap">
                  {JSON.stringify(cleanupResult, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

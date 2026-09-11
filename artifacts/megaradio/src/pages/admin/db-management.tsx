import { AdminPage } from "./AdminPage";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { OPERATIONAL_TABLES } from '@/lib/admin-operations';

const FLUSH_CONFIRM_PHRASE = "FLUSH";

interface FlushStationsResult {
  success?: boolean;
  message?: string;
  deletedStations?: number;
  deletedSyncLogs?: number;
  deletedBlacklisted?: number;
}

interface CollectionStat {
  name: string;
  count: number;
  sizeMB: number;
  storageSizeMB: number;
  indexSizeMB: number;
}

interface DbStatus {
  engine?: string;
  countsAreEstimates?: boolean;
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
  const [flushDialogOpen, setFlushDialogOpen] = useState(false);
  const [flushConfirmText, setFlushConfirmText] = useState("");
  const [flushResult, setFlushResult] = useState<FlushStationsResult | null>(null);
  const { toast } = useToast();

  const { data: dbStatus, isLoading, isError, refetch } = useQuery<DbStatus>({
    queryKey: ["/api/admin/db-status"],
  });

  const flushCounts = useMemo(() => {
    const findCount = (name: string) =>
      dbStatus?.collections.find(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      )?.count ?? 0;
    return {
      stations: findCount("stations"),
      synclogs: findCount("catalog_sync_runs"),
      blacklistedstations: findCount("blacklisted_stations"),
    };
  }, [dbStatus]);

  const flushMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/flush-stations");
      return (await res.json()) as FlushStationsResult;
    },
    onSuccess: (data) => {
      setFlushResult(data);
      setFlushDialogOpen(false);
      setFlushConfirmText("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/db-status"] });
      toast({
        title: "Stations flushed",
        description: `Deleted ${data.deletedStations ?? 0} stations, ${
          data.deletedSyncLogs ?? 0
        } sync logs, and ${data.deletedBlacklisted ?? 0} blacklisted entries.`,
      });
    },
    onError: (error: unknown) => {
      const description =
        error instanceof Error ? error.message : "Failed to flush station data.";
      toast({
        title: "Flush failed",
        description,
        variant: "destructive",
      });
    },
  });

  const flushConfirmed =
    flushConfirmText.trim().toUpperCase() === FLUSH_CONFIRM_PHRASE;

  const cleanupMutation = useMutation({
    mutationFn: async (collections?: string[]) => {
      const res = await apiRequest("POST", "/api/admin/db-cleanup", {
        body: { collections: collections || undefined },
      });
      return res.json();
    },
    onSuccess: (data) => {
      setCleanupResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/db-status"] });
    },
    onError: (error: Error) => toast({ title: 'Cleanup failed', description: error.message, variant: 'destructive' }),
  });

  const dropMutation = useMutation({
    mutationFn: async (collection: string) => {
      const res = await apiRequest("POST", "/api/admin/db-drop-collection", { body: { collection } });
      return res.json();
    },
    onSuccess: (data) => {
      setCleanupResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/db-status"] });
    },
    onError: (error: Error) => toast({ title: 'Clear failed', description: error.message, variant: 'destructive' }),
  });
  const mutationPending = flushMutation.isPending || cleanupMutation.isPending || dropMutation.isPending;

  return (
    <AdminPage
      title="Database Management"
      actions={
        <>
          <Button
            onClick={() => {
              setFlushConfirmText("");
              setFlushDialogOpen(true);
            }}
            variant="destructive"
            size="sm"
            disabled={flushMutation.isPending}
            data-testid="button-open-flush-stations"
          >
            {flushMutation.isPending ? "Flushing..." : "Flush all stations"}
          </Button>
          <Button onClick={() => refetch()} variant="outline" size="sm">
            Refresh
          </Button>
        </>
      }
    >

      {isLoading && <p className="text-gray-600">Loading...</p>}
      {isError && <p role="alert" className="text-destructive">Unable to load database status. Refresh to retry.</p>}

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
            <Card className="border bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-500">Database Engine</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-gray-900">PostgreSQL</p>
                <p className="text-xs text-gray-500 mt-1">Storage limits and billing are managed in Railway.</p>
                {dbStatus.quotaStatus.quotaExceeded && (
                  <p className="text-xs text-red-500 mt-1">Writes paused!</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-white border">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg text-gray-900">Tables {dbStatus.countsAreEstimates ? '(estimated row counts)' : ''}</CardTitle>
              <Button
                onClick={() => { if (confirm('Delete operational records under the retention policy? Analytics events are cleared entirely; old logs and listening history are removed.')) cleanupMutation.mutate(undefined); }}
                disabled={mutationPending}
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
                      <th className="text-left py-2 px-3 text-gray-700">Table</th>
                      <th className="text-right py-2 px-3 text-gray-700">Rows</th>
                      <th className="text-right py-2 px-3 text-gray-700">Data (MB)</th>
                      <th className="text-right py-2 px-3 text-gray-700">Storage (MB)</th>
                      <th className="text-right py-2 px-3 text-gray-700">Indexes (MB)</th>
                      <th className="text-right py-2 px-3 text-gray-700">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbStatus.collections.map((col) => {
                      const operation = OPERATIONAL_TABLES[col.name];
                      const cleanable = !!operation;
                      const droppable = operation?.clearable;
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
                                disabled={mutationPending}
                                onClick={() => { if (confirm(`Apply retention cleanup to ${col.name}? Deleted rows cannot be restored here.`)) cleanupMutation.mutate([operation.target]); }}
                              >
                                Clean
                              </Button>
                            )}
                            {droppable && (
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={mutationPending}
                                onClick={() => {
                                  if (confirm(`Clear records in "${col.name}"? The PostgreSQL table and indexes will be preserved.`)) {
                                    dropMutation.mutate(operation.target);
                                  }
                                }}
                              >
                                Clear
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
            <Card className={cleanupResult.success === false ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}>
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

          {flushResult && (
            <Card className="bg-green-50 border-green-300">
              <CardHeader>
                <CardTitle className="text-lg text-green-800">Flush Results</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-sm text-green-700 whitespace-pre-wrap" data-testid="text-flush-result">
                  {JSON.stringify(flushResult, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <AlertDialog
        open={flushDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setFlushDialogOpen(false);
            setFlushConfirmText("");
          }
        }}
      >
        <AlertDialogContent
          className="bg-white border border-gray-200 shadow-lg text-gray-900"
          data-testid="dialog-confirm-flush-stations"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Flush all station data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently wipes every station, sync log, and blacklisted-station
              record from the database. This cannot be undone — the team will receive
              an audit email recording the action.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div
            className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm"
            data-testid="list-flush-preview"
          >
            <div className="font-medium text-gray-900 mb-2">Will be deleted:</div>
            <ul className="space-y-1 text-gray-700">
              <li className="flex justify-between" data-testid="row-flush-preview-stations">
                <span>Stations</span>
                <span className="font-mono">{flushCounts.stations.toLocaleString()}</span>
              </li>
              <li className="flex justify-between" data-testid="row-flush-preview-synclogs">
                <span>Sync logs</span>
                <span className="font-mono">{flushCounts.synclogs.toLocaleString()}</span>
              </li>
              <li className="flex justify-between" data-testid="row-flush-preview-blacklisted">
                <span>Blacklisted stations</span>
                <span className="font-mono">
                  {flushCounts.blacklistedstations.toLocaleString()}
                </span>
              </li>
            </ul>
          </div>

          <div className="space-y-2 pt-1">
            <Label htmlFor="flush-confirm-input" className="text-sm text-gray-700">
              Type <span className="font-mono font-semibold">{FLUSH_CONFIRM_PHRASE}</span> to
              confirm:
            </Label>
            <Input
              id="flush-confirm-input"
              data-testid="input-flush-confirm"
              value={flushConfirmText}
              onChange={(e) => setFlushConfirmText(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-flush-stations">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-flush-stations"
              disabled={!flushConfirmed || flushMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!flushConfirmed || flushMutation.isPending) return;
                flushMutation.mutate();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              {flushMutation.isPending ? "Flushing..." : "Flush all stations"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPage>
  );
}

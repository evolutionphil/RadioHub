import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Trash2, RefreshCw } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SemrushSummary {
  total: number;
  byPriority: { priority: string; count: number }[];
  topIssueTypes: { type: string; count: number }[];
  lastImportedAt: string | null;
  expiresAt: string | null;
}

interface SemrushIssue {
  _id: string;
  url: string;
  statusCode: number;
  issueType: string;
  issueDescription: string;
  priority: "High" | "Medium" | "Low" | "Info";
  importedAt: string;
}

interface IssuesResponse {
  total: number;
  page: number;
  limit: number;
  items: SemrushIssue[];
}

// ─── Component ───────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  High: "destructive",
  Medium: "warning",
  Low: "secondary",
  Info: "outline",
};

export default function SemrushIssues() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [priorityFilter, setPriorityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const summaryQuery = useQuery<SemrushSummary>({
    queryKey: ["/api/admin/semrush/summary"],
    staleTime: 30_000,
  });

  const issuesQuery = useQuery<IssuesResponse>({
    queryKey: ["/api/admin/semrush/issues", page, priorityFilter, typeFilter],
    staleTime: 30_000,
  });

  const importMutation = useMutation<{ count: number; message: string }, Error, string>({
    mutationFn: async (csv: string) => {
      // Send as raw text/csv to bypass the 2 MB JSON body limit (CSVs can be 3-10 MB).
      const r = await fetch("/api/admin/semrush/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: csv,
        credentials: "include",
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as any).error ?? `HTTP ${r.status}`);
      }
      return r.json();
    },
    onSuccess: (data) => {
      toast({ title: "Import complete", description: `${data.count} issues imported` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/semrush/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/semrush/issues"] });
      setPage(1);
    },
    onError: (e) => toast({ title: "Import failed", description: e?.message, variant: "destructive" }),
  });

  const clearMutation = useMutation<{ message: string }, Error>({
    mutationFn: () => apiRequest("DELETE", "/api/admin/semrush/issues").then((r) => r.json()),
    onSuccess: (data) => {
      toast({ title: "Cleared", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/semrush/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/semrush/issues"] });
    },
    onError: (e) => toast({ title: "Clear failed", description: e?.message, variant: "destructive" }),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const csv = ev.target?.result as string;
      if (csv) importMutation.mutate(csv);
    };
    reader.readAsText(file, "utf-8");
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  const summary = summaryQuery.data;
  const issues = issuesQuery.data;
  const totalPages = issues ? Math.ceil(issues.total / issues.limit) : 1;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SEMrush Site Audit Issues</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Import a SEMrush Site Audit CSV export to see crawl errors, broken links, and on-page issues.
          </p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
            Import CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/admin/semrush/summary"] });
              queryClient.invalidateQueries({ queryKey: ["/api/admin/semrush/issues"] });
            }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Instructions */}
      <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
        <CardContent className="pt-4 text-sm text-blue-800 dark:text-blue-200 space-y-1">
          <p className="font-semibold">How to export from SEMrush:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Open SEMrush → Projects → your site → Site Audit</li>
            <li>Go to "Issues" tab → click the export button (↓) → Export as CSV</li>
            <li>Click "Import CSV" above and select the downloaded file</li>
          </ol>
          <p className="text-xs mt-2">Columns used: URL, Status Code, Issue (Type), Description, Priority. Other columns are ignored.</p>
        </CardContent>
      </Card>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-3xl font-bold">{summary.total.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Total issues</div>
            </CardContent>
          </Card>
          {summary.byPriority.map((p) => (
            <Card key={p.priority}>
              <CardContent className="pt-4">
                <div className={`text-3xl font-bold ${p.priority === 'High' ? 'text-red-500' : p.priority === 'Medium' ? 'text-yellow-500' : 'text-muted-foreground'}`}>
                  {p.count.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">{p.priority} priority</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Top issue types */}
      {summary && summary.topIssueTypes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top Issue Types</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {summary.topIssueTypes.map((t) => (
              <button
                key={t.type}
                className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/70 transition-colors"
                onClick={() => { setTypeFilter(t.type); setPage(1); }}
              >
                {t.type} <span className="font-bold ml-1">{t.count}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Filters + table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Issues</CardTitle>
            <div className="flex items-center gap-2">
              <select
                className="text-sm border rounded px-2 py-1"
                value={priorityFilter}
                onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
              >
                <option value="">All priorities</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
                <option value="Info">Info</option>
              </select>
              <Input
                placeholder="Filter by type…"
                value={typeFilter}
                onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
                className="w-48 h-8 text-sm"
              />
              {(priorityFilter || typeFilter) && (
                <Button variant="ghost" size="sm" onClick={() => { setPriorityFilter(""); setTypeFilter(""); setPage(1); }}>
                  Clear
                </Button>
              )}
              {summary && summary.total > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { if (confirm("Delete all SEMrush issues?")) clearMutation.mutate(); }}
                  disabled={clearMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              )}
            </div>
          </div>
          {summary?.lastImportedAt && (
            <CardDescription className="text-xs">
              Last import: {new Date(summary.lastImportedAt).toLocaleString()}
              {summary.expiresAt ? ` · expires ${new Date(summary.expiresAt).toLocaleDateString()}` : ""}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {issuesQuery.isLoading ? (
            <div className="flex items-center justify-center h-24 text-muted-foreground">
              <Loader2 className="animate-spin h-5 w-5 mr-2" /> Loading…
            </div>
          ) : !issues || issues.total === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              No issues found. Import a SEMrush CSV to get started.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-2 font-medium">Priority</th>
                      <th className="text-left px-4 py-2 font-medium">Issue Type</th>
                      <th className="text-left px-4 py-2 font-medium">URL</th>
                      <th className="text-left px-4 py-2 font-medium">Status</th>
                      <th className="text-left px-4 py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.items.map((issue) => (
                      <tr key={issue._id} className="border-b hover:bg-muted/20">
                        <td className="px-4 py-2">
                          <Badge variant={(PRIORITY_COLORS[issue.priority] ?? "outline") as any}>
                            {issue.priority}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 max-w-[160px] truncate text-xs">{issue.issueType}</td>
                        <td className="px-4 py-2 max-w-[240px]">
                          <a
                            href={issue.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline truncate block text-xs"
                            title={issue.url}
                          >
                            {issue.url}
                          </a>
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {issue.statusCode > 0 ? (
                            <span className={issue.statusCode >= 400 ? "text-red-500 font-medium" : "text-muted-foreground"}>
                              {issue.statusCode}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground max-w-[200px] truncate" title={issue.issueDescription}>
                          {issue.issueDescription || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-xs text-muted-foreground">
                    {issues.total.toLocaleString()} issues · page {page} of {totalPages}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>›</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

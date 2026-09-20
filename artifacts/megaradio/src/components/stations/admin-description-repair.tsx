import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Global repair deliberately does not inherit the current table selection. */
export default function AdminDescriptionRepair({ busy, onStarted }: {
  busy: boolean;
  onStarted: (jobId: string, total: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const repair = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/admin/stations/repair-description-gaps', { body: {} });
      const result = await response.json();
      if (result.success && (!result.jobId || !Number.isInteger(result.total) || result.total < 1)) {
        throw new Error('The server did not return a valid repair job. Check job status before retrying.');
      }
      if (!result.success && result.total !== 0) throw new Error(result.error || 'Could not start description repair');
      return result;
    },
    retry: false,
    onSuccess: result => {
      setOpen(false);
      if (!result.success) {
        toast({ title: 'No automatic repairs needed', description: result.message || 'No eligible stations have missing or detected invalid descriptions.' });
        return;
      }
      onStarted(result.jobId, result.total);
      toast({ title: 'Description repair started', description: `${result.total.toLocaleString()} stations queued across all 14 languages. Progress is saved as stations finish.` });
    },
  });
  return <>
    <Button type="button" variant="outline" className="w-full sm:w-auto border-primary/40 text-primary hover:bg-primary/10"
      disabled={busy || repair.isPending} data-testid="button-repair-all-descriptions" onClick={() => { repair.reset(); setOpen(true); }}>
      <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />Bulk AI repair · 14 languages
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!repair.isPending) setOpen(value); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Repair descriptions across the catalogue</DialogTitle>
          <DialogDescription>One background job for every eligible station, not just this page or your current filters.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
            <p className="font-medium">All 14 site languages · full descriptions + SEO metadata</p>
            <p className="text-muted-foreground">Fills missing content and repairs detected invalid translations. Valid text and manually protected descriptions stay unchanged. Excluded and redirected stations are skipped.</p>
          </div>
          <p className="text-muted-foreground">Uses GPT-4o mini; API charges may apply. Requests are rate-limited and the site stays available. You can close the progress window or cancel the job. Re-running checks remaining gaps instead of rewriting complete content.</p>
          <p className="text-xs text-muted-foreground">Automatic checks detect specific translation defects, not every possible language or factual error. Review flagged failures after completion.</p>
          {repair.error && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-destructive">{repair.error.message}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={repair.isPending} onClick={() => setOpen(false)}>Not now</Button>
            <Button type="button" disabled={busy || repair.isPending} onClick={() => repair.mutate()}>
              {repair.isPending ? 'Finding eligible stations…' : 'Start catalogue repair'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminStationPageWindow } from '@/lib/admin-station-list';

export default function AdminStationPagination({ page, limit, total, onPageChange, onLimitChange }: {
  page: number; limit: number; total: number; onPageChange: (page: number) => void; onLimitChange: (value: string) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return <div className="space-y-3 border-t border-border px-4 py-4 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <div className="flex items-center gap-2"><Label htmlFor="admin-stations-page-size">Rows per page</Label>
        <Select value={String(limit)} onValueChange={onLimitChange}><SelectTrigger id="admin-stations-page-size" className="w-20"><SelectValue /></SelectTrigger><SelectContent>
          {[10, 20, 50, 100, 200].map(size => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
        </SelectContent></Select>
      </div>
      <p className="tabular-nums">{total ? `${((page - 1) * limit + 1).toLocaleString()}–${Math.min(page * limit, total).toLocaleString()} of ${total.toLocaleString()}` : '0 results'}</p>
    </div>
    {pages > 1 && <nav aria-label="Station pages" className="flex flex-wrap items-center justify-between gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>Previous</Button>
      <span className="text-xs text-muted-foreground sm:hidden">Page {page} / {pages}</span>
      <div className="hidden items-center gap-1 sm:flex">
        <Button type="button" variant="ghost" size="sm" onClick={() => onPageChange(1)} disabled={page <= 1}>First</Button>
        {adminStationPageWindow(page, pages).map(number => <Button key={number} type="button" variant={page === number ? 'default' : 'ghost'} size="sm" onClick={() => onPageChange(number)} aria-label={`Page ${number}`} aria-current={page === number ? 'page' : undefined}>{number}</Button>)}
        <Button type="button" variant="ghost" size="sm" onClick={() => onPageChange(pages)} disabled={page >= pages}>Last</Button>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pages}>Next</Button>
    </nav>}
  </div>;
}

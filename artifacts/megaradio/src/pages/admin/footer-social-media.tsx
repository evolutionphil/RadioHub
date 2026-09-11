import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AdminPage } from './AdminPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

const platforms = ['facebook', 'instagram', 'twitter', 'linkedin', 'whatsapp', 'telegram', 'reddit', 'pinterest', 'youtube', 'tiktok'];
type Draft = { platform: string; url: string; isActive: boolean; position: number };
type SocialLink = Draft & { _id: string };
type Change = { method: 'POST' | 'PATCH'; data: Draft; id?: string } | { method: 'DELETE'; id: string };
const emptyDraft = (): Draft => ({ platform: 'facebook', url: '', isActive: true, position: 0 });
export default function FooterSocialMediaAdmin() {
  const client = useQueryClient(); const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SocialLink | null>(null);
  const links = useQuery<SocialLink[]>({ queryKey: ['/api/admin/footer-social-media'] });
  const reset = () => { setDraft(emptyDraft()); setEditingId(null); setShowForm(false); };
  const mutation = useMutation({
    mutationFn: async (change: Change) => {
      await apiRequest(change.method, `/api/admin/footer-social-media${change.id ? `/${encodeURIComponent(change.id)}` : ''}`,
        change.method === 'DELETE' ? {} : { body: change.data });
    },
    onSuccess: (_, change) => {
      void client.invalidateQueries({ queryKey: ['/api/admin/footer-social-media'] });
      void client.invalidateQueries({ queryKey: ['/api/footer-social-media'] });
      if (change.method === 'DELETE') {
        setDeleteTarget(null);
        if (editingId === change.id) reset();
      } else reset();
      toast({ description: change.method === 'DELETE' ? 'Social media link deleted.' : 'Social media link saved.' });
    },
    onError: () => toast({ description: 'The change could not be saved. Your form has been kept; check the current data before retrying.', variant: 'destructive' }),
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (mutation.isPending || links.isError || !links.data) return;
    try {
      const url = new URL(draft.url.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch { toast({ description: 'Enter a valid http:// or https:// URL without credentials.', variant: 'destructive' }); return; }
    if (!Number.isSafeInteger(draft.position) || draft.position < 0 || draft.position > 10000) return;
    mutation.mutate({ method: editingId ? 'PATCH' : 'POST', id: editingId ?? undefined, data: { ...draft, url: draft.url.trim() } });
  };
  return <AdminPage title="Footer Social Media Links" actions={<Button disabled={links.isPending || links.isError || mutation.isPending} onClick={() => { reset(); setShowForm(true); }}>Add Social Media Link</Button>}>
    {links.isPending ? <p role="status">Loading social media links…</p> : links.isError ? <div role="alert"><p>Social media links could not be loaded.</p><Button variant="outline" onClick={() => void links.refetch()}>Retry</Button></div> : <>
      {showForm && <Card><CardHeader><CardTitle>{editingId ? 'Edit Social Media Link' : 'Add New Social Media Link'}</CardTitle></CardHeader><CardContent>
        <form onSubmit={submit}><fieldset disabled={mutation.isPending} className="space-y-4">
          <div><Label htmlFor="social-platform">Platform</Label><select id="social-platform" className="mt-2 block w-full rounded-md border p-2" value={draft.platform} onChange={e => setDraft({ ...draft, platform: e.target.value })}>{platforms.map(platform => <option key={platform} value={platform}>{platform === 'twitter' ? 'Twitter / X' : platform}</option>)}</select></div>
          <div><Label htmlFor="social-url">URL</Label><Input id="social-url" type="url" required maxLength={2048} value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} placeholder="https://facebook.com/..." /></div>
          <div><Label htmlFor="social-position">Position (Order)</Label><Input id="social-position" type="number" required min={0} max={10000} step={1} value={draft.position} onChange={e => setDraft({ ...draft, position: Number(e.target.value) })} /></div>
          <div className="flex items-center gap-2"><input id="social-active" type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} /><Label htmlFor="social-active">Active</Label></div>
          <div className="flex gap-2"><Button type="submit">{mutation.isPending ? 'Saving…' : editingId ? 'Update' : 'Create'}</Button><Button type="button" variant="outline" onClick={reset}>Cancel</Button></div>
        </fieldset></form>
      </CardContent></Card>}
      <div className="grid gap-4">{links.data?.map(item => <Card key={item._id}><CardContent className="pt-6"><div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1"><h2 className="font-semibold capitalize">{item.platform}</h2><p className="break-all text-sm text-muted-foreground">{item.url}</p><p className="mt-2 text-xs">Position: {item.position} | {item.isActive ? 'Active' : 'Inactive'}</p></div>
        <div className="flex gap-2"><Button variant="outline" disabled={mutation.isPending} aria-label={`Edit ${item.platform}`} onClick={() => { setEditingId(item._id); setDraft({ platform: item.platform, url: item.url, position: item.position, isActive: item.isActive }); setShowForm(true); }}>Edit</Button><Button variant="destructive" disabled={mutation.isPending} aria-label={`Delete ${item.platform}`} onClick={() => setDeleteTarget(item)}>Delete</Button></div>
      </div></CardContent></Card>)}</div>
      {!links.data?.length && !showForm && <p>No social media links configured yet. Add one to get started.</p>}
    </>}
    <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open && !mutation.isPending) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this social media link?</AlertDialogTitle><AlertDialogDescription>This removes the {deleteTarget?.platform} destination from the footer. Other links are unchanged.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={mutation.isPending} onClick={event => { event.preventDefault(); if (deleteTarget && !mutation.isPending) mutation.mutate({ method: 'DELETE', id: deleteTarget._id }); }}>Confirm delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </AdminPage>;
}

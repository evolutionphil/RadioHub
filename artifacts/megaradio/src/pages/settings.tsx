import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AdminPage } from './admin/AdminPage';

const sections = [
  ['Homepage', 'Discoverable genres and homepage content.', '/admin/home-settings'],
  ['Social media', 'Footer destinations and visibility.', '/admin/footer-social-media'],
  ['Languages', 'Supported languages and translations.', '/admin/translation-languages'],
  ['Provider synchronization', 'Import schedules and synchronization status.', '/admin/sync'],
  ['Advertisements', 'Advertising placements and creatives.', '/admin/advertisements'],
  ['Paddle', 'Premium plans and Paddle price mappings.', '/admin/paddle-plans'],
  ['Stripe', 'Stripe plans and price mappings.', '/admin/stripe-plans'],
  ['TV and apps', 'Supported versions and store links.', '/admin/tv-version'],
  ['API access', 'Developer API keys and access.', '/admin/api-keys'],
  ['Database', 'PostgreSQL storage statistics and maintenance.', '/admin/db-management'],
] as const;

/** Infrastructure options are environment-managed, not arbitrary JSON settings.
 * Do not recreate the removed /api/settings endpoint with non-functional saves. */
export default function Settings() {
  const { data, isPending, isError, isFetching, refetch } = useQuery<{
    health?: { database?: 'online' | 'offline'; translations?: 'active' | 'empty' };
  }>({ queryKey: ['/api/dashboard/stats'], staleTime: 30_000 });
  return <AdminPage title="System Settings" description="Manage application settings in their dedicated sections.">
    <Card>
      <CardHeader><CardTitle>Runtime configuration</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Database connections, SMTP credentials, signing secrets, HTTPS, CORS and resource limits are managed through the deployment configuration in Railway. They are not editable in this panel. Changes there may require a redeployment.</p>
        {isPending ? <p role="status">Loading runtime status…</p>
          : isError ? <p role="alert">Runtime status could not be loaded. No settings have been changed.</p>
          : <p>PostgreSQL status: {data?.health?.database === 'online' ? 'Online' : data?.health?.database === 'offline' ? 'Offline' : 'Unknown'}</p>}
        <Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>{isFetching ? 'Checking…' : 'Refresh runtime status'}</Button>
      </CardContent>
    </Card>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {sections.map(([title, description, href]) => <Card key={href}>
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{description}</p>
          <Button variant="outline" asChild><Link href={href}>Manage {title.toLowerCase()}</Link></Button>
        </CardContent>
      </Card>)}
    </div>
  </AdminPage>;
}

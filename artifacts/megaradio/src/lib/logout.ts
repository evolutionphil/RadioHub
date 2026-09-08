import { apiRequest, queryClient } from './queryClient';

let pending: Promise<void> | undefined;
export function logoutAccount(): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    await apiRequest('POST', '/api/auth/logout');
    // Revoke first. A failed request must not falsely claim the session ended.
    try { sessionStorage.removeItem('_mrt_oat'); } catch {}
    try { localStorage.removeItem('_mrt_is_premium'); } catch {}
    await queryClient.cancelQueries();
    queryClient.clear();
    queryClient.setQueryData(['/api/auth/me'], { authenticated: false, user: null });
  })().finally(() => { pending = undefined; });
  return pending;
}

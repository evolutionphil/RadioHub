import { queryClient } from './queryClient';

// Module-level + window-level guard. The module flag handles normal startup;
// the window flag survives Vite HMR re-evaluations in dev, where the module
// can be re-imported and `started` reset to false. Without the window guard
// a fast HMR cycle while the page still has `?auth_token` in the URL would
// re-POST token-session.
let started = false;
declare global {
  interface Window {
    __oauthExchangeStarted?: boolean;
  }
}

export function initOAuthTokenExchange(): void {
  if (started) return;
  if (typeof window !== 'undefined' && window.__oauthExchangeStarted) return;
  started = true;
  if (typeof window !== 'undefined') window.__oauthExchangeStarted = true;

  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  const authToken = params.get('auth_token');

  console.log('[AUTH] init — URL:', window.location.href);
  console.log('[AUTH] init — auth_token:', authToken ? `${authToken.slice(0, 16)}…(${authToken.length})` : 'NONE');

  if (!authToken) return;

  params.delete('auth_token');
  // Preserve the URL hash fragment (e.g. #section-id) — losing it would
  // break deep-links that the OAuth round-trip was supposed to return to.
  const search = params.toString();
  const cleanUrl =
    window.location.pathname +
    (search ? `?${search}` : '') +
    (window.location.hash || '');
  console.log('[AUTH] init — cleaning URL →', cleanUrl);
  window.history.replaceState({}, '', cleanUrl);

  queryClient.cancelQueries({ queryKey: ['/api/auth/me'] }).catch(() => {});
  queryClient.setQueryData(['/api/auth/me'], { user: null, authenticated: false, _pendingTokenExchange: true });

  const t0 = performance.now();
  console.log('[AUTH] init — POST /api/auth/token-session');
  fetch('/api/auth/token-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: authToken }),
    credentials: 'include',
  })
    .then(async (res) => {
      const elapsed = Math.round(performance.now() - t0);
      console.log(`[AUTH] init — token-session status:${res.status} elapsed:${elapsed}ms`);
      if (!res.ok) {
        const errBody = await res.text().catch(() => '(unreadable)');
        console.error('[AUTH] init — token-session FAILED:', res.status, errBody);
        await queryClient.cancelQueries({ queryKey: ['/api/auth/me'] }).catch(() => {});
        queryClient.setQueryData(['/api/auth/me'], { user: null, authenticated: false });
        queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
        return;
      }
      let body: any = null;
      try {
        body = await res.json();
      } catch (e) {
        console.error('[AUTH] init — token-session JSON parse failed:', e);
      }
      if (body?.user) {
        console.log('[AUTH] init — hydrating user from token-session response');
        await queryClient.cancelQueries({ queryKey: ['/api/auth/me'] }).catch(() => {});
        queryClient.setQueryData(['/api/auth/me'], { user: body.user, authenticated: true });
      } else {
        console.log('[AUTH] init — no user in body, invalidating /me');
        await queryClient.cancelQueries({ queryKey: ['/api/auth/me'] }).catch(() => {});
        queryClient.setQueryData(['/api/auth/me'], { user: null, authenticated: false });
        queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      }
    })
    .catch((err) => {
      console.error('[AUTH] init — token-session fetch threw:', err);
      queryClient.cancelQueries({ queryKey: ['/api/auth/me'] }).catch(() => {});
      queryClient.setQueryData(['/api/auth/me'], { user: null, authenticated: false });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
    });
}

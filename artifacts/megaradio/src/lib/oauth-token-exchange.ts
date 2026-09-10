import { queryClient } from './queryClient';
import { logger } from './logger';

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

  if (!authToken) return;

  params.delete('auth_token');
  // Preserve the URL hash fragment (e.g. #section-id) — losing it would
  // break deep-links that the OAuth round-trip was supposed to return to.
  const search = params.toString();
  const cleanUrl =
    window.location.pathname +
    (search ? `?${search}` : '') +
    (window.location.hash || '');
  window.history.replaceState({}, '', cleanUrl);

  queryClient.cancelQueries({ queryKey: ['/api/auth/me'] }).catch(() => {});
  queryClient.setQueryData(['/api/auth/me'], { user: null, authenticated: false, _pendingTokenExchange: true });

  // Never log the callback URL, token (even a prefix), response body or user.
  logger.debug('[AUTH] Starting session exchange');
  fetch('/api/auth/token-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: authToken }),
    credentials: 'include',
  })
    .then(async (res) => {
      if (!res.ok) {
        logger.error('[AUTH] Session exchange failed; recovering existing session', res.status);
        // Use fetchQuery (not invalidateQueries) so the /me refetch fires even
        // when useAuth has enabled:false (set because ?auth_token was in the URL
        // at module load time). This recovers the user from their active session
        // cookie / Bearer token instead of leaving them stuck logged-out.
        queryClient.fetchQuery({ queryKey: ['/api/auth/me'] }).catch(() => {});
        return;
      }
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        logger.error('[AUTH] Session exchange returned invalid JSON');
      }
      if (body?.user) {
        logger.debug('[AUTH] Session exchange completed');
        await queryClient.cancelQueries({ queryKey: ['/api/auth/me'] }).catch(() => {});
        queryClient.setQueryData(['/api/auth/me'], { user: body.user, authenticated: true });
        // Persist the auth token as a Bearer fallback so subsequent API
        // requests succeed even when the session cookie is blocked by the
        // browser (SameSite=None cookies dropped in strict privacy modes).
        try { sessionStorage.setItem('_mrt_oat', authToken); } catch (_) {}
      } else {
        logger.debug('[AUTH] Recovering existing session');
        // fetchQuery bypasses the enabled:false guard so the user is restored
        // from their active session/Bearer token rather than stuck logged-out.
        queryClient.fetchQuery({ queryKey: ['/api/auth/me'] }).catch(() => {});
      }
    })
    .catch(() => {
      logger.error('[AUTH] Session exchange request failed; recovering existing session');
      queryClient.fetchQuery({ queryKey: ['/api/auth/me'] }).catch(() => {});
    });
}

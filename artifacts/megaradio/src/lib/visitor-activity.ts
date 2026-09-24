import { classifyVisitorReferral, sanitizeVisitorPagePath } from '@workspace/seo-shared/visitor-activity';
import { apiFetch } from './queryClient';

// Small first-party, best-effort navigation measurement. No user ID, cookies,
// persistent identifiers, arbitrary event payloads or third-party SDKs.
const sent = new Map<string, number>();
let windowStart = 0;
let windowCount = 0;
let hasReportedNavigation = false;

function allowed(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return document.visibilityState !== 'hidden' && navigator.onLine !== false
    && !['1', 'yes'].includes(navigator.doNotTrack ?? '') && !nav.globalPrivacyControl;
}

/** Only committed route changes are measured. Fast redirects/unmounts cancel
 * the deferred request; failed sends are never retried and never affect UX. */
export function scheduleVisitorPageView(location: string): () => void {
  const path = sanitizeVisitorPagePath(location);
  if (!path || !allowed()) return () => {};
  let controller: AbortController | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    if (!allowed()) return;
    const now = Date.now();
    if (now - windowStart >= 60_000) { windowStart = now; windowCount = 0; }
    if (windowCount >= 30 || (sent.has(path) && now - sent.get(path)! < 2_000)) return;
    windowCount++;
    sent.delete(path);
    sent.set(path, now);
    if (sent.size > 64) sent.delete(sent.keys().next().value!);
    controller = new AbortController();
    deadline = setTimeout(() => controller?.abort(), 5_000);
    // document.referrer is reduced to a fixed category before transmission.
    // Subsequent SPA navigation originates inside the site, not at the original
    // referrer. The server labels this event as a client-reported observation.
    const referralCategory = !hasReportedNavigation && initialDocumentPath === location
      ? classifyVisitorReferral(document.referrer) : 'internal';
    hasReportedNavigation = true;
    void Promise.resolve().then(() => apiFetch('/api/visitor-activity/page-view', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, referralCategory }), signal: controller!.signal,
    })).catch(() => {}).finally(() => clearTimeout(deadline));
  }, 1_000);
  return () => { clearTimeout(timer); clearTimeout(deadline); controller?.abort(); };
}

const initialDocumentPath = typeof window !== 'undefined' ? window.location.pathname : '';

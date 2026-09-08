/** Accept same-origin relative destinations only; preserve legitimate TV/payment query/hash. */
export function safeAuthReturnTo(value: string | null | undefined): string | null {
  if (!value || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://auth-return.invalid');
    if (url.origin !== 'https://auth-return.invalid') return null;
    const decodedPath = decodeURIComponent(url.pathname);
    if (decodedPath.startsWith('//') || decodedPath.includes('\\') || /[\u0000-\u001f\u007f]/.test(decodedPath)) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}

export function withAuthReturnTo(destination: string, returnTo: string | null | undefined): string {
  const target = safeAuthReturnTo(returnTo);
  if (!target) return destination;
  const url = new URL(destination, 'https://auth-return.invalid');
  url.searchParams.set('returnTo', target);
  return url.pathname + url.search + url.hash;
}

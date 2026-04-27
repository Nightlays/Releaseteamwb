/* Proxy helper — оборачивает запросы через локальный прокси :8787 */

export type ProxyMode = 'query' | 'prefix';

export interface ProxyOptions {
  base:     string;         // http://localhost:8787
  mode?:    ProxyMode;      // default: 'query'
  headers?: Record<string, string>;
  signal?:  AbortSignal;
}

function buildUrl(opts: ProxyOptions, targetUrl: string): string {
  const mode = opts.mode ?? 'query';
  const base = opts.base.replace(/\/+$/, '');
  if (mode === 'prefix') {
    return `${base}/prefix/${targetUrl}`;
  }
  return `${base}/proxy?url=` + encodeURIComponent(targetUrl);
}

function buildFallbackUrl(opts: ProxyOptions, targetUrl: string): string | null {
  const base = opts.base.replace(/\/+$/, '');
  if ((opts.mode ?? 'query') === 'prefix') {
    return `${base}/proxy?url=` + encodeURIComponent(targetUrl);
  }
  return `${base}/?url=` + encodeURIComponent(targetUrl);
}

export async function proxyFetch(
  opts: ProxyOptions,
  targetUrl: string,
  init?: RequestInit
): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const requestInit: RequestInit = {
    ...init,
    headers: { ...headers, ...((init?.headers as Record<string, string> | undefined) ?? {}) },
    signal: opts.signal,
  };
  const primaryUrl = buildUrl(opts, targetUrl);
  const fallbackUrl = buildFallbackUrl(opts, targetUrl);
  const response = await fetch(primaryUrl, requestInit);

  if (response.status !== 404 || !fallbackUrl || fallbackUrl === primaryUrl) {
    return response;
  }

  return fetch(fallbackUrl, requestInit);
}

export async function proxyJson<T>(
  opts: ProxyOptions,
  targetUrl: string,
  init?: RequestInit
): Promise<T> {
  const resp = await proxyFetch(opts, targetUrl, init);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} — ${targetUrl}`);
  return resp.json() as Promise<T>;
}

export async function checkProxy(base: string): Promise<boolean> {
  const root = base.replace(/\/$/, '');
  for (const path of ['/healthz', '/health']) {
    try {
      const resp = await fetch(root + path, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) return true;
    } catch {
      /* continue */
    }
  }
  return false;
}

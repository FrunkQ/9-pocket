// A tiny hash router: the app is a static site, so routes live after the "#".
import { useSyncExternalStore } from 'react';

export interface Route {
  parts: string[];
  query: URLSearchParams;
}

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path, search = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(search) };
}

let cachedHash = '';
let cachedRoute: Route = parse('');

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedRoute = parse(hash);
  }
  return cachedRoute;
}

export function href(parts: string[], query?: Record<string, string | undefined>): string {
  const path = parts.map(encodeURIComponent).join('/');
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v);
  const qs = q.toString();
  return `#/${path}${qs ? `?${qs}` : ''}`;
}

export function go(parts: string[], query?: Record<string, string | undefined>) {
  window.location.hash = href(parts, query);
}

export function goBack(fallback: string) {
  if (window.history.length > 1) window.history.back();
  else window.location.hash = fallback;
}

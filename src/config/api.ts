// Which Rift API the payment widget talks to (rates + invoice verification).
//
// Production is the default and is unchanged. Sandbox is opt-in:
//
//   * URL param  ?env=sandbox          (append to the payment link)
//   * Build-time VITE_API_BASE_URL     (self-hosted / dedicated sandbox deploy)
//   * Hostname   pay.sandbox.X / widget.sandbox.X / sandbox.pay.X -> sandbox.X
//
// Arbitrary API URLs are NOT accepted from the query string (a crafted link
// must not be able to redirect a legitimate widget origin to another server).

const PROD_API = 'https://payment.riftfi.xyz';
const SANDBOX_API = (import.meta.env.VITE_SANDBOX_API_BASE_URL as string | undefined) || 'https://sandbox.riftfi.com';

function strip(u: string): string {
  return u.replace(/\/+$/, '');
}

function requestedEnv(): 'sandbox' | 'production' | null {
  if (typeof window === 'undefined') return null;
  const v = (new URLSearchParams(window.location.search).get('env') || '').trim().toLowerCase();
  return v === 'sandbox' || v === 'production' ? v : null;
}

function resolveApiBase(): string {
  if (requestedEnv() === 'sandbox') return strip(SANDBOX_API);
  const explicit = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (explicit) return strip(explicit);
  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    const m = host.match(/^(?:pay|widget|payment)\.(sandbox|staging)\.(.+)$/) || host.match(/^(sandbox|staging)\.(?:pay|widget|payment)\.(.+)$/);
    if (m) return `https://${m[1]}.${m[2]}`;
  }
  return PROD_API;
}

export const API_BASE = resolveApiBase();

export const IS_SANDBOX: boolean = (() => {
  if (requestedEnv() === 'sandbox') return true;
  try {
    return /^sandbox\./i.test(new URL(API_BASE).hostname);
  } catch {
    return false;
  }
})();

/**
 * Optional PUBLIC project key (e.g. `pk_...` or an existing key format),
 * read from `?key=`. Sent as X-API-Key on invoice verification when present.
 * Any prefix is accepted; the widget does not validate the format.
 */
export function projectKeyFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const k = (new URLSearchParams(window.location.search).get('key') || '').trim();
  return k || null;
}

/** Headers for Rift API calls. Production adds nothing beyond JSON + optional key. */
export function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  const key = projectKeyFromUrl();
  if (key) h['X-API-Key'] = key;
  if (IS_SANDBOX) h['X-Rift-Mode'] = 'sandbox';
  return h;
}

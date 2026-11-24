import { API_BASE, apiHeaders } from '../config/api';

export interface CurrencyRate {
  currency: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  /** Local fiat per 1 USDC for onramp (fiat→crypto). null = corridor not supported on this side. */
  onramp: number | null;
  /** Local fiat per 1 USDC for offramp (crypto→fiat). null = corridor not supported on this side. */
  offramp: number | null;
  /** Largest local amount allowed in one onramp/offramp transaction (backend txnLimits). Informational here: invoice payments are on-chain and not capped by it. */
  perTransactionMax?: number;
  isDefault: boolean;
  error?: string;
}

export interface RatesResponse {
  base: string;
  detectedCountry: string | null;
  defaultCurrency: string | null;
  currencies: CurrencyRate[];
  updatedAt: string;
}

export interface RatesError {
  error: string;
  code: string;
}

const RATES_URL = `${API_BASE}/v1/rates`;

export async function fetchRates(): Promise<RatesResponse> {
  // apiHeaders() is empty in production without ?key=, so the request stays a
  // simple CORS GET; sandbox adds X-Rift-Mode (allowed by the backend CORS list).
  const headers = apiHeaders();
  const res = await fetch(RATES_URL, Object.keys(headers).length ? { headers } : undefined);
  if (!res.ok) throw new Error('Could not load rates');
  return res.json();
}

export function localToUsdc(localAmount: number, rate: number | null): number {
  if (!rate || rate <= 0) return 0;
  return localAmount / rate;
}

export function usdcToLocal(usdcAmount: number, rate: number | null): number {
  if (!rate || rate <= 0) return 0;
  return usdcAmount * rate;
}

export interface CurrencyMeta {
  cc: string;
  name: string;
  dec: number;
  group: 'african' | 'reserve';
}

export const CURRENCY_META: Record<string, CurrencyMeta> = {
  KES: { cc: 'ke', name: 'Kenyan Shilling', dec: 0, group: 'african' },
  NGN: { cc: 'ng', name: 'Nigerian Naira', dec: 0, group: 'african' },
  GHS: { cc: 'gh', name: 'Ghanaian Cedi', dec: 2, group: 'african' },
  UGX: { cc: 'ug', name: 'Ugandan Shilling', dec: 0, group: 'african' },
  TZS: { cc: 'tz', name: 'Tanzanian Shilling', dec: 0, group: 'african' },
  MWK: { cc: 'mw', name: 'Malawian Kwacha', dec: 2, group: 'african' },
  // Synthetic base currency added client-side (not returned by GET /v1/rates).
  USD: { cc: 'us', name: 'US Dollar', dec: 2, group: 'reserve' },
};

/**
 * Display metadata for a currency. GET /v1/rates returns name/decimals for
 * every corridor (KES, UGX, TZS, GHS, MWK, NGN); those win over the local
 * table. Unknown codes from the rates list are African corridors.
 */
export function metaFor(code: string, rate?: Pick<CurrencyRate, 'name' | 'decimals'> | null): CurrencyMeta {
  const local = CURRENCY_META[code];
  const base: CurrencyMeta = local || { cc: code.slice(0, 2).toLowerCase(), name: code, dec: 2, group: code === 'USD' ? 'reserve' : 'african' };
  return {
    ...base,
    ...(rate?.name ? { name: rate.name } : {}),
    ...(typeof rate?.decimals === 'number' ? { dec: rate.decimals } : {}),
  };
}

/**
 * The rate the PAYER converts at.
 *
 * This page is read by whoever is paying, and they are always going the same
 * way: local currency into crypto. That is the ONRAMP side — and on a link
 * paid by mobile money it is literally the rate they are charged.
 *
 * The offramp rate is what the MERCHANT receives when they later settle that
 * crypto back to local currency. It sits a few per cent the other side, and
 * showing it here made the page quote a figure that no payer would ever be
 * charged.
 *
 * Falls back to offramp only so a corridor that cannot be bought this minute
 * still shows an indicative figure for an on-chain payment, instead of the
 * currency vanishing from the list.
 */
export function payerRate(c: CurrencyRate | null | undefined): number | null {
  if (!c) return null;
  if (c.onramp !== null && c.onramp > 0) return c.onramp;
  if (c.offramp !== null && c.offramp > 0) return c.offramp;
  return null;
}

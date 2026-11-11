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

const RATES_URL = 'https://payment.riftfi.xyz/v1/rates';

export async function fetchRates(): Promise<RatesResponse> {
  const res = await fetch(RATES_URL);
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

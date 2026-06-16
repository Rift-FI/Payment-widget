export interface CurrencyRate {
  currency: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  /** Local fiat per 1 USDC for onramp (fiat→crypto). null = corridor not supported on this side. */
  onramp: number | null;
  /** Local fiat per 1 USDC for offramp (crypto→fiat). Always present. */
  offramp: number;
  isDefault: boolean;
  error?: string;
}

export interface RatesResponse {
  base: string;
  detectedCountry: string;
  defaultCurrency: string;
  currencies: CurrencyRate[];
  updatedAt: string;
}

export interface RatesError {
  error: string;
  code: string;
}

const RATES_URL = 'https://payment.riftfi.xyz/rates';

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
  ZAR: { cc: 'za', name: 'South African Rand', dec: 2, group: 'african' },
  USD: { cc: 'us', name: 'US Dollar', dec: 2, group: 'reserve' },
  EUR: { cc: 'eu', name: 'Euro', dec: 2, group: 'reserve' },
  GBP: { cc: 'gb', name: 'British Pound', dec: 2, group: 'reserve' },
};

export function metaFor(code: string): CurrencyMeta {
  return CURRENCY_META[code] || { cc: 'un', name: code, dec: 2, group: 'reserve' };
}

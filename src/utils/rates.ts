export interface CurrencyRate {
  currency: string;
  onramp: number;
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

export function localToUsdc(localAmount: number, onramp: number): number {
  if (!onramp || onramp <= 0) return 0;
  return localAmount / onramp;
}

export function usdcToLocal(usdcAmount: number, onramp: number): number {
  return usdcAmount * onramp;
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
  USD: { cc: 'us', name: 'US Dollar', dec: 2, group: 'reserve' },
};

export function metaFor(code: string): CurrencyMeta {
  return CURRENCY_META[code] || { cc: 'un', name: code, dec: 2, group: 'reserve' };
}

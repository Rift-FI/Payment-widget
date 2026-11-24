import { API_BASE, apiHeaders } from '../config/api';

/**
 * Paying a payment link with mobile money.
 *
 * The payer is prompted on their phone, pays fiat, and Rift releases the
 * crypto straight to the link's own recipient address. The widget never
 * handles the money and never needs a key: the amount comes from the invoice
 * server-side, not from anything this file sends.
 *
 * Nigeria is absent on purpose. NGN onramps settle by bank transfer, with no
 * prompt to push, so showing "check your phone" there would be a lie.
 */

export interface Market {
  currency: string;
  country: string;
  dial: string;
  networks: string[];
  /** Example placeholder in the local shape people actually type. */
  placeholder: string;
}

export const MARKETS: Market[] = [
  { currency: 'KES', country: 'Kenya',      dial: '254', networks: ['Safaricom', 'Airtel'],              placeholder: '0712 345 678' },
  { currency: 'UGX', country: 'Uganda',     dial: '256', networks: ['MTN', 'Airtel'],                    placeholder: '0772 000 000' },
  { currency: 'TZS', country: 'Tanzania',   dial: '255', networks: ['Vodacom', 'Airtel', 'Halotel', 'Yas'], placeholder: '0712 345 678' },
  { currency: 'GHS', country: 'Ghana',      dial: '233', networks: ['MTN', 'AirtelTigo', 'Telecel'],     placeholder: '020 123 4567' },
  { currency: 'MWK', country: 'Malawi',     dial: '265', networks: ['Airtel', 'TNM Mpamba'],             placeholder: '099 123 4567' },
  { currency: 'CDF', country: 'DR Congo',   dial: '243', networks: ['Airtel Money', 'Mpesa'],            placeholder: '081 234 5678' },
];

export const findMarket = (currency: string): Market | undefined =>
  MARKETS.find((m) => m.currency === currency.toUpperCase());

export interface OnrampQuote {
  currency: string;
  fiatAmount: number;
  cryptoAmount: number;
  rate: number;
  fee: number;
}

export interface OnrampStatus {
  orderId: string;
  status: 'awaiting_payment' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'expired' | 'refunded' | 'refunding';
  currency?: string;
  fiatAmount?: string | number;
  cryptoAmount?: string | number;
  transactionHash?: string | null;
  reason?: string;
  message?: string;
}

export class OnrampError extends Error {
  constructor(public code: string, message: string, public status?: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: apiHeaders({ 'Content-Type': 'application/json', ...(init?.headers as any) }),
    });
  } catch {
    throw new OnrampError('NETWORK', "Couldn't reach the network. Check your connection and try again.");
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    throw new OnrampError(
      body?.error || 'REQUEST_FAILED',
      body?.message || 'That did not go through. Try again.',
      res.status
    );
  }
  return body as T;
}

/** What the payer will be charged, before any prompt is sent. */
export function quoteOnramp(invoiceId: string, currency: string): Promise<OnrampQuote> {
  return call<OnrampQuote>(
    `/v1/invoices/${encodeURIComponent(invoiceId)}/onramp/quote?currency=${encodeURIComponent(currency)}`
  );
}

/** Send the prompt. */
export function startOnramp(
  invoiceId: string,
  body: { phone: string; network: string; currency: string }
): Promise<OnrampStatus & { message?: string }> {
  return call(`/v1/invoices/${encodeURIComponent(invoiceId)}/onramp`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getOnramp(invoiceId: string, orderId: string): Promise<OnrampStatus> {
  return call<OnrampStatus>(
    `/v1/invoices/${encodeURIComponent(invoiceId)}/onramp/${encodeURIComponent(orderId)}`
  );
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired', 'refunded']);
export const isTerminal = (s: string) => TERMINAL.has(s);

/**
 * Poll until the collection settles. STK prompts usually resolve in under a
 * minute but can sit unanswered until the operator times them out, so this
 * polls for a few minutes and then stops rather than spinning forever.
 */
export async function pollOnramp(
  invoiceId: string,
  orderId: string,
  onUpdate: (s: OnrampStatus) => void,
  opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<OnrampStatus> {
  const interval = opts.intervalMs ?? 3000;
  const deadline = Date.now() + (opts.timeoutMs ?? 4 * 60 * 1000);
  let last: OnrampStatus = { orderId, status: 'processing' };
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return last;
    try {
      last = await getOnramp(invoiceId, orderId);
      onUpdate(last);
      if (isTerminal(last.status)) return last;
    } catch {
      // A blip mid-poll is not a failed payment — keep waiting.
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return last;
}

/** Local formatting for a fiat amount, e.g. "KES 1,350". */
export function formatFiat(amount: number, currency: string): string {
  const decimals = currency.toUpperCase() === 'GHS' ? 2 : 0;
  return `${currency.toUpperCase()} ${amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

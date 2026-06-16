export interface InvoiceData {
  chain: string;
  token: string;
  amount: number;
  address: string;
  invoiceId?: string;
  userId?: string;
  projectId?: string;
  orderId?: string;
  exchangeRate?: number;
  originUrl?: string;
}

export interface MpesaPaymentData {
  shortcode: string;
  mobile_network: 'Safaricom';
  country_code: 'KES';
  amount: number;
  chain: 'BASE';
  asset: 'USDC';
  address: string;
  user_id: string;
  project_id: string;
}

// Simple types for the payment widget
export type SupportedChain = 'BASE' | 'POLYGON' | 'ARBITRUM' | 'ETHEREUM' | 'CELO';
export type SupportedToken = 'USDC' | 'USDT';
export interface InvoiceData {
  chain: string;
  token: string;
  amount: number;
  address: string;
  userId?: string;
  projectId?: string;
  exchangeRate?: number;
}

export interface MpesaPaymentData {
  shortcode: string;
  mobile_network: 'Safaricom' | 'Airtel';
  country_code: 'KES';
  amount: number;
  chain: 'BASE';
  asset: 'USDC';
  address: string;
  user_id: string;
  project_id: string;
}

// Simple types for the payment widget
export type SupportedChain = 'POLYGON' | 'ETHEREUM' | 'BASE' | 'ARBITRUM' | 'OPTIMISM';
export type SupportedToken = 'USDC' | 'USDT' | 'ETH' | 'MATIC';
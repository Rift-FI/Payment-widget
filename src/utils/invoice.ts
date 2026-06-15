import { InvoiceData } from '../types';

export function decodeInvoice(encodedInvoice: string): InvoiceData | null {
  try {
    const decodedString = atob(encodedInvoice);
    const invoiceData: InvoiceData = JSON.parse(decodedString);

    // amount=0 is allowed — it means "open" (customer enters amount)
    if (!invoiceData.chain || !invoiceData.token || !invoiceData.address) {
      throw new Error('Invalid invoice data: missing required fields');
    }

    if (invoiceData.amount === undefined || invoiceData.amount === null) {
      throw new Error('Invalid invoice data: amount is missing');
    }

    if (!invoiceData.address.match(/^0x[a-fA-F0-9]{40}$/)) {
      throw new Error('Invalid address format');
    }

    if (invoiceData.amount < 0) {
      throw new Error('Invalid amount: must not be negative');
    }

    return invoiceData;
  } catch (error) {
    console.error('Failed to decode invoice:', error);
    return null;
  }
}

export function getInvoiceFromUrl(): InvoiceData | null {
  const urlParams = new URLSearchParams(window.location.search);
  const encodedInvoice = urlParams.get('invoice');
  
  if (!encodedInvoice) {
    console.error('No invoice parameter found in URL');
    return null;
  }
  
  return decodeInvoice(encodedInvoice);
}

export function formatAmount(amount: number, decimals: number = 6): string {
  return amount.toFixed(decimals).replace(/\.?0+$/, '');
}

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
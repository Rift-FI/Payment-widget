import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useDisconnect } from 'wagmi';
import { parseUnits } from 'viem';
import { InvoiceData, MpesaPaymentData } from '../types';
import { getInvoiceFromUrl, formatAmount, formatAddress } from '../utils/invoice';
import { getChainConfig, getTokenConfig, getAvailableTokens, AVAILABLE_CHAINS } from '../config/chains';
import { Copy, Check, AlertCircle, Wallet, LogOut, Phone, ChevronRight } from 'lucide-react';

export default function PaymentWidget() {
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [selectedChain, setSelectedChain] = useState<string>('BASE');
  const [selectedToken, setSelectedToken] = useState<string>('USDC');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'crypto' | 'mpesa'>('mpesa');
  const [transactionCode, setTransactionCode] = useState<string | null>(null);
  const [mpesaData, setMpesaData] = useState<{ shortcode: string; mobile_network: 'Safaricom' }>({
    shortcode: '',
    mobile_network: 'Safaricom'
  });

  const { address, isConnected, chain } = useAccount();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { switchChain } = useSwitchChain();
  const { disconnect } = useDisconnect();

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  useEffect(() => {
    const invoice = getInvoiceFromUrl();
    if (invoice) {
      setInvoiceData(invoice);
    } else {
      setError('Invalid or missing invoice data');
    }
  }, []);

  // Reset token selection when chain changes (pick first available)
  useEffect(() => {
    const tokens = getAvailableTokens(selectedChain);
    if (tokens.length > 0 && !tokens.find(t => t.symbol === selectedToken)) {
      setSelectedToken(tokens[0].symbol);
    }
  }, [selectedChain, selectedToken]);

  // Verify crypto payment with backend and auto-redirect after confirmation
  useEffect(() => {
    if (!isConfirmed || !hash) return;

    // If this is an invoice payment, notify the backend
    if (invoiceData?.invoiceId) {
      fetch('https://payment.riftfi.xyz/invoices/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoiceData.invoiceId,
          transactionHash: hash,
          chain: selectedChain,
        }),
      }).catch((err) => console.error('Failed to verify invoice payment:', err));
    }

    if (invoiceData?.originUrl) {
      const returnUrl = buildReturnUrl(invoiceData.originUrl, {
        hash,
        ...(invoiceData.orderId && { order_id: invoiceData.orderId }),
      });
      const redirectTimer = setTimeout(() => {
        window.location.href = returnUrl;
      }, 2000);

      return () => clearTimeout(redirectTimer);
    }
  }, [isConfirmed, hash, invoiceData?.invoiceId, invoiceData?.originUrl, invoiceData?.orderId, selectedChain]);

  // Auto-redirect for M-Pesa payment after transaction code is received
  useEffect(() => {
    if (transactionCode && invoiceData?.originUrl) {
      const redirectTimer = setTimeout(() => {
        const returnUrl = buildReturnUrl(invoiceData.originUrl as string, {
          transaction_code: transactionCode,
          ...(invoiceData.orderId && { order_id: invoiceData.orderId }),
        });
        window.location.href = returnUrl;
      }, 5000);

      return () => clearTimeout(redirectTimer);
    }
  }, [transactionCode, invoiceData?.originUrl, invoiceData?.orderId]);

  const handleCopyAddress = async () => {
    if (!invoiceData) return;
    try {
      await navigator.clipboard.writeText(invoiceData.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  const handlePayment = async () => {
    if (!invoiceData || !isConnected || !address) {
      setError('Please connect your wallet first');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const chainConfig = getChainConfig(selectedChain);
      if (!chainConfig) {
        throw new Error(`Unsupported chain: ${selectedChain}`);
      }

      if (chain?.id !== chainConfig.id) {
        await switchChain({ chainId: chainConfig.id });
        return;
      }

      const tokenConfig = getTokenConfig(selectedChain, selectedToken);
      if (!tokenConfig) {
        throw new Error(`${selectedToken} not supported on ${selectedChain}`);
      }

      const value = parseUnits(invoiceData.amount.toString(), tokenConfig.decimals);

      await writeContract({
        address: tokenConfig.address as `0x${string}`,
        abi: [
          {
            type: 'function',
            name: 'transfer',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
            outputs: [{ name: '', type: 'bool' }],
            stateMutability: 'nonpayable',
          },
        ],
        functionName: 'transfer',
        args: [invoiceData.address as `0x${string}`, value],
      });
    } catch (err: any) {
      console.error('Payment failed:', err);
      setError(err.message || 'Payment failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const validateMpesaNumber = (number: string): boolean => {
    const kenyaRegex = /^(?:\+?254|0)?([17][0-9]{8})$/;
    return kenyaRegex.test(number);
  };

  const convertToKES = (usdAmount: number): number => {
    const exchangeRate = invoiceData?.exchangeRate || 129.7;
    return usdAmount * exchangeRate;
  };

  const formatKES = (amount: number): string => {
    return `KES ${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  };

  const buildReturnUrl = (baseUrl: string, params: Record<string, string>): string => {
    const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
    try {
      const url = new URL(baseUrl);
      entries.forEach(([name, value]) => url.searchParams.set(name, value));
      return url.toString();
    } catch {
      const separator = baseUrl.includes('?') ? '&' : '?';
      const query = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      return `${baseUrl}${separator}${query}`;
    }
  };

  const handleMpesaPayment = async () => {
    if (!invoiceData || !invoiceData.userId || !invoiceData.projectId) {
      const missing: string[] = [];
      if (!invoiceData) missing.push('invoice data');
      if (!invoiceData?.userId) missing.push('user ID');
      if (!invoiceData?.projectId) missing.push('project ID');
      setError(`Missing required payment information: ${missing.join(', ')}. Please check the payment link.`);
      return;
    }

    if (!validateMpesaNumber(mpesaData.shortcode)) {
      setError('Please enter a valid Kenyan phone number (e.g., 0712345678)');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setTransactionCode(null);

    try {
      const paymentData: MpesaPaymentData = {
        shortcode: mpesaData.shortcode,
        mobile_network: mpesaData.mobile_network,
        country_code: 'KES',
        amount: invoiceData.amount,
        chain: 'BASE',
        asset: 'USDC',
        address: invoiceData.address,
        user_id: invoiceData.userId,
        project_id: invoiceData.projectId
      };

      const queryParams = new URLSearchParams({
        shortcode: paymentData.shortcode,
        amount: paymentData.amount.toString(),
        chain: paymentData.chain,
        asset: paymentData.asset,
        mobile_network: paymentData.mobile_network,
        country_code: paymentData.country_code,
        address: paymentData.address,
        user_id: paymentData.user_id,
        project_id: paymentData.project_id,
        ...(invoiceData.invoiceId && { invoice_id: invoiceData.invoiceId }),
      });

      const redirectUrl = `https://payment.riftfi.xyz/pay/open-ramp?${queryParams.toString()}`;

      const response = await fetch(redirectUrl, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error('Failed to initiate M-Pesa payment. Please try again.');
      }

      const data = await response.json();
      const txCode =
        data?.data?.data?.transaction_code ||
        data?.data?.transaction_code ||
        data?.transaction_code;

      if (!txCode) {
        throw new Error('Missing transaction code in response.');
      }

      setTransactionCode(txCode);
    } catch (err: any) {
      console.error('M-Pesa payment failed:', err);
      setError(err.message || 'M-Pesa payment failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Error / loading states ───────────────────────────────────────────────

  if (error && !invoiceData) {
    return (
      <div className="min-h-screen bg-[#E9F1F4] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-xl font-semibold text-[#1F2D3A] mb-2">Payment Error</h2>
          <p className="text-[#1F2D3A]/70">{error}</p>
        </div>
      </div>
    );
  }

  if (!invoiceData) {
    return (
      <div className="min-h-screen bg-[#E9F1F4] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="animate-pulse-subtle">
            <div className="w-16 h-16 bg-[#E9F1F4] rounded-full flex items-center justify-center mx-auto mb-4">
              <Wallet className="w-8 h-8 text-[#2E8C96]" />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-[#1F2D3A] mb-2">Loading Payment</h2>
          <p className="text-[#1F2D3A]/70">Preparing your payment details...</p>
        </div>
      </div>
    );
  }

  const availableTokens = getAvailableTokens(selectedChain);

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#E9F1F4] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="bg-white px-6 py-8 text-center relative overflow-hidden border-b border-[#E9F1F4]">
          <div className="absolute inset-0 opacity-5">
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-[#2E8C96]/10 to-transparent"></div>
            <div className="absolute top-4 right-4 w-32 h-32 border border-[#2E8C96]/10 rounded-full"></div>
            <div className="absolute bottom-4 left-4 w-24 h-24 border border-[#2E8C96]/10 rounded-full"></div>
          </div>

          <div className="relative z-10">
            <div className="flex items-center justify-center mx-auto mb-4">
              <img src="/logo.png" alt="Rift Finance Logo" className="w-16 h-16 object-contain" />
            </div>
            <h1 className="text-2xl font-bold mb-1 text-[#1F2D3A]">Payment Request</h1>
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="w-2 h-2 bg-[#2E8C96] rounded-full"></div>
              <span className="text-lg font-semibold tracking-wide text-[#2E8C96]">RIFT FINANCE</span>
              <div className="w-2 h-2 bg-[#2E8C96] rounded-full"></div>
            </div>
            <p className="text-[#1F2D3A]/70">Secure blockchain payment</p>
          </div>
        </div>

        {/* Payment Details */}
        <div className="p-6">
          {/* Payment Card Display */}
          <div className="mb-6">
            <div className="relative bg-gradient-to-br from-[#2E8C96] to-[#1F2D3A] rounded-2xl p-6 text-white shadow-xl overflow-hidden">
              <div className="absolute inset-0 opacity-10">
                <div className="absolute bottom-0 right-0 w-32 h-32 bg-white rounded-full translate-y-8 translate-x-8"></div>
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-white rounded-full translate-y-8 -translate-x-8"></div>
                <div className="absolute bottom-1/4 right-1/3 w-16 h-16 bg-white rounded-full opacity-50"></div>
              </div>

              <div className="relative z-10">
                <div className="flex justify-between items-start mb-6 relative z-20">
                  <div className="relative z-30">
                    <div className="text-sm font-medium text-white mb-1">Payment Request</div>
                    <div className="text-xs text-white/70">
                      {paymentMethod === 'mpesa' ? 'Mobile Money' : `${getChainConfig(selectedChain)?.name || selectedChain} Network`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 relative z-30">
                    <img src="/logo.png" alt="Rift Finance" className="w-8 h-8 object-contain" />
                    <div className="text-xs font-semibold text-white">RIFT</div>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="text-3xl font-bold mb-1">
                    {paymentMethod === 'mpesa'
                      ? formatKES(convertToKES(invoiceData.amount))
                      : `${formatAmount(invoiceData.amount)} ${selectedToken}`
                    }
                  </div>
                  <div className="text-sm opacity-80">
                    {paymentMethod === 'mpesa'
                      ? 'Mobile Money Payment'
                      : `${formatAmount(invoiceData.amount)} ${selectedToken} on ${getChainConfig(selectedChain)?.name}`
                    }
                  </div>
                </div>

                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-xs opacity-60 mb-1">Powered by</div>
                    <div className="text-sm font-semibold">RIFT FINANCE</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold tracking-wider">RIFT</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Method Selection */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-[#1F2D3A] mb-1">Step 1: Choose Payment Method</h3>
            <p className="text-xs text-[#1F2D3A]/60 mb-3">Select how you'd like to pay</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setPaymentMethod('mpesa')}
                className={`p-4 rounded-xl border-2 transition-all duration-200 ${
                  paymentMethod === 'mpesa'
                    ? 'border-[#2E8C96] bg-[#2E8C96]/10 text-[#2E8C96]'
                    : 'border-[#E9F1F4] bg-white text-[#1F2D3A] hover:border-[#2E8C96]/50'
                }`}
              >
                <div className="text-2xl mb-2">📱</div>
                <div className="text-sm font-medium">Mobile Money</div>
                <div className="text-xs opacity-70 mt-1">M-Pesa</div>
              </button>
              <button
                onClick={() => setPaymentMethod('crypto')}
                className={`p-4 rounded-xl border-2 transition-all duration-200 ${
                  paymentMethod === 'crypto'
                    ? 'border-[#2E8C96] bg-[#2E8C96]/10 text-[#2E8C96]'
                    : 'border-[#E9F1F4] bg-white text-[#1F2D3A] hover:border-[#2E8C96]/50'
                }`}
              >
                <div className="text-2xl mb-2">🌐</div>
                <div className="text-sm font-medium">Crypto Wallet</div>
                <div className="text-xs opacity-70 mt-1">USDC / USDT</div>
              </button>
            </div>
          </div>

          {/* ────────────────── CRYPTO FLOW ────────────────── */}
          {paymentMethod === 'crypto' && (
            <>
              {/* Chain Selection */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-[#1F2D3A] mb-1">Step 2: Choose Network</h3>
                <p className="text-xs text-[#1F2D3A]/60 mb-3">Pick the blockchain network you want to pay on</p>
                <div className="grid grid-cols-3 gap-2">
                  {AVAILABLE_CHAINS.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setSelectedChain(c.key)}
                      className={`p-3 rounded-xl border-2 transition-all duration-200 relative ${
                        selectedChain === c.key
                          ? 'border-[#2E8C96] bg-[#2E8C96]/10 text-[#2E8C96]'
                          : 'border-[#E9F1F4] bg-white text-[#1F2D3A] hover:border-[#2E8C96]/50'
                      }`}
                    >
                      {c.recommended && (
                        <div className="absolute -top-2 -right-2 bg-[#2E8C96] text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                          Low fees
                        </div>
                      )}
                      <div className="text-xl mb-1">{c.icon}</div>
                      <div className="text-xs font-medium">{c.name}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Token Selection */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-[#1F2D3A] mb-1">Step 3: Choose Token</h3>
                <p className="text-xs text-[#1F2D3A]/60 mb-3">Select which stablecoin to pay with</p>
                <div className="flex gap-3">
                  {availableTokens.map((token) => (
                    <button
                      key={token.symbol}
                      onClick={() => setSelectedToken(token.symbol)}
                      className={`flex-1 p-3 rounded-xl border-2 transition-all duration-200 text-center ${
                        selectedToken === token.symbol
                          ? 'border-[#2E8C96] bg-[#2E8C96]/10 text-[#2E8C96]'
                          : 'border-[#E9F1F4] bg-white text-[#1F2D3A] hover:border-[#2E8C96]/50'
                      }`}
                    >
                      <div className="text-sm font-semibold">{token.symbol}</div>
                      <div className="text-xs opacity-70">{token.name}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Connect Wallet */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-[#1F2D3A] mb-1">Step 4: Connect & Pay</h3>
                <p className="text-xs text-[#1F2D3A]/60 mb-3">Connect your wallet and confirm the transaction</p>

                {!isConnected ? (
                  <div className="text-center bg-[#E9F1F4] rounded-xl p-6">
                    <Wallet className="w-8 h-8 text-[#2E8C96] mx-auto mb-3" />
                    <p className="text-sm text-[#1F2D3A] mb-4">Connect your wallet to proceed</p>
                    <w3m-button />
                  </div>
                ) : (
                  <div className="bg-[#E9F1F4] border border-[#2E8C96]/30 rounded-xl p-4 mb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-[#2E8C96]">
                          <div className="w-2 h-2 bg-[#2E8C96] rounded-full"></div>
                          <span className="font-medium text-sm">Wallet Connected</span>
                        </div>
                        <p className="text-[#1F2D3A] text-sm mt-1">
                          {formatAddress(address || '')} on {chain?.name}
                        </p>
                      </div>
                      <button
                        onClick={() => disconnect()}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-[#1F2D3A] hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Disconnect wallet"
                      >
                        <LogOut className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Transaction Status */}
              {(isPending || isConfirming || isConfirmed) && (
                <div className="mb-6">
                  {isPending && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-blue-800">
                        <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                        <span className="font-medium">Transaction Pending</span>
                      </div>
                      <p className="text-blue-700 text-sm mt-1">Please confirm in your wallet</p>
                    </div>
                  )}

                  {isConfirming && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-yellow-800">
                        <div className="animate-spin w-4 h-4 border-2 border-yellow-600 border-t-transparent rounded-full"></div>
                        <span className="font-medium">Confirming Transaction</span>
                      </div>
                      <p className="text-yellow-700 text-sm mt-1">Waiting for blockchain confirmation</p>
                    </div>
                  )}

                  {isConfirmed && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-green-800">
                        <Check className="w-4 h-4" />
                        <span className="font-medium">Payment Successful!</span>
                      </div>
                      <p className="text-green-700 text-sm mt-1">Transaction confirmed on blockchain</p>
                      {hash && (
                        <div className="mt-3 pt-3 border-t border-green-200">
                          <p className="text-xs text-green-700 mb-1">Transaction hash:</p>
                          <p className="font-mono text-sm text-green-900 break-all mb-3">{hash}</p>
                          {invoiceData?.originUrl && (
                            <div className="flex items-center gap-2 text-green-700">
                              <div className="animate-spin w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full"></div>
                              <span className="text-sm">Redirecting you back...</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Payment Summary */}
              <div className="space-y-4 mb-6">
                <div className="bg-[#E9F1F4] rounded-xl p-4">
                  <h4 className="text-sm font-semibold text-[#1F2D3A] mb-3">Payment Summary</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-[#1F2D3A]/70">Network</span>
                      <span className="font-medium text-[#1F2D3A]">{getChainConfig(selectedChain)?.name || selectedChain}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[#1F2D3A]/70">Token</span>
                      <span className="font-medium text-[#1F2D3A]">{selectedToken}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[#1F2D3A]/70">Amount</span>
                      <span className="font-medium text-[#1F2D3A]">{formatAmount(invoiceData.amount)} {selectedToken}</span>
                    </div>
                    <div className="border-t border-[#1F2D3A]/10 pt-2 mt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[#1F2D3A]/70">Send to</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[#1F2D3A] text-sm">
                            {formatAddress(invoiceData.address)}
                          </span>
                          <button
                            onClick={handleCopyAddress}
                            className="p-1 hover:bg-white/50 rounded transition-colors"
                            title="Copy full address"
                          >
                            {copied ? (
                              <Check className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-[#1F2D3A]/50" />
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-[#1F2D3A]/50 font-mono break-all">
                        {invoiceData.address}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment Button */}
              {isConnected && !isConfirmed && (
                <button
                  onClick={handlePayment}
                  disabled={isPending || isConfirming || isProcessing}
                  className="w-full bg-[#2E8C96] text-white font-semibold py-4 px-6 rounded-xl hover:bg-[#2E8C96]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
                >
                  {isPending || isConfirming || isProcessing ? (
                    <>
                      <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                      Processing...
                    </>
                  ) : (
                    <>
                      Pay {formatAmount(invoiceData.amount)} {selectedToken} on {getChainConfig(selectedChain)?.name}
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              )}
            </>
          )}

          {/* ────────────────── M-PESA FLOW ────────────────── */}
          {paymentMethod === 'mpesa' && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-[#1F2D3A] mb-1">Step 2: Enter Your M-Pesa Number</h3>
              <p className="text-xs text-[#1F2D3A]/60 mb-4">You'll receive an STK push on your phone to confirm payment</p>

              {/* Payment Amount Display */}
              <div className="bg-[#E9F1F4] rounded-xl p-4 mb-5">
                <div className="text-center">
                  <div className="text-2xl font-bold text-[#1F2D3A] mb-1">
                    {formatKES(convertToKES(invoiceData.amount))}
                  </div>
                  <div className="text-sm text-[#1F2D3A]/70">
                    ≈ {formatAmount(invoiceData.amount)} USD
                  </div>
                </div>
              </div>

              {/* Phone Number Input */}
              <div className="mb-5">
                <label className="block text-sm font-medium text-[#1F2D3A] mb-2">
                  Safaricom M-Pesa Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                    <Phone className="w-4 h-4 text-[#1F2D3A]/40" />
                  </div>
                  <input
                    type="tel"
                    value={mpesaData.shortcode}
                    onChange={(e) => setMpesaData(prev => ({ ...prev, shortcode: e.target.value }))}
                    placeholder="0712345678"
                    className="w-full pl-10 pr-4 py-3 border border-[#E9F1F4] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2E8C96] focus:border-transparent text-lg"
                  />
                </div>
                <p className="text-xs text-[#1F2D3A]/60 mt-2">
                  Enter the Safaricom number registered with M-Pesa. You'll get a pop-up on your phone to enter your M-Pesa PIN.
                </p>
              </div>

              {/* Payment Summary */}
              <div className="bg-[#E9F1F4] rounded-xl p-4 mb-5">
                <h4 className="text-sm font-semibold text-[#1F2D3A] mb-2">Payment Summary</h4>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#1F2D3A]/70">Amount</span>
                    <span className="font-medium text-[#1F2D3A]">{formatKES(convertToKES(invoiceData.amount))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#1F2D3A]/70">Method</span>
                    <span className="font-medium text-[#1F2D3A]">M-Pesa (Safaricom)</span>
                  </div>
                  {mpesaData.shortcode && validateMpesaNumber(mpesaData.shortcode) && (
                    <div className="flex justify-between">
                      <span className="text-[#1F2D3A]/70">Phone</span>
                      <span className="font-medium text-[#1F2D3A]">{mpesaData.shortcode}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* How it works */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5">
                <h4 className="text-xs font-semibold text-blue-800 mb-2">How it works</h4>
                <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
                  <li>Enter your M-Pesa phone number above</li>
                  <li>Tap "Pay" — you'll receive an STK push on your phone</li>
                  <li>Enter your M-Pesa PIN on your phone to confirm</li>
                  <li>Payment is processed automatically</li>
                </ol>
              </div>

              {/* Pay Button */}
              <button
                onClick={handleMpesaPayment}
                disabled={isProcessing || !mpesaData.shortcode || !validateMpesaNumber(mpesaData.shortcode)}
                className="w-full bg-[#2E8C96] text-white py-4 px-6 rounded-xl font-semibold hover:bg-[#2E8C96]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Sending STK push...
                  </>
                ) : (
                  <>
                    Pay {formatKES(convertToKES(invoiceData.amount))} via M-Pesa
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>

              {transactionCode && (
                <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                  <Check className="w-6 h-6 text-green-600 mx-auto mb-2" />
                  <h4 className="text-sm font-semibold text-green-800 mb-2">Payment Initiated!</h4>
                  <p className="text-xs text-green-700 mb-3">
                    Check your phone and enter your M-Pesa PIN to complete.
                  </p>
                  <div className="bg-white rounded-lg p-3 mb-3">
                    <p className="text-xs text-green-600 mb-1">Transaction Code:</p>
                    <p className="font-mono text-sm text-green-900 break-all font-semibold">
                      {transactionCode}
                    </p>
                  </div>
                  {invoiceData?.originUrl && (
                    <div className="flex items-center justify-center gap-2 text-green-700">
                      <div className="animate-spin w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full"></div>
                      <span className="text-xs">Redirecting in a few seconds...</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
              <div className="flex items-center gap-2 text-red-800">
                <AlertCircle className="w-4 h-4" />
                <span className="font-medium">Error</span>
              </div>
              <p className="text-red-700 text-sm mt-1">{error}</p>
            </div>
          )}

          {/* Footer */}
          <div className="mt-6 pt-6 border-t border-[#E9F1F4] text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="w-1 h-1 bg-[#2E8C96] rounded-full"></div>
              <span className="text-xs font-semibold text-[#2E8C96] tracking-wide">POWERED BY RIFT FINANCE</span>
              <div className="w-1 h-1 bg-[#2E8C96] rounded-full"></div>
            </div>
            <p className="text-xs text-[#1F2D3A]/70">
              Secure payment powered by blockchain technology
            </p>
            <p className="text-xs text-[#1F2D3A]/50 mt-1">
              Transaction fees may apply from the network
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

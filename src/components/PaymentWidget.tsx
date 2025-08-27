import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useDisconnect } from 'wagmi';
import { parseUnits } from 'viem';
import { InvoiceData, MpesaPaymentData } from '../types';
import { getInvoiceFromUrl, formatAmount, formatAddress } from '../utils/invoice';
import { getChainConfig, getTokenConfig, AVAILABLE_CHAINS } from '../config/chains';
import { Copy, Check, AlertCircle, Wallet, ExternalLink, LogOut } from 'lucide-react';

export default function PaymentWidget() {
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [selectedChain, setSelectedChain] = useState<string>('BASE');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'crypto' | 'mpesa'>('mpesa');
  const [mpesaData, setMpesaData] = useState({
    shortcode: '',
    mobile_network: 'Safaricom' as 'Safaricom' | 'Airtel'
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

      // Check if we need to switch chains
      if (chain?.id !== chainConfig.id) {
        await switchChain({ chainId: chainConfig.id });
        return; // Function will be called again after chain switch
      }

      // Always use USDC for now (can be extended later)
      const tokenConfig = getTokenConfig(selectedChain, 'USDC');
      if (!tokenConfig) {
        throw new Error(`USDC not supported on ${selectedChain}`);
      }

      console.log('Payment details:', {
        selectedChain,
        chainId: chainConfig.id,
        tokenAddress: tokenConfig.address,
        tokenSymbol: tokenConfig.symbol,
        amount: invoiceData.amount,
        recipient: invoiceData.address
      });

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
    // Kenyan phone number validation (starts with 07 or +254 or 254)
    const kenyaRegex = /^(?:\+?254|0)?([17][0-9]{8})$/;
    return kenyaRegex.test(number);
  };

  const convertToKES = (usdAmount: number): number => {
    const exchangeRate = invoiceData?.exchangeRate || 129.7; // Fallback to 129.7 if not provided
    return usdAmount * exchangeRate;
  };

  const formatKES = (amount: number): string => {
    return `KES ${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  };

  const handleMpesaPayment = async () => {
    console.log('M-Pesa payment initiated');
    console.log('Invoice data:', invoiceData);
    console.log('M-Pesa data:', mpesaData);
    console.log('Validation results:', {
      hasInvoiceData: !!invoiceData,
      hasUserId: !!invoiceData?.userId,
      hasProjectId: !!invoiceData?.projectId,
      hasShortcode: !!mpesaData.shortcode,
      isValidNumber: validateMpesaNumber(mpesaData.shortcode)
    });

    if (!invoiceData || !invoiceData.userId || !invoiceData.projectId) {
      setError('Missing required payment information. Please check the payment link.');
      return;
    }

    if (!validateMpesaNumber(mpesaData.shortcode)) {
      setError('Please enter a valid Kenyan phone number (e.g., 0712345678)');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Construct M-Pesa payment data
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

      // Construct query parameters for redirect
      const queryParams = new URLSearchParams({
        shortcode: paymentData.shortcode,
        amount: paymentData.amount.toString(),
        chain: paymentData.chain,
        asset: paymentData.asset,
        mobile_network: paymentData.mobile_network,
        country_code: paymentData.country_code,
        address: paymentData.address,
        user_id: paymentData.user_id,
        project_id: paymentData.project_id
      });

      // Redirect to open-ramp page
      const redirectUrl = `https://app.riftfi.xyz/pay/open-ramp?${queryParams.toString()}`;
      window.location.href = redirectUrl;
    } catch (err: any) {
      console.error('M-Pesa payment failed:', err);
      setError(err.message || 'M-Pesa payment failed. Please try again.');
      setIsProcessing(false);
    }
  };

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

  return (
    <div className="min-h-screen bg-[#E9F1F4] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="bg-white px-6 py-8 text-center relative overflow-hidden border-b border-[#E9F1F4]">
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-5">
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-[#2E8C96]/10 to-transparent"></div>
            <div className="absolute top-4 right-4 w-32 h-32 border border-[#2E8C96]/10 rounded-full"></div>
            <div className="absolute bottom-4 left-4 w-24 h-24 border border-[#2E8C96]/10 rounded-full"></div>
          </div>
          
          <div className="relative z-10">
            {/* Rift Finance Logo */}
            <div className="flex items-center justify-center mx-auto mb-4">
              <img 
                src="/logo.png" 
                alt="Rift Finance Logo" 
                className="w-16 h-16 object-contain"
              />
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
              {/* Card Background Pattern */}
              <div className="absolute inset-0 opacity-10">
                <div className="absolute bottom-0 right-0 w-32 h-32 bg-white rounded-full translate-y-8 translate-x-8"></div>
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-white rounded-full translate-y-8 -translate-x-8"></div>
                <div className="absolute bottom-1/4 right-1/3 w-16 h-16 bg-white rounded-full opacity-50"></div>
              </div>
              
              <div className="relative z-10">
                {/* Card Header */}
                <div className="flex justify-between items-start mb-6 relative z-20">
                  <div className="relative z-30">
                    <div className="text-sm font-medium text-white mb-1">Payment Request</div>
                    <div className="text-xs text-white/70">Blockchain Network</div>
                  </div>
                  <div className="flex items-center gap-2 relative z-30">
                    <img 
                      src="/logo.png" 
                      alt="Rift Finance" 
                      className="w-8 h-8 object-contain"
                    />
                    <div className="text-xs font-semibold text-white">RIFT</div>
                  </div>
                </div>
                
                {/* Amount */}
                <div className="mb-4">
                  <div className="text-3xl font-bold mb-1">
                    {paymentMethod === 'mpesa' 
                      ? formatKES(convertToKES(invoiceData.amount))
                      : `${formatAmount(invoiceData.amount)} USDC`
                    }
                  </div>
                  <div className="text-sm opacity-80">
                    {paymentMethod === 'mpesa' ? 'Mobile Money Payment' : 'Base Network'}
                  </div>
                </div>
                
                {/* Card Footer */}
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
            <h3 className="text-lg font-semibold text-[#1F2D3A] mb-3">Choose Payment Method</h3>
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
                <div className="text-xs opacity-70 mt-1">M-Pesa & Airtel</div>
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
                <div className="text-xs opacity-70 mt-1">Connect your wallet</div>
              </button>
            </div>
          </div>

          {paymentMethod === 'crypto' && (
            <>
              {/* Chain Selection */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-[#1F2D3A] mb-3">Choose Payment Network</h3>
                <div className="grid grid-cols-2 gap-3">
                  {AVAILABLE_CHAINS.map((chain) => (
                    <button
                      key={chain.key}
                      onClick={() => setSelectedChain(chain.key)}
                      className={`p-4 rounded-xl border-2 transition-all duration-200 relative ${
                        selectedChain === chain.key
                          ? 'border-[#2E8C96] bg-[#2E8C96]/10 text-[#2E8C96]'
                          : 'border-[#E9F1F4] bg-white text-[#1F2D3A] hover:border-[#2E8C96]/50'
                      }`}
                    >
                      {chain.recommended && (
                        <div className="absolute -top-2 -right-2 bg-[#2E8C96] text-white text-xs px-2 py-1 rounded-full font-medium">
                          Recommended
                        </div>
                      )}
                      <div className="text-2xl mb-2">{chain.icon}</div>
                      <div className="text-sm font-medium">{chain.name}</div>
                      <div className="text-xs opacity-70 mt-1">USDC</div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[#1F2D3A]/60 mt-3 text-center">
                  Same amount ({formatAmount(invoiceData.amount)} USDC) • Same recipient address • Your choice of network
                </p>
              </div>

              {/* Connection Status */}
              <div className="mb-6">
                {!isConnected ? (
                  <div className="text-center">
                    <p className="text-[#1F2D3A] mb-4">Connect your wallet to proceed with payment</p>
                    <w3m-button />
                  </div>
                ) : (
                  <div className="bg-[#E9F1F4] border border-[#2E8C96]/30 rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-[#2E8C96]">
                          <div className="w-2 h-2 bg-[#2E8C96] rounded-full"></div>
                          <span className="font-medium">Wallet Connected</span>
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
                        Disconnect
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Transaction Status */}
              {(isPending || isConfirming || isConfirmed) && (
                <div className="mb-6">
                  {isPending && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-blue-800">
                        <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                        <span className="font-medium">Transaction Pending</span>
                      </div>
                      <p className="text-blue-700 text-sm mt-1">Please confirm in your wallet</p>
                    </div>
                  )}
                  
                  {isConfirming && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-yellow-800">
                        <div className="animate-spin w-4 h-4 border-2 border-yellow-600 border-t-transparent rounded-full"></div>
                        <span className="font-medium">Confirming Transaction</span>
                      </div>
                      <p className="text-yellow-700 text-sm mt-1">Waiting for blockchain confirmation</p>
                    </div>
                  )}
                  
                  {isConfirmed && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-green-800">
                        <Check className="w-4 h-4" />
                        <span className="font-medium">Payment Successful!</span>
                      </div>
                      <p className="text-green-700 text-sm mt-1">Transaction confirmed on blockchain</p>
                    </div>
                  )}
                </div>
              )}

              {/* Payment Info */}
              <div className="space-y-4 mb-6">
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-gray-600">Network:</span>
                    <span className="font-mono text-gray-900">{getChainConfig(selectedChain)?.name || selectedChain}</span>
                  </div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-gray-600">Token:</span>
                    <span className="font-mono text-gray-900">USDC</span>
                  </div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-gray-600">Amount:</span>
                    <span className="font-mono text-gray-900">{formatAmount(invoiceData.amount)}</span>
                  </div>
                  <div className="border-t pt-3 mt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-600">Send to:</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-gray-900 text-sm">
                          {formatAddress(invoiceData.address)}
                        </span>
                        <button
                          onClick={handleCopyAddress}
                          className="p-1 hover:bg-gray-100 rounded transition-colors"
                          title="Copy full address"
                        >
                          {copied ? (
                            <Check className="w-4 h-4 text-green-600" />
                          ) : (
                            <Copy className="w-4 h-4 text-gray-500" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500 font-mono break-all">
                      {invoiceData.address}
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
                      Pay {formatAmount(invoiceData.amount)} USDC on {getChainConfig(selectedChain)?.name}
                      <ExternalLink className="w-4 h-4" />
                    </>
                  )}
                </button>
              )}
            </>
          )}

          {paymentMethod === 'mpesa' && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-[#1F2D3A] mb-3">Mobile Money Payment</h3>
            
            {/* Payment Amount Display */}
            <div className="bg-[#E9F1F4] rounded-xl p-4 mb-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-[#1F2D3A] mb-1">
                  {formatKES(convertToKES(invoiceData.amount))}
                </div>
                <div className="text-sm text-[#1F2D3A]/70">
                  Payment Amount
                </div>
              </div>
            </div>

            {/* Mobile Network Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-[#1F2D3A] mb-3">
                Choose Mobile Network
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setMpesaData(prev => ({ ...prev, mobile_network: 'Safaricom' }))}
                  className={`p-4 rounded-xl border-2 transition-all duration-200 ${
                    mpesaData.mobile_network === 'Safaricom'
                      ? 'border-[#2E8C96] bg-[#2E8C96]/10 text-[#2E8C96]'
                      : 'border-[#E9F1F4] bg-white text-[#1F2D3A] hover:border-[#2E8C96]/50'
                  }`}
                >
                  <div className="text-2xl mb-2">📱</div>
                  <div className="text-sm font-medium">M-Pesa</div>
                  <div className="text-xs opacity-70 mt-1">Safaricom</div>
                </button>
                <button
                  onClick={() => setMpesaData(prev => ({ ...prev, mobile_network: 'Airtel' }))}
                  className={`p-4 rounded-xl border-2 transition-all duration-200 ${
                    mpesaData.mobile_network === 'Airtel'
                      ? 'border-[#2E8C96] bg-[#2E8C96]/10 text-[#2E8C96]'
                      : 'border-[#E9F1F4] bg-white text-[#1F2D3A] hover:border-[#2E8C96]/50'
                  }`}
                >
                  <div className="text-2xl mb-2">📶</div>
                  <div className="text-sm font-medium">Airtel Money</div>
                  <div className="text-xs opacity-70 mt-1">Airtel</div>
                </button>
              </div>
            </div>

            {/* Phone Number Input */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-[#1F2D3A] mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                value={mpesaData.shortcode}
                onChange={(e) => setMpesaData(prev => ({ ...prev, shortcode: e.target.value }))}
                placeholder="e.g., 0712345678"
                className="w-full px-4 py-3 border border-[#E9F1F4] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2E8C96] focus:border-transparent"
              />
              <p className="text-xs text-[#1F2D3A]/60 mt-1">
                Enter your Kenyan mobile number
              </p>
            </div>

            {/* Payment Summary */}
            <div className="bg-[#E9F1F4] rounded-xl p-4 mb-6">
              <h4 className="text-sm font-semibold text-[#1F2D3A] mb-2">Payment Summary</h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#1F2D3A]/70">Amount:</span>
                  <span className="font-medium text-[#1F2D3A]">{formatKES(convertToKES(invoiceData.amount))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#1F2D3A]/70">Method:</span>
                  <span className="font-medium text-[#1F2D3A]">{mpesaData.mobile_network} Mobile Money</span>
                </div>
              </div>
            </div>

            {/* Pay Button */}
            <button
              onClick={handleMpesaPayment}
              disabled={isProcessing || !mpesaData.shortcode || !validateMpesaNumber(mpesaData.shortcode)}
              className="w-full bg-[#2E8C96] text-white py-4 px-6 rounded-xl font-semibold hover:bg-[#2E8C96]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
              title={`Debug: isProcessing=${isProcessing}, hasShortcode=${!!mpesaData.shortcode}, isValidNumber=${validateMpesaNumber(mpesaData.shortcode)}`}
            >
              {isProcessing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Processing...
                </>
              ) : (
                <>
                  Pay {formatKES(convertToKES(invoiceData.amount))} with Mobile Money
                  <ExternalLink className="w-4 h-4" />
                </>
              )}
            </button>

            <p className="text-xs text-[#1F2D3A]/60 mt-3 text-center">
              You will be redirected to complete the mobile money payment
            </p>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
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
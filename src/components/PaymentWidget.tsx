import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useDisconnect } from 'wagmi';
import { parseUnits } from 'viem';
import { InvoiceData } from '../types';
import { getInvoiceFromUrl, formatAmount, formatAddress } from '../utils/invoice';
import { getChainConfig, getTokenConfig, isNativeToken } from '../config/chains';
import { Copy, Check, AlertCircle, Wallet, ExternalLink, LogOut } from 'lucide-react';

export default function PaymentWidget() {
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

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
      const chainConfig = getChainConfig(invoiceData.chain);
      if (!chainConfig) {
        throw new Error(`Unsupported chain: ${invoiceData.chain}`);
      }

      // Check if we need to switch chains
      if (chain?.id !== chainConfig.id) {
        await switchChain({ chainId: chainConfig.id });
        return; // Function will be called again after chain switch
      }

      if (isNativeToken(invoiceData.chain, invoiceData.token)) {
        // Handle native token payment (MATIC, ETH, etc.)
        // For native tokens, we'll use a simple transfer
        // Note: This would need to be implemented differently for actual native transfers
        setError('Native token payments not yet implemented in this demo');
        return;
      } else {
        // Handle ERC-20 token payment
        const tokenConfig = getTokenConfig(invoiceData.chain, invoiceData.token);
        if (!tokenConfig) {
          throw new Error(`Token ${invoiceData.token} not supported on ${invoiceData.chain}`);
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
      }
    } catch (err: any) {
      console.error('Payment failed:', err);
      setError(err.message || 'Payment failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (error && !invoiceData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Payment Error</h2>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!invoiceData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="animate-pulse-subtle">
            <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Wallet className="w-8 h-8 text-purple-600" />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Loading Payment</h2>
          <p className="text-gray-600">Preparing your payment details...</p>
        </div>
      </div>
    );
  }

  const chainConfig = getChainConfig(invoiceData.chain);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 via-blue-600 to-indigo-600 px-6 py-8 text-white text-center relative overflow-hidden">
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/20 to-transparent"></div>
            <div className="absolute top-4 right-4 w-32 h-32 border border-white/20 rounded-full"></div>
            <div className="absolute bottom-4 left-4 w-24 h-24 border border-white/20 rounded-full"></div>
          </div>
          
          <div className="relative z-10">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm border border-white/30">
              <Wallet className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold mb-1">Payment Request</h1>
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="w-2 h-2 bg-white rounded-full"></div>
              <span className="text-lg font-semibold tracking-wide">RIFT FINANCE</span>
              <div className="w-2 h-2 bg-white rounded-full"></div>
            </div>
            <p className="text-purple-100">Secure blockchain payment</p>
          </div>
        </div>

        {/* Payment Details */}
        <div className="p-6">
          {/* Amount Display */}
          <div className="bg-gray-50 rounded-xl p-6 mb-6 text-center">
            <div className="text-3xl font-bold text-gray-900 mb-2">
              {formatAmount(invoiceData.amount)} {invoiceData.token}
            </div>
            <div className="text-sm text-gray-600 mb-4">
              on {chainConfig?.name || invoiceData.chain} network
            </div>
          </div>

          {/* Connection Status */}
          <div className="mb-6">
            {!isConnected ? (
              <div className="text-center">
                <p className="text-gray-600 mb-4">Connect your wallet to proceed with payment</p>
                <w3m-button />
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-green-800">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="font-medium">Wallet Connected</span>
                    </div>
                    <p className="text-green-700 text-sm mt-1">
                      {formatAddress(address || '')} on {chain?.name}
                    </p>
                  </div>
                  <button
                    onClick={() => disconnect()}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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

          {/* Payment Info */}
          <div className="space-y-4 mb-6">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-600">Network:</span>
                <span className="font-mono text-gray-900">{chainConfig?.name || invoiceData.chain}</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-600">Token:</span>
                <span className="font-mono text-gray-900">{invoiceData.token}</span>
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
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold py-4 px-6 rounded-xl hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
            >
              {isPending || isConfirming || isProcessing ? (
                <>
                  <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                  Processing...
                </>
              ) : (
                <>
                  Pay {formatAmount(invoiceData.amount)} {invoiceData.token}
                  <ExternalLink className="w-4 h-4" />
                </>
              )}
            </button>
          )}

          {/* Footer */}
          <div className="mt-6 pt-6 border-t text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="w-1 h-1 bg-purple-500 rounded-full"></div>
              <span className="text-xs font-semibold text-purple-600 tracking-wide">POWERED BY RIFT FINANCE</span>
              <div className="w-1 h-1 bg-purple-500 rounded-full"></div>
            </div>
            <p className="text-xs text-gray-500">
              Secure payment powered by blockchain technology
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Transaction fees may apply from the network
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
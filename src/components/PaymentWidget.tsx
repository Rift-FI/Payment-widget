import { useState, useEffect, useMemo, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useDisconnect } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { parseUnits } from 'viem';
import type { InvoiceData } from '../types';
import { getInvoiceFromUrl, formatAddress } from '../utils/invoice';
import { getChainConfig, getTokenConfig, AVAILABLE_CHAINS } from '../config/chains';
import { fetchRates, localToUsdc, usdcToLocal, metaFor, type CurrencyRate, type RatesResponse } from '../utils/rates';

type Screen =
  | 'loading'
  | 'error'
  | 'amount'
  | 'method'
  | 'connected'
  | 'tx'
  | 'success'
  | 'txFailed';

type Overlay = null | 'currency' | 'disconnect';

const CHAIN_META: Record<string, { icon: string; rec?: boolean }> = {
  BASE: { icon: 'https://icons.llamao.fi/icons/chains/rsz_base?w=48&h=48', rec: true },
  POLYGON: { icon: 'https://icons.llamao.fi/icons/chains/rsz_polygon?w=48&h=48' },
  ARBITRUM: { icon: 'https://icons.llamao.fi/icons/chains/rsz_arbitrum?w=48&h=48' },
  ETHEREUM: { icon: 'https://icons.llamao.fi/icons/chains/rsz_ethereum?w=48&h=48' },
  CELO: { icon: 'https://icons.llamao.fi/icons/chains/rsz_celo?w=48&h=48' },
};

const TOKEN_META: Record<string, { icon: string }> = {
  USDC: { icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  USDT: { icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png' },
};

function flagUrl(cc: string): string {
  return `https://flagcdn.com/${cc}.svg`;
}

function fmt(n: number, dec: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: dec });
}

function fmtUsd(n: number): string {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDisp(raw: string): string {
  if (!raw) return '0';
  const dot = raw.includes('.');
  let ip = raw.split('.')[0];
  const dp = raw.split('.')[1];
  ip = ip.replace(/^0+(?=\d)/, '');
  if (ip === '') ip = '0';
  let out = Number(ip).toLocaleString('en-US');
  if (dot) out += '.' + (dp || '');
  return out;
}

function chainKeyFromId(id: number | undefined): string | null {
  if (!id) return null;
  const entry = AVAILABLE_CHAINS.find(c => getChainConfig(c.key)?.id === id);
  return entry ? entry.key : null;
}

export default function PaymentWidget() {
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('loading');
  const [overlay, setOverlay] = useState<Overlay>(null);

  const [rates, setRates] = useState<RatesResponse | null>(null);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [rateAge, setRateAge] = useState(0);
  const [manualCurrency, setManualCurrency] = useState(false);
  const [currency, setCurrency] = useState<string>('USD');

  const [amountStr, setAmountStr] = useState('');
  const [selectedChain, setSelectedChain] = useState<string>('BASE');
  const [selectedToken, setSelectedToken] = useState<string>('USDC');
  const [search, setSearch] = useState('');

  const [isSwitchingChain, setIsSwitchingChain] = useState(false);

  const { address, isConnected, chain } = useAccount();
  const { writeContract, data: hash, isPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { switchChain } = useSwitchChain();
  const { disconnect } = useDisconnect();
  const { open: openAppkit } = useAppKit();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const navigatedToConnected = useRef(false);
  const txStarted = useRef(false);
  const successHandled = useRef(false);

  useEffect(() => {
    const invoice = getInvoiceFromUrl();
    if (invoice) {
      setInvoiceData(invoice);
      setScreen(invoice.amount === 0 ? 'amount' : 'method');
    } else {
      setErrorMsg('Invalid or missing invoice data');
      setScreen('error');
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetchRates()
      .then(r => {
        if (!alive) return;
        setRates(r);
        if (!manualCurrency) {
          const def = r.defaultCurrency || 'USD';
          setCurrency(def);
        }
      })
      .catch(e => {
        if (!alive) return;
        setRatesError(e.message || 'Could not load rates');
      });
    return () => { alive = false; };
  }, [manualCurrency]);

  useEffect(() => {
    const t = setInterval(() => setRateAge(a => a + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const refreshRates = async () => {
    try {
      const r = await fetchRates();
      setRates(r);
      setRateAge(0);
      setRatesError(null);
    } catch (e: any) {
      setRatesError(e?.message || 'Could not load rates');
    }
  };

  useEffect(() => {
    if (selectedChain === 'BASE') return;
    const cfg = getChainConfig(selectedChain);
    if (cfg && !cfg.tokens[selectedToken]) {
      setSelectedToken('USDC');
    }
  }, [selectedChain, selectedToken]);

  useEffect(() => {
    if (isConnected && screen === 'method' && !navigatedToConnected.current) {
      navigatedToConnected.current = true;
      setScreen('connected');
    }
    if (!isConnected) {
      navigatedToConnected.current = false;
    }
  }, [isConnected, screen]);

  useEffect(() => {
    if (isPending && txStarted.current && screen !== 'tx') {
      setScreen('tx');
    }
  }, [isPending, screen]);

  useEffect(() => {
    if (isConfirmed && txStarted.current && !successHandled.current) {
      successHandled.current = true;
      setScreen('success');

      if (invoiceData?.invoiceId && hash) {
        fetch('https://payment.riftfi.xyz/invoices/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId: invoiceData.invoiceId,
            transactionHash: hash,
            chain: selectedChain,
          }),
        }).catch(err => console.error('Invoice verify failed:', err));
      }

      if (invoiceData?.originUrl) {
        const returnUrl = buildReturnUrl(invoiceData.originUrl, {
          hash: hash || '',
          ...(invoiceData.orderId && { order_id: invoiceData.orderId }),
        });
        const t = setTimeout(() => { window.location.href = returnUrl; }, 3500);
        return () => clearTimeout(t);
      }
    }
  }, [isConfirmed, hash, invoiceData, selectedChain]);

  useEffect(() => {
    if (writeError && txStarted.current && screen === 'tx') {
      setScreen('txFailed');
    }
  }, [writeError, screen]);

  const isOpenAmount = invoiceData !== null && invoiceData.amount === 0;
  const currencyRate: CurrencyRate | null = useMemo(() => {
    if (!rates) return null;
    if (currency === 'USD') return { currency: 'USD', onramp: 1, offramp: 1, isDefault: false };
    return rates.currencies.find(c => c.currency === currency) || null;
  }, [rates, currency]);

  // For display (Mode A): prefer onramp, fall back to offramp when buy is
  // unsupported (UGX/TZS/GHS etc). For Mode B we must have onramp — customer is
  // converting local fiat → USDC.
  const displayRate = currencyRate?.onramp ?? currencyRate?.offramp ?? null;

  const localNum = useMemo(() => {
    const n = parseFloat(String(amountStr).replace(/[, ]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }, [amountStr]);

  const usdcAmount = useMemo(() => {
    if (isOpenAmount) {
      if (!currencyRate || !localNum) return 0;
      return localToUsdc(localNum, currencyRate.onramp);
    }
    return invoiceData?.amount ?? 0;
  }, [isOpenAmount, localNum, currencyRate, invoiceData]);

  const localDisplayNum = useMemo(() => {
    if (isOpenAmount) return localNum;
    if (!displayRate) return 0;
    return usdcToLocal(usdcAmount, displayRate);
  }, [isOpenAmount, localNum, displayRate, usdcAmount]);

  const usdDisplay = fmtUsd(usdcAmount);
  const localDisplay = `${currency} ${fmt(localDisplayNum, metaFor(currency).dec)}`;

  const walletChainKey = chainKeyFromId(chain?.id);
  const needSwitch = isConnected && walletChainKey !== selectedChain;
  const chainCfg = getChainConfig(selectedChain);
  const tokenCfg = getTokenConfig(selectedChain, selectedToken);

  const payDisabled = !invoiceData || usdcAmount <= 0 || !tokenCfg || !chainCfg;
  const payLabel = needSwitch
    ? `Switch to ${chainCfg?.name || selectedChain}, then pay`
    : `Pay ${usdDisplay} ${selectedToken} on ${chainCfg?.name || selectedChain}`;

  const dec = metaFor(currency).dec;

  const pressKey = (k: string) => {
    let v = String(amountStr || '').replace(/,/g, '');
    if (k === 'back') v = v.slice(0, -1);
    else if (k === '.') { if (dec > 0 && !v.includes('.')) v = (v === '' ? '0' : v) + '.'; }
    else if (k === '000') { if (v === '' || v === '0') return; const t = v + '000'; if (t.replace('.', '').length <= 12) v = t; }
    else {
      if (v === '0') v = k; else v = v + k;
      const parts = v.split('.');
      if (parts[1] && parts[1].length > dec) return;
      if (v.replace('.', '').length > 12) return;
    }
    setAmountStr(v);
  };

  const selectCurrency = (code: string) => {
    setCurrency(code);
    setManualCurrency(true);
    setOverlay(null);
    setSearch('');
  };

  const startPay = async () => {
    if (payDisabled || !invoiceData || !tokenCfg || !chainCfg) return;
    setErrorMsg(null);
    resetWrite();
    successHandled.current = false;
    txStarted.current = true;

    if (needSwitch) {
      try {
        setIsSwitchingChain(true);
        setScreen('tx');
        await switchChain({ chainId: chainCfg.id });
        setIsSwitchingChain(false);
        await doTransfer();
      } catch (err: any) {
        setIsSwitchingChain(false);
        console.error('Chain switch failed:', err);
        setScreen('txFailed');
      }
      return;
    }

    setScreen('tx');
    await doTransfer();
  };

  const doTransfer = async () => {
    if (!invoiceData || !tokenCfg) return;
    try {
      const value = parseUnits(String(usdcAmount), tokenCfg.decimals);
      await writeContract({
        address: tokenCfg.address as `0x${string}`,
        abi: [{
          type: 'function', name: 'transfer',
          inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
          outputs: [{ name: '', type: 'bool' }],
          stateMutability: 'nonpayable',
        }],
        functionName: 'transfer',
        args: [invoiceData.address as `0x${string}`, value],
      });
    } catch (err: any) {
      console.error('Payment failed:', err);
      setErrorMsg(err.message || 'Payment failed');
      setScreen('txFailed');
    }
  };

  const buildReturnUrl = (baseUrl: string, params: Record<string, string>): string => {
    const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
    try {
      const url = new URL(baseUrl);
      entries.forEach(([k, v]) => url.searchParams.set(k, v));
      return url.toString();
    } catch {
      const sep = baseUrl.includes('?') ? '&' : '?';
      const q = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      return `${baseUrl}${sep}${q}`;
    }
  };

  const txTitle = isSwitchingChain
    ? `Switching to ${chainCfg?.name || selectedChain}`
    : isConfirming
    ? 'Waiting for confirmation'
    : hash
    ? 'Sending payment'
    : 'Check your wallet';

  const txCopy = isSwitchingChain
    ? 'Approve the network switch in your wallet.'
    : isConfirming
    ? `Usually under 30 seconds on ${chainCfg?.name || selectedChain}.`
    : hash
    ? `Broadcasting your transaction on ${chainCfg?.name || selectedChain}.`
    : 'Confirm the payment in your wallet to continue.';

  const filteredCurrencies = useMemo(() => {
    if (!rates) return { african: [] as CurrencyRate[], reserve: [] as CurrencyRate[] };
    const all: CurrencyRate[] = [
      ...rates.currencies,
      { currency: 'USD', onramp: 1, offramp: 1, isDefault: false },
    ];
    // Mode B = customer types local fiat amount → needs onramp to convert into
    // USDC. Hide currencies that have no buy side so the user can't pick
    // something we can't process.
    const usable = isOpenAmount ? all.filter(c => c.onramp !== null && c.onramp > 0) : all;
    const q = search.toLowerCase();
    const filt = usable.filter(c => {
      const m = metaFor(c.currency);
      return c.currency.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
    });
    return {
      african: filt.filter(c => metaFor(c.currency).group === 'african'),
      reserve: filt.filter(c => metaFor(c.currency).group === 'reserve'),
    };
  }, [rates, search, isOpenAmount]);

  const pad: { l: string; k: string }[] = [
    { l: '1', k: '1' }, { l: '2', k: '2' }, { l: '3', k: '3' },
    { l: '4', k: '4' }, { l: '5', k: '5' }, { l: '6', k: '6' },
    { l: '7', k: '7' }, { l: '8', k: '8' }, { l: '9', k: '9' },
    { l: dec > 0 ? '.' : '000', k: dec > 0 ? '.' : '000' },
    { l: '0', k: '0' },
    { l: '⌫', k: 'back' },
  ];

  const shortAddr = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';
  const shortHash = hash ? `${hash.slice(0, 6)}...${hash.slice(-4)}` : '';
  const explorerUrl = chainCfg && hash ? `${chainCfg.blockExplorers.default.url}/tx/${hash}` : '#';
  const merchantLabel = invoiceData ? formatAddress(invoiceData.address) : '';

  return (
    <>
      <style>{INLINE_KEYFRAMES}</style>
      <div className="min-h-screen flex items-center justify-center p-5 sm:p-10" style={{ background: '#E9F1F4', fontFamily: 'Inter, system-ui, sans-serif', WebkitFontSmoothing: 'antialiased' }}>
        <div className="relative w-full max-w-[390px] bg-white overflow-hidden flex flex-col" style={{ height: 844, maxHeight: 'calc(100vh - 32px)', borderRadius: 42, border: '1px solid rgba(15,42,56,.06)', boxShadow: '0 24px 60px -24px rgba(15,42,56,.36)' }}>
          <div className="flex-1 relative flex flex-col" style={{ overflowY: 'auto' }}>
            {screen === 'loading' && <LoadingScreen />}
            {screen === 'error' && <ErrorScreen onRetry={() => window.location.reload()} message={errorMsg || 'We couldn’t find this payment link'} />}

            {screen === 'amount' && (
              <AmountScreen
                currency={currency}
                amountStr={amountStr}
                amountDisplay={fmtDisp(amountStr)}
                usdDisplay={usdDisplay}
                rateLine={ratesError ? 'Rates unavailable' : rateAge === 0 ? 'Live rate' : `Rates updated ${rateAge}m ago`}
                rateStale={rateAge >= 5 || !!ratesError}
                pad={pad}
                pressKey={pressKey}
                onOpenCurrency={() => setOverlay('currency')}
                onContinue={() => setScreen('method')}
                refreshRate={refreshRates}
                canContinue={localNum > 0 && !!currencyRate && currencyRate.onramp !== null && currencyRate.onramp > 0}
              />
            )}

            {screen === 'method' && (
              <MethodScreen
                showBack={isOpenAmount}
                onBack={() => setScreen('amount')}
                usdDisplay={usdDisplay}
                token={selectedToken}
                localDisplay={localDisplay}
                onOpenWallet={() => openAppkit()}
              />
            )}

            {screen === 'connected' && (
              <ConnectedScreen
                merchant={merchantLabel}
                usdDisplay={usdDisplay}
                token={selectedToken}
                localDisplay={localDisplay}
                walletName="Wallet"
                shortAddr={shortAddr}
                onDisconnect={() => setOverlay('disconnect')}
                selectedChain={selectedChain}
                onSelectChain={setSelectedChain}
                selectedToken={selectedToken}
                onSelectToken={setSelectedToken}
                onBack={() => setScreen('method')}
                onPay={startPay}
                payLabel={payLabel}
                payDisabled={payDisabled}
              />
            )}

            {screen === 'tx' && (
              <TxScreen
                title={txTitle}
                copy={txCopy}
                isSwitching={isSwitchingChain}
                isAwaiting={!isSwitchingChain && !hash}
                isSubmitting={!!hash && !isConfirming && !isConfirmed}
                isConfirming={isConfirming}
              />
            )}

            {screen === 'success' && (
              <SuccessScreen
                usdDisplay={usdDisplay}
                token={selectedToken}
                merchant={merchantLabel}
                localDisplay={localDisplay}
                hash={hash || ''}
                explorerUrl={explorerUrl}
                shortHash={shortHash}
                onDone={() => {
                  txStarted.current = false;
                  successHandled.current = false;
                  resetWrite();
                  setScreen(isOpenAmount ? 'amount' : 'method');
                }}
              />
            )}

            {screen === 'txFailed' && (
              <TxFailedScreen
                message={writeError?.message || errorMsg || 'Try again when ready. Your chain, token and amount are still set.'}
                onRetry={() => {
                  txStarted.current = false;
                  successHandled.current = false;
                  resetWrite();
                  setScreen('connected');
                }}
              />
            )}
          </div>

          <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 134, height: 5, borderRadius: 3, background: 'rgba(11,22,32,.18)', pointerEvents: 'none', zIndex: 6 }} />

          {overlay === 'currency' && (
            <CurrencyOverlay
              search={search}
              setSearch={setSearch}
              african={filteredCurrencies.african}
              reserve={filteredCurrencies.reserve}
              selected={currency}
              onSelect={selectCurrency}
              onClose={() => { setOverlay(null); setSearch(''); }}
            />
          )}

          {overlay === 'disconnect' && (
            <DisconnectOverlay
              onCancel={() => setOverlay(null)}
              onConfirm={() => {
                disconnect();
                setOverlay(null);
                navigatedToConnected.current = false;
                setScreen('method');
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

const INLINE_KEYFRAMES = `
@keyframes pw_spin { to { transform: rotate(360deg); } }
@keyframes pw_screenIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes pw_sheetIn { from { transform: translateY(100%); } to { transform: none; } }
@keyframes pw_fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes pw_drawCheck { to { stroke-dashoffset: 0; } }
@keyframes pw_pop { 0% { transform: scale(.6); } 62% { transform: scale(1.07); } 100% { transform: scale(1); } }
@keyframes pw_dotpulse { 0%,80%,100% { opacity: .22; transform: scale(.85); } 40% { opacity: 1; transform: scale(1); } }
@keyframes pw_glow { 0%,100% { box-shadow: 0 0 0 0 rgba(46,140,150,0); } 50% { box-shadow: 0 0 0 12px rgba(46,140,150,.10); } }
@media (prefers-reduced-motion: reduce) { * { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; } }
`;

const SCREEN = { animation: 'pw_screenIn .18s ease both' } as const;
const ACCENT = '#2E8C96';
const ACCENT_DARK = '#256E77';

function PoweredBy() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16, color: '#94A3B8', font: '500 12px Inter' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        Powered by
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#1F2D3A', fontWeight: 700 }}>
          <img src="/logo.png" alt="Rift" style={{ width: 18, height: 18, objectFit: 'contain', display: 'block' }} />
          Rift
        </span>
      </span>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: 24, ...SCREEN }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #E2E8F0', borderTopColor: ACCENT, animation: 'pw_spin .8s linear infinite' }} />
      <div style={{ font: '500 15px Inter', color: '#64748B' }}>Loading payment</div>
      <div style={{ width: 230, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
        <div style={{ height: 14, borderRadius: 7, background: '#EEF2F5' }} />
        <div style={{ height: 44, borderRadius: 12, background: '#F1F5F7' }} />
        <div style={{ height: 14, width: '60%', borderRadius: 7, background: '#EEF2F5' }} />
      </div>
    </div>
  );
}

function ErrorScreen({ onRetry, message }: { onRetry: () => void; message: string }) {
  return (
    <div style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column', padding: '24px 26px 28px', ...SCREEN }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 18 }}>
        <div style={{ width: 72, height: 72, borderRadius: 22, background: 'rgba(225,29,72,.10)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ font: '700 34px Sora', color: '#E11D48', lineHeight: 1 }}>!</span>
        </div>
        <h1 style={{ margin: 0, font: '700 22px Sora', color: '#0B1620', letterSpacing: '-.01em' }}>{message}</h1>
        <p style={{ margin: 0, font: '400 15px Inter', color: '#64748B', lineHeight: 1.5, maxWidth: 300 }}>It may have expired or been mistyped. Check the link with the person who sent it.</p>
      </div>
      <button onClick={onRetry} style={{ width: '100%', border: '1px solid #E2E8F0', background: '#fff', borderRadius: 16, padding: 16, font: '600 16px Inter', color: '#1F2D3A', cursor: 'pointer' }}>Try again</button>
    </div>
  );
}

interface AmountScreenProps {
  currency: string;
  amountStr: string;
  amountDisplay: string;
  usdDisplay: string;
  rateLine: string;
  rateStale: boolean;
  pad: { l: string; k: string }[];
  pressKey: (k: string) => void;
  onOpenCurrency: () => void;
  onContinue: () => void;
  refreshRate: () => void;
  canContinue: boolean;
}

function AmountScreen({ currency, amountDisplay, usdDisplay, rateLine, rateStale, pad, pressKey, onOpenCurrency, onContinue, refreshRate, canContinue }: AmountScreenProps) {
  const meta = metaFor(currency);
  return (
    <div style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column', padding: '20px 24px 26px', ...SCREEN }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '6px 0', minHeight: 0 }}>
        <button onClick={onOpenCurrency} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: '#F8FAFB', border: '1px solid #E2E8F0', borderRadius: 999, padding: '9px 16px', font: '600 14px Inter', color: '#1F2D3A', cursor: 'pointer' }}>
          <img src={flagUrl(meta.cc)} alt="" style={{ width: 22, height: 16, borderRadius: 3, objectFit: 'cover', boxShadow: '0 0 0 1px rgba(15,42,56,.10)' }} />
          <span>{currency}</span>
          <span style={{ color: '#94A3B8', fontSize: 11 }}>▾</span>
        </button>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div aria-label="Amount" style={{ font: '700 52px Sora', letterSpacing: '-.02em', color: '#0B1620', lineHeight: 1.04 }}>{amountDisplay}</div>
          <div style={{ width: 140, height: 2, background: '#E2E8F0', borderRadius: 2 }} />
        </div>

        <div style={{ font: '500 19px Inter', color: '#64748B', transition: 'opacity .2s ease' }}>≈ {usdDisplay}</div>

        <button onClick={refreshRate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', font: '500 12px Inter', padding: 4 }}>
          {rateStale && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#D97706' }} />}
          <span style={{ color: '#94A3B8' }}>{rateLine}</span>
          {rateStale && <span style={{ color: ACCENT, fontWeight: 600 }}>Refresh</span>}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, marginBottom: 12 }}>
        {pad.map((key, i) => (
          <button
            key={i}
            onClick={() => pressKey(key.k)}
            aria-label={key.l}
            style={{ height: 54, border: 'none', background: 'transparent', borderRadius: 14, font: '600 23px Sora', color: '#0B1620', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFB')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {key.l}
          </button>
        ))}
      </div>
      <button
        onClick={onContinue}
        disabled={!canContinue}
        style={{ width: '100%', border: 'none', borderRadius: 16, background: canContinue ? ACCENT : '#CBD5E1', color: '#fff', font: '600 17px Inter', padding: 17, cursor: canContinue ? 'pointer' : 'not-allowed', boxShadow: canContinue ? '0 10px 28px -14px rgba(37,110,119,.7)' : 'none' }}
      >Continue</button>
      <PoweredBy />
    </div>
  );
}

interface MethodScreenProps {
  showBack: boolean;
  onBack: () => void;
  usdDisplay: string;
  token: string;
  localDisplay: string;
  onOpenWallet: () => void;
}

function MethodScreen({ showBack, onBack, usdDisplay, token, localDisplay, onOpenWallet }: MethodScreenProps) {
  return (
    <div style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column', padding: '20px 24px 26px', ...SCREEN }}>
      {showBack && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} aria-label="Back" style={{ width: 38, height: 38, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 18, color: '#1F2D3A', flex: 'none' }}>←</button>
        </div>
      )}

      <div style={{ background: '#F8FAFB', border: '1px solid #E2E8F0', borderRadius: 24, padding: 20, marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ font: '600 12px Inter', letterSpacing: '.05em', textTransform: 'uppercase', color: '#94A3B8' }}>Amount</span>
          <span style={{ font: '700 26px Sora', color: '#0B1620', letterSpacing: '-.01em' }}>{usdDisplay} {token}</span>
        </div>
        <div style={{ textAlign: 'right', font: '500 14px Inter', color: '#64748B', marginTop: 4 }}>≈ {localDisplay}</div>
      </div>

      <div style={{ font: '600 12px Inter', letterSpacing: '.05em', textTransform: 'uppercase', color: '#94A3B8', margin: '24px 0 12px' }}>Pay with</div>

      <button onClick={onOpenWallet} style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 20, padding: '16px 18px', cursor: 'pointer', textAlign: 'left', marginBottom: 12 }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: 'rgba(46,140,150,.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="3.5" fill="none" stroke={ACCENT} strokeWidth="2" /><circle cx="16.5" cy="12.5" r="1.7" fill={ACCENT} /></svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ font: '600 16px Inter', color: '#0B1620' }}>Crypto wallet</div>
          <div style={{ font: '400 13px Inter', color: '#64748B', marginTop: 2 }}>Connect any wallet</div>
        </div>
        <span style={{ color: '#CBD5E1', fontSize: 22 }}>›</span>
      </button>

      <div style={{ flex: 1 }} />
      <PoweredBy />
    </div>
  );
}

interface ConnectedProps {
  merchant: string;
  usdDisplay: string;
  token: string;
  localDisplay: string;
  walletName: string;
  shortAddr: string;
  onDisconnect: () => void;
  selectedChain: string;
  onSelectChain: (k: string) => void;
  selectedToken: string;
  onSelectToken: (k: string) => void;
  onBack: () => void;
  onPay: () => void;
  payLabel: string;
  payDisabled: boolean;
}

function ConnectedScreen({ merchant, usdDisplay, token, localDisplay, walletName, shortAddr, onDisconnect, selectedChain, onSelectChain, selectedToken, onSelectToken, onBack, onPay, payLabel, payDisabled }: ConnectedProps) {
  return (
    <div style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column', padding: '20px 22px 26px', ...SCREEN }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} aria-label="Back" style={{ width: 38, height: 38, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 18, color: '#1F2D3A', flex: 'none' }}>←</button>
        <div style={{ font: '600 17px Inter', color: '#0B1620' }}>Pay {merchant}</div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ font: '700 25px Sora', color: '#0B1620', letterSpacing: '-.01em' }}>Pay {usdDisplay} {token}</div>
        <div style={{ font: '500 14px Inter', color: '#64748B', marginTop: 2 }}>≈ {localDisplay}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F8FAFB', border: '1px solid #E2E8F0', borderRadius: 16, padding: '11px 14px', marginTop: 16 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'conic-gradient(from 45deg,#2E8C96,#7B3FE4,#28A0F0,#2E8C96)', flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '600 13px Inter', color: '#0B1620' }}>{walletName}</div>
          <div style={{ font: '500 12px "JetBrains Mono", monospace', color: '#64748B' }}>{shortAddr}</div>
        </div>
        <button onClick={onDisconnect} style={{ background: 'none', border: 'none', color: ACCENT, font: '600 13px Inter', cursor: 'pointer', padding: '4px 6px' }}>Disconnect</button>
      </div>

      <div style={{ font: '600 12px Inter', letterSpacing: '.05em', textTransform: 'uppercase', color: '#94A3B8', margin: '20px 0 12px' }}>Pay on</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {AVAILABLE_CHAINS.map(c => {
          const meta = CHAIN_META[c.key];
          const selected = c.key === selectedChain;
          return (
            <button
              key={c.key}
              onClick={() => onSelectChain(c.key)}
              style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '12px 11px', cursor: 'pointer', textAlign: 'left' }}
            >
              <img src={meta.icon} alt={c.name} style={{ width: 30, height: 30, borderRadius: '50%', flex: 'none', objectFit: 'cover', background: '#fff' }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ font: '600 14px Inter', color: '#0B1620' }}>{c.name}</div>
                {meta.rec && <div style={{ font: '600 11px Inter', color: ACCENT }}>Recommended</div>}
              </div>
              {selected && (
                <>
                  <div style={{ position: 'absolute', inset: 0, border: `2px solid ${ACCENT}`, borderRadius: 16, background: 'rgba(46,140,150,.06)', pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', top: 7, right: 7, width: 17, height: 17, borderRadius: '50%', background: ACCENT, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 10px Inter' }}>✓</div>
                </>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ font: '600 12px Inter', letterSpacing: '.05em', textTransform: 'uppercase', color: '#94A3B8', margin: '20px 0 12px' }}>Pay with</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {['USDC', 'USDT'].map(t => {
          const meta = TOKEN_META[t];
          const selected = t === selectedToken;
          return (
            <button
              key={t}
              onClick={() => onSelectToken(t)}
              style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 13, cursor: 'pointer' }}
            >
              <img src={meta.icon} alt={t} style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
              <span style={{ font: '600 15px Inter', color: '#0B1620' }}>{t}</span>
              {selected && <div style={{ position: 'absolute', inset: 0, border: `2px solid ${ACCENT}`, borderRadius: 14, background: 'rgba(46,140,150,.06)', pointerEvents: 'none' }} />}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, minHeight: 18 }} />
      <button
        onClick={onPay}
        disabled={payDisabled}
        style={{ width: '100%', border: 'none', borderRadius: 16, background: payDisabled ? '#CBD5E1' : ACCENT, color: '#fff', font: '600 16px Inter', padding: 17, cursor: payDisabled ? 'not-allowed' : 'pointer', boxShadow: payDisabled ? 'none' : '0 10px 28px -14px rgba(37,110,119,.7)' }}
      >{payLabel}</button>
    </div>
  );
}

interface TxScreenProps {
  title: string;
  copy: string;
  isSwitching: boolean;
  isAwaiting: boolean;
  isSubmitting: boolean;
  isConfirming: boolean;
}

function TxScreen({ title, copy, isSwitching, isAwaiting, isSubmitting, isConfirming }: TxScreenProps) {
  return (
    <div style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 22, padding: 24, ...SCREEN }}>
      {isAwaiting && (
        <div style={{ width: 74, height: 74, borderRadius: 20, background: 'rgba(46,140,150,.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pw_glow 1.8s ease-in-out infinite' }}>
          <svg width="32" height="32" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="3.5" fill="none" stroke={ACCENT} strokeWidth="2" /><circle cx="16.5" cy="12.5" r="1.7" fill={ACCENT} /></svg>
        </div>
      )}
      {(isSwitching || isSubmitting) && (
        <div style={{ width: 46, height: 46, borderRadius: '50%', border: '3px solid #E2E8F0', borderTopColor: ACCENT, animation: 'pw_spin .8s linear infinite' }} />
      )}
      {isConfirming && (
        <div style={{ display: 'flex', gap: 9 }}>
          {[0, 0.2, 0.4].map((d, i) => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: ACCENT, animation: 'pw_dotpulse 1.2s ease-in-out infinite', animationDelay: `${d}s` }} />
          ))}
        </div>
      )}
      <div>
        <h1 style={{ margin: 0, font: '700 22px Sora', color: '#0B1620', letterSpacing: '-.01em' }}>{title}</h1>
        <p style={{ margin: '10px 0 0', font: '400 15px Inter', color: '#64748B', lineHeight: 1.5, maxWidth: 280 }}>{copy}</p>
      </div>
    </div>
  );
}

interface SuccessProps {
  usdDisplay: string;
  token: string;
  merchant: string;
  localDisplay: string;
  hash: string;
  explorerUrl: string;
  shortHash: string;
  onDone: () => void;
}

function SuccessScreen({ usdDisplay, token, merchant, localDisplay, hash, explorerUrl, shortHash, onDone }: SuccessProps) {
  return (
    <div style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column', padding: '24px 26px 26px', ...SCREEN }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 18 }}>
        <svg width="84" height="84" viewBox="0 0 84 84" style={{ animation: 'pw_pop .5s ease both' }}>
          <circle cx="42" cy="42" r="42" fill={ACCENT} />
          <path d="M24 43 L37 56 L60 30" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="70" strokeDashoffset="70" style={{ animation: 'pw_drawCheck .5s .22s ease forwards' }} />
        </svg>
        <h1 style={{ margin: 0, font: '700 24px Sora', color: '#0B1620', letterSpacing: '-.01em' }}>Payment sent</h1>
        <div>
          <div style={{ font: '500 16px Inter', color: '#334155' }}>{usdDisplay} {token} paid to {merchant}</div>
          <div style={{ font: '500 14px Inter', color: '#94A3B8', marginTop: 4 }}>≈ {localDisplay}</div>
        </div>
        {hash && (
          <a href={explorerUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#F8FAFB', border: '1px solid #E2E8F0', borderRadius: 999, padding: '9px 14px', textDecoration: 'none' }}>
            <span style={{ font: '500 12px Inter', color: '#64748B' }}>Transaction</span>
            <span style={{ font: '500 12px "JetBrains Mono", monospace', color: '#1F2D3A' }}>{shortHash}</span>
            <span style={{ color: ACCENT, fontSize: 13 }}>↗</span>
          </a>
        )}
        <div style={{ font: '400 12px Inter', color: '#94A3B8' }}>Returning shortly</div>
      </div>
      <button onClick={onDone} style={{ width: '100%', border: 'none', borderRadius: 16, background: ACCENT, color: '#fff', font: '600 17px Inter', padding: 17, cursor: 'pointer' }} onMouseOver={e => (e.currentTarget.style.background = ACCENT_DARK)} onMouseOut={e => (e.currentTarget.style.background = ACCENT)}>Done</button>
    </div>
  );
}

function TxFailedScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column', padding: '24px 26px 26px', ...SCREEN }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 18 }}>
        <div style={{ width: 74, height: 74, borderRadius: 22, background: 'rgba(225,29,72,.10)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ font: '300 40px Sora', color: '#E11D48', lineHeight: 1 }}>×</span>
        </div>
        <h1 style={{ margin: 0, font: '700 22px Sora', color: '#0B1620', letterSpacing: '-.01em' }}>Transaction cancelled</h1>
        <p style={{ margin: 0, font: '400 15px Inter', color: '#64748B', lineHeight: 1.5, maxWidth: 280 }}>{message}</p>
      </div>
      <button onClick={onRetry} style={{ width: '100%', border: 'none', borderRadius: 16, background: ACCENT, color: '#fff', font: '600 17px Inter', padding: 17, cursor: 'pointer' }}>Try again</button>
    </div>
  );
}

interface CurrencyOverlayProps {
  search: string;
  setSearch: (v: string) => void;
  african: CurrencyRate[];
  reserve: CurrencyRate[];
  selected: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}

function CurrencyOverlay({ search, setSearch, african, reserve, selected, onSelect, onClose }: CurrencyOverlayProps) {
  const renderRow = (c: CurrencyRate) => {
    const meta = metaFor(c.currency);
    const isSelected = c.currency === selected;
    const rateForLabel = c.onramp ?? c.offramp;
    const rateText = c.currency === 'USD'
      ? 'Base currency'
      : rateForLabel === null
      ? 'Rate unavailable'
      : `1 USD ≈ ${rateForLabel.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${c.currency}`;
    return (
      <button
        key={c.currency}
        onClick={() => onSelect(c.currency)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', background: 'transparent', border: 'none', borderRadius: 12, padding: '11px 10px', cursor: 'pointer' }}
      >
        <img src={flagUrl(meta.cc)} alt="" style={{ width: 28, height: 21, borderRadius: 4, objectFit: 'cover', flex: 'none', boxShadow: '0 0 0 1px rgba(15,42,56,.08)' }} />
        <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
          <div style={{ font: '600 15px Inter', color: '#0B1620' }}>{c.currency}</div>
          <div style={{ font: '400 12px Inter', color: '#64748B' }}>{meta.name}</div>
        </div>
        <span style={{ font: '500 11px "JetBrains Mono", monospace', color: '#94A3B8', flex: 'none' }}>{rateText}</span>
        {isSelected && <span style={{ color: ACCENT, fontWeight: 700, flex: 'none', marginLeft: 4 }}>✓</span>}
      </button>
    );
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 30 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(11,22,32,.42)', animation: 'pw_fadeIn .2s ease' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#fff', borderRadius: '28px 28px 0 0', maxHeight: '80%', display: 'flex', flexDirection: 'column', animation: 'pw_sheetIn .24s cubic-bezier(.2,.7,.2,1)', boxShadow: '0 -10px 40px -20px rgba(15,42,56,.4)' }}>
        <div style={{ padding: '12px 0 4px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 40, height: 5, borderRadius: 3, background: '#E2E8F0' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 22px 12px' }}>
          <h2 style={{ margin: 0, font: '700 18px Sora', color: '#0B1620' }}>Select currency</h2>
          <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: '#F1F5F7', color: '#64748B', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '0 22px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F8FAFB', border: '1px solid #E2E8F0', borderRadius: 12, padding: '11px 14px' }}>
            <span style={{ color: '#94A3B8' }}>⌕</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search currency" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', font: '500 15px Inter', color: '#0B1620' }} />
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 14px 22px' }}>
          {african.length > 0 && (
            <>
              <div style={{ font: '600 11px Inter', letterSpacing: '.06em', textTransform: 'uppercase', color: '#94A3B8', padding: '10px 10px 4px' }}>African currencies</div>
              {african.map(renderRow)}
            </>
          )}
          {reserve.length > 0 && (
            <>
              <div style={{ font: '600 11px Inter', letterSpacing: '.06em', textTransform: 'uppercase', color: '#94A3B8', padding: '14px 10px 4px' }}>Major reserves</div>
              {reserve.map(renderRow)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DisconnectOverlay({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <div onClick={onCancel} style={{ position: 'absolute', inset: 0, background: 'rgba(11,22,32,.42)', animation: 'pw_fadeIn .2s ease' }} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: 24, padding: 24, width: '100%', maxWidth: 320, animation: 'pw_pop .26s ease', boxShadow: '0 24px 48px -20px rgba(15,42,56,.4)' }}>
        <h2 style={{ margin: '0 0 8px', font: '700 19px Sora', color: '#0B1620' }}>Disconnect wallet?</h2>
        <p style={{ margin: '0 0 20px', font: '400 14px Inter', color: '#64748B', lineHeight: 1.5 }}>You can reconnect anytime. Your amount stays set.</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ flex: 1, border: '1px solid #E2E8F0', background: '#fff', borderRadius: 14, padding: 13, font: '600 15px Inter', color: '#1F2D3A', cursor: 'pointer' }}>Cancel</button>
          <button onClick={onConfirm} style={{ flex: 1, border: 'none', background: '#E11D48', color: '#fff', borderRadius: 14, padding: 13, font: '600 15px Inter', cursor: 'pointer' }}>Disconnect</button>
        </div>
      </div>
    </div>
  );
}

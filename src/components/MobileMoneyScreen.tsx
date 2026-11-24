import { useEffect, useRef, useState } from 'react';
import {
  MARKETS,
  OnrampError,
  OnrampStatus,
  findMarket,
  formatFiat,
  pollOnramp,
  quoteOnramp,
  startOnramp,
} from '../utils/mobileMoney';

const ACCENT = '#2E8C96';

/**
 * Pay a payment link from a phone.
 *
 * Three steps, one screen: pick the market and network, enter the number,
 * approve the prompt. The cancellation limit is stated BEFORE the prompt is
 * sent, not after someone is blocked by it — a rule you only learn by
 * tripping it reads as a punishment.
 */
interface Props {
  invoiceId: string;
  token: string;
  cryptoAmount: number;
  onBack: () => void;
  onPaid: (s: OnrampStatus) => void;
}

type Phase = 'form' | 'sending' | 'waiting' | 'done' | 'failed';

const label: React.CSSProperties = {
  font: '600 12px Inter',
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: '#94A3B8',
  margin: '18px 0 8px',
};
const field: React.CSSProperties = {
  width: '100%',
  border: '1px solid #E2E8F0',
  borderRadius: 16,
  padding: '14px 16px',
  font: '500 16px Inter',
  color: '#0B1620',
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
};

export function MobileMoneyScreen({ invoiceId, token, cryptoAmount, onBack, onPaid }: Props) {
  const [currency, setCurrency] = useState(MARKETS[0].currency);
  const [network, setNetwork] = useState(MARKETS[0].networks[0]);
  const [phone, setPhone] = useState('');
  const [quote, setQuote] = useState<{ fiatAmount: number; currency: string } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<OnrampStatus | null>(null);
  const abort = useRef<AbortController | null>(null);

  const market = findMarket(currency)!;

  useEffect(() => {
    setNetwork(market.networks[0]);
  }, [currency]);

  // Price it as soon as the market changes, so the payer sees the local
  // amount before committing to anything.
  useEffect(() => {
    let cancelled = false;
    setQuoting(true);
    setError(null);
    quoteOnramp(invoiceId, currency)
      .then((q) => {
        if (!cancelled) setQuote({ fiatAmount: q.fiatAmount, currency: q.currency });
      })
      .catch((e: OnrampError) => {
        if (!cancelled) {
          setQuote(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setQuoting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId, currency]);

  useEffect(() => () => abort.current?.abort(), []);

  async function send() {
    setError(null);
    setPhase('sending');
    try {
      const started = await startOnramp(invoiceId, { phone, network, currency });
      setStatus(started);
      setPhase('waiting');
      abort.current = new AbortController();
      const final = await pollOnramp(invoiceId, started.orderId, setStatus, { signal: abort.current.signal });
      if (final.status === 'completed') {
        setPhase('done');
        onPaid(final);
      } else if (final.status === 'processing' || final.status === 'awaiting_payment') {
        // Still open when we stopped polling. Not a failure — say so plainly.
        setPhase('waiting');
      } else {
        setStatus(final);
        setPhase('failed');
      }
    } catch (e: any) {
      const err = e as OnrampError;
      setError(err.message || 'That did not go through.');
      setPhase(err.code === 'TOO_MANY_CANCELLATIONS' ? 'failed' : 'form');
    }
  }

  const canSend = phone.replace(/\D/g, '').length >= 9 && !!network && !!quote && !quoting;

  return (
    <div style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column', padding: '20px 24px 26px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={phase === 'waiting' ? undefined : onBack}
          aria-label="Back"
          disabled={phase === 'waiting'}
          style={{
            width: 38, height: 38, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: phase === 'waiting' ? 'not-allowed' : 'pointer', fontSize: 18, color: '#1F2D3A',
            flex: 'none', opacity: phase === 'waiting' ? 0.4 : 1,
          }}
        >
          ←
        </button>
        <div style={{ font: '600 16px Inter', color: '#0B1620' }}>Mobile money</div>
      </div>

      {/* Amount */}
      <div style={{ background: '#F8FAFB', border: '1px solid #E2E8F0', borderRadius: 24, padding: 20, marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ font: '600 12px Inter', letterSpacing: '.05em', textTransform: 'uppercase', color: '#94A3B8' }}>You pay</span>
          <span style={{ font: '700 26px Sora', color: '#0B1620', letterSpacing: '-.01em' }}>
            {quoting ? '…' : quote ? formatFiat(quote.fiatAmount, quote.currency) : '—'}
          </span>
        </div>
        <div style={{ textAlign: 'right', font: '500 14px Inter', color: '#64748B', marginTop: 4 }}>
          for {cryptoAmount} {token}
        </div>
      </div>

      {phase === 'form' || phase === 'sending' ? (
        <>
          <div style={label}>Country</div>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={field} disabled={phase === 'sending'}>
            {MARKETS.map((m) => (
              <option key={m.currency} value={m.currency}>
                {m.country} ({m.currency})
              </option>
            ))}
          </select>

          <div style={label}>Network</div>
          <select value={network} onChange={(e) => setNetwork(e.target.value)} style={field} disabled={phase === 'sending'}>
            {market.networks.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>

          <div style={label}>Phone number</div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={market.placeholder}
            inputMode="tel"
            autoComplete="tel"
            style={field}
            disabled={phase === 'sending'}
          />

          {/* No rate-limit notice here on purpose: the person paying a link is
              not a Rift account holder, so warning them about account limits
              is both confusing and off-putting at the moment they are trying
              to pay. If the brake does trip, the 429 explains itself. */}

          {error && (
            <div role="alert" style={{ marginTop: 14, padding: '12px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 14, font: '400 13px Inter', color: '#991B1B' }}>
              {error}
            </div>
          )}

          <div style={{ flex: 1, minHeight: 16 }} />
          <button
            onClick={send}
            disabled={!canSend || phase === 'sending'}
            style={{
              width: '100%', padding: '16px', borderRadius: 18, border: 'none',
              background: canSend && phase !== 'sending' ? ACCENT : '#CBD5E1',
              color: '#fff', font: '600 16px Inter',
              cursor: canSend && phase !== 'sending' ? 'pointer' : 'not-allowed',
            }}
          >
            {phase === 'sending' ? 'Sending…' : 'Send payment request'}
          </button>
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '28px 8px' }}>
          {phase === 'waiting' && (
            <>
              <div style={{ width: 56, height: 56, borderRadius: '50%', border: `3px solid ${ACCENT}`, borderTopColor: 'transparent', animation: 'spin 1s linear infinite', marginBottom: 22 }} />
              <div style={{ font: '600 18px Sora', color: '#0B1620' }}>Check your phone</div>
              <div style={{ font: '400 14px/1.6 Inter', color: '#64748B', marginTop: 10, maxWidth: 280 }}>
                Enter your mobile money PIN to approve
                {quote ? ` ${formatFiat(quote.fiatAmount, quote.currency)}` : ''}. This page updates on
                its own — keep it open.
              </div>
            </>
          )}

          {phase === 'done' && (
            <>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(46,140,150,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 22, font: '600 26px Inter', color: ACCENT }}>✓</div>
              <div style={{ font: '600 18px Sora', color: '#0B1620' }}>Payment complete</div>
              <div style={{ font: '400 14px/1.6 Inter', color: '#64748B', marginTop: 10 }}>Thank you.</div>
            </>
          )}

          {phase === 'failed' && (
            <>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#FEF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 22, font: '600 26px Inter', color: '#DC2626' }}>!</div>
              <div style={{ font: '600 18px Sora', color: '#0B1620' }}>Payment not completed</div>
              <div style={{ font: '400 14px/1.6 Inter', color: '#64748B', marginTop: 10, maxWidth: 290 }}>
                {error || status?.message || 'The payment did not go through.'}
              </div>
              {!error && (
                <button
                  onClick={() => { setPhase('form'); setStatus(null); }}
                  style={{ marginTop: 22, padding: '13px 26px', borderRadius: 16, border: '1px solid #E2E8F0', background: '#fff', font: '600 15px Inter', color: '#0B1620', cursor: 'pointer' }}
                >
                  Try again
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

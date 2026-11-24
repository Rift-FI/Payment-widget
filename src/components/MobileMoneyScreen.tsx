import { useEffect, useMemo, useRef, useState } from 'react';
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
  /**
   * Set only on an open link, where the payer picked the figure themselves:
   * the number they typed, the currency they typed it in, and its crypto
   * equivalent. On a link with an amount baked in this stays undefined and
   * the server charges the invoice.
   */
  openAmount?: { currency: string; fiat: number; crypto: number };
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

export function MobileMoneyScreen({ invoiceId, token, cryptoAmount, openAmount, onBack, onPaid }: Props) {
  // Start in the market the payer was already thinking in, when that market
  // can be prompted at all. Dropping them into Kenya after they typed an
  // amount in shillings-of-somewhere-else is its own small confusion.
  const [currency, setCurrency] = useState(() => {
    const wanted = (openAmount?.currency ?? '').toUpperCase();
    return findMarket(wanted) ? wanted : MARKETS[0].currency;
  });
  const [network, setNetwork] = useState(MARKETS[0].networks[0]);
  const [phone, setPhone] = useState('');
  const [quote, setQuote] = useState<{ fiatAmount: number; currency: string; cryptoAmount: number; rate: number; fee: number } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<OnrampStatus | null>(null);
  const abort = useRef<AbortController | null>(null);

  const market = findMarket(currency)!;

  /**
   * How to price an open link.
   *
   * If the payer is paying from the same currency they typed their amount
   * in, send that figure and they are prompted for exactly it — no
   * conversion for them to puzzle over. If they switched country, their
   * number no longer means anything in this market, so the crypto
   * equivalent is used and the rate is shown so the new figure is
   * explicable.
   */
  const basis = useMemo(() => {
    if (!openAmount) return {};
    return openAmount.currency.toUpperCase() === currency.toUpperCase()
      ? { fiatAmount: openAmount.fiat }
      : { amount: openAmount.crypto };
  }, [openAmount, currency]);

  useEffect(() => {
    setNetwork(market.networks[0]);
  }, [currency]);

  // Price it as soon as the market changes, so the payer sees the local
  // amount before committing to anything.
  useEffect(() => {
    let cancelled = false;
    setQuoting(true);
    setError(null);
    quoteOnramp(invoiceId, currency, basis)
      .then((q) => {
        if (!cancelled) {
          setQuote({ fiatAmount: q.fiatAmount, currency: q.currency, cryptoAmount: q.cryptoAmount, rate: q.rate, fee: q.fee });
        }
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
  }, [invoiceId, currency, basis]);

  useEffect(() => () => abort.current?.abort(), []);

  async function send() {
    setError(null);
    setPhase('sending');
    try {
      const started = await startOnramp(invoiceId, { phone, network, currency, ...basis });
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

      {/*
        The same three facts the Rift app's buy screen shows, in the same
        order and the same words: what you pay, what it buys, the rate it
        bought at. Every figure comes from the server's quote — the widget
        never re-derives a price, so what is shown here is what the prompt
        will ask for.

        The rate is the ONRAMP rate (local currency per 1 USDC when buying),
        which is not the rate the pay page quotes elsewhere: that one is the
        offramp rate, what the merchant gets when settling to local currency.
        Showing the wrong one here would explain the total incorrectly.
      */}
      <div style={{ background: '#F8FAFB', border: '1px solid #E2E8F0', borderRadius: 24, padding: 20, marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ font: '600 12px Inter', letterSpacing: '.05em', textTransform: 'uppercase', color: '#94A3B8' }}>You pay</span>
          <span style={{ font: '700 26px Sora', color: '#0B1620', letterSpacing: '-.01em' }}>
            {quoting ? '…' : quote ? formatFiat(quote.fiatAmount, quote.currency) : '—'}
          </span>
        </div>

        <div style={{ borderTop: '1px solid #E2E8F0', marginTop: 14, paddingTop: 12, display: 'grid', gap: 7 }}>
          <Row label="You get">
            {quote ? `${trim(quote.cryptoAmount)} ${token}` : cryptoAmount ? `${trim(cryptoAmount)} ${token}` : '—'}
          </Row>
          <Row label="Rate">
            {quote?.rate ? `1 ${token} = ${fmtRate(quote.rate)} ${quote.currency}` : '—'}
          </Row>
          <Row label="Fee">
            {quote ? formatFiat(quote.fee, quote.currency) : '—'}
          </Row>
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

/** One label/value line, the shape the app uses for a quote breakdown. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ font: '400 13px Inter', color: '#64748B' }}>{label}</span>
      <span style={{ font: '500 13px Inter', color: '#0B1620', textAlign: 'right' }}>{children}</span>
    </div>
  );
}

/** Crypto, without a tail of meaningless zeros. */
const trim = (n: number) => String(+n.toFixed(6));

/** A rate reads better to 2dp, but a thin unit (UGX, MWK) needs none. */
const fmtRate = (r: number) =>
  r.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: r >= 1000 ? 0 : 2 });

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a render crash so the pay page shows something instead of nothing.
 *
 * React unmounts the whole tree on an uncaught throw, so one unexpected field
 * from the API takes the entire page to white — which is exactly what
 * happened during local testing: /v1/rates came back in a shape the widget
 * did not expect, `rates.currencies` was not iterable, and the page rendered
 * and then vanished.
 *
 * That is far worse here than in an internal dashboard. This page is opened
 * by a stranger who was sent a link and is trying to pay someone. A blank
 * page tells them nothing, gives them nothing to act on, and looks like the
 * merchant's checkout is broken — so they leave, and the merchant loses the
 * payment without ever knowing why.
 *
 * Deliberately dependency-free and inline-styled: if the crash came from the
 * styling or data layers, the fallback must not need them.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No error reporter is wired up on this page; the console is what support
    // asks for when someone says "the link didn't load".
    console.error('[pay page crashed]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        data-testid="pay-error"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#F8FAFB',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 380,
            width: '100%',
            background: '#fff',
            border: '1px solid #E2E8F0',
            borderRadius: 24,
            padding: 28,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: '#FEF2F2',
              color: '#DC2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              font: '600 24px Inter',
              margin: '0 auto 18px',
            }}
          >
            !
          </div>
          <div style={{ font: '600 18px Sora, Inter, sans-serif', color: '#0B1620' }}>
            This payment page didn't load
          </div>
          <p style={{ font: '400 14px/1.6 Inter', color: '#64748B', margin: '10px 0 0' }}>
            Nothing has been charged and no payment has been sent. Reload to try
            again — if it keeps happening, ask whoever sent you this link for a
            new one.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 22,
              width: '100%',
              padding: 15,
              borderRadius: 16,
              border: 'none',
              background: '#2E8C96',
              color: '#fff',
              font: '600 15px Inter',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

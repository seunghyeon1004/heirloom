'use client';

import { useState } from 'react';
import { useConnect, useConnectedWallet, useDisconnect, useWallets } from '@solana/kit-plugin-wallet/react';
import { walletClient } from '@/lib/wallet';

/** Optional: connect a real Wallet Standard wallet (devnet) to act as the owner. */
export function WalletConnect() {
  const wallets = useWallets(walletClient);
  const connected = useConnectedWallet(walletClient);
  const { dispatch: connect } = useConnect(walletClient);
  const { dispatch: disconnect } = useDisconnect(walletClient);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (connected) {
    return (
      <button className="btn-quiet btn" onClick={() => disconnect()} title={connected.account.address}>
        Disconnect wallet
      </button>
    );
  }
  return (
    <span style={{ position: 'relative' }}>
      <button className="btn-quiet btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        Use my wallet
      </button>
      {open && (
        <span className="sheet" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 'var(--z-dropdown)' as unknown as number, display: 'grid', gap: 8, minWidth: 240, padding: 16 }}>
          {wallets.length === 0 ? (
            <span className="small muted">No Solana wallet found in this browser. The demo wallets work without one.</span>
          ) : (
            wallets.map((w) => (
              <button
                key={w.name}
                className="btn"
                onClick={async () => {
                  setErr(null);
                  try {
                    await connect(w);
                    setOpen(false);
                  } catch (e) {
                    setErr((e as Error).message);
                  }
                }}
              >
                {w.name}
              </button>
            ))
          )}
          {err && <span className="error">{err}</span>}
        </span>
      )}
    </span>
  );
}

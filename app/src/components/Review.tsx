'use client';

// Every signature in Heirloom goes through this card: simulate on-chain, let Claude explain
// in plain words, and only then ask for the signature.
import { useEffect, useState } from 'react';
import type { Instruction, TransactionSigner } from '@solana/kit';
import { simulate, sendAndConfirm, type Simulation } from '@/lib/tx';
import { CLUSTER_LABEL } from '@/lib/config';

export type PendingTx = {
  title: string;
  signer: TransactionSigner;
  build: () => Promise<Instruction[]>;
  rows: [string, string][];
  explain: Record<string, unknown>;
  confirmLabel: string;
};

export function Review({
  tx,
  onCancel,
  onDone,
}: {
  tx: PendingTx;
  onCancel: () => void;
  onDone: (sig: string) => void;
}) {
  const [sim, setSim] = useState<Simulation | null>(null);
  const [ai, setAi] = useState<string | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      let s: Simulation;
      try {
        s = await simulate(tx.signer, await tx.build());
      } catch (e) {
        s = { ok: false, error: (e as Error).message.slice(0, 200), logs: [], unitsConsumed: null };
      }
      if (!live) return;
      setSim(s);
      try {
        const r = await fetch('/api/ai/explain', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...tx.explain, signer: tx.signer.address, simulation: { ok: s.ok, error: s.error, unitsConsumed: s.unitsConsumed } }),
        });
        const j = await r.json();
        if (!live) return;
        if (!r.ok) setAiErr(j.error ?? 'The assistant could not explain this one.');
        else setAi(j.explanation);
      } catch {
        if (live) setAiErr('The assistant could not be reached.');
      }
    })();
    return () => {
      live = false;
    };
  }, [tx]);

  async function confirm() {
    setSending(true);
    setErr(null);
    try {
      const sig = await sendAndConfirm(tx.signer, await tx.build());
      onDone(sig);
    } catch (e) {
      setErr((e as Error).message);
      setSending(false);
    }
  }

  return (
    <section className="review" aria-live="polite" aria-label={`Review: ${tx.title}`}>
      <h3>{tx.title}</h3>
      <dl>
        <dt>Network</dt>
        <dd>Solana {CLUSTER_LABEL}</dd>
        <dt>Signer and fee payer</dt>
        <dd>{tx.signer.address}</dd>
        {tx.rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <dt>Simulation</dt>
        <dd>
          {!sim ? (
            <span className="muted">running…</span>
          ) : sim.ok ? (
            <span className="sim-ok">would succeed{sim.unitsConsumed ? `, ${sim.unitsConsumed.toLocaleString()} compute units` : ''}</span>
          ) : (
            <span className="sim-fail">would fail: {sim.error}</span>
          )}
        </dd>
      </dl>
      <div className="ai">
        <span className="who">Claude, before you sign</span>
        {ai ? <p>{ai}</p> : aiErr ? <p className="error">{aiErr}</p> : <div className="skeleton" style={{ height: '4.5em' }} />}
      </div>
      {err && <p className="error">{err}</p>}
      <div className="row" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" onClick={confirm} disabled={!sim || !sim.ok || sending} aria-busy={sending}>
          {sending ? 'Signing and sending…' : tx.confirmLabel}
        </button>
        <button className="btn" onClick={onCancel} disabled={sending}>
          Back
        </button>
      </div>
    </section>
  );
}

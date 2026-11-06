'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAddress, type Address, type KeyPairSigner } from '@solana/kit';
import { PERSONAS, loadPersonas, resetPersonas, type PersonaId } from '@/lib/personas';
import { rpc, chainNow } from '@/lib/tx';
import { explorerAddress, explorerTx, CLUSTER_LABEL } from '@/lib/config';
import {
  fetchVault,
  viewVault,
  formatSol,
  vaultAddress,
  ixInitialize,
  ixDeposit,
  ixWithdraw,
  ixHeartbeat,
  ixClaim,
  ixGuardianPause,
  ixCancel,
  ixSetGuideHash,
  type VaultSnapshot,
  type VaultView,
  LAMPORTS_PER_SOL,
} from '@/lib/heirloom';
import { Review, type PendingTx } from './Review';

type Personas = Record<PersonaId, KeyPairSigner>;
type Loaded = { snap: VaultSnapshot | null; rentMin: bigint; now: number; fetchedAt: number };

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function clock(secs: number) {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h > 0) return `${h}:${pad(m)}:${pad(ss)}`;
  return `${pad(m)}:${pad(ss)}`;
}

function human(secs: number) {
  if (secs < 120) return `${secs} seconds`;
  if (secs < 7200) return `${Math.round(secs / 60)} minutes`;
  if (secs < 172800) return `${Math.round(secs / 3600)} hours`;
  return `${Math.round(secs / 86400)} days`;
}

function parseSol(v: string): bigint | null {
  if (!/^\d+(\.\d{1,9})?$/.test(v.trim())) return null;
  const [w, f = ''] = v.trim().split('.');
  return BigInt(w) * LAMPORTS_PER_SOL + BigInt((f + '000000000').slice(0, 9));
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function readGuide(vault: string): string | null {
  try {
    return localStorage.getItem(`heirloom.guide.${vault}`);
  } catch {
    return null;
  }
}
function writeGuide(vault: string, text: string) {
  try {
    localStorage.setItem(`heirloom.guide.${vault}`, text);
  } catch {
    /* ignore */
  }
}

export default function HeirloomApp() {
  const [personas, setPersonas] = useState<Personas | null>(null);
  const [who, setWho] = useState<PersonaId>('owner');
  const [ownerInput, setOwnerInput] = useState('');
  const [data, setData] = useState<Loaded | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [pending, setPending] = useState<PendingTx | null>(null);
  const [toast, setToast] = useState<{ text: string; sig?: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [activity, setActivity] = useState<{ sig: string; time: number | null; ok: boolean }[]>([]);

  useEffect(() => {
    loadPersonas().then(setPersonas);
    try {
      const p = new URLSearchParams(location.search).get('as') as PersonaId | null;
      if (p && PERSONAS.some((x) => x.id === p)) setWho(p);
    } catch {
      /* ignore */
    }
  }, []);

  const me = personas?.[who];
  const ownerAddr: Address | null = useMemo(() => {
    if (!personas) return null;
    if (who === 'owner') return personas.owner.address;
    if (ownerInput && isAddress(ownerInput)) return ownerInput as Address;
    return personas.owner.address;
  }, [personas, who, ownerInput]);

  const refresh = useCallback(async () => {
    if (!ownerAddr || !personas) return;
    try {
      const [snap, now] = await Promise.all([fetchVault(rpc, ownerAddr), chainNow()]);
      const rentMin = snap ? await rpc.getMinimumBalanceForRentExemption(BigInt(snap.dataLength)).send() : 0n;
      setData({ snap, rentMin, now, fetchedAt: Date.now() });
      setLoadErr(null);
      const bals = await Promise.all(PERSONAS.map((p) => rpc.getBalance(personas[p.id].address, { commitment: 'confirmed' }).send()));
      setBalances(Object.fromEntries(PERSONAS.map((p, i) => [p.id, bals[i].value])));
      const vaddr = await vaultAddress(ownerAddr);
      const sigs = await rpc.getSignaturesForAddress(vaddr, { limit: 8, commitment: 'confirmed' }).send();
      setActivity(sigs.map((s) => ({ sig: s.signature, time: s.blockTime != null ? Number(s.blockTime) : null, ok: !s.err })));
    } catch (e) {
      setLoadErr((e as Error).message);
    }
  }, [ownerAddr, personas]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = data ? data.now + Math.floor((Date.now() - data.fetchedAt) / 1000) : 0;
  void tick;
  const view: VaultView | null = data?.snap ? viewVault(data.snap, data.rentMin, now) : null;

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(id);
  }, [toast]);

  function done(text: string) {
    return (sig: string) => {
      setPending(null);
      setToast({ text, sig });
      refresh();
    };
  }

  async function fund() {
    if (!me) return;
    setToast({ text: 'Requesting test SOL…' });
    const r = await fetch('/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: me.address }) });
    const j = await r.json().catch(() => ({}));
    if (j.signature) setToast({ text: 'Sent 0.3 test SOL', sig: j.signature });
    else setToast({ text: j.reason ? `Skipped: ${j.reason}` : j.error ?? 'Faucet unavailable' });
    setTimeout(refresh, 2500);
  }

  if (!personas || !me) {
    return (
      <main className="main">
        <div className="sheet deed" aria-busy="true">
          <div className="skeleton" style={{ height: '1.4em', width: '40%' }} />
          <div className="skeleton" style={{ height: '5em', marginTop: 24 }} />
        </div>
      </main>
    );
  }

  const myBal = balances[who];

  return (
    <>
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <filter id="press">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
        </filter>
      </svg>
      <header className="bar">
        <div className="bar-inner">
          <div className="wordmark">
            Heirloom <small>{CLUSTER_LABEL} prototype</small>
          </div>
          <div className="bar-spacer" />
          <div className="groove" role="group" aria-label="Act as">
            {PERSONAS.map((p) => (
              <button key={p.id} aria-pressed={who === p.id} onClick={() => { setWho(p.id); setPending(null); }} title={p.role}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="account">
            <a href={explorerAddress(me.address)} target="_blank" rel="noreferrer" className="mono">
              {short(me.address)}
            </a>
            <span className="mono">{myBal != null ? `${formatSol(myBal)} SOL` : '…'}</span>
            <button className="btn-quiet btn" onClick={fund}>
              Add test SOL
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="stack">
          <Deed view={view} snap={data?.snap ?? null} loading={!data} error={loadErr} personas={personas} ownerAddr={ownerAddr} now={now} />
          <section className="sheet">
            <div className="sheet-head">
              <h2>On-chain activity</h2>
              {data?.snap && (
                <a className="small" href={explorerAddress(data.snap.address)} target="_blank" rel="noreferrer">
                  Vault on Explorer
                </a>
              )}
            </div>
            {activity.length === 0 ? (
              <p className="muted small">No transactions yet. They appear here as soon as the vault exists.</p>
            ) : (
              <ul className="activity">
                {activity.map((a) => (
                  <li key={a.sig}>
                    <a className="mono" href={explorerTx(a.sig)} target="_blank" rel="noreferrer">
                      {a.sig.slice(0, 16)}…
                    </a>
                    <span className="muted">
                      {a.ok ? '' : 'failed '}
                      {a.time ? new Date(a.time * 1000).toLocaleTimeString('en-US') : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="stack">
          {who !== 'owner' && (
            <section className="sheet">
              <label className="field">
                Vault owner address
                <input
                  className="mono"
                  value={ownerInput}
                  placeholder={personas.owner.address}
                  onChange={(e) => setOwnerInput(e.target.value.trim())}
                  aria-invalid={ownerInput !== '' && !isAddress(ownerInput)}
                />
              </label>
              <p className="muted small" style={{ marginTop: 8 }}>
                Defaults to the demo Owner in this browser.
              </p>
            </section>
          )}
          {who === 'owner' && (
            <OwnerPanel me={me} personas={personas} snap={data?.snap ?? null} view={view} loading={!data} pending={pending} setPending={setPending} done={done} balance={myBal} />
          )}
          {(who === 'heirA' || who === 'heirB') && ownerAddr && (
            <HeirPanel me={me} ownerAddr={ownerAddr} snap={data?.snap ?? null} view={view} pending={pending} setPending={setPending} done={done} />
          )}
          {who === 'guardian' && ownerAddr && (
            <GuardianPanel me={me} ownerAddr={ownerAddr} snap={data?.snap ?? null} view={view} pending={pending} setPending={setPending} done={done} />
          )}
          <section className="sheet">
            <h3>How this demo works</h3>
            <p className="small">
              Four throwaway {CLUSTER_LABEL} wallets live in this browser so you can play every role. Switch roles in the top bar.
              Every action is simulated, explained by Claude, then signed and sent to the Heirloom program.
            </p>
            <div className="row">
              <button
                className="btn-quiet btn"
                onClick={() => {
                  if (confirm('Forget the four demo wallets in this browser? Test SOL in them is lost.')) {
                    resetPersonas();
                    location.reload();
                  }
                }}
              >
                Reset demo wallets
              </button>
            </div>
          </section>
        </div>
      </main>
      <footer className="footer">
        <p>
          Prototype on Solana {CLUSTER_LABEL} with test SOL. Not a legal will and not financial advice. Claude explains and nudges; it cannot move funds or reset the timer.
        </p>
      </footer>
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast.text}
          {toast.sig && (
            <>
              {' '}
              <a href={explorerTx(toast.sig)} target="_blank" rel="noreferrer">
                View on Explorer
              </a>
            </>
          )}
        </div>
      )}
    </>
  );
}

// ---------------- the deed ----------------

function Deed({
  view,
  snap,
  loading,
  error,
  personas,
  ownerAddr,
  now,
}: {
  now: number;
  view: VaultView | null;
  snap: VaultSnapshot | null;
  loading: boolean;
  error: string | null;
  personas: Personas;
  ownerAddr: Address | null;
}) {
  const name = (a: string) => PERSONAS.find((p) => personas[p.id].address === a)?.label ?? short(a);
  if (loading) {
    return (
      <section className="sheet deed" aria-busy="true">
        <div className="skeleton" style={{ height: '1.2em', width: '35%' }} />
        <div className="skeleton" style={{ height: '5rem', marginTop: 24 }} />
        <div className="skeleton" style={{ height: '6rem', marginTop: 24 }} />
      </section>
    );
  }
  if (error && !snap) {
    return (
      <section className="sheet deed">
        <h2>Could not read the vault</h2>
        <p className="error">{error}</p>
        <p className="small muted">The {CLUSTER_LABEL} RPC may be rate limiting. It retries every 5 seconds.</p>
      </section>
    );
  }
  if (!snap || !view) {
    return (
      <section className="sheet deed">
        <span className="status">No vault yet</span>
        <p className="count" aria-hidden="true">
          --:--
        </p>
        <p className="count-label">
          {ownerAddr ? `${name(ownerAddr)} has no Heirloom vault.` : ''} The owner creates one: heirs and their shares, how often to check in, and the SOL to protect.
        </p>
      </section>
    );
  }
  const d = snap.data;
  const total = Number(d.checkinIntervalSecs) + Number(d.gracePeriodSecs);
  const elapsed = Math.min(total, Math.max(0, total - view.secondsToUnlock));
  const progress = total > 0 ? elapsed / total : 1;
  const dueAt = total > 0 ? Number(d.checkinIntervalSecs) / total : 1;
  const phaseText: Record<string, string> = {
    active: 'Sealed',
    grace: 'Check-in overdue',
    claimable: 'Unlocked for heirs',
    claiming: 'Heirs are claiming',
    settled: 'Settled',
  };
  const label =
    view.phase === 'active'
      ? `until heirs could claim. Next check-in due in ${human(Math.max(0, view.dueAt - now))}.`
      : view.phase === 'grace'
        ? 'left in the grace period. One check-in from the owner seals it again.'
        : view.phase === 'claimable'
          ? 'The timer ran out. Each heir can claim their share once.'
          : view.phase === 'claiming'
            ? 'Shares are frozen on the balance at the first claim.'
            : 'Every heir has claimed. The vault is closed to new activity.';
  const pausedNow = view.pausedUntil > now;
  return (
    <section className="sheet deed" aria-label="Vault">
      {(view.phase === 'settled' || view.phase === 'claiming') && <span className="seal">{view.phase === 'settled' ? 'Settled' : 'Claiming'}</span>}
      <span className="status" data-phase={view.phase}>
        {phaseText[view.phase]}
      </span>
      <p className="count" aria-live="off">
        {view.phase === 'active' || view.phase === 'grace' ? clock(view.secondsToUnlock) : `${formatSol(view.phase === 'claiming' || view.phase === 'settled' ? d.claimSnapshot : view.pot)} SOL`}
      </p>
      <p className="count-label">{label}</p>
      {(view.phase === 'active' || view.phase === 'grace') && (
        <>
          <div className="rail" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Time elapsed toward unlock">
            <span data-phase={view.phase} style={{ transform: `scaleX(${progress})` }} />
            <i className="due-mark" style={{ left: `${dueAt * 100}%` }} />
          </div>
          <div className="rail-legend">
            <span>Last check-in</span>
            <span className="due" style={{ left: `${dueAt * 100}%` }}>Check-in due</span>
            <span>Heirs may claim</span>
          </div>
        </>
      )}
      <table className="ledger">
        <thead>
          <tr>
            <th>Heir</th>
            <th className="num">Share</th>
            <th className="num">{view.phase === 'claiming' || view.phase === 'settled' ? 'Owed' : 'Today'}</th>
            <th className="num">Claimed</th>
          </tr>
        </thead>
        <tbody>
          {view.heirs.map((h) => (
            <tr key={h.key}>
              <td>
                {name(h.key)} <span className="muted mono small">{short(h.key)}</span>
              </td>
              <td className="num">{(h.shareBps / 100).toFixed(h.shareBps % 100 ? 2 : 0)}%</td>
              <td className="num">{formatSol(h.estimateLamports)}</td>
              <td className="num">{h.claimed ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="facts">
        <div>
          <dt>Balance in vault</dt>
          <dd>{formatSol(view.pot)} SOL</dd>
        </div>
        <div>
          <dt>Check in every</dt>
          <dd>{human(Number(d.checkinIntervalSecs))}</dd>
        </div>
        <div>
          <dt>Grace period</dt>
          <dd>{human(Number(d.gracePeriodSecs))}</dd>
        </div>
        <div>
          <dt>Guardian</dt>
          <dd>{d.guardian.__option === 'Some' ? `${name(d.guardian.value)}, ${d.pausesUsed} of 3 pauses used` : 'none'}</dd>
        </div>
        <div>
          <dt>Handoff guide hash</dt>
          <dd>{d.guideHash.some((b) => b !== 0) ? hex(d.guideHash).slice(0, 16) + '…' : 'not set'}</dd>
        </div>
        <div>
          <dt>Vault account</dt>
          <dd>
            <a href={explorerAddress(snap.address)} target="_blank" rel="noreferrer">
              {short(snap.address)}
            </a>
            {pausedNow ? ', guardian pause active' : ''}
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ---------------- owner ----------------

type PanelProps = {
  me: KeyPairSigner;
  snap: VaultSnapshot | null;
  view: VaultView | null;
  pending: PendingTx | null;
  setPending: (p: PendingTx | null) => void;
  done: (text: string) => (sig: string) => void;
};

function OwnerPanel(props: PanelProps & { personas: Personas; loading: boolean; balance?: bigint }) {
  const { snap, view, loading } = props;
  if (loading) return <section className="sheet"><div className="skeleton" style={{ height: '8rem' }} /></section>;
  if (!snap || !view) return <SetupForm {...props} />;
  return (
    <>
      <CheckIn {...props} snap={snap} view={view} />
      <Funds {...props} snap={snap} view={view} />
      <GuideComposer {...props} snap={snap} />
      {view.phase !== 'active' && view.phase !== 'grace' && view.phase !== 'claimable' && (
        <p className="notice">Heirs have started claiming. The owner can no longer change or withdraw from this vault.</p>
      )}
    </>
  );
}

function SetupForm({ me, personas, pending, setPending, done, balance }: PanelProps & { personas: Personas; balance?: bigint }) {
  const [heirs, setHeirs] = useState([
    { key: personas.heirA.address as string, pct: '60' },
    { key: personas.heirB.address as string, pct: '40' },
  ]);
  const [interval, setIntervalS] = useState('90');
  const [grace, setGrace] = useState('30');
  const [useGuardian, setUseGuardian] = useState(true);
  const [deposit, setDeposit] = useState('0.2');
  const total = heirs.reduce((s, h) => s + (Number(h.pct) || 0), 0);
  const amount = parseSol(deposit);
  const valid = heirs.every((h) => isAddress(h.key) && Number(h.pct) > 0) && Math.abs(total - 100) < 1e-9 && amount != null;

  function review() {
    const hs = heirs.map((h) => ({ key: h.key as Address, shareBps: Math.round(Number(h.pct) * 100) }));
    const guardian = useGuardian ? personas.guardian.address : null;
    setPending({
      title: 'Create the vault and lock SOL',
      signer: me,
      confirmLabel: 'Sign and create vault',
      build: async () => {
        const ixs = [await ixInitialize({ owner: me, heirs: hs, intervalSecs: Number(interval), graceSecs: Number(grace), guardian })];
        if (amount && amount > 0n) ixs.push(await ixDeposit(me, amount));
        return ixs;
      },
      rows: [
        ['Program', 'Heirloom initialize + deposit'],
        ['Heirs', hs.map((h) => `${short(h.key)} ${h.shareBps / 100}%`).join(', ')],
        ['Check-in every', human(Number(interval))],
        ['Grace period', human(Number(grace))],
        ['Guardian', guardian ? short(guardian) : 'none'],
        ['Locked now', `${deposit} SOL`],
      ],
      explain: {
        action: 'initialize',
        owner: me.address,
        amountLamports: (amount ?? 0n).toString(),
        draft: { heirs: hs, intervalSecs: Number(interval), graceSecs: Number(grace), guardian },
      },
    });
  }

  return (
    <section className="sheet">
      <h2>Set up your vault</h2>
      <p className="small muted">Name who inherits, how often you will check in, and how much SOL to protect.</p>
      {pending ? (
        <Review tx={pending} onCancel={() => setPending(null)} onDone={done('Vault created')} />
      ) : (
        <div className="form" style={{ marginTop: 16 }}>
          {heirs.map((h, i) => (
            <div className="heir-row" key={i}>
              <label className="field">
                Heir {i + 1} address
                <input className="mono" value={h.key} aria-invalid={!isAddress(h.key)} onChange={(e) => setHeirs(heirs.map((x, j) => (j === i ? { ...x, key: e.target.value.trim() } : x)))} />
              </label>
              <label className="field">
                Share %
                <input inputMode="decimal" value={h.pct} onChange={(e) => setHeirs(heirs.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
              </label>
            </div>
          ))}
          <div className="row" style={{ marginTop: 0 }}>
            {heirs.length < 5 && (
              <button className="btn" onClick={() => setHeirs([...heirs, { key: '', pct: '0' }])}>
                Add heir
              </button>
            )}
            {heirs.length > 1 && (
              <button className="btn-quiet btn" onClick={() => setHeirs(heirs.slice(0, -1))}>
                Remove last
              </button>
            )}
            <span className={Math.abs(total - 100) < 1e-9 ? 'muted small' : 'error'}>Shares total {total}%</span>
          </div>
          <div className="grid-2">
            <label className="field">
              Check in every
              <select value={interval} onChange={(e) => setIntervalS(e.target.value)}>
                <option value="90">90 seconds (demo)</option>
                <option value="86400">1 day</option>
                <option value="2592000">30 days</option>
                <option value="15552000">180 days</option>
              </select>
            </label>
            <label className="field">
              Grace period
              <select value={grace} onChange={(e) => setGrace(e.target.value)}>
                <option value="30">30 seconds (demo)</option>
                <option value="604800">7 days</option>
                <option value="2592000">30 days</option>
              </select>
            </label>
          </div>
          <div className="grid-2">
            <label className="field">
              SOL to lock now
              <input inputMode="decimal" value={deposit} aria-invalid={amount == null} onChange={(e) => setDeposit(e.target.value)} />
            </label>
            <label className="field">
              Guardian
              <select value={useGuardian ? 'yes' : 'no'} onChange={(e) => setUseGuardian(e.target.value === 'yes')}>
                <option value="yes">Demo Guardian {short(personas.guardian.address)}</option>
                <option value="no">No guardian</option>
              </select>
            </label>
          </div>
          {balance != null && amount != null && balance < amount + 10_000_000n && (
            <p className="notice">This wallet holds {formatSol(balance)} SOL. Use “Add test SOL” in the top bar first.</p>
          )}
          <div className="row" style={{ marginTop: 0 }}>
            <button className="btn btn-primary" disabled={!valid} onClick={review}>
              Review with Claude
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function CheckIn({ me, view, setPending, pending, done }: PanelProps & { snap: VaultSnapshot; view: VaultView }) {
  const [thread, setThread] = useState<{ role: 'assistant' | 'owner'; text: string }[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);
  const canAct = view.phase === 'active' || view.phase === 'grace' || view.phase === 'claimable';
  const mine = pending?.explain.action === 'heartbeat';

  const talk = useCallback(
    async (history: { role: 'assistant' | 'owner'; text: string }[]) => {
      setBusy(true);
      setErr(null);
      try {
        const r = await fetch('/api/ai/checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: me.address, history }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'Assistant unavailable');
        setThread([...history, { role: 'assistant', text: j.reply }]);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [me.address],
  );

  useEffect(() => {
    if (!started.current && canAct) {
      started.current = true;
      talk([]);
    }
  }, [canAct, talk]);

  function signCheckIn() {
    setPending({
      title: 'Check in: prove you are still here',
      signer: me,
      confirmLabel: 'Sign check-in',
      build: async () => [await ixHeartbeat(me, me.address)],
      rows: [
        ['Program', 'Heirloom heartbeat'],
        ['Moves funds', 'no'],
      ],
      explain: { action: 'heartbeat', owner: me.address },
    });
  }

  if (!canAct) return null;
  return (
    <section className="sheet">
      <div className="sheet-head">
        <h2>Check-in</h2>
        <span className="small muted">with Claude</span>
      </div>
      <div className="thread" aria-live="polite">
        {thread.map((m, i) => (
          <div className="card" data-from={m.role} key={i}>
            <span className="who">{m.role === 'owner' ? 'You' : 'Claude'}</span>
            <p>{m.text}</p>
          </div>
        ))}
        {busy && <div className="card"><div className="skeleton" style={{ height: '3em', width: 260 }} /></div>}
        {err && <p className="error">{err}</p>}
      </div>
      {mine && pending ? (
        <Review tx={pending} onCancel={() => setPending(null)} onDone={(sig) => { setThread((t) => [...t, { role: 'assistant', text: 'Check-in recorded on-chain. The timer starts over from now.' }]); done('Checked in')(sig); }} />
      ) : (
        <>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              const h = [...thread, { role: 'owner' as const, text: draft.trim() }];
              setThread(h);
              setDraft('');
              talk(h);
            }}
          >
            <input aria-label="Reply to Claude" placeholder="Reply, for example: all good, just busy" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: '1 1 220px' }} />
            <button className="btn" type="submit" disabled={busy || !draft.trim()}>
              Send
            </button>
          </form>
          <div className="row">
            <button className="btn btn-primary" onClick={signCheckIn} disabled={!!pending}>
              Sign check-in
            </button>
            <span className="small muted">Only your wallet signature resets the timer.</span>
          </div>
        </>
      )}
    </section>
  );
}

function Funds({ me, view, pending, setPending, done }: PanelProps & { snap: VaultSnapshot; view: VaultView }) {
  const [amt, setAmt] = useState('0.05');
  const amount = parseSol(amt);
  const mine = pending && ['deposit', 'withdraw', 'cancel'].includes(String(pending.explain.action));
  const active = view.phase === 'active' || view.phase === 'grace' || view.phase === 'claimable';
  if (!active) return null;

  function go(kind: 'deposit' | 'withdraw' | 'cancel') {
    if (kind !== 'cancel' && !amount) return;
    setPending({
      title: kind === 'deposit' ? 'Add SOL to the vault' : kind === 'withdraw' ? 'Take SOL back out' : 'Close the vault and take everything back',
      signer: me,
      confirmLabel: kind === 'deposit' ? 'Sign deposit' : kind === 'withdraw' ? 'Sign withdrawal' : 'Sign and close',
      build: async () => [kind === 'deposit' ? await ixDeposit(me, amount!) : kind === 'withdraw' ? await ixWithdraw(me, amount!) : await ixCancel(me)],
      rows: [
        ['Program', `Heirloom ${kind}`],
        ['Amount', kind === 'cancel' ? `${formatSol(view.pot)} SOL plus the account rent` : `${amt} SOL`],
      ],
      explain: { action: kind, owner: me.address, amountLamports: kind === 'cancel' ? view.pot.toString() : (amount ?? 0n).toString() },
    });
  }

  return (
    <section className="sheet">
      <h2>Funds</h2>
      {mine && pending ? (
        <Review tx={pending} onCancel={() => setPending(null)} onDone={done('Done')} />
      ) : (
        <>
          <label className="field" style={{ marginTop: 12 }}>
            Amount in SOL
            <input inputMode="decimal" value={amt} aria-invalid={amount == null} onChange={(e) => setAmt(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn" onClick={() => go('deposit')} disabled={!amount || !!pending}>
              Deposit
            </button>
            <button className="btn" onClick={() => go('withdraw')} disabled={!amount || !!pending}>
              Withdraw
            </button>
            <button className="btn-quiet btn" onClick={() => go('cancel')} disabled={!!pending}>
              Close vault
            </button>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>Any of these also counts as a check-in.</p>
        </>
      )}
    </section>
  );
}

function GuideComposer({ me, snap, view, pending, setPending, done }: PanelProps & { snap: VaultSnapshot }) {
  const [notes, setNotes] = useState('');
  const [guide, setGuide] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mine = pending?.explain.action === 'set_guide_hash';
  const onChain = snap.data.guideHash.some((b) => b !== 0);
  if (!view || !(view.phase === 'active' || view.phase === 'grace' || view.phase === 'claimable')) return null;

  async function draftGuide() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/ai/guide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: me.address, notes }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Could not write the guide');
      setGuide(j.guide);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function seal() {
    if (!guide) return;
    const h = await sha256(guide);
    setPending({
      title: 'Seal the handoff guide on-chain',
      signer: me,
      confirmLabel: 'Sign and seal guide',
      build: async () => [await ixSetGuideHash(me, h)],
      rows: [
        ['Program', 'Heirloom set_guide_hash'],
        ['SHA-256', hex(h)],
        ['Stored on-chain', 'only the hash, never the text'],
      ],
      explain: { action: 'set_guide_hash', owner: me.address },
    });
  }

  return (
    <section className="sheet">
      <div className="sheet-head">
        <h2>Handoff guide</h2>
        <span className="small muted">{onChain ? 'hash sealed on-chain' : 'not sealed yet'}</span>
      </div>
      <p className="small muted">
        Write rough notes: what exists, where it is kept, who to call. Claude turns them into steps your heirs can follow. Never type a seed phrase or key.
      </p>
      {mine && pending ? (
        <Review
          tx={pending}
          onCancel={() => setPending(null)}
          onDone={(sig) => {
            if (guide) writeGuide(snap.address, guide);
            done('Guide sealed')(sig);
          }}
        />
      ) : (
        <div className="form" style={{ marginTop: 12 }}>
          <textarea
            aria-label="Notes for your heirs"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Hardware wallet is in the fire safe at home, the PIN is with my sister Mina. Exchange account at Coinbase under my email. Call Mr. Lee at the family law office first."
          />
          {err && <p className="error">{err}</p>}
          <div className="row" style={{ marginTop: 0 }}>
            <button className="btn" onClick={draftGuide} disabled={busy || notes.trim().length < 10} aria-busy={busy}>
              {busy ? 'Claude is writing…' : 'Draft guide with Claude'}
            </button>
          </div>
          {guide && (
            <>
              <div className="guide">{guide}</div>
              <div className="row" style={{ marginTop: 0 }}>
                <button className="btn btn-primary" onClick={seal} disabled={!!pending}>
                  Seal hash on-chain
                </button>
                <span className="small muted">The text stays in this browser in the prototype.</span>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------- heir ----------------

function HeirPanel({ me, ownerAddr, snap, view, pending, setPending, done }: PanelProps & { ownerAddr: Address }) {
  const [guideOk, setGuideOk] = useState<null | { text: string; verified: boolean }>(null);
  const idx = snap ? snap.data.heirs.findIndex((h) => h.key === me.address) : -1;
  const heir = view && idx >= 0 ? view.heirs[idx] : null;
  const onChainHash = snap ? hex(snap.data.guideHash) : '';
  const hasHash = !!snap && snap.data.guideHash.some((b) => b !== 0);

  useEffect(() => {
    if (!snap || !heir?.claimed || !hasHash) return setGuideOk(null);
    const text = readGuide(snap.address);
    if (!text) return setGuideOk(null);
    sha256(text).then((h) => setGuideOk({ text, verified: hex(h) === onChainHash }));
  }, [snap, heir?.claimed, hasHash, onChainHash]);

  if (!snap || !view) {
    return (
      <section className="sheet">
        <h2>Nothing to inherit yet</h2>
        <p className="small muted">This owner has no vault. When they create one and name you, it appears here.</p>
      </section>
    );
  }
  if (!heir) {
    return (
      <section className="sheet">
        <h2>You are not an heir here</h2>
        <p className="small muted">This vault names other wallets. Claims from any other wallet fail on-chain.</p>
      </section>
    );
  }
  const unclaimedOthers = view.heirs.filter((h, i) => i !== idx && !h.claimed).length;
  const payout = unclaimedOthers === 0 ? view.pot : heir.estimateLamports;
  const canClaim = !heir.claimed && (view.phase === 'claimable' || view.phase === 'claiming');

  function review() {
    setPending({
      title: 'Claim your share',
      signer: me,
      confirmLabel: 'Sign and claim',
      build: async () => [await ixClaim(me, ownerAddr)],
      rows: [
        ['Program', 'Heirloom claim'],
        ['Your share', `${heir!.shareBps / 100}%`],
        ['You receive', `${formatSol(payout)} SOL`],
      ],
      explain: { action: 'claim', owner: ownerAddr },
    });
  }

  return (
    <section className="sheet">
      <h2>{heir.claimed ? 'You have claimed' : canClaim ? 'Your share is ready' : 'Waiting'}</h2>
      <p className="small">
        {heir.claimed
          ? 'Your share is in your wallet.'
          : canClaim
            ? `You can claim ${formatSol(payout)} SOL, your ${heir.shareBps / 100}% share.`
            : `The owner is still checking in. If they stop, you can claim in ${clock(view.secondsToUnlock)}.`}
      </p>
      {pending?.explain.action === 'claim' ? (
        <Review tx={pending} onCancel={() => setPending(null)} onDone={done('Share claimed')} />
      ) : (
        canClaim && (
          <div className="row">
            <button className="btn btn-primary" onClick={review}>
              Review claim with Claude
            </button>
          </div>
        )
      )}
      {heir.claimed && (
        <div style={{ marginTop: 16 }}>
          <h3>Handoff guide</h3>
          {!hasHash ? (
            <p className="small muted">The owner did not seal a guide.</p>
          ) : guideOk ? (
            <>
              <p className={guideOk.verified ? 'sim-ok small' : 'error'}>
                {guideOk.verified ? 'Matches the SHA-256 sealed on-chain.' : 'Does not match the on-chain hash. Do not trust this copy.'}
              </p>
              <div className="guide" style={{ marginTop: 8 }}>{guideOk.text}</div>
            </>
          ) : (
            <p className="small muted">A guide hash is sealed on-chain ({onChainHash.slice(0, 12)}…). The text was not found in this browser.</p>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------- guardian ----------------

function GuardianPanel({ me, ownerAddr, snap, view, pending, setPending, done }: PanelProps & { ownerAddr: Address }) {
  const [mins, setMins] = useState('5');
  if (!snap || !view) {
    return (
      <section className="sheet">
        <h2>No vault to guard</h2>
        <p className="small muted">The owner has not created a vault yet.</p>
      </section>
    );
  }
  const isGuardian = snap.data.guardian.__option === 'Some' && snap.data.guardian.value === me.address;
  const open = view.phase === 'active' || view.phase === 'grace' || view.phase === 'claimable';
  const secs = Math.round(Number(mins) * 60);
  return (
    <section className="sheet">
      <h2>Guardian</h2>
      <p className="small">
        {isGuardian
          ? 'If you know the owner is alive but cannot check in, you can delay the unlock. You can never move funds.'
          : 'This wallet is not the guardian of this vault.'}
      </p>
      {pending?.explain.action === 'guardian_pause' ? (
        <Review tx={pending} onCancel={() => setPending(null)} onDone={done('Unlock delayed')} />
      ) : (
        isGuardian &&
        open && (
          <>
            <label className="field" style={{ marginTop: 12 }}>
              Delay the unlock by (minutes)
              <input inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} aria-invalid={!(secs > 0 && secs <= 2592000)} />
            </label>
            <div className="row">
              <button
                className="btn btn-primary"
                disabled={!(secs > 0 && secs <= 2592000) || snap.data.pausesUsed >= 3}
                onClick={() =>
                  setPending({
                    title: 'Delay the unlock',
                    signer: me,
                    confirmLabel: 'Sign pause',
                    build: async () => [await ixGuardianPause(me, ownerAddr, secs)],
                    rows: [
                      ['Program', 'Heirloom guardian_pause'],
                      ['Delay', human(secs)],
                      ['Pauses used', `${snap.data.pausesUsed} of 3`],
                    ],
                    explain: { action: 'guardian_pause', owner: ownerAddr, pauseSecs: secs },
                  })
                }
              >
                Review pause with Claude
              </button>
              <span className="small muted">{snap.data.pausesUsed} of 3 pauses used</span>
            </div>
          </>
        )
      )}
    </section>
  );
}

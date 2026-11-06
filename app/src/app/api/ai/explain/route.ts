// Claude explains, in plain language, what a transaction will do before the user signs it.
import { ask, factsBlock } from '@/lib/server/claude';
import { vaultFacts, short, dur, serverRpc } from '@/lib/server/facts';
import { asAddress, bad, clientIp, clip, rateLimit } from '@/lib/server/guard';
import { formatSol } from '@/lib/heirloom';

// 8-byte discriminator + Vault::INIT_SPACE (5 heirs max).
const VAULT_ACCOUNT_BYTES = 371;

const ACTIONS = ['initialize', 'deposit', 'withdraw', 'heartbeat', 'claim', 'guardian_pause', 'cancel', 'set_guide_hash'] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: Request) {
  if (!rateLimit(`ai:${clientIp(req)}`, 40, 60 * 60_000)) return bad('Too many requests, try again later', 429);
  const body = await req.json().catch(() => null);
  const owner = asAddress(body?.owner);
  const signer = asAddress(body?.signer);
  const action = body?.action as Action;
  if (!owner || !signer || !ACTIONS.includes(action)) return bad('owner, signer and a known action are required');

  const amount = (() => {
    try {
      const v = BigInt(String(body?.amountLamports ?? '0'));
      return v >= 0n && v < 10n ** 18n ? v : 0n;
    } catch {
      return 0n;
    }
  })();
  const pauseSecs = Math.max(0, Math.min(Number(body?.pauseSecs ?? 0) || 0, 30 * 86400));
  const sim = {
    ok: Boolean(body?.simulation?.ok),
    error: clip(body?.simulation?.error, 200) || null,
    compute_units: Number(body?.simulation?.unitsConsumed) || null,
  };

  const facts = await vaultFacts(owner);
  const raw = (facts._raw ?? null) as null | {
    heirKeys: string[];
    potLamports: string;
    snapshot: string;
    claimedTotal: string;
  };
  delete facts._raw;

  const tx: Record<string, unknown> = {
    action,
    cluster: 'Solana devnet (test SOL, no real value)',
    signer: short(signer),
    signer_role:
      signer === owner
        ? 'owner'
        : raw?.heirKeys.includes(signer)
          ? 'heir'
          : facts.guardian !== 'none' && short(signer) === facts.guardian
            ? 'guardian'
            : 'not listed on this vault',
    network_fee: 'about 0.000005 SOL, paid by the signer',
    // Every owner-signed Heirloom instruction counts as proof of life and restarts the timer.
    restarts_checkin_timer: ['initialize', 'deposit', 'withdraw', 'heartbeat', 'set_guide_hash'].includes(action),
    moves_funds: ['initialize', 'deposit', 'withdraw', 'claim', 'cancel'].includes(action),
    simulation: sim,
  };
  if (action === 'deposit' || action === 'withdraw') tx.amount_sol = formatSol(amount);
  if (action === 'guardian_pause') tx.pause_length = dur(pauseSecs);
  if (action === 'initialize') {
    const d = body?.draft ?? {};
    const heirs = Array.isArray(d.heirs) ? d.heirs.slice(0, 5) : [];
    tx.new_vault = {
      heirs: heirs.map((h: { key?: unknown; shareBps?: unknown }) => ({
        heir: typeof h.key === 'string' ? short(h.key) : '?',
        share_percent: (Number(h.shareBps) || 0) / 100,
      })),
      checkin_interval: dur(Number(d.intervalSecs) || 0),
      grace_period: dur(Number(d.graceSecs) || 0),
      guardian: typeof d.guardian === 'string' ? short(d.guardian) : 'none',
      initial_deposit_sol: formatSol(amount),
      account_rent_sol: formatSol(await serverRpc.getMinimumBalanceForRentExemption(BigInt(VAULT_ACCOUNT_BYTES)).send()),
      account_rent_note: 'a refundable deposit Solana requires to store the vault; returned if the owner closes the vault',
    };
  }
  if (action === 'claim' && raw) {
    const idx = raw.heirKeys.indexOf(signer);
    const heirs = facts.heirs as { share_percent: number; claimed: boolean }[];
    if (idx >= 0) {
      const unclaimedOthers = heirs.filter((h, i) => i !== idx && !h.claimed).length;
      const base = facts.phase === 'claiming' ? BigInt(raw.snapshot) : BigInt(raw.potLamports);
      const pot = BigInt(raw.potLamports);
      const payout = unclaimedOthers === 0 ? pot : (base * BigInt(Math.round(heirs[idx].share_percent * 100))) / 10_000n;
      tx.expected_payout_sol = formatSol(payout);
      tx.is_last_heir = unclaimedOthers === 0;
    }
  }

  const system = `Your job right now: explain the transaction in <transaction> before the person signs it.
Write 3 or 4 short sentences: what this does in everyday words, exactly what moves and to whom (use the numbers given), what changes about the vault afterwards, and anything they should know first.
If simulation.ok is false, start with "This would fail:" and explain the error in plain words and what to do instead. If the signer_role does not fit the action, say so.
For a claim, mention that the first claim freezes the pot so every heir's share is computed on the same amount, and that the last heir also receives rounding dust.
Use restarts_checkin_timer and moves_funds exactly as given; never contradict them.
End with one sentence starting "Sign only if".`;
  const explanation = await ask(system, `${factsBlock(facts)}\n<transaction>${JSON.stringify(tx)}</transaction>`, 500).catch(
    (e: Error) => `The assistant is unavailable right now (${e.message}). Review the details above before signing.`,
  );
  return Response.json({ explanation, tx });
}

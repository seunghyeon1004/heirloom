import 'server-only';
import { createSolanaRpc, type Address } from '@solana/kit';
import { fetchVault, viewVault, formatSol } from '../heirloom';
import { RPC_URL } from '../config';
import { chainNowWith } from './clock';

const rpc = createSolanaRpc(process.env.RPC_URL ?? RPC_URL);
export const serverRpc = rpc;

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function dur(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 120) return `${s} seconds`;
  if (s < 7200) return `${Math.round(s / 60)} minutes`;
  if (s < 172800) return `${Math.round(s / 3600)} hours`;
  return `${Math.round(s / 86400)} days`;
}

export type VaultFacts = Record<string, unknown> & { exists: boolean };

/** Facts read from chain by the server (never trusted from the browser). */
export async function vaultFacts(owner: Address): Promise<VaultFacts> {
  const v = await fetchVault(rpc, owner);
  if (!v) return { exists: false, owner: short(owner) };
  const now = await chainNowWith(rpc);
  const rentMin = await rpc.getMinimumBalanceForRentExemption(BigInt(v.dataLength)).send();
  const view = viewVault(v, rentMin, now);
  const d = v.data;
  return {
    exists: true,
    owner: short(owner),
    phase: view.phase,
    phase_meaning: {
      active: 'owner checked in recently; funds locked to the owner',
      grace: 'check-in is overdue; grace period running; heirs cannot claim yet',
      claimable: 'timer and grace expired; heirs may claim now unless the owner checks in first',
      claiming: 'at least one heir has claimed; owner and guardian powers are gone',
      settled: 'every heir has claimed',
    }[view.phase],
    balance_sol: formatSol(view.pot),
    checkin_interval: dur(Number(d.checkinIntervalSecs)),
    grace_period: dur(Number(d.gracePeriodSecs)),
    last_checkin_ago: dur(now - Number(d.lastHeartbeat)),
    next_checkin_due_in: now < view.dueAt ? dur(view.dueAt - now) : `overdue by ${dur(now - view.dueAt)}`,
    heirs_can_claim_in: view.secondsToUnlock > 0 ? dur(view.secondsToUnlock) : 'now',
    guardian: d.guardian.__option === 'Some' ? short(d.guardian.value) : 'none',
    guardian_pauses_used: `${d.pausesUsed} of 3`,
    heartbeat_relay: d.heartbeatAuthority === d.owner ? 'owner only' : short(d.heartbeatAuthority),
    handoff_guide_hash_on_chain: d.guideHash.some((b) => b !== 0),
    heirs: view.heirs.map((h) => ({
      heir: short(h.key),
      share_percent: h.shareBps / 100,
      estimated_sol: formatSol(h.estimateLamports),
      claimed: h.claimed,
    })),
    _raw: { now, unlockAt: view.unlockAt, heirKeys: view.heirs.map((h) => h.key), potLamports: view.pot.toString(), snapshot: d.claimSnapshot.toString(), claimedTotal: d.claimedTotal.toString() },
  };
}

export { short, dur };

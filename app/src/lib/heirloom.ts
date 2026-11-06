// Shared vault helpers used by the UI, the API routes and the integration test.
import {
  type Address,
  type TransactionSigner,
  fetchEncodedAccount,
  some,
  none,
  type Rpc,
  type GetAccountInfoApi,
} from '@solana/kit';
import {
  HEIRLOOM_PROGRAM_ADDRESS,
  VaultStatus,
  decodeVault,
  findVaultPda,
  getClaimInstruction,
  getDepositInstructionAsync,
  getGuardianPauseInstruction,
  getHeartbeatInstruction,
  getInitializeInstructionAsync,
  getWithdrawInstructionAsync,
  getCancelInstructionAsync,
  getSetGuideHashInstructionAsync,
  type Vault,
} from '../generated';

export { HEIRLOOM_PROGRAM_ADDRESS, VaultStatus };
export type { Vault };

export async function vaultAddress(owner: Address): Promise<Address> {
  const [pda] = await findVaultPda({ owner });
  return pda;
}

export type VaultSnapshot = {
  address: Address;
  data: Vault;
  lamports: bigint;
  dataLength: number;
};

/** Fetch and decode a vault. Verifies the account is owned by the Heirloom program. */
export async function fetchVault(
  rpc: Rpc<GetAccountInfoApi>,
  owner: Address,
): Promise<VaultSnapshot | null> {
  const addr = await vaultAddress(owner);
  const acc = await fetchEncodedAccount(rpc, addr, { commitment: 'confirmed' });
  if (!acc.exists) return null;
  if (acc.programAddress !== HEIRLOOM_PROGRAM_ADDRESS) {
    throw new Error('Vault account is not owned by the Heirloom program');
  }
  const decoded = decodeVault(acc);
  return { address: addr, data: decoded.data, lamports: acc.lamports, dataLength: acc.data.length };
}

export type Phase = 'active' | 'grace' | 'claimable' | 'claiming' | 'settled';

export type VaultView = {
  phase: Phase;
  dueAt: number; // next check-in due (last + interval)
  unlockAt: number; // heirs may claim at or after this
  secondsToUnlock: number;
  pausedUntil: number;
  heirs: { key: Address; shareBps: number; claimed: boolean; estimateLamports: bigint }[];
  pot: bigint; // withdrawable lamports right now
};

export function viewVault(v: VaultSnapshot, rentMin: bigint, nowSecs: number): VaultView {
  const d = v.data;
  const last = Number(d.lastHeartbeat);
  const dueAt = last + Number(d.checkinIntervalSecs);
  const unlockAt = Math.max(dueAt + Number(d.gracePeriodSecs), Number(d.pausedUntil));
  const pot = v.lamports > rentMin ? v.lamports - rentMin : 0n;
  let phase: Phase;
  if (d.status === VaultStatus.Settled) phase = 'settled';
  else if (d.status === VaultStatus.Claiming) phase = 'claiming';
  else if (nowSecs >= unlockAt) phase = 'claimable';
  else if (nowSecs >= dueAt) phase = 'grace';
  else phase = 'active';
  const base = d.status === VaultStatus.Active ? pot : d.claimSnapshot;
  const heirs = d.heirs.map((h, i) => ({
    key: h.key,
    shareBps: h.shareBps,
    claimed: (d.claimedBitmap & (1 << i)) !== 0,
    estimateLamports: (base * BigInt(h.shareBps)) / 10_000n,
  }));
  return {
    phase,
    dueAt,
    unlockAt,
    secondsToUnlock: Math.max(0, unlockAt - nowSecs),
    pausedUntil: Number(d.pausedUntil),
    heirs,
    pot,
  };
}

// ---------- instruction builders ----------

export async function ixInitialize(p: {
  owner: TransactionSigner;
  heirs: { key: Address; shareBps: number }[];
  intervalSecs: number;
  graceSecs: number;
  guardian?: Address | null;
  heartbeatAuthority?: Address | null;
}) {
  return getInitializeInstructionAsync({
    owner: p.owner,
    heirs: p.heirs,
    checkinIntervalSecs: BigInt(p.intervalSecs),
    gracePeriodSecs: BigInt(p.graceSecs),
    guardian: p.guardian ? some(p.guardian) : none(),
    heartbeatAuthority: p.heartbeatAuthority ? some(p.heartbeatAuthority) : none(),
  });
}

export async function ixDeposit(owner: TransactionSigner, lamports: bigint) {
  return getDepositInstructionAsync({ owner, amount: lamports });
}

export async function ixWithdraw(owner: TransactionSigner, lamports: bigint) {
  return getWithdrawInstructionAsync({ owner, amount: lamports });
}

export async function ixCancel(owner: TransactionSigner) {
  return getCancelInstructionAsync({ owner });
}

export async function ixSetGuideHash(owner: TransactionSigner, hash: Uint8Array) {
  return getSetGuideHashInstructionAsync({ owner, guideHash: hash });
}

export async function ixHeartbeat(signer: TransactionSigner, owner: Address) {
  return getHeartbeatInstruction({ signer, vault: await vaultAddress(owner) });
}

export async function ixClaim(heir: TransactionSigner, owner: Address) {
  return getClaimInstruction({ heir, vault: await vaultAddress(owner) });
}

export async function ixGuardianPause(guardian: TransactionSigner, owner: Address, secs: number) {
  return getGuardianPauseInstruction({ guardian, vault: await vaultAddress(owner), pauseSecs: BigInt(secs) });
}

export const LAMPORTS_PER_SOL = 1_000_000_000n;

export function formatSol(l: bigint, digits = 4): string {
  const whole = l / LAMPORTS_PER_SOL;
  const frac = (l % LAMPORTS_PER_SOL).toString().padStart(9, '0').slice(0, digits);
  return `${whole}.${frac}`.replace(/\.?0+$/, '') || '0';
}

// Minimal, explicit transaction pipeline: build -> simulate -> (user approves) -> sign -> send -> confirm.
// Uses a legacy-compatible v0 message so any wallet and any RPC accepts it.
import {
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type TransactionSigner,
  type Signature,
  address,
  fetchEncodedAccount,
} from '@solana/kit';
import { RPC_URL } from './config';

export const rpc = createSolanaRpc(RPC_URL);

async function buildSigned(feePayer: TransactionSigner, ixs: Instruction[]) {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  return signTransactionMessageWithSigners(message);
}

export type Simulation = {
  ok: boolean;
  error: string | null;
  logs: string[];
  unitsConsumed: number | null;
};

/** Anchor logs "Error Code: X. Error Number: N. Error Message: ..." on failure; surface it. */
function anchorError(logs: string[]): string | null {
  for (const l of logs) {
    const m = l.match(/Error Code: (\w+)\. Error Number: \d+\. Error Message: (.*)$/);
    if (m) return `${m[1]}: ${m[2]}`;
  }
  return null;
}

export async function simulate(feePayer: TransactionSigner, ixs: Instruction[]): Promise<Simulation> {
  const signed = await buildSigned(feePayer, ixs);
  const wire = getBase64EncodedWireTransaction(signed);
  const res = await rpc
    .simulateTransaction(wire, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' })
    .send();
  const logs = (res.value.logs ?? []) as string[];
  const err = res.value.err;
  return {
    ok: !err,
    error: err ? anchorError(logs) ?? JSON.stringify(err, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) : null,
    logs,
    unitsConsumed: res.value.unitsConsumed != null ? Number(res.value.unitsConsumed) : null,
  };
}

export async function sendAndConfirm(feePayer: TransactionSigner, ixs: Instruction[]): Promise<Signature> {
  const signed = await buildSigned(feePayer, ixs);
  const sig = getSignatureFromTransaction(signed);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const { value } = await rpc.getSignatureStatuses([sig]).send();
    const st = value[0];
    if (st?.err) throw new Error(`Transaction failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error('Timed out waiting for confirmation');
}

const CLOCK = address('SysvarC1ock11111111111111111111111111111111');

/** Cluster unix time from the Clock sysvar (what the program compares against). */
export async function chainNow(): Promise<number> {
  const acc = await fetchEncodedAccount(rpc, CLOCK, { commitment: 'confirmed' });
  if (!acc.exists) return Math.floor(Date.now() / 1000);
  return Number(new DataView(acc.data.buffer, acc.data.byteOffset).getBigInt64(32, true));
}

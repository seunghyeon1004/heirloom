// Devnet-only helper: tops up the in-browser demo personas from a throwaway server key.
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { asAddress, bad, clientIp, rateLimit } from '@/lib/server/guard';
import { RPC_URL } from '@/lib/config';

const DRIP = 300_000_000n; // 0.3 SOL
const ONLY_IF_BELOW = 200_000_000n;

export async function POST(req: Request) {
  const secret = process.env.FAUCET_SECRET_KEY;
  if (!secret) return bad('Faucet is not configured', 503);
  const body = await req.json().catch(() => null);
  const to = asAddress(body?.address);
  if (!to) return bad('address must be a Solana address');
  if (!rateLimit(`faucet:ip:${clientIp(req)}`, 8, 60 * 60_000) || !rateLimit(`faucet:to:${to}`, 3, 24 * 60 * 60_000)) {
    return bad('Faucet limit reached for now', 429);
  }
  const rpc = createSolanaRpc(process.env.RPC_URL ?? RPC_URL);
  const { value: bal } = await rpc.getBalance(to).send();
  if (bal >= ONLY_IF_BELOW) return Response.json({ skipped: true, reason: 'already funded' });
  const faucet = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(secret)));
  const { value: bh } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(faucet, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions([getTransferSolInstruction({ source: faucet, destination: address(to), amount: lamports(DRIP) })], m),
  );
  const signed = await signTransactionMessageWithSigners(msg);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64' }).send();
  return Response.json({ signature: getSignatureFromTransaction(signed) });
}

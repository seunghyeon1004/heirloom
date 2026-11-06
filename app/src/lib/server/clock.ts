import 'server-only';
import { address, fetchEncodedAccount, type Rpc, type GetAccountInfoApi } from '@solana/kit';

const CLOCK = address('SysvarC1ock11111111111111111111111111111111');

export async function chainNowWith(rpc: Rpc<GetAccountInfoApi>): Promise<number> {
  const acc = await fetchEncodedAccount(rpc, CLOCK, { commitment: 'confirmed' });
  if (!acc.exists) return Math.floor(Date.now() / 1000);
  return Number(new DataView(acc.data.buffer, acc.data.byteOffset).getBigInt64(32, true));
}

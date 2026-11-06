export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com';
export const CLUSTER_LABEL = process.env.NEXT_PUBLIC_CLUSTER_LABEL ?? 'devnet';

export function explorerTx(sig: string): string {
  if (CLUSTER_LABEL === 'devnet') return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
}

export function explorerAddress(addr: string): string {
  if (CLUSTER_LABEL === 'devnet') return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
  return `https://explorer.solana.com/address/${addr}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
}

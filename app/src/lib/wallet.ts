'use client';
// Optional real-wallet path via Wallet Standard (Phantom, Solflare, Backpack...).
// The connected wallet's signer replaces the demo Owner when the user picks "My wallet".
import { createClient } from '@solana/kit';
import { walletWithoutSigner } from '@solana/kit-plugin-wallet';
import { CLUSTER_LABEL } from './config';

const chain = CLUSTER_LABEL === 'devnet' ? 'solana:devnet' : 'solana:localnet';

export const walletClient = createClient().use(walletWithoutSigner({ chain, autoConnect: true }));

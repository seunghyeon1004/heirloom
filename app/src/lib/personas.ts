// Demo personas: four throwaway devnet keypairs kept in this browser only.
// They let one person (or a judge) play owner, heirs and guardian without installing a wallet.
import { createKeyPairSignerFromPrivateKeyBytes, type KeyPairSigner } from '@solana/kit';

export type PersonaId = 'owner' | 'heirA' | 'heirB' | 'guardian';
export const PERSONAS: { id: PersonaId; label: string; role: string }[] = [
  { id: 'owner', label: 'Owner', role: 'Locks the funds and checks in' },
  { id: 'heirA', label: 'Heir A', role: 'Receives 60% after the timer runs out' },
  { id: 'heirB', label: 'Heir B', role: 'Receives 40% after the timer runs out' },
  { id: 'guardian', label: 'Guardian', role: 'Can delay the unlock, never move funds' },
];

const KEY = 'heirloom.personas.v1';

function toB64(b: Uint8Array) {
  return btoa(String.fromCharCode(...b));
}
function fromB64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function loadPersonas(): Promise<Record<PersonaId, KeyPairSigner>> {
  let seeds: Record<string, string> = {};
  try {
    seeds = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    seeds = {};
  }
  const out = {} as Record<PersonaId, KeyPairSigner>;
  let changed = false;
  for (const p of PERSONAS) {
    if (!seeds[p.id]) {
      seeds[p.id] = toB64(crypto.getRandomValues(new Uint8Array(32)));
      changed = true;
    }
    out[p.id] = await createKeyPairSignerFromPrivateKeyBytes(fromB64(seeds[p.id]));
  }
  if (changed) {
    try {
      localStorage.setItem(KEY, JSON.stringify(seeds));
    } catch {
      /* private mode: personas live for this tab only */
    }
  }
  return out;
}

export function resetPersonas() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

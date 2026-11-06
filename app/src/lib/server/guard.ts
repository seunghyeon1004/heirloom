import 'server-only';
import { isAddress, type Address } from '@solana/kit';

// Best-effort in-memory rate limit (per server instance). Protects the API key on a public demo.
const buckets = new Map<string, { n: number; reset: number }>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  if (b.n >= max) return false;
  b.n += 1;
  return true;
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

export function asAddress(v: unknown): Address | null {
  return typeof v === 'string' && isAddress(v) ? (v as Address) : null;
}

export function clip(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

export function bad(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}

/**
 * Refuse text that looks like a secret: a 12/24-word mnemonic or a base58 private key.
 * Heirloom never wants these; the guide should say where secrets are, not what they are.
 */
export function looksLikeSecret(text: string): boolean {
  // 12+ consecutive short lowercase words on one line is the shape of a seed phrase.
  for (const line of text.split(/\n/)) {
    const w = line.trim().toLowerCase().split(/\s+/);
    if (w.length >= 12 && w.length <= 25 && w.every((x) => /^[a-z]{3,8}$/.test(x))) return true;
  }
  if (/\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/.test(text)) return true; // base58 64-byte secret key
  if (/\[\s*\d{1,3}(\s*,\s*\d{1,3}){60,}\s*\]/.test(text)) return true; // JSON keypair array
  return false;
}

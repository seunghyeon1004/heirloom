// Claude turns the owner's rough notes into a clear handoff guide for the heirs.
// The guide stays off-chain; only its SHA-256 goes on-chain via set_guide_hash.
import { ask, factsBlock } from '@/lib/server/claude';
import { vaultFacts } from '@/lib/server/facts';
import { asAddress, bad, clientIp, clip, looksLikeSecret, rateLimit } from '@/lib/server/guard';

export async function POST(req: Request) {
  if (!rateLimit(`ai:${clientIp(req)}`, 40, 60 * 60_000)) return bad('Too many requests, try again later', 429);
  const body = await req.json().catch(() => null);
  const owner = asAddress(body?.owner);
  const notes = clip(body?.notes, 4000);
  if (!owner || notes.trim().length < 10) return bad('owner and some notes are required');
  if (looksLikeSecret(notes)) {
    return bad('These notes look like they contain a seed phrase or private key. Remove it: the guide should say where secrets are kept, never what they are.', 422);
  }
  const { _raw, ...facts } = await vaultFacts(owner);
  void _raw;
  const system = `Your job right now: turn the owner's notes in <owner_notes> into a handoff guide their heirs will read after they claim.
Format: a one-line title, then short numbered steps in plain text (no markdown symbols other than "1." numbering), under 220 words. Cover: what the heirs receive from this vault (use the facts), what else the notes say exists and where, who to contact, and the first three things to do. If the notes mention any secret value, replace it with "[kept offline - see the location above]". Add a final line: "This guide is not a legal will."`;
  const guide = await ask(system, `${factsBlock(facts)}\n<owner_notes>${notes}</owner_notes>`, 900).catch((e: Error) => {
    throw e;
  });
  return Response.json({ guide });
}

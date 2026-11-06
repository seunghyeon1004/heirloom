// Claude writes the liveness check-in nudge and answers the owner, using on-chain facts.
// It cannot reset the timer: only the owner's signed heartbeat transaction can.
import { ask, factsBlock } from '@/lib/server/claude';
import { vaultFacts } from '@/lib/server/facts';
import { asAddress, bad, clientIp, clip, rateLimit, looksLikeSecret } from '@/lib/server/guard';

export async function POST(req: Request) {
  if (!rateLimit(`ai:${clientIp(req)}`, 40, 60 * 60_000)) return bad('Too many requests, try again later', 429);
  const body = await req.json().catch(() => null);
  const owner = asAddress(body?.owner);
  if (!owner) return bad('owner must be a Solana address');
  const history: { role: 'owner' | 'assistant'; text: string }[] = Array.isArray(body?.history)
    ? body.history.slice(-6).map((m: { role?: string; text?: unknown }) => ({
        role: m?.role === 'owner' ? 'owner' : 'assistant',
        text: clip(m?.text, 600),
      }))
    : [];
  if (history.some((m) => m.role === 'owner' && looksLikeSecret(m.text))) {
    return Response.json({
      reply:
        'Please stop: that looks like a seed phrase or private key. Heirloom never needs it. Delete it from wherever you typed it and keep it offline.',
      secretBlocked: true,
    });
  }
  const { _raw, ...facts } = await vaultFacts(owner);
  void _raw;
  const transcript = history.map((m) => `<${m.role}>${m.text}</${m.role}>`).join('\n');
  const system = `Your job right now: the liveness check-in.
If the conversation is empty, write the check-in message to the owner: 2 or 3 sentences. Greet them, say plainly how long until the check-in is due and how long until heirs could claim, and ask them to confirm they are well and still in control of their wallet. Match urgency to the phase: relaxed when active, clearly urgent but kind when in grace or claimable.
If the owner has replied, answer in at most 3 sentences. If they say they are fine, thank them and tell them to press "Sign check-in" so their wallet proves it on-chain. If they say something worrying (lost device, someone else has their keys, they are unwell), respond with care, suggest the relevant on-chain action (withdraw, update heirs, ask the guardian to pause) and do not push the check-in.
Never say the timer has been reset.`;
  const reply = await ask(system, `${factsBlock(facts)}\n<conversation>\n${transcript || '(empty)'}\n</conversation>`, 400).catch(
    (e: Error) => `The assistant is unavailable right now (${e.message}). You can still sign the check-in.`,
  );
  return Response.json({ reply });
}

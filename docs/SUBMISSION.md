# Heirloom: submission text (MLH Challenges / Encode)

## Where and when (KST)
- MLH: MLH Challenges form https://www.mlh.com/events/solana-hackathon/submissions/new (not Devpost). Initial submission Nov 9 00:00, final Nov 9 01:45 (target), form hard close Nov 9 03:00.
  - Required: project link (live demo), description (below), screenshot (use the settled-vault capture c15 or the dashboard c03).
  - Other links: repo, video, slides (docs/deck.pdf).
  - Prize categories: Top 3 Overall + AI Track.
  - AI coding tools disclosure (optional, fill it): Claude Code and Codex, model Claude Opus 5.5. The app itself calls Claude claude-sonnet-5-5 at runtime.
- Encode: the project "Heirloom" already exists on the Encode platform. Fill the slots Description / Code / Slides / Live Demo / Demo Video before Nov 9 20:59 KST.

## Name
Heirloom

## Tagline
A dead-man's switch for your crypto: check in with Claude, and if you go silent, your heirs can claim on Solana.

## Inspiration
When someone dies holding self-custodied crypto, the coins usually die with them. Their family may not know the coins exist, where the keys are, or what to do. A will written on paper cannot sign a transaction. A custodian brings back the trust problem that self-custody was meant to remove. We wanted something in between: the owner keeps full control while alive, and a plain on-chain rule hands the funds over when they stop showing up.

## What it does
- The owner locks SOL in a vault account controlled by the Heirloom program. They name up to five heirs with percentage shares, choose a check-in interval and a grace period, and can add an optional guardian.
- Every so often, Claude sends the owner a short check-in message based on the vault's real on-chain state. It might say: "your check-in is due in 3 days; heirs could claim in 10". The owner replies, and if all is well they press "Sign check-in". Only that wallet signature resets the timer. Claude cannot be talked into it.
- Before any signature (create, deposit, withdraw, check in, pause, claim), the app first simulates the transaction on-chain. Then Claude explains in plain English what will move, to whom, and what changes, and whether the simulation says it would fail.
- If the owner stops checking in, the countdown runs out. After the grace period, each heir claims their share exactly once. The first claim freezes the pot, so shares are fair. The last heir also sweeps the rounding dust.
- A guardian, for example a sibling who knows the owner is in hospital, can delay the unlock. Each pause lasts at most 30 days, with at most 3 pauses per check-in period. The guardian can never move funds.
- The owner writes rough notes about their wider estate, such as where the hardware wallet is and who to call. Claude turns these into a step-by-step handoff guide. The SHA-256 of the guide is sealed on-chain, and after claiming, heirs see the guide verified against that hash. The app refuses anything that looks like a seed phrase.

## How we built it
- An Anchor 1.2.1 program in Rust with nine instructions. It has one vault PDA per owner (`["vault", owner]`) that holds the lamports directly. Every authority check is an Anchor constraint, and all arithmetic is checked. A claimed bitmap prevents double claims, and the pot snapshot is taken at the first claim.
- 18 LiteSVM tests cover the attack paths: the exact unlock boundary, double claim, wrong signers, fake accounts owned by another program, the rent floor, stray lamports, guardian bounds, and five heirs claiming in any order. There is also a Surfpool end-to-end test through the generated client, using clock time travel.
- Codama generates a `@solana/kit` 8 client from the IDL. The Next.js 16 frontend builds transactions with Kit, runs `simulateTransaction` before asking for a signature, and reads the cluster clock from the Clock sysvar, so the countdown matches what the program enforces.
- The Claude calls (`claude-sonnet-5-5`) run in server route handlers. The server reads the vault from the chain itself and passes it to the model as tagged JSON data, so the browser cannot feed it false numbers. The API key never leaves the server.
- Four throwaway devnet "demo wallets" (Owner, Heir A, Heir B, Guardian) live in the browser, so a judge can play every role in two minutes without installing a wallet.

## Challenges we ran into
- Getting the Rust test harness to match Anchor 1.2's Solana crates: LiteSVM 0.10 rejected the newer SBF binary, and 0.17 pulled mismatched Agave crates. We ended up on LiteSVM 0.18 with Rust 1.99.
- Designing fair claims when heirs claim at different times and someone can still send lamports to the PDA. The solution was a snapshot at the first claim, shares computed on the snapshot, and the remainder going to the last heir. Tests assert the vault ends at exactly its rent-exempt minimum.
- Bounding the guardian. A guardian who can pause forever is a way to steal by delay, so pauses are capped in both length and count, and only the owner's check-in resets the count.
- Keeping the AI honest. Claude must never claim a check-in happened, never contradict the chain, and never accept secrets. We gave it server-verified facts, explicit fields such as `restarts_checkin_timer`, and no signing power at all.
- Getting devnet SOL now that the public RPC airdrop is closed.

## How Solana is used
Solana is the custody and the rule-keeper. Funds sit in a program-owned PDA. The timer is the cluster clock, and claims are enforced by the program, not by our server. A check-in costs about 0.000005 SOL, so frequent proof-of-life is practical. Every action is a transaction you can inspect on Solana Explorer.

## How AI is used
Claude does three real jobs, and none of them can change state:
1. The check-in companion. It writes a nudge based on the real phase (active, grace, claimable) and responds with care when the owner reports a problem, for example by suggesting a withdraw or a guardian pause.
2. The pre-signature explainer. It turns the simulation result and the vault state into plain language: what moves, to whom, what changes, and "sign only if...".
3. The handoff-guide writer. It turns rough notes into clear steps for heirs and redacts anything that looks like a secret.

## What's next
- Wallet Standard connection (Phantom, Solflare, Backpack) alongside the demo wallets.
- SPL tokens, starting with USDC: one token account per vault owned by the PDA.
- A hosted heartbeat relay: scheduled email or Telegram check-ins, where a signed message from the owner triggers a relay `heartbeat`.
- Guide text encrypted to the heirs' keys and stored off-chain, released after a claim.
- Multisig guardians, and closing settled vaults.
- Legal wrappers with estate lawyers. Heirloom is not a will.

## Prior work disclosure
All Heirloom code was written during the MLH event window, starting Nov 6, 2026 12:00 ET. It uses open-source libraries (Anchor, Solana Kit, Codama, Next.js, LiteSVM, Surfpool, the Anthropic SDK) and the `anchor init` and `create-next-app` scaffolds. For Encode: the project was started late in the programme, on Nov 6 to 8, and nothing existed beforehand.

## Short description (for the MLH one-box field)
Heirloom is a dead-man's switch for crypto inheritance on Solana. You lock SOL in a program-owned vault, name heirs with shares, and check in with Claude. If you stop, heirs claim on-chain after a grace period. Claude explains every transaction before you sign, but it holds no keys: only wallet signatures change state. It has an Anchor program with 18 security tests, a Codama/Kit client and a Next.js app, and runs on devnet.

## Links checklist
- [ ] Public repo: https://github.com/seunghyeon1004/heirloom
- [ ] Live demo (devnet): https://heirloom-nine-gray.vercel.app
- [ ] Program ID (devnet): 2GvFQtnM7cGaM9wso5iw6nMH5abo2aYKJRneZiWbQbKv
- [ ] Program on Explorer: https://explorer.solana.com/address/2GvFQtnM7cGaM9wso5iw6nMH5abo2aYKJRneZiWbQbKv?cluster=devnet
- [ ] Deploy transaction: https://explorer.solana.com/tx/2iynxBBvwmCJz4pghus6bQo6vQbZqYMbw1NhgmHqnJk73oBH8WPUDY4VfcrGXoKhD4G9abeRkGJY4SwTTL562o91?cluster=devnet
- [ ] Demo video (YouTube, public, under 3 min): VIDEO_URL
- [ ] Pitch deck: docs/deck.pdf
- [ ] MLH prize categories: Top 3 Overall, AI Track
- [ ] MLH AI tools disclosure: Claude Code + Codex (Claude Opus 5.5)
- [ ] MLH screenshot uploaded
- [ ] Encode slots: Description, Code, Slides, Live Demo, Demo Video

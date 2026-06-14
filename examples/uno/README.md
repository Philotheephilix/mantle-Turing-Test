# Nexus UNO — full multiplayer, gasless, x402, played to a WIN (Base Sepolia)

A complete, working multiplayer UNO — the **full official ruleset, real 108-card
deck** — built on the Nexus SDK and settled entirely on Base Sepolia. **No Privy** —
every player is a distinct, self-custodial key.

- **Real UNO.** Official 108-card deck (per color: one 0, two each 1–9, two Skip,
  two Reverse, two Draw Two; plus 4 Wild + 4 Wild Draw Four). 7-card deal; color /
  number / symbol matching; all action-card effects (Skip; Reverse — acts as Skip in
  2-player; Draw Two; Wild; Wild Draw Four); draw-when-stuck; discard reshuffle when
  the draw pile empties; and a **real win** (a player legally plays their last card).
  The backend (`scripts/server.ts` + `lib/uno-game.ts`) is the authoritative
  full-rules engine and **rejects illegal plays**. No all-wild / fast-win shortcut.
- **On-chain shuffle.** The deck order is seeded by a real on-chain random word from
  the `RandomnessCoordinator` (fast/prevrandao tier) — no `Math.random` in the deal.
- **Sealed hands.** Each hand is sealed with `@nexus/secrets` (`LocalSecrets`, real
  AES-256-GCM) and revealed only to its owner (`POST /api/hand`).
- **One delegation per player.** Each player (the human in the browser + each bot)
  signs their OWN `GameDelegation` (gameplay + budget caveats) with their OWN key.
- **Gasless for players.** The single funded **relayer** key
  (`0xA3327d90d087cdddfB99E598E50B5Bdee7fC55bD`, server-only) redeems every
  delegation via the `NexusDelegationManager` and pays ALL gas.
- **Real x402 entry fee.** Each player pays the entry fee as a real
  `USDC.transferFrom(player → Pot)` from their OWN wallet, bounded on-chain by their
  budget delegation (per-action cap + lifetime cap + recipient allowlist).
- **A full game to a WIN.** Players take gasless turns until one empties their hand;
  the on-chain `UnoGameSystem` decides the winner and the `Pot` pays them out
  (real `USDC.transferFrom(Pot → winner)`).
- **Human in a real persistent browser; bots in a backend script.**

This mirrors the proven low-level redemption pattern from `scripts/live/integration.ts`
and `scripts/live/e2e.ts` (each player signs; the relayer redeems `redeemDelegations`).

## Architecture

| Piece | File(s) |
|---|---|
| Pure full-rules engine (108-card deck, legality, action effects) | `lib/uno-rules.ts`, `lib/uno-game.ts` |
| On-chain deck shuffle (seeded by the RandomnessCoordinator word) | `lib/shuffle.ts` |
| On-chain UNO record + turn enforcement + win | `contracts/UnoGameSystem.sol`, `contracts/UnoTable.sol` |
| Pot escrow + winner payout | `contracts/UnoPot.sol` |
| Deploy (full Nexus stack + Randomness + UNO + Pot, real USDC) | `contracts/DeployUno.s.sol`, `scripts/deploy.sh` |
| Redemption engine (relayer redeems per-player delegations; on-chain shuffle word) | `lib/engine.ts` |
| Browser-safe per-player delegation signing | `lib/delegations.ts` |
| Authoritative game server (full rules, sealed hands, settles pot) | `scripts/server.ts` |
| Real UNO bot strategy | `lib/bot-strategy.ts` |
| Bot driver (joins, pays x402, plays legal moves to a win) | `scripts/bots.ts` |
| Headless full-game smoke (every seat via the SDK, prints tx hashes) | `scripts/smoke.ts` |
| Fund + approve player keys (sequential nonces) | `scripts/fund-players.ts` |
| Browser client (human signs, fetches sealed hand, server redeems) | `lib/uno-client.ts`, `app/`, `components/` |
| Playwright e2e (persistent browser, on-chain verified) | `tests/uno.spec.ts`, `tests/global-setup.ts` |

## Prerequisites

- Node 25, pnpm 11
- Foundry at `$HOME/.foundry/bin` (`export PATH="$HOME/.foundry/bin:$PATH"`)
- The funded relayer key in `examples/.shared-env.local` (already provided).

## Exact commands

From the repo root (`SteamLink/`):

```bash
# 0. install (workspace)
pnpm install

# 1. (optional) re-deploy the full stack + UNO to Base Sepolia.
#    Already deployed — addresses are in deployments/base-sepolia.json.
export PATH="$HOME/.foundry/bin:$PATH"
pnpm --filter @nexus/example-uno deploy

# 2. fund + approve the player keys (1 human + N bots), SEQUENTIALLY.
#    Writes examples/uno/players.local.json (PRIVATE KEYS — gitignored).
#    Idempotent: re-running tops up wallets below the threshold (reuses keys).
#    FRESH=1 forces brand-new keys. BOT_COUNT=2 by default.
pnpm --filter @nexus/example-uno fund-players

# 3. start the game server (relayer redeems; serializes nonces) on :8790 — keep running
pnpm --filter @nexus/example-uno server

# 4. start the bots (they create the game, pay x402, and play to a win) — new terminal
pnpm --filter @nexus/example-uno bots

# 5. start the Next.js app on :3100 — new terminal
pnpm --filter @nexus/example-uno dev

# 6. production build (must succeed)
pnpm --filter @nexus/example-uno build

# 7. Playwright e2e — REAL payments, gasless moves, a game to a WIN, pot payout,
#    all verified ON-CHAIN. globalSetup auto-starts (and funds) the server + bots;
#    the config's webServer auto-starts the Next app.
pnpm --filter @nexus/example-uno test:e2e
```

A headless full game to a real win (no browser) — every seat driven through the
SDK; prints the winning move sequence + every tx hash. Run alongside the server
(step 3):

```bash
pnpm --filter @nexus/example-uno smoke
```

## How the flow works

1. **Fund** — `fund-players.ts` generates a key per player, sends a small ETH +
   USDC top-up from the relayer (sequential receipts → no nonce collisions), and
   each player sends its OWN `approve(manager)` so the relayer can redeem its
   budget delegation's `transferFrom`.
2. **New game** — the bot driver calls `POST /api/new-game`; the server draws a real
   on-chain random word from the `RandomnessCoordinator`, builds + shuffles the full
   108-card deck from it, deals 7 to each seat, **seals every hand** (AES-GCM), seats
   the room on the `TurnManager` (human seat 0, then bots), seeds the discard top on
   `UnoGameSystem`, records each seat's real hand count, and opens the `Pot`.
3. **Join + pay (x402)** — each player signs ONE budget delegation (bounded by
   caveats) and the server redeems `USDC.transferFrom(player → Pot, fee)`. Real
   USDC moves from the player's wallet; the relayer pays gas.
4. **Gasless legal moves** — each player signs ONE gameplay delegation. On their
   turn they fetch their sealed hand (`POST /api/hand`) and submit a play. The server
   validates it against the **full rules** (rejecting illegal plays), applies the
   action effect, and redeems `World.call(UnoGame, playCard/draw)` recording the REAL
   card `(color, value)` + the new hand count + the turn advance (2 seats for Skip /
   Draw Two / Wild Draw Four; a `setDirection` for a Reverse). Turn order is enforced
   on-chain; the player pays zero gas.
5. **Win + payout** — the first player to legally play their last card emits
   `Uno_Won`; the server settles the `Pot` to the winner
   (`USDC.transferFrom(Pot → winner)`, minus rake = 0).

The human plays in a real browser (persistent guest wallet); the bots play from
`scripts/bots.ts`. Entry fee is **0.1 USDC** (small for testnet so each ~0.5 USDC
player wallet can buy in repeatedly); override with `ENTRY_FEE_USDC`.

## Security

The relayer private key is **server-only** (`lib/config.ts`, from
`examples/.shared-env.local`). It is never imported by a client component. Players
only sign delegations. `players.local.json` holds the generated player keys and is
**gitignored**.

## Deployed Base Sepolia addresses

See `deployments/base-sepolia.json`. Key addresses:

- World: `0xeD8408d2dba74b4e94f10C96a19FF068cbe2280a`
- UnoGameSystem: `0xCc1Ac08699a1c173d4fbE63a64e5287146C8F684`
- NexusDelegationManager: `0x6c9F9bF4FbF83449c7f53801F0691317c198e481`
- TurnManager: `0xa10e088920C0230FCDcC58dBbF89dCDd161919cD`
- RandomnessCoordinator: `0xA213e74e162a75094fE16398Dbb5e331F1684953`
- Pot (UnoPot): `0xC6AEfbdA8DA074Ae7eaC66e09871668Cb6909Cf3`
- USDC (Base Sepolia): `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

## What is complete vs simplified

**Complete & real (on-chain, verified):**
- The **full official UNO ruleset** on the real 108-card deck — legality (color /
  number / symbol / wild), all action cards (Skip, Reverse, Draw Two, Wild, Wild
  Draw Four), draw-when-stuck, discard reshuffle, and a real win. Illegal plays are
  rejected by the authoritative server.
- The deck **shuffle is seeded by a real on-chain random word** (RandomnessCoordinator).
- **Hidden hands are sealed for real** with `@nexus/secrets` (`LocalSecrets`,
  AES-256-GCM) and revealed only to the owner.
- Distinct per-player keys; one ERC-7710 delegation per player, signed with their
  own key, redeemed by the relayer.
- The entry fee — a real `USDC.transferFrom(player → Pot)` from each player's wallet,
  bounded by per-action / lifetime / recipient caveats.
- Gasless moves — real `manager.redeemDelegations` recording the **real card**
  `(color, value)` and emitting `Uno_Played` / `Uno_Won`; players pay zero gas.
- On-chain turn enforcement (incl. action-card skips and Reverse direction) and the
  real win condition.
- The pot payout — a real `USDC.transferFrom(Pot → winner)` settled on-chain.
- A full multiplayer game played to a real WIN, human-in-browser + bots, end to end.

**Documented design choices / relaxations:**
- **Authority split.** Private hands cannot live on-chain, so the backend is the
  authoritative full-rules engine (deck, hands, legality) and the on-chain
  `UnoGameSystem` enforces turn order and records the real card + the server-attested
  remaining hand count + the win. The win is therefore decided by the chain from the
  attested count.
- **Randomness tier.** The shuffle seed uses the coordinator's `fast` (prevrandao)
  tier — fully on-chain and real, single-tx (no two-block commit-reveal wait). A
  full commit-reveal is also supported by the coordinator; `fast` is the documented
  choice for the demo. No off-chain entropy enters the deal.
- **Start card.** If the flipped start card is an action card (or Wild Draw Four) we
  re-flip until a plain number card starts the discard pile (the simplest
  unambiguous opening, deterministic from the seed).
- **Wild Draw Four restriction.** The official "only legal when you hold no card of
  the current color" rule IS enforced by the server's `legalPlays` (it sees the full
  hand).
- **UNO call.** The one-card "UNO" state is tracked; the call/penalty is not enforced
  (documented relaxation).

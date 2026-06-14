# Nexus UNO — full multiplayer, gasless, x402, played to a WIN (Base Sepolia)

A complete, working multiplayer UNO built on the Nexus SDK and settled entirely on
Base Sepolia. **No Privy** — every player is a distinct, self-custodial key.

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
| On-chain UNO (per-player hand counts, win) | `contracts/UnoGameSystem.sol`, `contracts/UnoTable.sol` |
| Pot escrow + winner payout | `contracts/UnoPot.sol` |
| Deploy (full Nexus stack + UNO + Pot, real USDC) | `contracts/DeployUno.s.sol`, `scripts/deploy.sh` |
| Redemption engine (relayer redeems per-player delegations) | `lib/engine.ts` |
| Browser-safe per-player delegation signing | `lib/delegations.ts` |
| Game server (HTTP `/api/*`, in-memory board, settles pot) | `scripts/server.ts` |
| Bot driver (joins, pays x402, plays to a win) | `scripts/bots.ts` |
| Fund + approve player keys (sequential nonces) | `scripts/fund-players.ts` |
| Browser client (human signs, server redeems) | `lib/uno-client.ts`, `app/`, `components/` |
| Hand model + legal-move chooser | `lib/hand.ts` |
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

A headless smoke of the human's full path (no browser), to run alongside the
server + bots (steps 3–4):

```bash
pnpm --filter @nexus/example-uno exec tsx scripts/human-sim.ts
```

## How the flow works

1. **Fund** — `fund-players.ts` generates a key per player, sends a small ETH +
   USDC top-up from the relayer (sequential receipts → no nonce collisions), and
   each player sends its OWN `approve(manager)` so the relayer can redeem its
   budget delegation's `transferFrom`.
2. **New game** — the bot driver calls `POST /api/new-game`; the server (relayer)
   seats the room on the `TurnManager` (human seat 0, then bots), deals hands on
   `UnoGameSystem`, seeds the discard top, and opens the `Pot`.
3. **Join + pay (x402)** — each player signs ONE budget delegation (bounded by
   caveats) and the server redeems `USDC.transferFrom(player → Pot, fee)`. Real
   USDC moves from the player's wallet; the relayer pays gas.
4. **Gasless moves** — each player signs ONE gameplay delegation; on their turn the
   server redeems `World.call(UnoGame, playCard/draw)`. Turn + legality are enforced
   on-chain; the player pays zero gas.
5. **Win + payout** — the first player to empty their hand emits `Uno_Won`; the
   server settles the `Pot` to the winner (`USDC.transferFrom(Pot → winner)`, minus
   rake = 0).

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

- World: `0xB0a8314b058C171bD1bbB1E72cAFe6EFf2406Fc3`
- UnoGameSystem: `0x2fe4F148Dff2aaD75aB85814D9d9b85d9832f92e`
- NexusDelegationManager: `0x2281B53d0a939C4AAC30E1941500080CE3D790D5`
- TurnManager: `0x213FEFA7026f94bFd3b7266dcF24E679a85f1df7`
- Pot (UnoPot): `0x1c798AD3B9c6511d914d21820E79Ea3864Be3E53`
- USDC (Base Sepolia): `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

## What is complete vs simplified

**Complete & real (on-chain, verified):**
- Distinct per-player keys; one ERC-7710 delegation per player, signed with their
  own key, redeemed by the relayer.
- The entry fee — a real `USDC.transferFrom(player → Pot)` from each player's wallet,
  bounded by per-action / lifetime / recipient caveats.
- Gasless moves — real `manager.redeemDelegations` emitting `Uno_Played` / `Uno_Won`;
  players pay zero gas.
- On-chain turn + legality enforcement and the win condition (per-player hand counts).
- The pot payout — a real `USDC.transferFrom(Pot → winner)` settled on-chain.
- A full multiplayer game played to a WIN, human-in-browser + bots, end to end.

**Simplified (by design, for a demo):**
- UNO rules are reduced: each dealt card is a WILD (always a legal play), which keeps
  the game deterministic and guarantees termination in a real on-chain win. The
  match-color-or-number rule is still enforced on-chain for non-wild plays.
- Hidden hands: hands are dealt deterministically client-side; the secrets
  seal/reveal/attest round-trip lives in the `@nexus/secrets` tests.
- The game server keeps one live game's board in memory (the authoritative win +
  payout are on-chain); the `Pot` deposit ledger is mirrored by the settle authority
  (`creditDeposit`) since the entry fee arrives via a manager-relayed `transferFrom`.

# Nexus Onchain Monopoly (Base Sepolia)

A fully-wired, **winnable multiplayer** example: onchain Monopoly on the Nexus SDK.
Gasless dice rolls use an on-chain `RandomnessCoordinator`; the buy-in, every property
purchase and every rent payment settle as **real, PER-PLAYER USDC payments on Base
Sepolia** — each from the player's OWN wallet, bounded by a single Nexus delegation
that player signs. First to own the property target wins the **Pot**, which pays out
on-chain to the winner.

> Real, end-to-end: real contracts, real per-player delegations, real testnet USDC.
> Nothing is mocked. Each player (the human in the browser + the bots) signs its OWN
> gameplay + budget delegation with its OWN key; a single funded **relayer** (server
> only) redeems them via the `NexusDelegationManager` — so players pay **zero gas**,
> yet the USDC genuinely moves from *their* wallet, capped on-chain.

This mirrors the verified `examples/uno` architecture.

---

## The money path (who signs vs who redeems)

- **Each player signs its own delegations** (`lib/delegations.ts`, browser-safe):
  - a **gameplay** delegation (turn-bound, `SystemAllowlist` → `MonopolyGameSystem`)
    covering all of that player's dice rolls, and
  - a **budget** delegation bounded by `perActionCap` / `totalCap` and an allowed
    recipient (the **Pot**) covering the buy-in + property buys + rent.
- **The relayer redeems** them (`lib/engine.ts`, server only — the hardcoded funded
  key `0xA3327…55bD`). It pays gas and submits `manager.redeemDelegations(...)`; it is
  also the `TurnManager` admin, the `MonopolyGameSystem` admin (for the ownership /
  cash ledger writes) and the Pot settle authority.
- The result: the on-chain ERC-20 `Transfer`'s `from` is the **player** (the
  delegator), while the tx submitter is the **relayer**. Distinct keys, verifiable
  with `cast`.

All relayer submissions are **serialized** through one queue so the single relayer
key never collides its nonces.

---

## Run it

```bash
# 1) fund a human + 2 bot wallets (idempotent top-up; writes players.local.json)
pnpm --filter @nexus-examples/monopoly fund-players

# 2) start the authoritative game server (relayer redeems; :8791)
pnpm --filter @nexus-examples/monopoly server

# 3) start the bots — they create the game (human seat 0 + bots), pay buy-ins, and
#    play their turns (roll + pay rent; bots never buy)
pnpm --filter @nexus-examples/monopoly bots

# 4) start the Next app (:3030) and play the human seat in the browser
pnpm --filter @nexus-examples/monopoly dev
```

The browser human connects a guest wallet, discovers its seat, pays the buy-in (real
x402 from its own wallet), rolls gasless dice, and **buys** the first unowned property
it lands on — reaching the property target and winning the Pot.

## End-to-end test

```bash
pnpm --filter @nexus-examples/monopoly test:e2e
```

A persistent-context Playwright test that:
1. funds the players + starts the server + bots (globalSetup),
2. injects the funded **human** key into the browser guest wallet,
3. connects, **pays the buy-in** and asserts the real on-chain USDC `Transfer(human →
   Pot)` (the `from` is the *player* key, proving a distinct wallet signed the budget
   delegation — the relayer only submitted/redeemed),
4. plays to a **WIN** via the real UI (human rolls + buys; bots play via the script),
5. asserts the on-chain **winner** and the Pot **payout** `Transfer(Pot → winner)`.

---

## Game rules (deterministic win)

- 12-space board (`lib/board.ts`). On a turn a player **rolls** 2d6 (gasless, on-chain
  RNG) and moves.
- Landing on an **unowned** property → may **buy** it (real `transferFrom(player →
  Pot)`). Landing on an **owned** property → **pay rent** (real `transferFrom(player →
  Pot)`, the owner is credited in the Pot ledger).
- **Win:** first player to own `TARGET_PROPERTIES` (default `1`) properties wins; the
  Pot settles to them on-chain. The bots never buy (they only roll + pay rent), so the
  human is the deterministic winner — exactly what the e2e asserts.

Real on-chain amounts (kept tiny for testnet): buy-in `0.10`, buy `0.05`, rent `0.02`
USDC (`lib/config.ts`).

---

## Layout

| Path | What |
|---|---|
| `lib/delegations.ts` | Browser-safe per-player delegation signing (gameplay + budget). |
| `lib/engine.ts` | Server-only relayer redemption engine + admin/authority ops. |
| `lib/monopoly-client.ts` | Browser client: the human signs + posts delegations to the server. |
| `lib/board.ts` / `lib/deployment.ts` / `lib/config.ts` | Board, deployed addresses, server config. |
| `scripts/fund-players.ts` | Generate + fund the human + bot keys (sequential, idempotent). |
| `scripts/server.ts` | Authoritative game server (board, turns, ownership, redemptions, settle). |
| `scripts/bots.ts` | Bot driver: bots sign their own delegations, pay buy-in, roll + pay rent. |
| `tests/monopoly.e2e.ts` | Persistent-context Playwright e2e (+ global setup/teardown). |
| `contracts/` | `MonopolyGameSystem.sol`, `MonopolyPot.sol`, tables, deploy script. |

Contracts are already deployed (`deployments/base-sepolia.json`). The relayer key
lives only in `examples/.shared-env.local` and never reaches the browser.

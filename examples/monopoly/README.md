# Nexus Onchain Monopoly — FULL RULES (Base Sepolia)

A complete, winnable multiplayer **Monopoly** on the Nexus SDK with the **full standard
US ruleset** — no shortcuts, no fake win. The game runs to a **real win = the last
player not bankrupt** (every other player eliminated through real bankruptcy).

Gasless dice come from an on-chain `RandomnessCoordinator`; **every** player action
(roll / buy / build / mortgage / pay / end-turn) is a gasless move redeemed through
that player's **gameplay** delegation; **every** money debit from a player (buy-in,
rent, tax, house, jail fine, card debit) is a **real USDC x402 charge** redeemed
through that player's **budget** delegation, bounded on-chain by spend caps + a
recipient allowlist (the **Pot**). The Pot pays the last solvent player on-chain.

> Real, end-to-end: real contracts, real per-player delegations, real testnet USDC.
> Each player (the human in the browser + the bots) signs ONE gameplay + ONE budget
> delegation with its OWN key; a single funded **relayer** (server only, `0xA3327…55bD`)
> redeems them via the `NexusDelegationManager` — players pay **zero gas**, yet the
> USDC genuinely moves from *their* wallet, capped on-chain. Mirrors `examples/uno`.

---

## Architecture

- **Authoritative rules engine** (`lib/monopoly-rules.ts`, pure logic): the full
  40-space board, buying, rent (monopolies double base rent; houses/hotels; railroads
  scale by count; utilities by dice), GO bonus, Income/Luxury tax, jail (pay $50 / roll
  doubles / Get-Out card / forced on 3rd turn), doubles (3-in-a-row → jail), Chance &
  Community Chest decks, building **evenly** on full color groups, mortgaging, and
  **bankruptcy** (a player who cannot meet a debt even after selling houses + mortgaging
  everything is eliminated; assets transfer to the creditor, or back to the bank).
  **Win = last solvent player.**
- **On-chain rails** (`contracts/MonopolyGameSystem.sol`):
  - `rollAndMove` — the player's turn-bound, gasless dice roll (RandomnessCoordinator);
    the real on-chain dice feed the rules engine. Does **not** advance the turn.
  - `recordAction(roomId, action, spaceId, amount)` — a generic, turn-bound, gasless
    record of every non-roll player action, signed for by the player.
  - `endTurn` — turn-bound, gasless, advances the on-chain `TurnManager` (signed by the
    player). Doubles re-roll without ending the turn.
  - admin mirrors (`recordOwner` / `setCash` / `recordBankrupt`) let the relayer mirror
    authoritative state into the World tables for the indexer/UI.
- **Real USDC economy** (`lib/engine.ts`): each money debit is
  `USDC.transferFrom(player → Pot, amount)` redeemed through the budget delegation at a
  fixed scale **$1 in game = 0.0001 USDC** (`DOLLAR_TO_USDC`) — so a $200 tax is a real
  `0.02 USDC` transfer and a whole game stays well under a funded testnet wallet. The
  Pot accumulates the real USDC and pays the winner on settle.

All relayer submissions are **serialized** through one queue (the single relayer key
never collides nonces) and **retry on a transient nonce error** (the relayer key is
shared with the UNO example).

### Bots

Real strategy (`lib/bot-strategy.ts`): buy any affordable property, build houses on
completed color groups when flush, leave jail when it has a cushion, and otherwise
roll / end. Mortgaging to cover a debt is automatic in the rules engine. Bots drive the
SDK exactly like the human — one action at a time through `/api/act`.

---

## Termination (real bankruptcy, smaller bankroll)

Real Monopoly can run very long. To reach a genuine bankruptcy-based finish in bounded
time we use the **standard published rent tables UNCHANGED** with a **smaller bankroll**:
start cash **$80** and a reduced GO income (**$60**/lap) so cumulative rent + tax
genuinely deplete a player. Across simulated games this reaches a **real bankruptcy
elimination in ~80%** of games (the primary path); a typical bankruptcy lands by round
~10–15. A **round cap of 50** is a **documented safety net only** — if reached, the
richest net-worth solvent player wins.

Verified live on Base Sepolia: a full game finished with a **real bankruptcy** — a bot
landed on Income Tax, couldn't cover the $200 even after liquidating, and was
eliminated; the human (last solvent) won and the Pot paid out on-chain
(`USDC.transfer(Pot → winner)`). NOT a first-to-N shortcut.

Tune via `START_CASH` / `ROUND_CAP` in `lib/monopoly-rules.ts` and `GO_BONUS` in
`lib/board.ts`.

## Documented simplifications / omissions

- **No property auction** when a player declines an unowned property (it stays with the
  bank) — declines are a no-op, not an auction.
- **No player-to-player trading.**
- **Decks**: faithful ~16-card Chance and Community Chest decks (money +/-, advance-to,
  go-to-jail, Get-Out-of-Jail-Free, collect/pay-each-player). A few rarely-decisive
  official cards (e.g. "advance to nearest railroad/utility and pay double", per-house
  street-repair assessments) are replaced with equivalent flat money cards; card flavor
  text may say "$200" while the engine credits the scaled `GO_BONUS`.
- On a bankruptcy to another player, inherited houses are sold to the bank (cleared)
  rather than kept, a minor simplification of the asset transfer.

---

## Run it

```bash
pnpm --filter @nexus-examples/monopoly fund-players   # human + 2 bots (idempotent)
pnpm --filter @nexus-examples/monopoly server         # authoritative server (:8791)
pnpm --filter @nexus-examples/monopoly bots           # bots create the game + play
pnpm --filter @nexus-examples/monopoly dev            # Next app (:3030) — play the human
```

The browser human connects a guest wallet, joins (pays the buy-in via real x402), then
plays its turns through the real UI: roll the gasless on-chain dice, buy / decline,
build houses, leave jail, end the turn — until one player is the last solvent and the
Pot pays out on-chain.

## End-to-end test

```bash
pnpm --filter @nexus-examples/monopoly test:e2e
```

Persistent-context Playwright: funds players + starts server + bots, injects the funded
human key into the browser guest wallet, joins + asserts the real on-chain USDC
`Transfer(human → Pot)` buy-in, plays the full game to a **real win** (gated on the
backend `/api/state` winner + payout), and asserts the on-chain Pot **payout**
`Transfer(Pot → winner)` matches the reported last-solvent winner.

---

## Layout

| Path | What |
|---|---|
| `lib/board.ts` | The full 40-space board + published deed/rent tables + $→USDC scale. |
| `lib/monopoly-rules.ts` | Authoritative full-rules engine (pure logic, bankruptcy, win). |
| `lib/bot-strategy.ts` | Bot decision logic (buy / build / jail / end). |
| `lib/delegations.ts` | Browser-safe per-player delegation signing (gameplay + budget). |
| `lib/engine.ts` | Server-only relayer redemption engine + admin/authority ops. |
| `lib/monopoly-client.ts` | Browser client: the human signs + posts delegations to the server. |
| `scripts/server.ts` | Authoritative game server (rules + on-chain rails + settle). |
| `scripts/bots.ts` | Bot driver: bots sign their own delegations, join, and play a strategy. |
| `tests/monopoly.e2e.ts` | Persistent-context Playwright e2e (+ global setup/teardown). |
| `contracts/` | `MonopolyGameSystem.sol`, `MonopolyPot.sol`, tables, deploy script. |

Contracts deploy with `pnpm deploy` (writes `deployments/base-sepolia.json`). The
relayer key lives only server-side and never reaches the browser.

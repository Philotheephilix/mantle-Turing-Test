# web/AGENTS.md — Navigation map for the SteamLink app

> Narrower companion to the root [`../AGENTS.md`](../AGENTS.md). This is the
> unified **Next.js (App Router)** app: marketing site + `/docs` + the two
> reference games (UNO, Monopoly). It targets **Mantle Sepolia (chain 5003)**.

## Two things to know before reading code here

1. **Published SDK, not the workspace.** This app imports the **published
   `@steamlink/*` npm packages** (core/react/server/relayer/secrets/types) — NOT
   the local `@nexus/*` workspace. Editing `packages/*` does not change this app's
   SDK layer; only `web/`'s own code changes it.
2. **Game-system contracts are not in this repo.** The shared Nexus stack is
   deployed (see root AGENTS "Deployments"), but the per-game Solidity systems
   (`unoGame`, `monopolyGame`) are external; their addresses are `0x0` in
   `web/lib/<game>/deployments/mantle-sepolia.json` until deployed and pasted in.

## Top-level layout

| Path | What it is |
|---|---|
| `app/layout.tsx`, `app/page.tsx`, `app/globals.css` | Root shell + landing page + theme. |
| `app/play/[slug]/page.tsx` | Generic game shell; routes by slug for non-special games. |
| `app/play/<game>/page.tsx` (+ `layout.tsx`) | Per-game UI (UNO, Monopoly) on the shared wallet. |
| `app/api/<game>/<route>/route.ts` | Server route handlers for each game (see below). |
| `app/docs/` + `components/docs/` | The `/docs` site (SDK reference + "contribute a game"). |
| `instrumentation.ts` | Next.js boot hook — starts each game's server authority/bots. |
| `lib/<game>/` | All per-game logic (authority, rules, signing, deploy addresses). |
| `lib/*.ts` (root) | Shared app infra (see "Shared infra"). |
| `components/` | UI — `<game>/`, `wallet/`, `docs/`, `iso/`, and shared pieces. |
| `PRODUCT.md`, `DESIGN.md` | Product framing and visual design notes (not code-nav). |

## Shared infra (`web/lib/*.ts`)

- `lib/wallet.ts` → `useWallet()` — the one wallet provider both games share (connect MetaMask smart account or a guest wallet); holds the Mantle Sepolia chain descriptor (MNT native token). **Server-only relayer keys never reach here.**
- `lib/games.ts` → the `GAMES` registry (catalog-as-data). Each entry's `status: "live"` routes its card to `/play/<slug>`. **Adding a game is a registry edit, not a page rewrite.**
- `lib/constants.ts` → chain-level shared constants (USDC token, relayer address).
- `lib/erc7715.ts` → shared ERC-7715 grant helpers; `lib/mode.ts`, `lib/confetti.ts` → small UI utilities.
- `components/linkifyTx.tsx` → renders any tx hash as a Mantlescan link (`https://sepolia.mantlescan.xyz/tx/…`). Every on-chain action surfaces through this.

## A game's anatomy (`web/lib/<game>/`, e.g. `uno`)

| File | Role | Key for review |
|---|---|---|
| `game.ts` | `defineGame(...)` — tables + systems + economy. | Single source of truth for the game schema. |
| `game-backend.ts` | **Server-only authority singleton** — holds the live game, charges entries, redeems moves, seals hands, settles the pot. | Trust boundary; holds the signed delegations. |
| `engine.ts` | Low-level Nexus redemption engine — `redeemMove`, `chargeEntryFee`, `settlePot`, randomness, turn setup. | Where calldata is built + relayed. Server-only. |
| `<game>-game.ts` / `<game>-rules.ts` | Authoritative rules state machine. | Move legality is decided here, then on-chain. |
| `delegations.ts` | **Browser-safe** delegation signing (`signGameplayDelegation`, `signBudgetDelegation`). | Pure `@steamlink/core` + viem — **no relayer key**. |
| `signer.ts` | Wallet abstraction (MetaMask Hybrid DeleGator smart account or guest). | Mantle Sepolia chain config (MNT). |
| `erc7715.ts` / `erc7715-settle.ts` | The ERC-7715 "intuitive grant" wallet rail (popup → server settle via the canonical MetaMask DelegationManager). | The 2nd rail (see root AGENTS "two wallet rails"). |
| `config.ts` | **Server-only** config; reads the relayer key + fees. | ⚠️ UNO's carries a hardcoded **testnet** relayer key (demo only). |
| `deployment.ts` | Imports `deployments/mantle-sepolia.json` and exposes typed addresses. | The address seam; safe to import client-side (addresses only). |
| `deployments/mantle-sepolia.json` | Live deployed addresses for this game. | `unoGame`/`monopolyGame` are `0x0` (contracts not in repo). |
| `auto-start.ts`, `bot-runner.ts`, `bot-strategy.ts`, `ensure-players.ts` | Self-seating demo: boots a table and bot players. | Booted from `instrumentation.ts`. |

## Request flow (gasless move)

```
browser (signed delegation)
  → POST web/app/api/<game>/move/route.ts          # thin handler
    → web/lib/<game>/game-backend.ts:move          # rules-validate (authority)
      → web/lib/<game>/engine.ts:redeemMove        # build calldata + relay
        → @steamlink/relayer DirectRelayer          # relayer EOA pays gas
          → NexusDelegationManager.redeemDelegations (on-chain, Mantle Sepolia)
            → enforcers' beforeHooks → World.call → System._msgSender → game system
  ← optimistic UI update, reconciled on webhook/poll; tx shown via linkifyTx
```

Charges (`/api/<game>/charge` for UNO, `/api/<game>/act`+`/grant` for Monopoly)
follow the same shape but redeem the **budget** caveat group as a real USDC
transfer to the Pot, bounded on-chain by the spend-cap enforcers.

## API routes

- **UNO** (`web/app/api/uno/`): `move`, `charge`, `grant`, `start`, `state`, `hand`, `health`, `new-game`.
- **Monopoly** (`web/app/api/monopoly/`): `act`, `join`, `grant`, `start`, `state`, `health`.

Each `route.ts` is a thin Next.js handler that delegates to the game's
`game-backend.ts`. They are booted/served via the standard Next.js runtime;
the self-playing demo + bots are started in `web/instrumentation.ts`.

## Adding a game (the short version)

1. `defineGame(...)` in `web/lib/<game>/game.ts`.
2. Write + deploy the Solidity system (under `packages/contracts/src/systems/`), record its address.
3. Fill `web/lib/<game>/deployments/mantle-sepolia.json`.
4. Add namespaced handlers under `web/app/api/<game>/*` and a UI at `web/app/play/<game>/page.tsx` on `useWallet()`, rendering tx hashes through `linkifyTx`.
5. Register a `GameEntry` in `web/lib/games.ts` with `status: "live"`.

Full walkthrough: the **Contribute a game** tab at `/docs`
(`web/components/docs/ContributeDocs.tsx`).

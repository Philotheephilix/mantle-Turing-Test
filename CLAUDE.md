# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SteamLink (engine codename **Nexus**) is a fully on-chain, turn-based game-engine SDK for **Mantle**. The core idea: a player signs **one** ERC-7710 / EIP-712 delegation when joining a room, and a backend relayer redeems that single signature for everything afterward — **gasless moves** (no wallet popups) and **x402 USDC payments** bounded by on-chain spend caps. Game state lives in an on-chain ECS World; settlement runs through a trustless `Pot`. Live on Mantle Sepolia (chain 5003).

A game is described as **data** (tables) + **logic** (real Solidity systems, never interpreted in JS). `defineGame()` is the single source of truth; codegen emits a Solidity table library so the on-chain World and the TS client share one schema.

> **Read `AGENTS.md` first** — it is the canonical, detailed navigation map (per-package file index, the end-to-end one-signature data flow, the two wallet rails, and security-critical code). This file is the quick-start; AGENTS.md is the reference. Note AGENTS.md still refers to `examples/uno` and `examples/monopoly`; those reference games now live **in-tree under `web/`** (the unified Next.js mono-app) — see below.

## Commands

pnpm + turborepo monorepo. Node ≥20, pnpm 11.

```bash
pnpm install
pnpm build          # turbo run build (all packages; respects ^build dep order)
pnpm test           # turbo run test (vitest)
pnpm typecheck      # turbo run typecheck
pnpm lint           # biome check .
pnpm lint:fix       # biome check --write .
pnpm format         # biome format --write .
```

Run a single package's task with a filter, e.g. `pnpm --filter @nexus/core test` or `pnpm --filter @nexus/core build`. Run one vitest file from inside a package: `pnpm vitest run src/path/to.test.ts` (or `-t "test name"` for a single case).

### Solidity (Foundry, in `packages/contracts`)

Foundry is **not** wired into the turbo `test`/`build` tasks — run it directly:

```bash
pnpm contracts:build           # = forge build  (from repo root)
pnpm contracts:test            # = forge test
# inside packages/contracts, ensure foundry is on PATH:
PATH=$HOME/.foundry/bin:$PATH forge test
forge test --match-path test/NexusDelegationManager.t.sol     # single file
forge test --match-test test_redeem_revertsOnWrongTurn        # single test
```

First-time setup installs forge-std + OpenZeppelin: `pnpm --filter @nexus/contracts setup`. Solc 0.8.27, `via_ir = true`, evm `cancun`.

### Live / integration scripts (`scripts/`)

These hit real Mantle Sepolia and need a funded `PRIVATE_KEY` in `.env` (copy `.env.example`). They run via `tsx`, not vitest:

```bash
pnpm --filter @nexus/scripts preflight    # env + connectivity check
pnpm --filter @nexus/scripts live         # full live integration run-all
pnpm --filter @nexus/scripts e2e          # live e2e
```

### Web app (the playable site)

```bash
pnpm --filter @steamlink/web dev          # next dev on :3000
pnpm --filter @steamlink/web build
```

## Architecture

### Package naming — two namespaces, on purpose

- **`@nexus/*`** — the internal workspace package names (`packages/*`): `core`, `types`, `contracts`, `relayer`, `backend`, `server`, `secrets`, `react`, `cli`. Use these in `pnpm --filter` and in cross-package imports.
- **`@steamlink/*`** — the **published npm** names and the web app (`@steamlink/web`). The README and public docs use these. Same code, public-facing brand.

When wiring `--filter`, use the `@nexus/*` name from each `package.json`; when reading the README/docs, expect `@steamlink/*`.

### The packages (SDK) — see AGENTS.md for the file-by-file map

- **`packages/types`** — branded `Address`/`Hex`/`TokenSymbol`, `chain` is strictly `"mantle"`, and the canonical `NexusError` + `NEXUS_ERROR_CODES` taxonomy imported everywhere. `codeFromRevert()` maps on-chain reverts to typed codes.
- **`packages/core`** — `defineGame()` (single source of truth), codegen (`codegen/solidity.ts` emits the `<Game>Tables` library + deploy manifest), and the **delegation engine** (`delegation/eip712.ts` schema — **must match `NexusDelegationManager.sol` byte-for-byte** — plus `buildGameplayCaveats`/`buildBudgetCaveats`, `signDelegation`, `build*Execution`, `buildRedeemCalldata`), and randomness facade.
- **`packages/contracts`** — Foundry. `world/World.sol` (ECS root + ERC-2771 redemption seam), `system/System.sol` (`_msgSender` recovers the true player — systems must **never** read raw `msg.sender` for attribution), `delegation/NexusDelegationManager.sol` (**security-critical** ERC-7710 redemption: ECDSA + ERC-1271 verify, caveat before/after hooks, sender append), `enforcers/*` (**security-critical** authorization boundary: turn gating, spend caps, recipient/system allowlists), `Pot.sol` (trustless USDC escrow, admin-keyless settle), `randomness/RandomnessCoordinator.sol`.
- **`packages/relayer`** — the `RelayerAdapter` port; **every** redemption (move or payment) reaches chain through it. `DirectRelayer` (self-relay funded EOA, default for dev/e2e) and `OneShotRelayer` (production).
- **`packages/backend`** — composition root (`compose/createBackend.ts`), Hono gateway, `RoomService` (holds the signed delegation), move/charge/webhook lifecycles, indexer, `PotService`.
- **`packages/server`** — x402 `monetize` middleware + delegation facilitator.
- **`packages/secrets`** — sealed hidden state (Lit Protocol default, local AES adapter for dev).
- **`packages/react`** — live-state hooks (`useTable`, `useTurn`, `useGameActions`, `useCharge`, `usePot`, `useSession`) + optimistic store (on-chain truth reconciles).
- **`packages/cli`** — `nexus` CLI: `init`, `codegen`, `deploy`, `dev`, `migrate`, `fork`.

### `web/` — the unified Next.js mono-app (the reference games + site)

The standalone `examples/uno` and `examples/monopoly` apps were consolidated into a single Next.js app under `web/`. Per-game code is namespaced:

- `web/lib/<game>/` — game logic (e.g. `uno`, `monopoly`): the `defineGame` definition, the authoritative rules state machine, the server-only authority/engine, browser-safe delegation signing, signer abstraction.
- `web/app/api/<game>/*` — namespaced Next.js route handlers (move / charge / grant / start / state / …), booted from `web/instrumentation.ts`.
- `web/app/play/<game>/page.tsx` — the game UI on the shared `useWallet()` provider; every tx hash rendered through `linkifyTx`.
- `web/lib/games.ts` — the `GAMES` registry; catalog-as-data. Adding a game is a registry edit (`status: "live"` routes the card to `/play/<slug>`), not a page rewrite.
- `web/lib/<game>/deployments/mantle-sepolia.json` — live deployed addresses.

**Adding a game** (full guide is the "Contribute a game" tab at steamlink.vercel.app/docs): `defineGame` in `web/lib/<game>/game.ts` → write Solidity systems under `packages/contracts/src/systems/` and `forge test` → deploy World+systems to Mantle Sepolia, record addresses → namespaced API handlers + play page → register in `web/lib/games.ts`. Verify gate: `forge test` · `pnpm -r test` · `pnpm --filter @steamlink/web build` must all pass.

## Invariants to respect (these are load-bearing)

- **Mantle only.** `chain` is `"mantle-sepolia"` (testnet) or `"mantle"` (mainnet) — the `ChainKey` union in `packages/types/src/chain.ts` enumerates both; there is no other network abstraction. Tokens/`targetAddress` come from `relayer_getCapabilities` (cached, source of truth) — never hardcode them in the hot path; a `targetAddress` mismatch is rejected before a bundle submits.
- **One delegation per player per room.** A single EIP-712 grant carries both the gameplay and budget caveat groups. No flow may re-prompt the wallet mid-game.
- **Player attribution via `_msgSender`.** On-chain, systems recover the player from ERC-2771 trailing bytes (`System.sol:_msgSender`), never raw `msg.sender`.
- **`eip712.ts` ↔ `NexusDelegationManager.sol` must match byte-for-byte.** Changing one without the other breaks signature verification.
- **Relayer/signing key is backend-only.** The browser holds only the player's signer — never the relayer key, Lit credentials, or the Pot authority. Keep browser-safe signing isolated (e.g. `web/lib/<game>/delegations.ts`, pure `@nexus/core` + viem).
- **Webhooks drive the hot path.** Status comes from HMAC-verified relayer webhooks → internal `StatusEvent`; chain polling is a silent fallback only. Apply optimistic updates, reconcile on the webhook; enforcer rejections surface as typed `NexusError`s.
- **Everything is an adapter.** Relayer, secrets, indexer, facilitator, randomness each sit behind a TS port with a default impl.
- **Never commit funded keys or `.env*`.** They're gitignored; a committed key is an automatic PR rejection.

## Conventions

- **Biome** is the single formatter/linter (2-space indent, width 100). It ignores `dist/`, `out/`, `cache/`, `lib/`, `generated/`, `*.gen.ts`. `noExplicitAny` is a warn; `noNonNullAssertion` is off.
- **TypeScript** is strict with `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax`, `isolatedModules`, ESM (`NodeNext`). Packages build with `tsup` (ESM + dts).
- Cross-package imports use `workspace:*`.
- This repo follows the **tenori-standards** skill for commits/branches/PRs — invoke it before creating commits, branches, or PRs.

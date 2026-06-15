# AGENTS.md — Navigation map for SteamLink / Nexus

> **Canonical map for an AI reviewer.** Repo "SteamLink", engine "Nexus". Start
> here, then jump to the file referenced for the area you're reviewing. Every
> path below is real and current. There is a second, narrower map for the web
> app at [`web/AGENTS.md`](web/AGENTS.md).

## Where to look first (by intent)

| You want to review… | Start at |
|---|---|
| The one-signature → gasless-move → x402 flow end-to-end | "End-to-end data flow" below |
| On-chain security (signatures, caveats, escrow) | `packages/contracts/src/{delegation,enforcers,Pot.sol,system}` + "For reviewers" |
| The TS SDK surface | `packages/*` map below (each has its own `README.md`) |
| The playable site / reference games | [`web/AGENTS.md`](web/AGENTS.md) |
| What's deployed on-chain | "Deployments" below + `packages/contracts/deployments/5003.json` |

## System summary

Nexus is a fully on-chain, turn-based game engine for **Mantle**. A player signs
**one** ERC-7710 / EIP-712 delegation when they join a room; the backend relayer
redeems that single delegation for everything afterward — **gasless moves** (no
wallet popups) and **x402 USDC payments** bounded by on-chain spend caps. Game
state lives in an on-chain ECS World; settlement (entry fees, winner payout) runs
through a trustless `Pot`. The architecture is **mainnet-ready** and is **live on
Mantle Sepolia** (chain `5003`); see "Deployments".

## Repository map

A pnpm + turborepo monorepo.

- **`packages/*`** — the SDK. Workspace package names are **`@nexus/*`**; the
  **published npm** names are **`@steamlink/*`** (same code, public brand).
- **`web/`** — the unified Next.js app: the marketing site, the docs, and the
  two reference games (UNO, Monopoly). See [`web/AGENTS.md`](web/AGENTS.md).
  > The standalone `examples/uno` / `examples/monopoly` apps referenced in older
  > docs were consolidated **into `web/`**; there is no `examples/` dir.
  > ⚠️ The web app depends on the **published `@steamlink/*` packages**, not the
  > local `@nexus/*` workspace — they are different package names.
- **`scripts/`** — live/integration harnesses (`@nexus/scripts`, run via `tsx`).

### packages/types — canonical branded types + error surface
- `src/errors.ts` → `NexusError` class + `NEXUS_ERROR_CODES` (e.g. `NOT_YOUR_TURN`, `BUDGET_EXCEEDED`, `PAYMENT_REQUIRED`); `codeFromRevert()` maps on-chain reverts to typed codes. Imported by every package.
- `src/branded.ts` → branded `Address`/`Hex`/`TokenSymbol`.
- `src/chain.ts` → `CHAINS` registry + `ChainKey`; the chain key is `"mantle-sepolia"` (testnet) or `"mantle"` (mainnet). Holds chain id, RPC, explorer, and USDC per chain.

### packages/core — game definition, codegen, delegation engine
- `src/schema/defineGame.ts` → `defineGame()`: the single source of truth (tables + systems + economy). Eager validation; everything else derives from it.
- `src/codegen/solidity.ts` / `src/codegen/manifest.ts` → emit the `<Game>Tables` Solidity library + deploy manifest so the on-chain World and TS client share one schema.
- `src/delegation/eip712.ts` → the EIP-712 `GameDelegation` schema; **must match `NexusDelegationManager.sol` byte-for-byte**.
- `src/delegation/engine.ts` → `buildGameplayCaveats` / `buildBudgetCaveats`, `signDelegation` (the one signature), `buildMoveExecution` / `buildChargeExecution` / `buildChargeFromExecution`, `buildRedeemCalldata` (`manager.redeemDelegations` calldata).
- `src/randomness/` → randomness facade (commit-reveal / fast tiers).
- `src/index.ts` → package barrel.

### packages/contracts — Solidity (Foundry): World, systems, enforcers, escrow
- `src/world/World.sol` → ECS root: table/system registry + `call` router; **the redemption seam** — when `msg.sender == trustedForwarder` it resolves the on-behalf-of player from the ERC-2771 trailing bytes and appends it to the system calldata.
- `src/world/IWorld.sol` → World interface + canonical `Store_*` events the indexer subscribes to.
- `src/system/System.sol` → abstract base for every system; `_msgSender()` recovers the canonical player from the trailing bytes (systems must never read `msg.sender` for attribution).
- `src/delegation/NexusDelegationManager.sol` → **security-critical.** On-chain ERC-7710 redemption manager: verifies the EIP-712 signed delegation (ECDSA + ERC-1271 via `SignatureChecker`), runs each caveat's before/after hooks, then executes the single delegated action into the target with the ERC-2771 sender append. `redeemDelegations()`. Rejects non-zero native `value`.
- `src/delegation/IDelegation.sol` → minimal local ERC-7710 interfaces (`ICaveatEnforcer`, `IDelegationManager`), signature-compatible with the MetaMask framework.
- `src/enforcers/` → caveat enforcers (**security-critical**): `CaveatEnforcerBase.sol` (decodes the ERC-7579 execution, `_requireNoValue` guard), `TurnBoundEnforcer.sol` (redeem only on your turn), `ERC20TransferAmountEnforcer.sol` (lifetime spend cap), `LimitedCallsEnforcer.sol` (max redemptions), `PerActionCapEnforcer.sol`, `AllowedRecipientsEnforcer.sol`, `TimestampEnforcer.sol`, `SystemAllowlistEnforcer.sol`.
- `src/Pot.sol` → trustless USDC escrow per room; `settle()` pays the winner balance − rake; settlement is authority-gated, admin-keyless. See its NatSpec for the settle-authority trust model.
- `src/randomness/RandomnessCoordinator.sol` → fully on-chain randomness: commit-reveal (trustless) + fast/prevrandao (low-stakes, NatSpec warns against value paths); documented VRF seam.
- `src/mocks/TestUSDC.sol` → 6-decimals ERC-20 used as the budget token (Mantle Sepolia has no canonical Circle USDC).
- `script/DeployFull.s.sol` → deploys the whole stack + a TestUSDC + RandomnessCoordinator and writes `deployments/<chainid>.json`.
- `test/*.t.sol` → Foundry tests (incl. `NexusDelegationManager.t.sol`, `SenderSpoofing.t.sol`, `ManagerHardening.t.sol`, `BudgetEnforcers.t.sol`). `test/mocks/*` are fixtures.

### packages/relayer — the redemption transport (adapter port)
- `src/port.ts` → `RelayerAdapter` port: **every** redemption (move or payment) reaches chain through this one interface. `Bundle`, `RelayerCapabilities`, `StatusEvent`.
- `src/direct.ts` → `DirectRelayer`: self-relay via a funded viem account (default for devnet/e2e/games; this is the relayer EOA redeeming on Mantle Sepolia).
- `src/oneshot.ts` → `OneShotRelayer`: production 1Shot permissionless relayer (gas in stablecoins, EIP-7702 EOA upgrades, HMAC webhook-verified status).

### packages/backend — gateway, rooms/sessions, lifecycles, indexer, pots
- `src/compose/createBackend.ts` → composition root: wires adapters + RoomService + PotService + awaiting + webhook into a `Backend`.
- `src/gateway/server.ts` / `src/gateway/routes.ts` → stateless Hono app + framework-agnostic handlers (join / move / charge / state / subscribe / webhook / healthz).
- `src/rooms/RoomService.ts` → room lifecycle + sessions; holds the signed delegation for later redemption. `src/rooms/caveats.ts` → server-side caveat-sanity guard (defense in depth complementing on-chain enforcers).
- `src/lifecycles/move.ts` → `handleMove`: redeems the **gameplay** delegation through the relayer. `src/lifecycles/charge.ts` → `handleCharge`: issues a 402, redeems the **budget** delegation as a USDC transfer. `src/lifecycles/webhook.ts` → verifies HMAC, dedupes, confirms charge settlement on-chain, emits `StatusEvent`.
- `src/indexer/` → `InMemoryIndexer` (default) + `nexus-indexer.ts` (documented Postgres/WS seam).
- `src/pots/PotService.ts` → smart-account escrow; settles via delegation redemption (no custodial transfer).

### packages/server — x402 monetization middleware + facilitator
- `src/monetize.ts` → `createMonetizeHandler`: framework-agnostic x402 gate (issues 402 challenges, verifies redemptions, maps errors to HTTP status). `src/adapters/{express,hono}.ts` wrap it.
- `src/facilitator/delegation-facilitator.ts` → default facilitator: verifies redemptions on Mantle via receipt reading, with nonce replay protection + finality depth.

### packages/secrets — sealed secret state (Lit Protocol)
- `src/lit.ts` → `LitSecrets` (default, network-gated): threshold `seal` / conditional `reveal` / TEE `verify`. Credentials live backend-only. `src/conditions/lit.ts` maps the chain key to Lit's chain slug.
- `src/actions/verifyMove.lit.js` → the Lit Action source that runs in the node TEE.
- `src/local.ts` → `LocalSecrets`: offline AES-256-GCM adapter for dev/tests.
- `src/index.ts` → port + adapters + policy registry + move-rule codec.

### packages/react — live game-state hooks
- `src/provider/NexusProvider.tsx` → root provider; owns one `SubscriptionManager` (transport seam to the gateway feed).
- `src/hooks/` → `useTable`, `useTurn`, `useGameActions`, `useCharge`, `usePot`, `useSession`. `src/optimistic/` → optimistic-UI store + reconcile (on-chain truth wins).

### packages/cli — scaffold, codegen, deploy, devnet
- `src/cli.ts` → `nexus` CLI: `init`, `codegen`, `deploy`, `dev`, `migrate`, `fork` (in `src/commands/`).

### web/ — the Next.js app (site + docs + reference games)
See [`web/AGENTS.md`](web/AGENTS.md) for the full map. In short: games live under
`web/lib/<game>/` (server authority + rules + signing) with Next.js route handlers
at `web/app/api/<game>/*` and UIs at `web/app/play/<game>/page.tsx`, all booted
from `web/instrumentation.ts` and registered in `web/lib/games.ts`.

> ⚠️ The per-game **Solidity system contracts** (`UnoGameSystem`, `MonopolyGameSystem`,
> their pots) are **not in this repo** — only the shared Nexus stack +
> reference `CounterGameSystem` is. In `web/lib/<game>/deployments/mantle-sepolia.json`
> the `unoGame`/`monopolyGame` addresses are therefore `0x0` until those contracts
> are deployed and pasted in.

## End-to-end data flow (one signature → gasless moves + x402)

Using UNO (`web/lib/uno`) as the worked example:

1. **Define the game.** `web/lib/uno/game.ts` is a `defineGame(...)` definition (`packages/core/src/schema/defineGame.ts`); `packages/core/src/codegen/solidity.ts` emits the table library and the World/systems are deployed (addresses in `web/lib/uno/deployments/mantle-sepolia.json`).

2. **Connect a wallet.** `web/lib/uno/signer.ts:connectMetaMask` / `connectGuest` yields a signer (a MetaMask Hybrid DeleGator smart account, or a guest viem account). The shared site wallet is `web/lib/wallet.ts:useWallet`.

3. **Sign ONE delegation (gameplay ⊕ budget).** The player signs a single EIP-712 `GameDelegation`. Caveat groups are compiled by `packages/core/src/delegation/engine.ts:buildGameplayCaveats` (turn-bound, system-allowlisted, call-limited) and `buildBudgetCaveats` (per-action + lifetime spend cap, recipient allowlist), and signed by `signDelegation` (schema: `packages/core/src/delegation/eip712.ts`). In UNO, `web/lib/uno/delegations.ts:signGameplayDelegation` / `signBudgetDelegation` drive this.

4. **Join the room.** The signed delegation is persisted server-side (`web/lib/uno/game-backend.ts`; SDK equivalent `packages/backend/src/rooms/RoomService.ts:joinRoom` after `rooms/caveats.ts:validateCaveats`). **No further wallet prompt for the rest of the game.**

5. **Gasless move.** Browser/bot POSTs the pre-signed gameplay delegation to `web/app/api/uno/move/route.ts` → `web/lib/uno/game-backend.ts:move` (rules-validated by `web/lib/uno/uno-game.ts`) → `web/lib/uno/engine.ts:redeemMove`. The redemption calldata is built by `packages/core/src/delegation/engine.ts:buildMoveExecution` + `buildRedeemCalldata` and submitted through the relayer (`packages/relayer/src/direct.ts:DirectRelayer.submitBundle`, via the `RelayerAdapter` port). SDK equivalent: `packages/backend/src/lifecycles/move.ts:handleMove`.

6. **On-chain redemption.** `packages/contracts/src/delegation/NexusDelegationManager.sol:redeemDelegations` verifies the EIP-712 signature (ECDSA + ERC-1271), runs each caveat's `beforeHook` (`TurnBoundEnforcer`, `LimitedCallsEnforcer`, …), executes into `World.sol:call` with the ERC-2771 player append, runs `afterHook`s. `World` routes to the system, which recovers the true player via `System.sol:_msgSender`. Enforcer rejections surface as typed `NexusError`s (`NOT_YOUR_TURN`, `BUDGET_EXCEEDED`).

7. **x402 charge (entry fee).** Player POSTs to `web/app/api/uno/charge/route.ts` → `web/lib/uno/game-backend.ts:charge` → `web/lib/uno/engine.ts:chargeEntryFee`, redeeming the **budget** caveat group as `USDC.transferFrom(player → Pot)` (`buildChargeFromExecution`), bounded by the on-chain `ERC20TransferAmountEnforcer` cap and recipient allowlist. SDK equivalent: `packages/backend/src/lifecycles/charge.ts:handleCharge`. Verification: `packages/server/src/facilitator/delegation-facilitator.ts`.

8. **Settlement.** On win, `web/lib/uno/engine.ts:settlePot` (or `packages/backend/src/pots/PotService.ts:settlePot`) calls `Pot.settle` (`packages/contracts/src/Pot.sol`), paying the winner the pot balance − rake, authority-gated and admin-keyless.

9. **Status + UI.** Relayer status arrives via HMAC-verified webhooks (`packages/backend/src/lifecycles/webhook.ts`) → internal `StatusEvent` → resolves the pending move/charge promise and reconciles the indexer. React hooks (`packages/react/src/hooks/*`) apply optimistic updates and reconcile on the webhook — optimistic UI, on-chain truth. Tx hashes render through `web/components/linkifyTx.tsx` (Mantlescan).

## The two wallet rails (in the web games)

Both rails redeem a delegation to move USDC; they differ in **which manager**
verifies and **how the player authorizes**.

- **(a) Custom NexusDelegationManager rail.** The player signs Nexus's raw EIP-712 `GameDelegation`. Redemption goes through `packages/contracts/src/delegation/NexusDelegationManager.sol:redeemDelegations`, which verifies the signature with `SignatureChecker` (ECDSA for EOAs, **ERC-1271** for smart accounts). Signing: `web/lib/uno/delegations.ts`; caveats from `packages/core/src/delegation/engine.ts`. Carries both gameplay moves and the budget/x402 charge for guest wallets.

- **(b) ERC-7715 intuitive-grant rail.** The player approves a spend through MetaMask's **native** permission popup (`web/lib/uno/erc7715.ts:connectMetaMaskGrant`, an `erc20-token-periodic` grant). The granted `context` is POSTed to `web/app/api/uno/grant/route.ts` (`storeGrant`) and later redeemed server-side via the **canonical MetaMask DelegationManager** in `web/lib/uno/erc7715-settle.ts:chargeViaGrant`. Selected at `/api/uno/charge` with `{ grant: true }`. (Monopoly mirrors this under `web/lib/monopoly/` + `web/app/api/monopoly/*`.)

## How to run

```bash
# Build + test the SDK (from repo root)
pnpm install
pnpm build           # turbo run build
pnpm test            # turbo run test (vitest)
pnpm typecheck

# Solidity (Foundry) — in packages/contracts
pnpm --filter @nexus/contracts setup         # one-time: forge install deps
PATH=$HOME/.foundry/bin:$PATH forge test
PATH=$HOME/.foundry/bin:$PATH forge build

# The web app (site + games), against Mantle Sepolia
pnpm --filter @steamlink/web dev             # next dev on :3000

# Live zero-mock integration against a local anvil chain (what CI runs)
pnpm --filter @nexus/scripts exec tsx live/local-integration.ts
```

## Deployments (Mantle Sepolia · chain 5003)

Committed source of truth: the per-game `web/lib/<game>/deployments/mantle-sepolia.json`
(tracked in git). `packages/contracts/deployments/5003.json` is the **regenerated
deploy artifact** written by `DeployFull` and is **gitignored** (not in a fresh
clone). Explorer [sepolia.mantlescan.xyz](https://sepolia.mantlescan.xyz), RPC
`https://rpc.sepolia.mantle.xyz`.

| Contract | Address |
|---|---|
| World | `0x561f9370EBf532b8f6002B07a501C820b7f16659` |
| NexusDelegationManager | `0xD716d600a63bf08100b2544935AD6D020f0F1Eaf` |
| TurnManager | `0xc8856f9eD594461f50BB673AD5B2933AEc9882e9` |
| Pot | `0x253B95Bc8f2c799449639AfF0858b4c0E9f0416f` |
| RandomnessCoordinator | `0x56a9ABe6AA0F575ccB36f5DE3F1f9f9c3F8E94CC` |
| TestUSDC (budget token, 6dp) | `0x189BdF9e9e4FfE4AC0e8eD0479b158843Bcd0cde` |
| relayer EOA | `0xA3327d90d087cdddfB99E598E50B5Bdee7fC55bD` |

The seven enforcers are in the deployment JSONs. `unoGame`/`monopolyGame` are
`0x0` — their Solidity source is not in this repo (see the web/ caveat above).

## For reviewers

- **Security-critical code.**
  - `packages/contracts/src/delegation/NexusDelegationManager.sol` — signature verification (ECDSA + ERC-1271 via `SignatureChecker`), caveat before/after hook ordering, the ERC-2771 sender append, and the non-zero-value guard. Hardening tests: `packages/contracts/test/{NexusDelegationManager,ManagerHardening,SenderSpoofing,MsgSenderResolution}.t.sol`.
  - `packages/contracts/src/enforcers/*` — the on-chain authorization boundary (turn gating, per-action + lifetime spend caps, recipient/system allowlists, `_requireNoValue`). Tests: `test/{Enforcers,BudgetEnforcers}.t.sol`.
  - `packages/contracts/src/system/System.sol:_msgSender` — player attribution; systems must never trust raw `msg.sender`.
  - `packages/backend/src/rooms/caveats.ts` — server-side defense in depth before a delegation is ever stored.

- **Relayer key boundary.** The relayer / signing key lives **only in the backend** — `packages/relayer/src/direct.ts` (funded EOA), and the web game `web/lib/<game>/config.ts` + `engine.ts` + `erc7715-settle.ts` (all server-only). The browser holds **only** the player's signer; it never sees the relayer key, Lit credentials, or the Pot authority. Browser-safe signing is isolated in `web/lib/<game>/delegations.ts`.
  > ⚠️ `web/lib/uno/config.ts` carries a **hardcoded testnet relayer key** (project-owner demo key, Mantle-Sepolia funds only). Never reuse it for real funds.

- **On-chain invariants.**
  - **Mantle only** — the chain key is `"mantle-sepolia"` / `"mantle"` (`packages/types/src/chain.ts`); no other network abstraction.
  - **One delegation per player per room** — a single EIP-712 grant carries both the gameplay and budget caveat groups; no flow re-prompts mid-game.
  - **Capabilities are the source of truth** — payment/fee tokens and the relayer `targetAddress` come from `relayer_getCapabilities` and are cached; a `targetAddress` mismatch is rejected before a bundle is submitted. Tokens are never hardcoded in the hot path.
  - **Webhooks drive the hot path** — status comes from HMAC-verified relayer webhooks → internal `StatusEvent`; chain polling is a silent fallback only.
  - **Everything is an adapter** — relayer, secrets, indexer, facilitator, randomness each sit behind a TypeScript port with a default impl.
  - **Optimistic UI, on-chain truth** — apply optimistic updates, reconcile on the webhook; enforcer rejections surface as typed `NexusError`s.
  - **Pot settlement is admin-keyless** — only the registered settle authority may pay out; payout is the pot balance minus rake.

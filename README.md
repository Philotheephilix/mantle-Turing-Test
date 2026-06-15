# SteamLink

[![Docs](https://img.shields.io/badge/Docs-steamlink.vercel.app%2Fdocs-e4572e?logo=readthedocs&logoColor=white&style=for-the-badge)](https://steamlink.vercel.app/docs)
[![Mantle Sepolia](https://img.shields.io/badge/Mantle-Sepolia%C2%B75003-0052ff?style=for-the-badge)](https://sepolia.mantlescan.xyz)
[![npm @steamlink/core](https://img.shields.io/npm/v/@steamlink/core?label=%40steamlink%2Fcore&style=for-the-badge&color=cb3837&logo=npm)](https://www.npmjs.com/package/@steamlink/core)

**Fully onchain, turn-based games on Mantle — one signature, then every move is gasless and every
payment is bounded on-chain.** SteamLink is a game-engine SDK (engine name: *Nexus*). A player signs
**one** ERC-7710 delegation when they join a room; a relayer redeems that single signature for
everything after — gasless moves (no wallet popups) and x402 stablecoin payments capped on-chain by
caveats. You describe a game as **data** (tables) and **logic** (Solidity systems); the SDK handles
the cryptography, relaying, randomness, sealed state, and settlement.

Live on Mantle Sepolia with real transactions; the architecture is mainnet-ready.

---

## What you get

- **One delegation → infinite gasless moves.** The player signs once at join. The relayer submits
  every `redeemDelegations` call and pays gas; the player pays zero gas and signs nothing again.
- **x402 payments with on-chain guardrails.** Entry fees and in-game charges are real USDC transfers
  bounded by the delegation's per-action + lifetime caps — the relayer can never overspend a player.
- **Typed end to end.** A misspelled table fails at compile time; game logic is real Solidity, never
  interpreted in JS.
- **Two wallet rails.** A built-in session/embedded wallet (zero setup), or a real **MetaMask Smart
  Account** that authorizes spend through MetaMask's native ERC-7715 permission popup.
- **Provable + private.** Onchain randomness for shuffles/dice; sealed hidden state (hands,
  fog-of-war) revealed only to its owner.

## Packages

Install only what you need. Every package is published on npm:

| Package | Purpose |
|---|---|
| [@steamlink/core](https://www.npmjs.com/package/@steamlink/core) | `defineGame`, the single-delegation engine, randomness, codegen |
| [@steamlink/react](https://www.npmjs.com/package/@steamlink/react) | React hooks for live game state, moves, and charges |
| [@steamlink/server](https://www.npmjs.com/package/@steamlink/server) | x402 payment middleware (`monetize`) for your endpoints |
| [@steamlink/relayer](https://www.npmjs.com/package/@steamlink/relayer) | Gasless redemption client (capabilities, bundles, webhooks) |
| [@steamlink/secrets](https://www.npmjs.com/package/@steamlink/secrets) | Sealed secret state (hidden hands / fog-of-war) |
| [@steamlink/cli](https://www.npmjs.com/package/@steamlink/cli) | Scaffold, codegen, deploy, migrate, local devnet |
| [@steamlink/types](https://www.npmjs.com/package/@steamlink/types) | Shared branded types + the canonical error taxonomy |

```bash
npm install @steamlink/core @steamlink/react @steamlink/server
```

## How it works in one example — `define`, `move`, `monetize`

```ts
// 1) DEFINE — your game is data (tables) + logic (Solidity systems).
import { defineGame, t } from "@steamlink/core";

export const game = defineGame({
  name: "tic-tac-toe",
  tables: {
    Board: { roomId: t.uint256, cells: t.bytes, turn: t.address },
  },
  systems: {
    PlayMove: "src/systems/PlayMove.sol", // real Solidity — never interpreted in JS
  },
  economy: {
    entryFee: { amount: "1.00", token: "USDC" },
    pot: { type: "winner-take-all", rake: "0.05" },
  },
});
```

```tsx
// 2) MOVE — the player signs ONE delegation at join; every move after is gasless,
//    no popup. `move` redeems that delegation through the relayer, applies an
//    optimistic update, and reconciles on the on-chain result.
import { useGameActions, useTable } from "@steamlink/react";

function PlayMoveButton({ roomId, cell }: { roomId: bigint; cell: number }) {
  const { move, isPending } = useGameActions();
  const { data: board } = useTable("Board", { roomId }); // live, optimistic
  return (
    <button
      disabled={isPending}
      onClick={() => move("PlayMove", { roomId, cell })} // gasless redemption
    >
      Play cell {cell}
    </button>
  );
}
```

```ts
// 3) MONETIZE — put an x402 paywall on any endpoint. The charge settles as a real
//    USDC transfer to your Pot, bounded by the player's budget caveats — no popup,
//    no gas for the player.
import express from "express";
import { monetize } from "@steamlink/server";

const app = express();
app.post(
  "/api/premium-hint",
  monetize({ price: "0.10", token: "USDC", chain: "mantle", recipient: POT_ADDRESS, facilitator: "nexus" }),
  (req, res) => res.json({ hint: "play the center", settlement: req.settlement }),
);
```

That's the whole surface: **`defineGame`** declares the game, **`move`** redeems the single
delegation for a gasless action, **`monetize`** charges bounded USDC over x402.

## Live deployments (Mantle Sepolia · chain 5003)

The shared Nexus stack is **live on Mantle Sepolia** (explorer
[sepolia.mantlescan.xyz](https://sepolia.mantlescan.xyz), RPC `https://rpc.sepolia.mantle.xyz`).
Click any address to open it on Mantlescan.

| Contract | Address |
|---|---|
| World | [0x561f…6659](https://sepolia.mantlescan.xyz/address/0x561f9370EBf532b8f6002B07a501C820b7f16659) |
| NexusDelegationManager | [0xD716…1Eaf](https://sepolia.mantlescan.xyz/address/0xD716d600a63bf08100b2544935AD6D020f0F1Eaf) |
| TurnManager | [0xc885…82e9](https://sepolia.mantlescan.xyz/address/0xc8856f9eD594461f50BB673AD5B2933AEc9882e9) |
| Pot | [0x253B…416f](https://sepolia.mantlescan.xyz/address/0x253B95Bc8f2c799449639AfF0858b4c0E9f0416f) |
| RandomnessCoordinator | [0x56a9…94CC](https://sepolia.mantlescan.xyz/address/0x56a9ABe6AA0F575ccB36f5DE3F1f9f9c3F8E94CC) |
| TestUSDC (budget token, 6dp) | [0x189B…0cde](https://sepolia.mantlescan.xyz/address/0x189BdF9e9e4FfE4AC0e8eD0479b158843Bcd0cde) |

The seven caveat enforcers (turn-bound, system-allowlist, timestamp, limited-calls, per-action cap,
ERC-20 transfer-amount, allowed-recipients) are recorded in
`web/lib/<game>/deployments/mantle-sepolia.json`. The relayer EOA is
[0xA332…55bD](https://sepolia.mantlescan.xyz/address/0xA3327d90d087cdddfB99E598E50B5Bdee7fC55bD).

> Mantle Sepolia has no canonical Circle USDC, so the stack deploys its own 6-decimals **TestUSDC**
> as the budget/charge token. The per-game system contracts (`unoGame` / `monopolyGame`) are not in
> this repo; deploy them and paste the address into the matching `deployments/mantle-sepolia.json`.

To (re)deploy the core stack to Mantle Sepolia:

```bash
cd packages/contracts && pnpm setup              # one-time: forge install deps
PLAYER=0xA3327d90d087cdddfB99E598E50B5Bdee7fC55bD ROOM_ID=1 \
  forge script script/DeployFull.s.sol:DeployFull \
  --rpc-url https://rpc.sepolia.mantle.xyz --private-key $PRIVATE_KEY \
  --broadcast --legacy --gas-estimate-multiplier 200 --slow   # writes deployments/5003.json
```

## Run a reference game locally

```bash
pnpm install
pnpm --filter @nexus/example-uno dev   # http://localhost:3100 — boots the game + bots, plays itself
```

Open the URL, connect a wallet, and play. The app auto-seats a table against bots; you sign one
delegation and every move + payment settles on-chain, gaslessly.

## Documentation

Full docs — the **SDK reference** (every `@steamlink/*` module and method) and the **Contribute a
game** guide — live at **[steamlink.vercel.app/docs](https://steamlink.vercel.app/docs)**.

## Contributing — add a game

Want a new game on the shelf, like UNO or Monopoly? The complete, step-by-step walkthrough is the
**Contribute a game** tab in the docs:

**→ [steamlink.vercel.app/docs](https://steamlink.vercel.app/docs)**

The short version:

1. **Fork & branch** — fork this repo, `git checkout -b feat/<your-game>`.
2. **Define** — `defineGame(...)` your tables + Solidity system paths in `web/lib/<game>/game.ts`.
3. **Write systems** — real Solidity under `packages/contracts/src/systems/`; `forge test` them.
4. **Deploy** — deploy the World + systems to Mantle Sepolia; record addresses in
   `web/lib/<game>/deployments/mantle-sepolia.json`.
5. **Wire the backend** — namespaced handlers in `web/app/api/<game>/*`, booted from
   `web/instrumentation.ts`.
6. **Add the UI** — `web/app/play/<game>/page.tsx` on the shared `useWallet()` provider, with every
   tx hash rendered through `linkifyTx`.
7. **Register** — add a `GameEntry` to `GAMES` in `web/lib/games.ts` with `status: "live"`.
8. **Verify** — `forge test` · `pnpm -r test` · `pnpm --filter @steamlink/web build` must all pass.

### Open a pull request

Push your branch and open a PR against `main`:

```bash
git push origin feat/<your-game>
gh pr create --base main --title "feat: add <Your Game>" \
  --body "New in-tree game. Deployed to Mantle Sepolia. One delegation, gasless moves, x402 entry."
```

Or from the compare view:
**[github.com/Philotheephilix/SteamLink/compare](https://github.com/Philotheephilix/SteamLink/compare)**.
Describe the game, link the deployed contract addresses, and confirm the PR checklist in the docs.
**Never commit funded keys or `.env.local`** — they're gitignored, and a committed key is an automatic
rejection.

## License

MIT.
</content>

# @nexus/backend

The composable server side of the Nexus game engine: the **Gateway** (REST + WS),
the **Room/Session service** (lifecycle, caveat sanity, pots), and the **Indexer**
(World Store events → queryable tables → WS fan-out). Everything sits behind a port
with a default adapter (backend spec §2). Phases 05 + 06.

## Composition root

```ts
import { createBackend, createGatewayApp, rateLimit } from "@nexus/backend";
import { DirectRelayer } from "@nexus/relayer";
import uno from "./games/uno";

const backend = createBackend({
  chain: "mantle",
  world: process.env.WORLD_ADDRESS,
  relayer: new DirectRelayer({ ... }),   // OneShotRelayer in prod
  games: [uno],                          // auto-mounted at /game/uno
  // indexer, facilitator, sessionStore → defaults
});
backend.use(rateLimit({ perRoom: 50 }));
await backend.start();                    // resolves capabilities, starts indexer

const app = createGatewayApp(backend);    // Hono app — mount or `serve` it
```

## Routes (backend spec §4.1 — exhaustive)

| Method | Path | Routes to |
|---|---|---|
| POST | `/game/:name/join` | `RoomService.joinRoom` (validates caveats) |
| POST | `/game/:name/move` | move lifecycle → `Relayer.submitBundle` |
| POST | `/game/:name/charge` | charge lifecycle → `Facilitator` + `Relayer` |
| GET | `/game/:name/state/:table` | `IndexerAdapter.query` |
| WS | `/game/:name/subscribe` | `IndexerAdapter.subscribe` (WsHub fan-out) |
| POST | `/nexus/webhook` | `WebhookHandler.ingest` (1Shot status) |
| GET | `/healthz` `/readyz` | ops |

## Adapters (ports + defaults)

- `RelayerAdapter` (from `@nexus/relayer`) — **required**, injected.
- `FacilitatorAdapter` (from `@nexus/server`) — default `StubFacilitator`;
  Phase 07 swaps in `DelegationFacilitator` with **zero gateway diff**.
- `IndexerAdapter` — default `InMemoryIndexer`; `NexusIndexer` (Postgres + WS) is a
  documented seam (see `indexer/nexus-indexer.ts`).
- `SessionStore` — default `MemorySessionStore`; Redis store documented in
  `rooms/store.ts`.
- Middleware — `backend.use(mw)`, run in registration order, sees every request and
  every redemption.

## Documented seams

- **`NexusIndexer`** (Postgres + WS, reorg/finality/backfill/reconcile) — phase-06.
- **`RedisSessionStore`** + **Redis webhook ledger** — shapes documented inline.
- **EIP-1271 smart-account auth** — `verifyRequest({ verify1271 })` hook for deployed
  contract wallets (EIP-191 personal_sign verified by default).

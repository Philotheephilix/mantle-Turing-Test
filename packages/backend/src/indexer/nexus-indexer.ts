import type {
  IndexerAdapter,
  IndexerConfig,
  Row,
  RowChange,
  Unsubscribe,
  Where,
} from "../ports/indexer.js";

/**
 * `NexusIndexer` — the production indexer seam (backend spec §4.6, phase-06).
 *
 * This is a DOCUMENTED SEAM, not a finished implementation. The full Postgres +
 * WebSocket indexer (phase-06 deliverables §3) lives behind the same
 * `IndexerAdapter` port as `InMemoryIndexer`, so the composition root swaps one
 * for the other with zero gateway change. What the real implementation adds over
 * the in-memory default:
 *
 *  - `ddl.ts`      — `defineGame` table schema → `CREATE TABLE` + secondary indexes
 *                    (`game_<game>_<table>`, PK from leading key fields,
 *                    `numeric(78,0)` for uint256, `__block/__log_index/__removed`).
 *  - `subscriber.ts` — viem log subscription filtered to `address = world` and the
 *                    two Store topics, with `finalized`-tag finality + reorg revert.
 *  - `checkpoint.ts` — `{ headBlock, headHash, finalizedBlock }` persisted per game.
 *  - `backfill.ts`  — cold-start catch-up from the World deploy block in paged
 *                    `eth_getLogs` ranges; `readyz=false` until within N of head.
 *  - `reconcile.ts` — joins the webhook `StatusEvent` stream to indexed `RowChange`s
 *                    and emits `confirm`/`reverted` frames (the optimistic-update
 *                    contract the SDK + React hooks consume).
 *  - `ws-hub.ts`    — `roomId → Set<WebSocket>` registry; room-scoped fan-out backed
 *                    by a shared pub/sub (Redis) so any gateway instance can push.
 *
 * The decode logic (`decode.ts`) and the projection/query semantics are SHARED
 * with `InMemoryIndexer` — only persistence, finality, and transport differ. Until
 * this is filled in, constructing it throws so misconfiguration fails loudly
 * rather than silently degrading; dev/test use `InMemoryIndexer`.
 */
export interface NexusIndexerConfig {
  /** Postgres connection string. */
  databaseUrl: string;
  /** Base RPC websocket URL — used by the subscriber/backfill only, never on the read path. */
  rpcUrl: string;
  /** World deploy block — the backfill floor. */
  deployBlock: number;
}

export class NexusIndexer implements IndexerAdapter {
  constructor(_cfg: NexusIndexerConfig) {
    throw new Error(
      "NexusIndexer (Postgres + WS) is a documented seam in phase-05; use InMemoryIndexer until phase-06 lands its implementation.",
    );
  }
  // The methods below are unreachable (constructor throws); they pin the port shape.
  async query(_table: string, _where: Where): Promise<Row[]> {
    return [];
  }
  subscribe(_t: string, _w: Where, _cb: (c: RowChange) => void): Unsubscribe {
    return () => {};
  }
  async start(_cfg: IndexerConfig): Promise<void> {}
  async stop(): Promise<void> {}
}

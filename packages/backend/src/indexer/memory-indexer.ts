import type { Hex } from "@nexus/types";
import type {
  IndexerAdapter,
  IndexerConfig,
  IndexerTableSchema,
  Row,
  RowChange,
  RowKey,
  Unsubscribe,
  Where,
} from "../ports/indexer.js";
import { type RawLog, buildTableRegistry, decodeStoreLog } from "./decode.js";

interface Subscription {
  table: string;
  where: Where;
  cb: (change: RowChange) => void;
}

/**
 * The zero-credential default indexer (backend spec §4.6, phase-06 §4.9). It
 * ingests decoded World Store events and projects them into in-memory per-table
 * rows, derived from the mounted `defineGame` schemas, with WS fan-out via
 * `subscribe`. Swap for `NexusIndexer` (Postgres + WS) in production — same port.
 *
 * Read path is independent of chain RPC: `query` only ever hits these Maps.
 */
export class InMemoryIndexer implements IndexerAdapter {
  /** table -> (rowKeyString -> Row) */
  private readonly tables = new Map<string, Map<string, Row>>();
  /** tableId -> resolved game/schema, built at start. */
  private registry = new Map<Hex, { game: string; schema: IndexerTableSchema }>();
  private readonly subs = new Set<Subscription>();
  private started = false;

  async start(cfg: IndexerConfig): Promise<void> {
    this.registry = buildTableRegistry(cfg.games);
    for (const game of cfg.games) {
      for (const schema of game.tables) {
        if (!this.tables.has(schema.table)) this.tables.set(schema.table, new Map());
      }
    }
    this.started = true;
  }

  async stop(): Promise<void> {
    this.subs.clear();
    this.started = false;
  }

  /**
   * Ingest a raw World Store log. Decodes against the mounted schemas, applies
   * the projection, and fans the change out to matching subscribers. Idempotent
   * on `(table, key)` for `set` (last write wins) — the caller dedupes by log id.
   */
  ingestLog(log: RawLog): RowChange | null {
    const change = decodeStoreLog(log, this.registry);
    if (!change) return null;
    this.apply(change);
    return change;
  }

  /** Apply a pre-decoded change (used by tests and by `ingestLog`). */
  apply(change: RowChange): void {
    const tbl = this.tables.get(change.table) ?? new Map<string, Row>();
    this.tables.set(change.table, tbl);
    const ks = keyString(change.key);
    if (change.type === "delete") {
      tbl.delete(ks);
    } else {
      tbl.set(ks, change.row);
    }
    for (const s of this.subs) {
      if (s.table === change.table && matchesKey(s.where, change.key)) s.cb(change);
    }
  }

  async query(table: string, where: Where): Promise<Row[]> {
    const tbl = this.tables.get(table);
    if (!tbl) return [];
    const out: Row[] = [];
    for (const row of tbl.values()) {
      if (matchesRow(where, row)) out.push(row);
    }
    return out;
  }

  subscribe(table: string, where: Where, cb: (change: RowChange) => void): Unsubscribe {
    const sub: Subscription = { table, where, cb };
    this.subs.add(sub);
    return () => {
      this.subs.delete(sub);
    };
  }

  /** Whether `start()` has run (used by `/readyz`). */
  get ready(): boolean {
    return this.started;
  }
}

function keyString(key: RowKey): string {
  return Object.keys(key)
    .sort()
    .map((k) => `${k}=${stringify(key[k])}`)
    .join("&");
}

function stringify(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return v.toLowerCase();
  return String(v);
}

function matchesKey(where: Where, key: RowKey): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k in key && stringify(key[k]) !== stringify(v)) return false;
  }
  return true;
}

function matchesRow(where: Where, row: Row): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (stringify(row[k]) !== stringify(v)) return false;
  }
  return true;
}

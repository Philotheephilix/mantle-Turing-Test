import type { Hex } from "@nexus/types";

/**
 * The `IndexerAdapter` port (backend spec §2.1 / §4.6). Reads projected rows and
 * pushes live changes. The default `InMemoryIndexer` ingests decoded World Store
 * events and projects them into per-table rows; `NexusIndexer` (Postgres + WS) is
 * the production swap — see `docs` in `indexer/nexus-indexer.ts`.
 */
export interface IndexerAdapter {
  /** Read projected rows. `where` is an AND-of-equality filter over fields. */
  query(table: string, where: Where): Promise<Row[]>;
  /** Live push: fires `cb` on every committed change to a matching row. */
  subscribe(table: string, where: Where, cb: (change: RowChange) => void): Unsubscribe;
  /** Lifecycle — called by the backend, not by game code. */
  start(cfg: IndexerConfig): Promise<void>;
  stop(): Promise<void>;
}

export type Where = Record<string, string | number | boolean | bigint | Hex>;

/** A projected row plus its provenance (which event last wrote it). */
export type Row = Record<string, unknown> & { __block: number; __logIndex: number };

export type RowKey = Record<string, string | number | bigint | boolean | Hex>;

export type RowChange =
  | { type: "set"; table: string; key: RowKey; row: Row }
  | { type: "delete"; table: string; key: RowKey };

export type Unsubscribe = () => void;

/** A game schema as the indexer needs it: table -> ordered field descriptors. */
export interface IndexerGameSchema {
  /** `defineGame` name; tables are keyed `game_<name>_<table>` downstream. */
  name: string;
  tables: IndexerTableSchema[];
}

export interface IndexerTableSchema {
  /** Table name as declared in `defineGame`. */
  table: string;
  /** bytes32 table id = `resourceId(game, "table", table)` — the on-chain tableId. */
  tableId: Hex;
  /** The first field is the primary key (PK derivation, phase-06 §4.2). */
  fields: IndexerField[];
}

export interface IndexerField {
  name: string;
  /** abi type, e.g. "address", "uint256", "bool", "bytes32", "string". */
  abiType: string;
  /** True when this field is part of the key tuple (leading fields). */
  key: boolean;
}

export interface IndexerConfig {
  chain: "mantle";
  world: Hex;
  games: IndexerGameSchema[];
}

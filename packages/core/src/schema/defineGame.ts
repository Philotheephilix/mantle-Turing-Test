/**
 * `defineGame` — the single source of truth for a Nexus game. A developer
 * describes the game as data (ECS `tables`), logic (`systems`, Solidity sources),
 * and monetization (`economy`); everything else is derived from this object.
 * The codegen (../codegen) emits the Solidity table library and the TS client
 * types from it, and the React hooks bind to the same table names — so a
 * misspelled table fails at compile time. Validation here is eager (throws on an
 * invalid definition at load), making it the first gate in the build pipeline.
 */
import type { TableSchema } from "./types.js";

/** Economy config for a game (entry fee + pot rules). */
export interface EconomyConfig {
  entryFee?: { amount: string; token: "USDC" };
  pot?: { type: "winner-take-all" | "split"; rake: string };
}

/**
 * A game definition. `tables` is the onchain state schema, `systems` maps a
 * system name to its Solidity source path, `economy` configures monetization.
 * This object is the single source of truth: codegen derives Solidity table
 * libraries + a deploy manifest, and a typed client + React hooks.
 */
export interface GameDefinition<
  TTables extends Record<string, TableSchema> = Record<string, TableSchema>,
  TSystems extends Record<string, string> = Record<string, string>,
> {
  name: string;
  tables: TTables;
  systems: TSystems;
  economy?: EconomyConfig;
}

// The name becomes a filesystem/identifier slug across the pipeline (generated
// Solidity library names, deploy-manifest keys, client table namespaces), so it is
// constrained to lower kebab/snake starting with a letter — anything else could
// produce an invalid Solidity identifier or collide once slugged downstream.
const NAME_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * Define a game. Validates the schema eagerly so misconfiguration fails at
 * call time (and, via the type parameters, at compile time).
 */
export function defineGame<
  const TTables extends Record<string, TableSchema>,
  const TSystems extends Record<string, string>,
>(def: {
  name: string;
  tables: TTables;
  systems: TSystems;
  economy?: EconomyConfig;
}): GameDefinition<TTables, TSystems> {
  // Invariant 1: a slug-safe name (see NAME_RE) — everything downstream keys off it.
  if (!NAME_RE.test(def.name)) {
    throw new TypeError(
      `defineGame: name "${def.name}" must be lower-kebab/snake starting with a letter`,
    );
  }
  // Invariant 2: at least one table. The whole engine is ECS-shaped; codegen emits a
  // Solidity table library per entry, so a game with no onchain state can't deploy.
  if (Object.keys(def.tables).length === 0) {
    throw new TypeError(`defineGame(${def.name}): at least one table is required`);
  }
  // Invariant 3: every table has ≥1 field. An empty schema would generate a degenerate
  // table struct/library with no columns, which is meaningless and breaks codegen.
  for (const [table, schema] of Object.entries(def.tables)) {
    if (Object.keys(schema).length === 0) {
      throw new TypeError(`defineGame(${def.name}): table "${table}" has no fields`);
    }
  }
  // Invariant 4: a rake is a fraction of the pot kept by the house, so it must be in
  // [0,1). >=1 would take the entire (or more than the) pot leaving nothing to pay out;
  // <0 is nonsensical. Caught here so a bad economy config fails at definition load,
  // not at settlement time on-chain.
  if (def.economy?.pot) {
    const rake = Number(def.economy.pot.rake);
    if (!(rake >= 0 && rake < 1)) {
      throw new TypeError(
        `defineGame(${def.name}): pot.rake must be a fraction in [0,1), got "${def.economy.pot.rake}"`,
      );
    }
  }
  // Re-emit a normalized object (economy omitted when absent) as the single source of
  // truth the codegen, deploy manifest, typed client, and React hooks all derive from.
  return {
    name: def.name,
    tables: def.tables,
    systems: def.systems,
    ...(def.economy ? { economy: def.economy } : {}),
  };
}

/** Names of the systems declared in a game definition. */
export type SystemNames<G> = G extends GameDefinition<TableSchema_, infer S>
  ? Extract<keyof S, string>
  : never;
type TableSchema_ = Record<string, TableSchema>;

/** Names of the tables declared in a game definition. */
export type TableNames<G> = G extends GameDefinition<infer T, Record<string, string>>
  ? Extract<keyof T, string>
  : never;

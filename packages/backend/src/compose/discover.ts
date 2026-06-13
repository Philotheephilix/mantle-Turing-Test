import { resourceId } from "@nexus/core";
import { NexusError } from "@nexus/types";
import type { IndexerGameSchema } from "../ports/indexer.js";
import type { GameModule } from "../types.js";

/**
 * Game auto-discovery (phase-05 §4.4). Games passed as `defineGame` modules are
 * mounted at `/game/:name`. A name collision is a fatal config error. Each game's
 * tables become indexer schemas (no migration step in dev).
 */
export function indexGames(games: GameModule[]): Map<string, GameModule> {
  const map = new Map<string, GameModule>();
  for (const game of games) {
    if (map.has(game.name)) {
      throw new NexusError("INVALID_CONFIG", `duplicate game name "${game.name}"`);
    }
    map.set(game.name, game);
  }
  return map;
}

/**
 * Derive the indexer schema for a game from its `defineGame` tables. The first
 * declared field of each table is treated as the key (PK derivation, phase-06
 * §4.2); the on-chain tableId is `resourceId(game, "table", table)`.
 */
export function toIndexerSchema(game: GameModule): IndexerGameSchema {
  return {
    name: game.name,
    tables: Object.entries(game.tables).map(([table, schema]) => {
      const entries = Object.entries(schema);
      return {
        table,
        tableId: resourceId(game.name, "table", table),
        fields: entries.map(([name, ftype], i) => ({
          name,
          abiType: ftype.abiType,
          key: i === 0, // leading field is the key
        })),
      };
    }),
  };
}

export function allIndexerSchemas(games: Map<string, GameModule>): IndexerGameSchema[] {
  return [...games.values()].map(toIndexerSchema);
}

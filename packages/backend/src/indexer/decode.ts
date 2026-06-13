import type { Hex } from "@nexus/types";
import { type AbiEvent, decodeAbiParameters, decodeEventLog } from "viem";
import type { IndexerGameSchema, IndexerTableSchema, RowChange } from "../ports/indexer.js";

/**
 * The World's canonical Store events (from `packages/contracts/src/world/World.sol`):
 *
 *   event Store_SetRecord(bytes32 indexed tableId, bytes32[] keyTuple, bytes staticData, bytes dynamicData);
 *   event Store_DeleteRecord(bytes32 indexed tableId, bytes32[] keyTuple);
 *
 * These two families drive every projection. `decode.ts` is PURE (no DB, no
 * network) so it is unit-testable against fixture logs.
 */
export const STORE_SET_RECORD: AbiEvent = {
  type: "event",
  name: "Store_SetRecord",
  inputs: [
    { name: "tableId", type: "bytes32", indexed: true },
    { name: "keyTuple", type: "bytes32[]", indexed: false },
    { name: "staticData", type: "bytes", indexed: false },
    { name: "dynamicData", type: "bytes", indexed: false },
  ],
};

export const STORE_DELETE_RECORD: AbiEvent = {
  type: "event",
  name: "Store_DeleteRecord",
  inputs: [
    { name: "tableId", type: "bytes32", indexed: true },
    { name: "keyTuple", type: "bytes32[]", indexed: false },
  ],
};

export const STORE_EVENTS_ABI = [STORE_SET_RECORD, STORE_DELETE_RECORD] as const;

/** A raw EVM log as observed from the chain (subset of viem's `Log`). */
export interface RawLog {
  topics: [Hex, ...Hex[]] | Hex[];
  data: Hex;
  blockNumber: bigint | number;
  logIndex: number;
}

/** tableId -> (game, table schema) resolver, built once from the mounted games. */
export function buildTableRegistry(
  games: IndexerGameSchema[],
): Map<Hex, { game: string; schema: IndexerTableSchema }> {
  const registry = new Map<Hex, { game: string; schema: IndexerTableSchema }>();
  for (const game of games) {
    for (const schema of game.tables) {
      registry.set(schema.tableId.toLowerCase() as Hex, { game: game.name, schema });
    }
  }
  return registry;
}

/**
 * Decode one World Store log into a `RowChange`, or `null` if the tableId is not
 * one of the mounted game tables. Key fields decode from `keyTuple` (each a
 * left-/right-padded bytes32); value fields decode from `staticData` as a tight
 * ABI tuple in declared order.
 */
export function decodeStoreLog(
  log: RawLog,
  registry: Map<Hex, { game: string; schema: IndexerTableSchema }>,
): RowChange | null {
  let decoded: { eventName: string; args: Record<string, unknown> };
  try {
    decoded = decodeEventLog({
      abi: STORE_EVENTS_ABI,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
    }) as never;
  } catch {
    return null;
  }

  const tableId = (decoded.args.tableId as Hex).toLowerCase() as Hex;
  const entry = registry.get(tableId);
  if (!entry) return null;

  const { schema } = entry;
  const keyTuple = (decoded.args.keyTuple as Hex[]) ?? [];
  const keyFields = schema.fields.filter((f) => f.key);
  const valueFields = schema.fields.filter((f) => !f.key);

  const key: Record<string, string | number | bigint | boolean | Hex> = {};
  keyFields.forEach((f, i) => {
    const raw = keyTuple[i];
    key[f.name] = raw === undefined ? defaultForType(f.abiType) : decodeKeyWord(raw, f.abiType);
  });

  const __block = Number(log.blockNumber);
  const __logIndex = log.logIndex;

  if (decoded.eventName === "Store_DeleteRecord") {
    return { type: "delete", table: schema.table, key };
  }

  // Store_SetRecord — decode the value tuple from staticData.
  const staticData = (decoded.args.staticData as Hex) ?? "0x";
  const values =
    valueFields.length > 0 && staticData !== "0x"
      ? decodeAbiParameters(
          valueFields.map((f) => ({ name: f.name, type: f.abiType })),
          staticData,
        )
      : valueFields.map((f) => defaultForType(f.abiType));

  const row: Record<string, unknown> = { ...key, __block, __logIndex };
  valueFields.forEach((f, i) => {
    row[f.name] = normalize(values[i], f.abiType);
  });

  return { type: "set", table: schema.table, key, row: row as never };
}

/** Decode a single bytes32 key word into the field's JS shape. */
function decodeKeyWord(word: Hex, abiType: string): string | number | bigint | boolean | Hex {
  if (abiType === "address") {
    return `0x${word.slice(-40)}`.toLowerCase() as Hex;
  }
  if (abiType.startsWith("uint") || abiType.startsWith("int")) {
    return BigInt(word);
  }
  if (abiType === "bool") {
    return BigInt(word) !== 0n;
  }
  return word; // bytes32 / bytes / string keys stay hex
}

function defaultForType(abiType: string): string | number | bigint | boolean | Hex {
  if (abiType === "address") return "0x0000000000000000000000000000000000000000" as Hex;
  if (abiType === "bool") return false;
  if (abiType === "string") return "";
  if (abiType === "bytes32") return `0x${"00".repeat(32)}` as Hex;
  if (abiType === "bytes") return "0x" as Hex;
  if (abiType.startsWith("uint") || abiType.startsWith("int")) return 0n;
  return 0;
}

/** Normalize a viem-decoded value to the wire shape we project. */
function normalize(v: unknown, abiType: string): unknown {
  if (abiType === "address" && typeof v === "string") return v.toLowerCase();
  return v;
}

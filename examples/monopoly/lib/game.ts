/**
 * The Monopoly game definition (defineGame schema) + the indexer table schemas
 * whose tableIds match the on-chain hand-written PlayerTable / PropertyTable
 * (the `bytes2("tb") ++ bytes14(0) ++ bytes16(name)` encoding, exactly like
 * CounterTable). Shared by the backend.
 */
import { defineGame, resourceId, t } from "@nexus/core";
import type { IndexerGameSchema } from "@nexus/backend";
import type { Hex } from "@nexus/types";
import { toHex } from "viem";

export const GAME_NAME = "monopoly";

export function monopolyGame() {
  return defineGame({
    name: GAME_NAME,
    tables: {
      Player: { roomId: t.uint256, addr: t.address, position: t.uint256, cash: t.uint256 },
      Property: {
        roomId: t.uint256,
        spaceId: t.uint256,
        owner: t.address,
        price: t.uint256,
        rent: t.uint256,
      },
    },
    systems: { MonopolyGame: "./MonopolyGameSystem.sol" },
    economy: { entryFee: { amount: "0.10", token: "USDC" }, pot: { type: "winner-take-all", rake: "0" } },
  });
}

/** The canonical system alias id = keccak256("nexus.monopoly.system.MonopolyGame"). */
export const MONOPOLY_SYSTEM_ID = resourceId(GAME_NAME, "system", "MonopolyGame") as Hex;

/** tableId = bytes2("tb") ++ bytes14(0) ++ bytes16(name) — matches MonopolyTables.sol. */
function tableId(name: string): Hex {
  const tb = toHex(new TextEncoder().encode("tb")); // 0x7462
  const nm = toHex(new TextEncoder().encode(name)).slice(2);
  const padded = `${nm}${"00".repeat(16 - name.length)}`; // bytes16, right-padded
  return `0x${tb.slice(2)}${"00".repeat(14)}${padded}` as Hex;
}

export const PLAYER_TABLE_ID = tableId("Player");
export const PROPERTY_TABLE_ID = tableId("Property");

export const indexerGameSchema: IndexerGameSchema = {
  name: GAME_NAME,
  tables: [
    {
      table: "Player",
      tableId: PLAYER_TABLE_ID,
      fields: [
        { name: "roomId", abiType: "uint256", key: true },
        { name: "addr", abiType: "address", key: true },
        { name: "position", abiType: "uint256", key: false },
        { name: "cash", abiType: "uint256", key: false },
      ],
    },
    {
      table: "Property",
      tableId: PROPERTY_TABLE_ID,
      fields: [
        { name: "roomId", abiType: "uint256", key: true },
        { name: "spaceId", abiType: "uint256", key: true },
        { name: "owner", abiType: "address", key: false },
        { name: "price", abiType: "uint256", key: false },
        { name: "rent", abiType: "uint256", key: false },
      ],
    },
  ],
};

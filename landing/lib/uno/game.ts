/**
 * The shared UNO game ids. Browser-safe (no @nexus/backend import).
 *
 * The on-chain system is registered under the raw label bytes32("UnoGame"); the
 * engine re-registers the SAME system contract under the canonical alias id
 * resourceId("uno","system","UnoGame") at boot so a single id is valid end-to-end
 * (mirrors scripts/live/e2e.ts). Moves target the alias id via World.call.
 */
import { resourceId } from "@steamlink/core";
import type { Hex } from "@steamlink/types";
import { toHex } from "viem";

/** The canonical system alias id (matches the on-chain SystemAllowlist + World). */
export const UNO_ALIAS_SYSTEM_ID: Hex = resourceId("uno", "system", "UnoGame");

/**
 * The exact on-chain UnoTable id: bytes2("tb") ++ bytes14(0) ++ bytes16("Uno").
 * Mirrors examples/uno/contracts/UnoTable.sol.
 */
export const UNO_TABLE_ID: Hex = (() => {
  const tb = toHex(new TextEncoder().encode("tb")); // 0x7462
  const uno = toHex(new TextEncoder().encode("Uno")); // 3 bytes
  const unoPadded = `${uno.slice(2)}${"00".repeat(16 - 3)}`; // bytes16, right-padded
  return `0x${tb.slice(2)}${"00".repeat(14)}${unoPadded}` as Hex;
})();

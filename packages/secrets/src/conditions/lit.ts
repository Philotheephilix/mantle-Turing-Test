/**
 * Compile Nexus {@link AccessCondition}s into Lit's
 * `unifiedAccessControlConditions` (phase-08 Task 3, step 1). Pins `chain` to a
 * Mantle value on every clause and rejects anything non-Mantle (convention guard).
 */

import { NexusError } from "@nexus/types";
import type { AccessCondition } from "../types.js";

/** Lit's chain slug for each Mantle chain. */
function litChain(chain: AccessCondition["chain"]): string {
  if (chain === "mantle") return "mantle";
  if (chain === "mantle-sepolia") return "mantleSepoliaTestnet";
  throw new NexusError("INVALID_CONFIG", `non-Mantle chain rejected: ${String(chain)}`);
}

/** A single Lit unified-ACC clause (shape Lit expects). */
export type UnifiedAccClause = {
  conditionType: "evmBasic";
  contractAddress: string;
  standardContractType: string;
  chain: string;
  method: string;
  parameters: string[];
  returnValueTest: { comparator: string; value: string };
};

/**
 * Convert each {@link AccessCondition} to a Lit clause. Multiple clauses are
 * joined with `and` operators (Lit interleaves operator objects between clauses).
 */
export function toUnifiedAccessControlConditions(
  conditions: AccessCondition[],
): Array<UnifiedAccClause | { operator: "and" }> {
  if (!conditions.length) {
    throw new NexusError("INVALID_CONFIG", "no access conditions supplied");
  }
  const out: Array<UnifiedAccClause | { operator: "and" }> = [];
  conditions.forEach((c, i) => {
    if (c.chain !== "mantle" && c.chain !== "mantle-sepolia") {
      throw new NexusError(
        "INVALID_CONFIG",
        `non-Mantle condition rejected at seal: chain=${String(c.chain)}`,
      );
    }
    if (i > 0) out.push({ operator: "and" });
    out.push({
      conditionType: "evmBasic",
      contractAddress: c.contractAddress ?? "",
      standardContractType: c.standardContractType ?? "",
      chain: litChain(c.chain),
      method: c.method,
      parameters: c.parameters ?? [],
      returnValueTest: { comparator: c.returns.comparator, value: c.returns.value },
    });
  });
  return out;
}

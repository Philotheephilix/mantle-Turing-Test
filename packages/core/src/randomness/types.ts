import type { Hex } from "@nexus/types";

/**
 * Randomness tiers behind the one `random.*` facade (design §9, phase-09).
 *
 *  - `vrf`          — Chainlink VRF v2.5 (async, provably fair). SEAM ONLY in the
 *                     contracts: not wired here because VRF needs a funded
 *                     subscription unavailable in CI. Included in the type so game
 *                     code can be written against it ahead of the oracle landing.
 *  - `commit-reveal`— two-tx, trustless, no oracle. The on-chain default for
 *                     adversarial draws that must run without a subscription.
 *  - `fast`         — single-tx `prevrandao` mix. LOW-STAKES only (proposer can
 *                     weakly bias). Never use where an attacker profits.
 */
export type RngTier = "vrf" | "commit-reveal" | "fast";

/**
 * A piece of calldata to send to the `RandomnessCoordinator` through the relayer.
 * `to` is the coordinator address; `data` is the ABI-encoded call.
 */
export type RandomnessCall = {
  to: Hex;
  data: Hex;
  /** Which coordinator function this call targets (for the relayer/SDK to label). */
  fn: "requestCommit" | "reveal" | "fastRandom";
  tier: RngTier;
};

/** Options shared by the calldata builders. */
export type CommitRevealOpts = {
  /** The deployed `RandomnessCoordinator` address. */
  coordinator: Hex;
};

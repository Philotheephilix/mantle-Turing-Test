import type { RelayerAdapter, RelayerCapabilities } from "@nexus/relayer";
import type { FacilitatorAdapter } from "@nexus/server";
import type { Address } from "@nexus/types";
import { InMemoryIndexer } from "../indexer/memory-indexer.js";
import { StubFacilitator } from "../ports/facilitator.js";
import type { IndexerAdapter } from "../ports/indexer.js";
import { MemorySessionStore, type SessionStore } from "../rooms/store.js";

/**
 * Default adapter set (backend spec §2.2 / phase-05 §4.3). The spec names the
 * production defaults `OneShotRelayer`, `LitSecrets`, `ChainlinkVRF`,
 * `NexusIndexer`, `DelegationFacilitator`. In phase-05 the zero-credential,
 * test-faithful defaults are: a caller-provided relayer (no live OneShot account
 * in dev), `InMemoryIndexer`, `StubFacilitator` (Phase-07 swaps in
 * `DelegationFacilitator`), and `MemorySessionStore`. No alternative providers are
 * invented — overrides replace these by passing a different instance.
 */
export function defaultIndexer(): IndexerAdapter {
  return new InMemoryIndexer();
}

export function defaultSessionStore(): SessionStore {
  return new MemorySessionStore();
}

export function defaultFacilitator(
  capabilities: RelayerCapabilities | (() => Promise<RelayerCapabilities>),
): FacilitatorAdapter {
  return new StubFacilitator(capabilities);
}

/** A relayer is REQUIRED (no zero-config live relayer); the CLI supplies one. */
export function requireRelayer(relayer: RelayerAdapter | undefined): RelayerAdapter {
  if (!relayer) {
    throw new Error(
      "createBackend: a `relayer` adapter is required (DirectRelayer for dev, OneShotRelayer for prod).",
    );
  }
  return relayer;
}

export const DEV_TARGET_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

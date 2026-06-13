/**
 * `@nexus/secrets` — the secrets layer for the Nexus game engine SDK.
 *
 * Surface (design §8 / phase-08 §5):
 *  - The {@link SecretsAdapter} port and shared types.
 *  - {@link LitSecrets} — the default, Lit-Protocol-backed adapter (NETWORK-GATED).
 *  - {@link LocalSecrets} — a real offline AES-256-GCM adapter for dev & tests.
 *  - The named-policy registry + built-in templates.
 *  - Thin `seal` / `reveal` / `verify` / `verifyMove` wrappers over a configured
 *    default adapter.
 */

// ── types (the port + shared shapes) ──
export type {
  AccessCondition,
  Attestation,
  AuthContext,
  Bytes,
  Comparator,
  LitNetwork,
  MoveClaim,
  Sealed,
  SecretsAdapter,
  SecretsChain,
} from "./types.js";

// ── adapters ──
export { LitSecrets } from "./lit.js";
export type { LitSecretsOptions } from "./lit.js";
export {
  LocalSecrets,
  defaultConditionPredicate,
} from "./local.js";
export type { ConditionPredicate, LocalSecretsOptions } from "./local.js";

// ── named policies ──
export {
  BUILTIN_POLICIES,
  PolicyRegistry,
  assertConditionsValid,
  defaultPolicyRegistry,
  defineAccessCondition,
} from "./conditions/registry.js";
export type { PolicyContext, PolicyTemplate } from "./conditions/registry.js";
export { toUnifiedAccessControlConditions } from "./conditions/lit.js";

// ── move rule + attestation codec (shared with the on-chain verifier) ──
export {
  type Card,
  decodeCard,
  decodeHand,
  encodeHand,
  isLegalMove,
} from "./moveRule.js";
export {
  type AttestationPayloadFields,
  attestationDigest,
  decodeAttestationPayload,
  encodeAttestationPayload,
} from "./attestation.js";

import { NexusError } from "@nexus/types";
import { defaultPolicyRegistry } from "./conditions/registry.js";
import type { PolicyContext } from "./conditions/registry.js";
import type {
  AccessCondition,
  Attestation,
  AuthContext,
  Bytes,
  MoveClaim,
  Sealed,
  SecretsAdapter,
} from "./types.js";

// ── default-adapter wiring (design §8 wrappers) ──

let defaultAdapter: SecretsAdapter | undefined;

/**
 * Wire the process default {@link SecretsAdapter} that the top-level `seal` /
 * `reveal` / `verify` wrappers delegate to. The backend coordinator calls this
 * once with a {@link LitSecrets} (prod) or {@link LocalSecrets} (dev).
 */
export function setDefaultSecretsAdapter(adapter: SecretsAdapter): void {
  defaultAdapter = adapter;
}

function requireAdapter(): SecretsAdapter {
  if (!defaultAdapter) {
    throw new NexusError(
      "INVALID_CONFIG",
      "no SecretsAdapter configured; call setDefaultSecretsAdapter() first",
    );
  }
  return defaultAdapter;
}

/** Options for the top-level {@link seal} wrapper. */
export type SealOptions =
  | { conditions: AccessCondition[] }
  | { policy: string; context?: PolicyContext };

/**
 * Seal `data` either behind explicit `conditions` or a named `policy` (expanded
 * via the default policy registry). Delegates to the configured adapter.
 */
export async function seal(data: Bytes, opts: SealOptions): Promise<Sealed> {
  const conditions =
    "policy" in opts ? defaultPolicyRegistry.expand(opts.policy, opts.context) : opts.conditions;
  return requireAdapter().seal(data, conditions);
}

/** Conditionally decrypt a sealed blob via the configured adapter. */
export async function reveal(sealed: Sealed, auth: AuthContext): Promise<Bytes> {
  return requireAdapter().reveal(sealed, auth);
}

/** Prove a move is legal (full {@link MoveClaim}) via the configured adapter. */
export async function verify(sealed: Sealed, claim: MoveClaim): Promise<Attestation> {
  return requireAdapter().verify(sealed, claim);
}

/**
 * Convenience over {@link verify} — `system` defaults to "PlayCardSystem"
 * (design §8.3).
 */
export async function verifyMove(
  sealed: Sealed,
  claim: Omit<MoveClaim, "system"> & { system?: string },
): Promise<Attestation> {
  return requireAdapter().verify(sealed, { system: "PlayCardSystem", ...claim });
}

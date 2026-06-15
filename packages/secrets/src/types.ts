/**
 * Shared shapes for the secrets layer (design §8, phase-08 Task 1).
 *
 * These are the swappable-boundary types. Game code and the SDK reference them;
 * concrete adapters (`LitSecrets`, `LocalSecrets`) implement {@link SecretsAdapter}.
 *
 * Re-exported from the package root so callers do
 * `import type { Sealed, AccessCondition } from "@nexus/secrets"`.
 */

import type { Address, Hex } from "@nexus/types";

/** Plaintext payload unit. Sealed/revealed data is always raw bytes. */
export type Bytes = Uint8Array;

/**
 * Lit networks we target. `datil` is production mainnet-grade; `datil-test` is
 * the free/public staging network used for development and the live path here.
 */
export type LitNetwork = "datil" | "datil-test";

/**
 * The chain an access condition is evaluated against. Nexus is Mantle-only by
 * design — the only permitted values are Mantle mainnet and Mantle Sepolia. Anything
 * else is rejected at seal time and at policy registration (convention guard).
 */
export type SecretsChain = "mantle" | "mantle-sepolia";

/** Comparators Lit supports for a returned value. */
export type Comparator = "=" | ">" | ">=" | "<" | "<=" | "!=";

/**
 * A single Mantle-only access-control clause (design §8.1 canonical shape).
 * `parameters` may carry substitution tokens (`:userAddress`, `:handId`, …)
 * resolved by the coordinator against the authenticated request before the
 * condition is handed to Lit.
 */
export type AccessCondition = {
  /** Strict — Mantle only, never another chain. */
  chain: SecretsChain;
  /** e.g. "ownerOf", "balanceOf", a World view, or an event check. */
  method: string;
  contractAddress?: Address;
  standardContractType?: "ERC721" | "ERC20" | "";
  /** Method args, with `:token` substitution placeholders. */
  parameters?: string[];
  returns: { comparator: Comparator; value: string };
};

/**
 * A sealed blob. Only `commitment` (bytes32) goes on-chain; `ciphertext` and
 * `dataHash` live off-chain in the indexer/blob store.
 */
export type Sealed = {
  /** Lit base64 ciphertext (off-chain). */
  ciphertext: string;
  /** Lit `dataToEncryptHash` — binds ciphertext to its conditions (off-chain). */
  dataHash: string;
  /** keccak256(dataHash) — the bytes32 that goes ON-CHAIN. */
  commitment: Hex;
  /** The conditions that gate decryption. */
  conditions: AccessCondition[];
  network: LitNetwork | "local";
  /** Threshold algorithm (Lit) or the local AES profile. */
  alg: "BLS12-381-threshold" | "AES-256-GCM";
};

/**
 * Auth material a caller presents to `reveal`. With Lit this carries SessionSigs
 * minted server-side; with {@link LocalSecrets} it is checked by an injected
 * predicate instead.
 */
export type AuthContext = {
  /** Lit SessionSigs derived from the caller's smart-account auth (opaque). */
  sessionSigs?: unknown;
  /** The smart account the Gateway authenticated. */
  caller: Address;
  roomId?: string;
  /**
   * Arbitrary game state the local predicate evaluates against (e.g.
   * `{ roundEnded: true }`). Ignored by `LitSecrets` (Lit reads chain directly).
   */
  state?: Record<string, unknown>;
};

/**
 * A claim that a move is legal, checked without revealing the rest of the hand
 * (design §8.3). `system` defaults to "PlayCardSystem".
 */
export type MoveClaim = {
  system: string;
  /** The card the player claims to play. */
  playedCard: number;
  /** Public game state the claim is checked against. */
  topOfDiscard: number;
  /** Public active color — for wilds. */
  activeColor: number;
  roomId: string;
  player: Address;
};

/**
 * The attestation a {@link SecretsAdapter.verify} produces for a legal move. The
 * on-chain `PlayCardSystem` recovers `signer` from `signature` over
 * `keccak256(payload)` and checks it against the authorized PKP address.
 */
export type Attestation = {
  /** abi-encoded (player, system, playedCard, nonce, validUntil). */
  payload: Hex;
  /** ECDSA signature over keccak256(payload). */
  signature: Hex;
  /** The signer address (Lit Action PKP, or the local dev key). */
  signer: Address;
  /** IPFS CID of the Lit Action that produced this (or a local marker). */
  litActionCid: string;
};

/**
 * The swappable boundary. Default impl is {@link LitSecrets}; {@link LocalSecrets}
 * is the offline real-crypto implementation used for dev and tests.
 */
export interface SecretsAdapter {
  /** Threshold-encrypt `data` behind `conditions`. */
  seal(data: Bytes, conditions: AccessCondition[]): Promise<Sealed>;
  /** Conditionally decrypt — succeeds iff the conditions are met. */
  reveal(sealed: Sealed, auth: AuthContext): Promise<Bytes>;
  /** Prove a move is legal without revealing the hand; returns a signed attestation. */
  verify(sealed: Sealed, claim: MoveClaim): Promise<Attestation>;
}

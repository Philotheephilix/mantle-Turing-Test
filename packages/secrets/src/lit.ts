/**
 * `LitSecrets` — the default {@link SecretsAdapter}, backed by Lit Protocol
 * threshold encryption (phase-08 Tasks 2-4, 8, 10).
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  NETWORK-GATED. Every method here talks to the Lit network (default
 *  `datil-test`, the free/public staging network). None of this is exercised by
 *  the offline unit tests — those use {@link LocalSecrets}. The Lit SDK is an
 *  OPTIONAL peer dependency loaded lazily via dynamic `import()`, so this module
 *  type-checks and bundles without the heavy dependency present.
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  - `seal`  → threshold-encrypt; only `commitment` (keccak256(dataHash)) goes
 *              on-chain; `ciphertext`/`dataHash` live off-chain.
 *  - `reveal`→ conditional decrypt; Lit nodes evaluate the conditions against
 *              Base and release key shares iff >2/3 agree.
 *  - `verify`→ runs the pinned `verifyMove` Lit Action in a node TEE, which
 *              decrypts the hand inside the enclave, checks legality, and signs
 *              an attestation with its PKP — the hand never leaves the enclave.
 *
 *  Credentials (SessionSigs minting, PKP) live ONLY in the backend coordinator
 *  that instantiates this class — never in a browser bundle.
 */

import { NexusError } from "@nexus/types";
import type { Address, Hex } from "@nexus/types";
import { keccak256, toBytes } from "viem";
import { decodeAttestationPayload } from "./attestation.js";
import { toUnifiedAccessControlConditions } from "./conditions/lit.js";
import { assertConditionsValid } from "./conditions/registry.js";
import type {
  AccessCondition,
  Attestation,
  AuthContext,
  Bytes,
  LitNetwork,
  MoveClaim,
  Sealed,
  SecretsAdapter,
} from "./types.js";

/** Loose shape of the Lit node client we use — kept minimal & version-tolerant. */
interface LitNodeClientLike {
  connect(): Promise<void>;
  disconnect?(): Promise<void>;
  ready?: boolean;
  executeJs(args: {
    ipfsId: string;
    sessionSigs: unknown;
    jsParams: Record<string, unknown>;
  }): Promise<{ response: unknown; signatures?: Record<string, unknown> }>;
}

/** Loose shape of the Lit encryption helpers. */
interface LitEncryptionModule {
  encryptUint8Array(
    args: {
      dataToEncrypt: Uint8Array;
      unifiedAccessControlConditions: unknown;
    },
    client: LitNodeClientLike,
  ): Promise<{ ciphertext: string; dataToEncryptHash: string }>;
  decryptToUint8Array(
    args: {
      ciphertext: string;
      dataToEncryptHash: string;
      unifiedAccessControlConditions: unknown;
      chain: string;
      sessionSigs: unknown;
    },
    client: LitNodeClientLike,
  ): Promise<Uint8Array>;
}

export type LitSecretsOptions = {
  /** Lit network. Default `datil-test` (free/public staging). */
  network?: LitNetwork;
  /** IPFS CID of the pinned `verifyMove` Lit Action (Task 9). */
  verifyMoveCid?: string;
  /** PKP address authorized on-chain as the attestation signer. */
  pkpAddress?: Address;
  /** Attestation validity window in seconds. Default 120s. */
  validitySeconds?: number;
  /** Debug mode passed to the Lit client. */
  debug?: boolean;
};

export class LitSecrets implements SecretsAdapter {
  readonly network: LitNetwork;
  private readonly verifyMoveCid?: string;
  private readonly pkpAddress?: Address;
  private readonly validitySeconds: number;
  private readonly debug: boolean;

  private client?: LitNodeClientLike;
  private encryption?: LitEncryptionModule;
  private nonceCounter = 0n;

  constructor(opts: LitSecretsOptions = {}) {
    this.network = opts.network ?? "datil-test";
    this.verifyMoveCid = opts.verifyMoveCid;
    this.pkpAddress = opts.pkpAddress;
    this.validitySeconds = opts.validitySeconds ?? 120;
    this.debug = opts.debug ?? false;
  }

  // ── client bootstrap (Task 2) — lazy singleton + backoff ──────────────────

  /** NETWORK-GATED. Lazily connect to the Lit network with exponential backoff. */
  private async getClient(): Promise<LitNodeClientLike> {
    if (this.client?.ready) return this.client;
    const mod = await importLit<{
      LitNodeClient: new (cfg: { litNetwork: string; debug: boolean }) => LitNodeClientLike;
    }>("@lit-protocol/lit-node-client");
    const client = new mod.LitNodeClient({ litNetwork: this.network, debug: this.debug });

    let attempt = 0;
    const maxAttempts = 5;
    for (;;) {
      try {
        await client.connect();
        break;
      } catch (cause) {
        attempt += 1;
        if (attempt >= maxAttempts) {
          throw new NexusError("INTERNAL", "Lit network unavailable after retries", {
            cause,
            retryable: true,
            context: { network: this.network },
          });
        }
        await delay(2 ** attempt * 200);
      }
    }
    this.client = client;
    return client;
  }

  private async getEncryption(): Promise<LitEncryptionModule> {
    if (this.encryption) return this.encryption;
    this.encryption = await importLit<LitEncryptionModule>("@lit-protocol/encryption");
    return this.encryption;
  }

  /** Clean shutdown of the Lit connection. */
  async disconnect(): Promise<void> {
    await this.client?.disconnect?.();
    this.client = undefined;
  }

  // ── seal (Task 3) ─────────────────────────────────────────────────────────

  /** NETWORK-GATED. Threshold-encrypt `data` behind Base-only conditions. */
  async seal(data: Bytes, conditions: AccessCondition[]): Promise<Sealed> {
    assertConditionsValid(conditions);
    const unified = toUnifiedAccessControlConditions(conditions);
    const client = await this.getClient();
    const enc = await this.getEncryption();

    let result: { ciphertext: string; dataToEncryptHash: string };
    try {
      result = await enc.encryptUint8Array(
        { dataToEncrypt: data, unifiedAccessControlConditions: unified },
        client,
      );
    } catch (cause) {
      throw new NexusError("SEAL_FAILED", "Lit threshold encryption failed", { cause });
    }

    const dataHash = `0x${result.dataToEncryptHash}` as Hex;
    const commitment = keccak256(toBytes(dataHash));
    return {
      ciphertext: result.ciphertext,
      dataHash: result.dataToEncryptHash,
      commitment,
      conditions,
      network: this.network,
      alg: "BLS12-381-threshold",
    };
  }

  // ── reveal (Task 4) ───────────────────────────────────────────────────────

  /**
   * NETWORK-GATED. Conditional decrypt. Lit nodes evaluate the conditions
   * against Base; only if >2/3 agree do they release key shares.
   * `auth.sessionSigs` must be minted by the coordinator for the caller.
   */
  async reveal(sealed: Sealed, auth: AuthContext): Promise<Bytes> {
    if (!auth.sessionSigs) {
      throw new NexusError("REVEAL_DENIED", "missing SessionSigs (mint via coordinator)");
    }
    const unified = toUnifiedAccessControlConditions(sealed.conditions);
    const client = await this.getClient();
    const enc = await this.getEncryption();
    try {
      return await enc.decryptToUint8Array(
        {
          ciphertext: sealed.ciphertext,
          dataToEncryptHash: sealed.dataHash,
          unifiedAccessControlConditions: unified,
          chain: litChainSlug(sealed.conditions),
          sessionSigs: auth.sessionSigs,
        },
        client,
      );
    } catch (cause) {
      // Lit surfaces a NodeAccessControlConditionsReturnedNotAuthorized when the
      // conditions are not met — map to the typed denial.
      throw new NexusError("REVEAL_DENIED", "Lit access conditions not met", { cause });
    }
  }

  // ── verify (Task 10) ──────────────────────────────────────────────────────

  /**
   * NETWORK-GATED. Run the pinned `verifyMove` Lit Action in a node TEE. The
   * Action decrypts the hand inside the enclave, checks legality, and signs an
   * attestation — the hand never leaves the enclave. Throws
   * `NexusError("ILLEGAL_MOVE")` if the Action reports the move is illegal.
   *
   * Requires {@link LitSecretsOptions.verifyMoveCid} and `pkpAddress` to be set
   * and `auth`/SessionSigs supplied by the coordinator via {@link withSessionSigs}.
   */
  async verify(sealed: Sealed, claim: MoveClaim): Promise<Attestation> {
    if (!this.verifyMoveCid || !this.pkpAddress) {
      throw new NexusError(
        "INVALID_CONFIG",
        "LitSecrets.verify requires verifyMoveCid and pkpAddress",
      );
    }
    const sessionSigs = this.pendingSessionSigs;
    if (!sessionSigs) {
      throw new NexusError("INTERNAL", "call withSessionSigs() before verify()");
    }

    const nonce = this.nonceCounter++;
    const validUntil = BigInt(Math.floor(Date.now() / 1000) + this.validitySeconds);
    const client = await this.getClient();

    let res: { response: unknown };
    try {
      res = await client.executeJs({
        ipfsId: this.verifyMoveCid,
        sessionSigs,
        jsParams: {
          ciphertext: sealed.ciphertext,
          dataHash: sealed.dataHash,
          conditions: toUnifiedAccessControlConditions(sealed.conditions),
          playedCard: claim.playedCard,
          topOfDiscard: claim.topOfDiscard,
          activeColor: claim.activeColor,
          player: claim.player,
          system: claim.system,
          nonce: nonce.toString(),
          validUntil: validUntil.toString(),
        },
      });
    } catch (cause) {
      throw new NexusError("INTERNAL", "Lit Action execution failed", { cause });
    }

    const parsed = parseActionResponse(res.response);
    if (!parsed.legal) {
      throw new NexusError("ILLEGAL_MOVE", "Lit Action rejected the move");
    }
    if (!parsed.payload || !parsed.signature) {
      throw new NexusError("INTERNAL", "Lit Action returned no attestation");
    }

    // Sanity: the payload the Action signed must bind to this player/card.
    const fields = decodeAttestationPayload(parsed.payload);
    if (fields.player.toLowerCase() !== claim.player.toLowerCase()) {
      throw new NexusError("INTERNAL", "attestation player mismatch");
    }

    return {
      payload: parsed.payload,
      signature: parsed.signature,
      signer: this.pkpAddress,
      litActionCid: this.verifyMoveCid,
    };
  }

  // ── SessionSigs handoff ────────────────────────────────────────────────────

  private pendingSessionSigs?: unknown;

  /**
   * Attach coordinator-minted SessionSigs for the next `verify` call. The
   * backend coordinator owns the auth material; this keeps it off the adapter
   * surface and out of any browser bundle.
   */
  withSessionSigs(sessionSigs: unknown): this {
    this.pendingSessionSigs = sessionSigs;
    return this;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

/**
 * Map our Base chain to Lit's chain slug. Lit refers to Base mainnet as `base`.
 * Confirm against Lit's supported-chains list per phase-08 §8 open question.
 */
function litChainSlug(conditions: AccessCondition[]): string {
  const first = conditions[0];
  if (first?.chain === "base-sepolia") return "baseSepolia";
  return "base";
}

function parseActionResponse(response: unknown): {
  legal: boolean;
  payload?: Hex;
  signature?: Hex;
} {
  const obj =
    typeof response === "string"
      ? (JSON.parse(response) as Record<string, unknown>)
      : ((response ?? {}) as Record<string, unknown>);
  return {
    legal: Boolean(obj.legal),
    payload: typeof obj.payload === "string" ? (obj.payload as Hex) : undefined,
    signature: typeof obj.signature === "string" ? (obj.signature as Hex) : undefined,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dynamic import of an optional Lit package. Throws a typed config error if the
 * Lit SDK isn't installed — keeping the package usable (LocalSecrets) without it.
 */
async function importLit<T>(specifier: string): Promise<T> {
  try {
    return (await import(/* @vite-ignore */ specifier)) as T;
  } catch (cause) {
    throw new NexusError(
      "INVALID_CONFIG",
      `${specifier} is not installed; install the Lit SDK to use LitSecrets, or use LocalSecrets`,
      { cause },
    );
  }
}

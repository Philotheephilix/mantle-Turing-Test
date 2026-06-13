import { type Address, type Hex, NexusError, asAddress } from "@nexus/types";
import { keccak256, recoverMessageAddress, toHex, verifyMessage } from "viem";

/**
 * Caller auth (backend spec §8, phase-05 §4.2). Session-scoped routes verify the
 * player's smart-account signature over a CANONICAL request payload
 * (method + path + bodyHash + nonce + timestamp). No API keys reach the browser.
 *
 * Two verification modes:
 *  - EIP-191 personal_sign over the canonical string (default for EOAs / SCA).
 *  - EIP-1271 (smart-account) verification via `verifyMessage` with a public
 *    client (injected); used when the account is a deployed contract wallet.
 */
export interface SignedRequest {
  method: string;
  path: string;
  body: unknown;
  /** Single-use nonce (replay protection). */
  nonce: string;
  /** Epoch ms; rejected if too old. */
  timestamp: number;
  /** The claimed signer (smart-account address). */
  caller: Address;
  /** The signature over the canonical payload. */
  signature: Hex;
}

export interface AuthConfig {
  /** Max age of a request signature in ms. Default 60s. */
  maxAgeMs?: number;
  /**
   * Optional EIP-1271 verifier (for deployed smart accounts). When provided and
   * the EIP-191 ecrecover does not match, this is consulted. Injected with a viem
   * public client in prod; omitted in tests that use EOA personal_sign.
   */
  verify1271?: (caller: Address, hash: Hex, signature: Hex) => Promise<boolean>;
  /** Nonce replay guard. Default in-memory set. */
  seenNonce?: (nonce: string) => boolean;
}

/** Build the canonical message a caller signs for a session-scoped request. */
export function canonicalMessage(req: Omit<SignedRequest, "signature" | "caller">): string {
  const bodyHash = keccak256(toHex(JSON.stringify(req.body ?? null)));
  return [req.method.toUpperCase(), req.path, bodyHash, req.nonce, String(req.timestamp)].join(
    "\n",
  );
}

const usedNonces = new Set<string>();

/**
 * Verify a signed session-scoped request. Throws `NexusError("NOT_CONNECTED")` on
 * any failure (expired, replayed, bad signature). Returns the verified caller.
 */
export async function verifyRequest(req: SignedRequest, cfg: AuthConfig = {}): Promise<Address> {
  const maxAge = cfg.maxAgeMs ?? 60_000;
  const now = Date.now();
  if (
    !Number.isFinite(req.timestamp) ||
    now - req.timestamp > maxAge ||
    req.timestamp - now > maxAge
  ) {
    throw new NexusError("NOT_CONNECTED", "request timestamp expired or skewed");
  }
  const seen = cfg.seenNonce ?? ((n: string) => usedNonces.has(n));
  if (seen(req.nonce)) throw new NexusError("NONCE_REUSED", "request nonce replayed");

  const message = canonicalMessage(req);
  const caller = asAddress(req.caller);

  // EIP-191 ecrecover fast path.
  let ok = false;
  try {
    const recovered = await recoverMessageAddress({ message, signature: req.signature });
    ok = recovered.toLowerCase() === caller.toLowerCase();
  } catch {
    ok = false;
  }
  if (!ok) {
    // viem's verifyMessage also handles ERC-6492 / ERC-1271 when given a client;
    // here use the structural verify as a second attempt.
    try {
      ok = await verifyMessage({ address: caller, message, signature: req.signature });
    } catch {
      ok = false;
    }
  }
  if (!ok && cfg.verify1271) {
    const hash = keccak256(toHex(message));
    ok = await cfg.verify1271(caller, hash, req.signature);
  }
  if (!ok) throw new NexusError("NOT_CONNECTED", "smart-account signature verification failed");

  if (!cfg.seenNonce) usedNonces.add(req.nonce);
  return caller;
}

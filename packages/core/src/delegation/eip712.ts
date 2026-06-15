import type { Address } from "@nexus/types";

/**
 * The EIP-712 schema for a Nexus GameDelegation. This MUST match
 * NexusDelegationManager.sol byte-for-byte (domain, type order, field order),
 * or on-chain signature recovery fails. Verified live against the deployed
 * manager's getDelegationHash() / domainSeparator() in the scripts/ suite.
 *
 * WHY byte-for-byte: an EIP-712 typehash is keccak256 of the type STRING, and the
 * digest is keccak("\x19\x01" || domainSeparator || hashStruct). The manager hard-
 * codes those strings (DELEGATION_TYPEHASH / CAVEAT_TYPEHASH / DOMAIN_TYPEHASH) and
 * recovers the signer from them. viem rebuilds the identical typehash from the
 * structures below, so ANY divergence — a renamed/reordered field, a different
 * domain name/version — produces a different digest, a different recovered address,
 * and the manager reverts InvalidDelegationSignature. These constants are therefore
 * a hardcoded contract, not a convenience, and must move in lockstep with the .sol.
 */

// Must equal NAME_HASH = keccak256("Nexus Game Delegation") in the manager.
export const EIP712_DOMAIN_NAME = "Nexus Game Delegation";
// Must equal VERSION_HASH = keccak256("1") in the manager.
export const EIP712_DOMAIN_VERSION = "1";

/**
 * Root authority (a non-chained, root delegation). The manager only accepts
 * authority == bytes32(0) and reverts NonRootAuthorityUnsupported otherwise — it
 * implements no delegation chains — so every signed delegation pins this value.
 */
export const ROOT_AUTHORITY =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/**
 * viem typed-data `types` for a Delegation. Field order is significant: it must
 * reproduce the manager's type strings exactly —
 *   Caveat(address enforcer,bytes terms,bytes args)
 *   Delegation(address delegate,address delegator,bytes32 authority,
 *              Caveat[] caveats,uint256 salt,uint256 maxRedemptions)
 * — because the typehash is keccak of that string with fields in THIS order.
 * Reordering a field (even to a "nicer" order) silently changes the typehash and
 * breaks recovery. `signature` is intentionally absent: it is not part of the
 * signed struct (you can't sign over the signature), only of the encoded tuple.
 */
export const DELEGATION_TYPES = {
  Caveat: [
    { name: "enforcer", type: "address" },
    { name: "terms", type: "bytes" },
    { name: "args", type: "bytes" },
  ],
  Delegation: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    { name: "caveats", type: "Caveat[]" },
    { name: "salt", type: "uint256" },
    { name: "maxRedemptions", type: "uint256" },
  ],
} as const;

/**
 * The EIP-712 domain. Mirrors the manager's domainSeparator(): name + version +
 * chainId + verifyingContract (the manager address). Binding the domain to a
 * specific chainId and manager address is what stops a signature from being
 * replayed on another chain or against a different/forged manager.
 */
export function eip712Domain(chainId: number, verifyingContract: Address) {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  } as const;
}

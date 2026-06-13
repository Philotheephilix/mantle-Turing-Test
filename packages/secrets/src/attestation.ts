/**
 * Attestation payload codec (phase-08 Task 10/11). The payload binds the legal
 * move to (player, system, playedCard, nonce, validUntil). The on-chain
 * `LitAttestationVerifier` recovers the signer from `signature` over
 * `keccak256(payload)` and checks it against the authorized PKP address.
 *
 * Encoding mirrors the Solidity side exactly:
 *   abi.encode(address player, string system, uint8 playedCard,
 *              uint256 nonce, uint256 validUntil)
 */

import type { Address, Hex } from "@nexus/types";
import { decodeAbiParameters, encodeAbiParameters, keccak256, parseAbiParameters } from "viem";

const ATTEST_PARAMS = parseAbiParameters(
  "address player, string system, uint8 playedCard, uint256 nonce, uint256 validUntil",
);

export type AttestationPayloadFields = {
  player: Address;
  system: string;
  playedCard: number;
  nonce: bigint;
  validUntil: bigint;
};

/** ABI-encode the attestation payload. */
export function encodeAttestationPayload(f: AttestationPayloadFields): Hex {
  return encodeAbiParameters(ATTEST_PARAMS, [
    f.player,
    f.system,
    f.playedCard,
    f.nonce,
    f.validUntil,
  ]);
}

/** Inverse of {@link encodeAttestationPayload}. */
export function decodeAttestationPayload(payload: Hex): AttestationPayloadFields {
  const [player, system, playedCard, nonce, validUntil] = decodeAbiParameters(
    ATTEST_PARAMS,
    payload,
  );
  return {
    player: player as Address,
    system,
    playedCard: Number(playedCard),
    nonce,
    validUntil,
  };
}

/** The digest the PKP/dev key signs: keccak256(payload). */
export function attestationDigest(payload: Hex): Hex {
  return keccak256(payload);
}

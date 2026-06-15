/**
 * verifyMove.lit.js — the Lit Action that runs inside a Lit node's TEE.
 * (phase-08 Task 9, design §8.3)
 *
 * DEPLOYMENT (network-gated, NOT exercised by unit tests):
 *   1. Bundle this file (it must be a single self-contained script).
 *   2. Pin it to IPFS and record the CID -> pass as `verifyMoveCid` to LitSecrets.
 *   3. Mint a PKP whose public key is `PKP_PUBLIC_KEY` below; record its address
 *      and register it on-chain in LitAttestationVerifier as the authorized signer.
 *
 * jsParams supplied by the coordinator (see LitSecrets.verify):
 *   { ciphertext, dataHash, conditions, playedCard, topOfDiscard, activeColor,
 *     player, system, nonce, validUntil, sessionSigs }
 *
 * INVARIANT: the decrypted hand NEVER leaves this scope. Only an attestation
 * (or a bare { legal:false }) is returned. The rule logic here MUST match
 * `src/moveRule.ts#isLegalMove` so LocalSecrets and LitSecrets agree.
 *
 * `Lit`, `ethers`, and the jsParams are injected into the Action runtime by the
 * Lit node; this file is not imported by the TypeScript build.
 */

/* global Lit, ethers, ciphertext, dataHash, conditions, sessionSigs,
   playedCard, topOfDiscard, activeColor, player, system, nonce, validUntil */

const PKP_PUBLIC_KEY = "0x<REPLACE_WITH_PINNED_PKP_PUBLIC_KEY>";

function decodeHand(bytes) {
  const cards = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    cards.push({
      id: bytes[i],
      color: bytes[i + 1],
      number: bytes[i + 2],
      isWild: bytes[i + 3] === 1,
    });
  }
  return cards;
}

function decodeCard(encoded) {
  return { color: (encoded >> 8) & 0xff, number: encoded & 0xff };
}

const go = async () => {
  // 1. Decrypt the hand INSIDE the enclave. Plaintext never leaves this scope.
  const handBytes = await Lit.Actions.decryptAndCombine({
    accessControlConditions: conditions,
    ciphertext,
    dataToEncryptHash: dataHash,
    chain: "mantleSepoliaTestnet",
    authSig: null,
    sessionSigs,
  });
  const hand = decodeHand(handBytes);

  // 2. Rule check: card in hand AND matches active color or discard number, or wild.
  const card = hand.find((c) => c.id === playedCard);
  const top = decodeCard(topOfDiscard);
  const legal = !!card && (card.isWild || card.color === activeColor || card.number === top.number);

  if (!legal) {
    // Do NOT sign. Bare rejection reveals nothing about the hand.
    Lit.Actions.setResponse({ response: JSON.stringify({ legal: false }) });
    return;
  }

  // 3. Build the attestation payload (NO hand data). Mirrors src/attestation.ts.
  const payload = ethers.utils.defaultAbiCoder.encode(
    ["address", "string", "uint8", "uint256", "uint256"],
    [player, system, playedCard, ethers.BigNumber.from(nonce), ethers.BigNumber.from(validUntil)],
  );
  const digest = ethers.utils.keccak256(payload);
  // EIP-191 prefix so the on-chain verifier recovers via toEthSignedMessageHash.
  const toSign = ethers.utils.arrayify(ethers.utils.hashMessage(ethers.utils.arrayify(digest)));

  // 4. Sign with the Action's PKP (key never leaves the threshold network).
  const sig = await Lit.Actions.signEcdsa({
    toSign,
    publicKey: PKP_PUBLIC_KEY,
    sigName: "attest",
  });

  // 5. Return ONLY the attestation. The hand stays sealed and private.
  Lit.Actions.setResponse({
    response: JSON.stringify({ legal: true, payload, signature: sig }),
  });
};

go();

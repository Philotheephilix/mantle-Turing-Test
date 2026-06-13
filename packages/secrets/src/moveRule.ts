/**
 * The UNO move-legality rule, extracted as a pure function so it can be unit
 * tested directly and shared between {@link LocalSecrets} and the Lit Action
 * template (phase-08 Task 9). The TEE-run Action and the local adapter MUST run
 * identical logic so attestations are consistent across paths.
 */

/** A decoded UNO card. `id` is the card's stable identifier within a hand. */
export type Card = {
  id: number;
  color: number;
  number: number;
  isWild: boolean;
};

/**
 * Encode a hand of cards to bytes for sealing. Each card is 4 bytes:
 * [id, color, number, isWild]. Compact and deterministic.
 */
export function encodeHand(hand: Card[]): Uint8Array {
  const out = new Uint8Array(hand.length * 4);
  hand.forEach((c, i) => {
    out[i * 4 + 0] = c.id & 0xff;
    out[i * 4 + 1] = c.color & 0xff;
    out[i * 4 + 2] = c.number & 0xff;
    out[i * 4 + 3] = c.isWild ? 1 : 0;
  });
  return out;
}

/** Inverse of {@link encodeHand}. */
export function decodeHand(bytes: Uint8Array): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    cards.push({
      id: bytes[i] ?? 0,
      color: bytes[i + 1] ?? 0,
      number: bytes[i + 2] ?? 0,
      isWild: (bytes[i + 3] ?? 0) === 1,
    });
  }
  return cards;
}

/** Decode a single public card id into `{ color, number }` (top-of-discard form). */
export function decodeCard(encoded: number): { color: number; number: number } {
  // Public discard-top encoding: high byte = color, low byte = number.
  return { color: (encoded >> 8) & 0xff, number: encoded & 0xff };
}

/**
 * The legality check (design §8.3): the played card must be in the hand AND
 * match the active color or the discard top's number, OR be a wild.
 */
export function isLegalMove(args: {
  hand: Card[];
  playedCard: number;
  topOfDiscard: number;
  activeColor: number;
}): boolean {
  const { hand, playedCard, topOfDiscard, activeColor } = args;
  const card = hand.find((c) => c.id === playedCard);
  if (!card) return false;
  const top = decodeCard(topOfDiscard);
  return card.isWild || card.color === activeColor || card.number === top.number;
}

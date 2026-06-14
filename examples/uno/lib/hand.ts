/**
 * The player's hand model for the Nexus UNO example.
 *
 * Hidden card identities are dealt client-side (deterministically, from the
 * player's address) and only the public board (top card + active color) plus
 * each player's hand COUNT live on-chain. On-chain `UnoGameSystem` enforces turn
 * + legality against the public top card; this module decides WHICH card to play.
 *
 * Winnability guarantee: every hand's LAST card is a WILD (always legal), so a
 * player is never stuck — they can always make a legal play and never need to
 * grow their hand by drawing. With equal hand sizes the first seat to act empties
 * first, so the game always terminates in a real on-chain WIN.
 */
import type { UnoCard } from "../components/Card";

/** Default cards dealt to each seat. Small for a fast, deterministic finish. */
export const HAND_SIZE = 3;

/** Deterministic PRNG seeded from a string (stable across reloads/processes). */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * Deal a deterministic hand of `size` cards for `seed` (a player address).
 *
 * Every card is a WILD. A wild is always a legal play (the on-chain
 * `UnoGameSystem` accepts color==0 with any chosen active color), so a player is
 * NEVER stuck: every turn strictly shrinks their hand by one, and the game always
 * terminates in a real on-chain WIN (with equal hands, the first seat to act
 * empties first). The chosen new active color rotates for visual variety. This is
 * the documented rules-simplification that keeps the demo deterministic + winnable.
 */
export function dealHand(seed: string, size = HAND_SIZE): UnoCard[] {
  const next = rng(seed);
  const cards: UnoCard[] = [];
  for (let i = 0; i < size; i++) {
    // The "number" carries the chosen new active color (1..4) when played.
    cards.push({ color: 0, number: 1 + Math.floor(next() * 4), wild: true });
  }
  return cards;
}

/** Back-compat alias used by the existing UI import. */
export const deriveHand = (seed: string): UnoCard[] => dealHand(seed, HAND_SIZE);

export interface Board {
  topColor: number; // 0 = wild marker
  topNumber: number;
  activeColor: number;
}

/** A card is legal iff it's a wild, matches the active color, or matches the top number. */
export function isLegal(card: UnoCard, board: Board): boolean {
  if (card.wild || card.color === 0) return true;
  const matchesColor = card.color === board.activeColor;
  const matchesNumber = board.topColor !== 0 && card.number === board.topNumber;
  return matchesColor || matchesNumber;
}

/**
 * Choose which card to play from `hand` given `board`. Prefers a legal NON-wild
 * card (saving the wild as a fallback); plays the wild only when nothing else is
 * legal. Returns the hand index and the on-chain move args, or null if (somehow)
 * nothing is legal — in which case the caller draws.
 */
export function chooseMove(
  hand: UnoCard[],
  board: Board,
): { index: number; color: number; number: number } | null {
  // Prefer a legal colored card (saving wilds as a fallback).
  for (let i = 0; i < hand.length; i++) {
    const c = hand[i];
    if (!c.wild && c.color !== 0 && isLegal(c, board)) {
      return { index: i, color: c.color, number: c.number };
    }
  }
  // Play a wild (always legal); its `number` carries the chosen new active color.
  for (let i = 0; i < hand.length; i++) {
    const c = hand[i];
    if (c.wild || c.color === 0) {
      const chosen = c.number >= 1 && c.number <= 4 ? c.number : 1;
      return { index: i, color: 0, number: chosen };
    }
  }
  return null;
}

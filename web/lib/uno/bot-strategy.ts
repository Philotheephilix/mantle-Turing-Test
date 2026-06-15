/**
 * Real UNO bot strategy. The bot picks a LEGAL play by sensible heuristics and
 * submits it through the Nexus SDK exactly like the human — no random/illegal
 * moves. If nothing is legal it draws.
 *
 * Heuristics (in priority order), all over the server-authoritative legal set:
 *   1. Prefer playing a colored ACTION card (Skip/Reverse/Draw Two) that matches
 *      the current color — pressure the next player while shedding a high card.
 *   2. Otherwise prefer a plain number card that matches the current color
 *      (keeps a same-color chain going, conserves cross-matching numbers).
 *   3. Otherwise any other legal non-wild (a value/symbol match in another color).
 *   4. Otherwise a Wild / Wild Draw Four (saved as a last resort, since wilds are
 *      the most flexible cards to hold).
 * When forced to choose a color for a wild, pick the bot's MOST-HELD color so it
 * is most likely to be able to follow up next turn.
 */
import {
  type UnoCard,
  type TopState,
  isWildCard,
  isWildValue,
  legalPlays,
  SKIP,
  REVERSE,
  DRAW_TWO,
  WILD_DRAW_FOUR,
} from "./uno-rules";

export interface BotMove {
  /** index into the bot's hand */
  index: number;
  card: UnoCard;
  /** chosen active color (1..4) when the card is a wild; else the card's color */
  chosenColor: number;
}

/** The color the bot holds most of (excluding wilds); ties → first seen; default red. */
export function mostHeldColor(hand: UnoCard[]): number {
  const counts = [0, 0, 0, 0, 0]; // index by color 0..4 (0 unused)
  for (const c of hand) if (!isWildCard(c) && c.color >= 1 && c.color <= 4) counts[c.color]++;
  let best = 1;
  for (let color = 2; color <= 4; color++) if (counts[color] > counts[best]) best = color;
  return best;
}

const isColoredAction = (c: UnoCard) =>
  c.color !== 0 && (c.value === SKIP || c.value === REVERSE || c.value === DRAW_TWO);

/** Choose the bot's move, or null to draw (no legal play available). */
export function chooseBotMove(hand: UnoCard[], top: TopState): BotMove | null {
  const legal = legalPlays(hand, top);
  if (legal.length === 0) return null;

  const pick = (idx: number): BotMove => {
    const card = hand[idx];
    const chosenColor = isWildCard(card) ? mostHeldColor(hand) : card.color;
    return { index: idx, card, chosenColor };
  };

  // 1) colored action card matching the active color.
  const action = legal.find((i) => isColoredAction(hand[i]) && hand[i].color === top.activeColor);
  if (action !== undefined) return pick(action);

  // 2) plain number card matching the active color.
  const numColor = legal.find((i) => hand[i].value <= 9 && hand[i].color === top.activeColor);
  if (numColor !== undefined) return pick(numColor);

  // 3) any other legal non-wild (value/symbol match in another color).
  const nonWild = legal.find((i) => !isWildCard(hand[i]));
  if (nonWild !== undefined) return pick(nonWild);

  // 4) a wild — prefer plain Wild over Wild Draw Four when both are legal.
  const plainWild = legal.find((i) => isWildValue(hand[i].value) && hand[i].value !== WILD_DRAW_FOUR);
  if (plainWild !== undefined) return pick(plainWild);
  return pick(legal[0]);
}

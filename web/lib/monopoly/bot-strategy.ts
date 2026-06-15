/**
 * Bot decision logic (pure). Given the current game snapshot for the bot whose turn
 * it is, decide the next single action. The bot plays a real strategy:
 *   - leave jail (pay the $50 fine / use a card) when it has a cushion
 *   - buy any affordable property it lands on (keeping a small cash reserve)
 *   - build houses when it owns a full color group and is flush
 *   - mortgage when short on cash (handled automatically by the engine on a debt)
 *   - otherwise roll / end the turn
 */
import { BOARD, GROUP_MEMBERS, type ColorGroup, isOwnable } from "./board";
import type { GameSnapshot } from "./monopoly-rules";

const CASH_RESERVE = 30; // small buffer; bots play aggressively to force a finish
const BUILD_RESERVE = 20; // build whenever owning a monopoly + barely affordable

export type BotAction =
  | { kind: "payJail" }
  | { kind: "roll" }
  | { kind: "buy" }
  | { kind: "decline" }
  | { kind: "build"; spaceId: number }
  | { kind: "end" };

function ownsFullGroup(snap: GameSnapshot, id: string, group: ColorGroup): boolean {
  const members = GROUP_MEMBERS[group] ?? [];
  return members.length > 0 && members.every((sp) => snap.properties[sp]?.owner === id);
}

export function decideBotAction(snap: GameSnapshot, botId: string): BotAction {
  const me = snap.players.find((p) => p.id === botId.toLowerCase());
  if (!me) return { kind: "end" };

  // Resolve a pending buy first. Bots buy any property they can afford while keeping
  // a tiny reserve — acquiring property is how monopolies (and a real finish) form.
  if (snap.pending?.kind === "buy") {
    const price = snap.pending.price;
    return me.cash - price >= 10 ? { kind: "buy" } : { kind: "decline" };
  }

  // If a pay/other pending exists the engine settles it automatically; just end.
  if (snap.pending?.kind === "pay") return { kind: "end" };

  // In jail and hasn't rolled: try to leave if flush (pay fine / use card).
  if (me.inJail && !snap.rolledThisTurn) {
    if (me.getOutCards > 0 || me.cash >= 100) return { kind: "payJail" };
    return { kind: "roll" }; // try doubles
  }

  // Haven't rolled yet this turn → roll.
  if (!snap.rolledThisTurn) return { kind: "roll" };

  // Post-roll: build on a complete group whenever affordable (aggressive — drives
  // rents up so a real bankruptcy finish is reached within the round budget).
  if (snap.pending?.kind === "end") {
    let bestBuild: { spaceId: number; minH: number } | null = null;
    for (const sp of BOARD) {
      if (sp.kind !== "property" || !sp.group) continue;
      const pr = snap.properties[sp.id];
      if (!pr || pr.owner !== me.id || pr.mortgaged) continue;
      if (!ownsFullGroup(snap, me.id, sp.group)) continue;
      if (pr.houses >= 5) continue;
      const members = GROUP_MEMBERS[sp.group];
      const minH = Math.min(...members.map((m) => snap.properties[m].houses));
      if (pr.houses > minH) continue; // must build evenly
      if (members.some((m) => snap.properties[m].mortgaged)) continue;
      if ((sp.houseCost ?? 0) > me.cash - BUILD_RESERVE) continue;
      if (!bestBuild || pr.houses < bestBuild.minH) bestBuild = { spaceId: sp.id, minH: pr.houses };
    }
    if (bestBuild) return { kind: "build", spaceId: bestBuild.spaceId };
  }

  return { kind: "end" };
}

export { isOwnable };

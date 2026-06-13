import type { EconomyConfig } from "@nexus/core";
import { NexusError } from "@nexus/types";

/**
 * Rake + pro-rata refund math (phase-05 §4.9). All amounts are decimal strings in
 * human (USDC) units to avoid float drift on the wire; internal math uses integer
 * micro-USDC (6 decimals) so winner payout + rake == pot exactly.
 */
const DECIMALS = 6n;
const SCALE = 10n ** DECIMALS;

function toMicro(human: string): bigint {
  const [whole, frac = ""] = human.split(".");
  const fracPadded = `${frac}000000`.slice(0, 6);
  return BigInt(whole || "0") * SCALE + BigInt(fracPadded || "0");
}

function fromMicro(micro: bigint): string {
  const whole = micro / SCALE;
  const frac = (micro % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** rake fraction in [0,1) from the game economy; 0 when no pot config. */
export function rakeFraction(economy: EconomyConfig | undefined): number {
  const r = economy?.pot ? Number(economy.pot.rake) : 0;
  if (!(r >= 0 && r < 1)) throw new NexusError("INVALID_CONFIG", `bad rake fraction ${r}`);
  return r;
}

export interface PayoutSplit {
  winner: string;
  rake: string;
}

/** Winner gets pot minus rake; payout + rake == pot exactly. */
export function computePayout(potHuman: string, economy: EconomyConfig | undefined): PayoutSplit {
  const pot = toMicro(potHuman);
  const r = rakeFraction(economy);
  // rake = floor(pot * r) using integer math at 1e6 resolution of r.
  const rNum = BigInt(Math.round(r * 1_000_000));
  const rake = (pot * rNum) / 1_000_000n;
  const winner = pot - rake;
  return { winner: fromMicro(winner), rake: fromMicro(rake) };
}

export interface RefundShare {
  player: string;
  amount: string;
}

/**
 * Pro-rata refund of an abandoned pot: each participant gets their equal share of
 * the un-rake'd pot; the shares sum to the full pot (dust goes to the first).
 */
export function computeRefunds(potHuman: string, participants: string[]): RefundShare[] {
  if (participants.length === 0) return [];
  const pot = toMicro(potHuman);
  const base = pot / BigInt(participants.length);
  const remainder = pot - base * BigInt(participants.length);
  return participants.map((player, i) => ({
    player,
    amount: fromMicro(i === 0 ? base + remainder : base),
  }));
}

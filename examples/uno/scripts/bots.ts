/**
 * The UNO bot driver — a backend script that runs the bot players.
 *
 *   pnpm --filter @nexus/example-uno bots          # default 2 bots
 *
 * Each bot has a generated + funded key (from players.local.json), signs its OWN
 * delegations (gameplay + budget) with its OWN key, pays the entry fee via x402
 * (real USDC from its wallet → Pot), and on its turn submits a gasless move
 * through the server until the game ends.
 *
 * This script ALSO orchestrates the game: it calls /api/new-game with the human
 * (seat 0) + bot seats, so the human's browser just connects, discovers its seat
 * via /api/state, pays, and plays its turns. The human (seat 0) acts first and,
 * with equal hands, empties first — so a human win is the deterministic outcome,
 * but the bots will finish the game even if the human is idle (they keep playing
 * on their turns; the on-chain win is whoever empties first).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "@nexus/types";
import type { SignedDelegation } from "@nexus/core";
import { getEngine, signBudgetDelegation, signGameplayDelegation } from "../lib/engine";
import { deployment } from "../lib/deployment";
import { dealHand, chooseMove, type Board } from "../lib/hand";
import { ENTRY_FEE_USDC } from "../lib/config";
import type { UnoCard } from "../components/Card";

const SERVER = process.env.UNO_BACKEND_URL ?? "http://localhost:8790";
const PLAYERS = join(import.meta.dirname, "..", "players.local.json");
const FEE = process.env.ENTRY_FEE ?? ENTRY_FEE_USDC;
// Per-action cap must cover the fee; lifetime cap a small multiple.
const PER_ACTION_CAP = process.env.PER_ACTION_CAP ?? "1";
const TOTAL_CAP = process.env.TOTAL_CAP ?? "2";

interface PlayerKey { role: "human" | "bot"; index: number; privateKey: Hex; address: Address }

function bigintSafe(body: unknown): string {
  return JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}
async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${SERVER}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: bigintSafe(body) });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { ok: false, error: `non-json (${res.status}): ${text.slice(0, 200)}` }; }
  return { status: res.status, body: parsed };
}
async function getState(): Promise<any> {
  const res = await fetch(`${SERVER}/api/state`);
  return res.json().catch(() => ({ ok: false }));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { players } = JSON.parse(readFileSync(PLAYERS, "utf8")) as { players: PlayerKey[] };
  const human = players.find((p) => p.role === "human");
  const bots = players.filter((p) => p.role === "bot");
  if (!human || bots.length === 0) throw new Error("players.local.json needs a human + ≥1 bot (run fund-players)");

  const e = await getEngine();
  console.log(`[bots] ${bots.length} bot(s): ${bots.map((b) => b.address).join(", ")}`);
  console.log(`[bots] human seat: ${human.address}`);

  // Orchestrate: create a fresh game (human seat 0 + bots).
  const newGame = await post("/api/new-game", { human: human.address, bots: bots.map((b) => b.address), fee: FEE });
  if (!newGame.body.ok) throw new Error(`new-game failed: ${JSON.stringify(newGame.body)}`);
  const roomId = newGame.body.roomId as string;
  console.log(`[bots] game room ${roomId} created; human plays via the browser UI.`);

  // Per-bot: deterministic hand + signed delegations.
  const botCtx = await Promise.all(
    bots.map(async (b) => {
      const account = privateKeyToAccount(b.privateKey);
      const hand: UnoCard[] = dealHand(b.address);
      const signedGameplay: SignedDelegation = await signGameplayDelegation(account, BigInt(roomId));
      const signedBudget: SignedDelegation = await signBudgetDelegation(account, deployment.pot, PER_ACTION_CAP, TOTAL_CAP);
      return { ...b, account, hand, signedGameplay, signedBudget, paid: false };
    }),
  );

  // Each bot pays its entry fee (real x402, sequential at the server's queue). A
  // charge failure (e.g. a drained testnet wallet) is non-fatal: the bot still
  // takes its gasless turns so the game completes — only its buy-in is skipped.
  for (const b of botCtx) {
    const r = await post("/api/charge", { player: b.address, signedBudget: b.signedBudget });
    if (!r.body.ok) {
      console.warn(`[bots] bot#${b.index} entry-fee charge skipped: ${r.body.error?.slice?.(0, 120) ?? r.body.error}`);
      continue;
    }
    b.paid = true;
    console.log(`[bots] bot#${b.index} PAID ${FEE} USDC — tx ${r.body.txHash}`);
  }

  // Play loop: on each bot's turn, choose + submit a legal move until a winner.
  const DEADLINE = Date.now() + 8 * 60_000;
  while (Date.now() < DEADLINE) {
    const st = await getState();
    if (!st.ok) { await sleep(1500); continue; }
    if (st.winner) {
      console.log(`[bots] game over — winner ${st.winner}; payout tx ${st.payoutTx}`);
      return;
    }
    const current: Address | null = st.currentTurn;
    const bot = botCtx.find((b) => current && b.address.toLowerCase() === current.toLowerCase());
    if (!bot) { await sleep(1500); continue; } // human's (or another) turn

    const board: Board = st.board;
    const choice = chooseMove(bot.hand, board);
    try {
      if (!choice) {
        const r = await post("/api/move", { player: bot.address, signedGameplay: bot.signedGameplay, kind: "draw" });
        if (!r.body.ok) { console.log(`[bots] bot#${bot.index} draw rejected: ${r.body.error}`); await sleep(1500); continue; }
        bot.hand.push({ color: 0, number: 0, wild: true }); // drew a fallback wild
        console.log(`[bots] bot#${bot.index} drew — tx ${r.body.txHash}`);
      } else {
        const r = await post("/api/move", { player: bot.address, signedGameplay: bot.signedGameplay, kind: "play", card: { color: choice.color, number: choice.number } });
        if (!r.body.ok) { console.log(`[bots] bot#${bot.index} play rejected: ${r.body.error}`); await sleep(1500); continue; }
        bot.hand.splice(choice.index, 1);
        console.log(`[bots] bot#${bot.index} played ${choice.color === 0 ? "WILD→" + choice.number : choice.color + "/" + choice.number} (${bot.hand.length} left) — tx ${r.body.txHash}`);
        if (r.body.winner) { console.log(`[bots] WINNER ${r.body.winner}; payout tx ${r.body.payoutTx}`); return; }
      }
    } catch (err) {
      console.log(`[bots] bot#${bot.index} move error:`, err instanceof Error ? err.message : err);
      await sleep(1500);
    }
    await sleep(800);
  }
  console.log("[bots] deadline reached without a winner.");
}

main().catch((err) => {
  console.error("[bots] fatal:", err);
  process.exit(1);
});

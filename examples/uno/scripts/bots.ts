/**
 * The UNO bot driver — runs the bot players against the authoritative full-rules
 * server.
 *
 *   pnpm --filter @nexus/example-uno bots          # default 2 bots
 *
 * Each bot has a generated + funded key (players.local.json), signs its OWN
 * delegations (gameplay + budget) with its OWN key, pays the entry fee via x402
 * (real USDC → Pot), and on its turn:
 *   1. fetches its REAL, server-sealed hand from /api/hand (owner-gated),
 *   2. picks a LEGAL play by real UNO strategy (lib/bot-strategy.ts) — preferring
 *      colored action/number matches, choosing its most-held color for wilds — or
 *      draws when nothing is legal,
 *   3. submits the move through the SDK exactly like the human.
 * No random or illegal moves: legality is decided by the server-authoritative
 * rules and the bot only ever submits a card the server says is legal.
 *
 * This script ALSO orchestrates the game: it calls /api/new-game with the human
 * (seat 0) + bot seats, so the human's browser just connects, pays, and plays.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "@nexus/types";
import type { SignedDelegation } from "@nexus/core";
import { getEngine, signBudgetDelegation, signGameplayDelegation } from "../lib/engine";
import { deployment } from "../lib/deployment";
import { type UnoCard, type TopState, cardLabel } from "../lib/uno-rules";
import { chooseBotMove } from "../lib/bot-strategy";
import { ENTRY_FEE_USDC } from "../lib/config";

const SERVER = process.env.UNO_BACKEND_URL ?? "http://localhost:8790";
const PLAYERS = join(import.meta.dirname, "..", "players.local.json");
const FEE = process.env.ENTRY_FEE ?? ENTRY_FEE_USDC;
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

  await getEngine();
  console.log(`[bots] ${bots.length} bot(s): ${bots.map((b) => b.address).join(", ")}`);
  console.log(`[bots] human seat: ${human.address}`);

  // Orchestrate: create a fresh game (human seat 0 + bots).
  const newGame = await post("/api/new-game", { human: human.address, bots: bots.map((b) => b.address), fee: FEE });
  if (!newGame.body.ok) throw new Error(`new-game failed: ${JSON.stringify(newGame.body)}`);
  const roomId = newGame.body.roomId as string;
  console.log(`[bots] game room ${roomId} created (on-chain shuffle ${newGame.body.shuffleTx}); human plays via the browser UI.`);

  // Per-bot: signed delegations (each with its OWN key).
  const botCtx = await Promise.all(
    bots.map(async (b) => {
      const account = privateKeyToAccount(b.privateKey);
      const signedGameplay: SignedDelegation = await signGameplayDelegation(account, BigInt(roomId));
      const signedBudget: SignedDelegation = await signBudgetDelegation(account, deployment.pot, PER_ACTION_CAP, TOTAL_CAP);
      return { ...b, account, signedGameplay, signedBudget, paid: false };
    }),
  );

  // Each bot pays its entry fee (real x402). A charge failure is non-fatal.
  for (const b of botCtx) {
    const r = await post("/api/charge", { player: b.address, signedBudget: b.signedBudget });
    if (!r.body.ok) {
      console.warn(`[bots] bot#${b.index} entry-fee charge skipped: ${r.body.error?.slice?.(0, 120) ?? r.body.error}`);
      continue;
    }
    b.paid = true;
    console.log(`[bots] bot#${b.index} PAID ${FEE} USDC — tx ${r.body.txHash}`);
  }

  // Play loop: on each bot's turn, fetch its real hand, pick a legal move, submit.
  const DEADLINE = Date.now() + 12 * 60_000;
  while (Date.now() < DEADLINE) {
    const st = await getState();
    if (!st.ok) { await sleep(1500); continue; }
    if (st.winner) {
      console.log(`[bots] game over — winner ${st.winner}; payout tx ${st.payoutTx}`);
      return;
    }
    const current: Address | null = st.currentTurn;
    const bot = botCtx.find((b) => current && b.address.toLowerCase() === current.toLowerCase());
    if (!bot) { await sleep(1200); continue; } // human's (or another bot's) turn

    // Fetch this bot's real, server-sealed hand.
    const handRes = await post("/api/hand", { player: bot.address });
    if (!handRes.body.ok) { await sleep(1200); continue; }
    const hand = handRes.body.hand as UnoCard[];
    const top: TopState = st.board;
    const move = chooseBotMove(hand, top);

    try {
      if (!move) {
        const r = await post("/api/move", { player: bot.address, signedGameplay: bot.signedGameplay, kind: "draw" });
        if (!r.body.ok) { console.log(`[bots] bot#${bot.index} draw rejected: ${r.body.error}`); await sleep(1200); continue; }
        console.log(`[bots] bot#${bot.index} drew (${r.body.playable ? "playable" : "passed"})`);
        await sleep(600);
        continue;
      }
      const r = await post("/api/move", {
        player: bot.address,
        signedGameplay: bot.signedGameplay,
        kind: "play",
        card: move.card,
        chosenColor: move.chosenColor,
      });
      if (!r.body.ok) { console.log(`[bots] bot#${bot.index} play rejected: ${r.body.error}`); await sleep(1200); continue; }
      console.log(`[bots] bot#${bot.index} played ${cardLabel(move.card)}${move.card.color === 0 ? ` → ${["", "red", "green", "blue", "yellow"][move.chosenColor]}` : ""} (${hand.length - 1} left) — tx ${r.body.txHash}`);
      if (r.body.winner) { console.log(`[bots] WINNER ${r.body.winner}; payout tx ${r.body.payoutTx}`); return; }
    } catch (err) {
      console.log(`[bots] bot#${bot.index} move error:`, err instanceof Error ? err.message : err);
      await sleep(1200);
    }
    await sleep(700);
  }
  console.log("[bots] deadline reached without a winner.");
}

main().catch((err) => {
  console.error("[bots] fatal:", err);
  process.exit(1);
});

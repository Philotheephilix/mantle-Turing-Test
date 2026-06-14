/**
 * Headless full-game smoke test: plays a COMPLETE, REAL game of UNO to a real win
 * — every seat (the "human" seat 0 + the bots) driven by this script through the
 * SDK, against the live authoritative server on Base Sepolia. Prints the winning
 * legal-move sequence and the on-chain tx hashes (entry fees, every move, payout).
 *
 *   pnpm --filter @nexus/example-uno smoke
 *
 * Requires the server running (pnpm server) and funded players (pnpm fund-players).
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

interface PlayerKey { role: "human" | "bot"; index: number; privateKey: Hex; address: Address }

function bigintSafe(b: unknown): string {
  return JSON.stringify(b, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}
async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${SERVER}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: bigintSafe(body) });
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { ok: false, error: `non-json (${res.status})` }; }
}
async function getState(): Promise<any> {
  return (await fetch(`${SERVER}/api/state`)).json().catch(() => ({ ok: false }));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const colorName = (c: number) => ["wild", "red", "green", "blue", "yellow"][c] ?? "?";

async function main() {
  const { players } = JSON.parse(readFileSync(PLAYERS, "utf8")) as { players: PlayerKey[] };
  const human = players.find((p) => p.role === "human")!;
  const bots = players.filter((p) => p.role === "bot");
  if (!human || bots.length === 0) throw new Error("run fund-players first");

  await getEngine();
  const order = [human, ...bots];
  console.log(`[smoke] seats: ${order.map((p, i) => `${i === 0 ? "human" : `bot${i - 1}`}=${p.address.slice(0, 8)}`).join(", ")}`);

  const game = await post("/api/new-game", { human: human.address, bots: bots.map((b) => b.address), fee: FEE });
  if (!game.ok) throw new Error(`new-game failed: ${JSON.stringify(game)}`);
  const roomId = game.roomId as string;
  const startTop = game.board;
  console.log(`[smoke] room ${roomId} — ON-CHAIN shuffle tx ${game.shuffleTx}`);
  console.log(`[smoke] start card: ${colorName(startTop.topColor)} ${startTop.topValue} (active ${colorName(startTop.activeColor)})`);

  // Sign delegations for every seat (each with its OWN key) + pay entry fee.
  const ctx = await Promise.all(
    order.map(async (p) => {
      const account = privateKeyToAccount(p.privateKey);
      const signedGameplay = await signGameplayDelegation(account, BigInt(roomId));
      const signedBudget = await signBudgetDelegation(account, deployment.pot, "1", "2");
      return { ...p, account, signedGameplay, signedBudget };
    }),
  );

  console.log("\n[smoke] entry fees (real x402 USDC → Pot):");
  for (const p of ctx) {
    const r = await post("/api/charge", { player: p.address, signedBudget: p.signedBudget });
    console.log(`  ${p.role === "human" ? "human" : `bot${p.index}`} ${p.address.slice(0, 8)} → ${r.ok ? `PAID tx ${r.txHash}` : `skipped (${String(r.error).slice(0, 80)})`}`);
  }

  console.log("\n[smoke] playing to a real win:");
  const seq: string[] = [];
  const deadline = Date.now() + 12 * 60_000;
  let moves = 0;
  while (Date.now() < deadline) {
    const st = await getState();
    if (!st.ok) { await sleep(800); continue; }
    if (st.winner) {
      const who = order.find((p) => p.address.toLowerCase() === String(st.winner).toLowerCase());
      console.log(`\n[smoke] WINNER: ${who?.role === "human" ? "human" : `bot${who?.index}`} ${st.winner}`);
      console.log(`[smoke] pot payout tx: ${st.payoutTx}`);
      console.log(`[smoke] total legal moves played: ${moves}`);
      console.log("\n[smoke] winning move sequence:");
      for (const s of seq) console.log(`  ${s}`);
      return;
    }
    const cur: Address = st.currentTurn;
    const seat = ctx.find((p) => p.address.toLowerCase() === cur.toLowerCase());
    if (!seat) { await sleep(600); continue; }

    const handRes = await post("/api/hand", { player: seat.address });
    if (!handRes.ok) { await sleep(600); continue; }
    const hand = handRes.hand as UnoCard[];
    const top: TopState = st.board;
    const move = chooseBotMove(hand, top);
    const label = seat.role === "human" ? "human" : `bot${seat.index}`;

    if (!move) {
      const r = await post("/api/move", { player: seat.address, signedGameplay: seat.signedGameplay, kind: "draw" });
      if (!r.ok) { await sleep(800); continue; }
      seq.push(`${label} drew a card (${r.playable ? "playable" : "passed"}) — tx ${r.txHash}`);
      moves++;
      await sleep(400);
      continue;
    }
    const r = await post("/api/move", { player: seat.address, signedGameplay: seat.signedGameplay, kind: "play", card: move.card, chosenColor: move.chosenColor });
    if (!r.ok) { console.log(`  (${label} play rejected: ${r.error}) retrying…`); await sleep(800); continue; }
    const wildPick = move.card.color === 0 ? ` → ${colorName(move.chosenColor)}` : "";
    seq.push(`${label} played ${cardLabel(move.card)}${wildPick} (${hand.length - 1} left) — tx ${r.txHash}`);
    console.log(`  ${seq[seq.length - 1]}`);
    moves++;
    if (r.winner) continue; // next loop reports the win + payout
    await sleep(400);
  }
  throw new Error("[smoke] deadline reached without a winner");
}

main().catch((err) => {
  console.error("[smoke] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});

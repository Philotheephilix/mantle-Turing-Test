/**
 * Headless smoke for the HUMAN seat — mirrors exactly what the browser UI does,
 * but without a browser. Useful to validate the full money path (charge + gasless
 * moves to a win) end-to-end from the command line.
 *
 *   pnpm --filter @nexus/example-uno exec tsx scripts/human-sim.ts
 *
 * Needs the server (scripts/server.ts) + bots (scripts/bots.ts) running; bots
 * orchestrates /api/new-game with the human (seat 0). The human signs its OWN
 * delegations with its OWN funded key (from players.local.json).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "@nexus/types";
import { UnoClient } from "../lib/uno-client";
import { dealHand, chooseMove, type Board } from "../lib/hand";

const SERVER = process.env.UNO_BACKEND_URL ?? "http://localhost:8790";
const PLAYERS = join(import.meta.dirname, "..", "players.local.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { players } = JSON.parse(readFileSync(PLAYERS, "utf8")) as {
    players: { role: string; privateKey: Hex; address: Address }[];
  };
  const human = players.find((p) => p.role === "human")!;
  const account = privateKeyToAccount(human.privateKey);
  const client = new UnoClient(SERVER, account);
  let hand = dealHand(account.address);

  // Wait for a game where we are a seat.
  let roomId: string | null = null;
  let fee = "1";
  let pot: Address | null = null;
  for (let i = 0; i < 60 && !roomId; i++) {
    const st = await client.state();
    if (st.ok && st.seats.some((s) => s.address.toLowerCase() === account.address.toLowerCase())) {
      roomId = st.roomId;
      fee = st.fee;
      pot = st.pot;
    } else await sleep(1000);
  }
  if (!roomId || !pot) throw new Error("no game seat found (start bots first)");
  console.log(`[human] seated in room ${roomId}, fee ${fee}`);

  // Pay the entry fee (real x402 from the human's own wallet).
  const pay = await client.pay(pot, fee);
  if (!pay.ok || !pay.txHash) throw new Error(`pay failed: ${pay.error}`);
  console.log(`[human] PAID ${fee} USDC — tx ${pay.txHash}`);

  // Play loop.
  const DEADLINE = Date.now() + 8 * 60_000;
  while (Date.now() < DEADLINE) {
    const st = await client.state();
    if (st.winner) {
      console.log(`[human] game over — winner ${st.winner}; payout tx ${st.payoutTx}`);
      return;
    }
    const myTurn = st.currentTurn && st.currentTurn.toLowerCase() === account.address.toLowerCase();
    if (!myTurn) { await sleep(1200); continue; }
    const board: Board = st.board;
    const choice = chooseMove(hand, board);
    if (choice) {
      const r = await client.move(roomId, "play", { color: choice.color, number: choice.number });
      if (!r.ok) { console.log(`[human] play rejected: ${r.error}`); await sleep(1200); continue; }
      hand.splice(choice.index, 1);
      console.log(`[human] played ${choice.color === 0 ? "WILD→" + choice.number : choice.color + "/" + choice.number} (${hand.length} left) — tx ${r.txHash}`);
      if (r.winner) { console.log(`[human] WINNER ${r.winner}; payout tx ${r.payoutTx}`); return; }
    } else {
      const r = await client.move(roomId, "draw");
      if (r.ok) hand.push({ color: 0, number: 0, wild: true });
      await sleep(800);
    }
    await sleep(700);
  }
  console.log("[human] deadline without a win");
}

main().catch((e) => { console.error("[human-sim] fatal:", e); process.exit(1); });

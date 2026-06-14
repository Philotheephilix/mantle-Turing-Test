/**
 * The MONOPOLY bot driver — runs the bot players.
 *
 *   pnpm --filter @nexus-examples/monopoly bots          # default 2 bots
 *
 * Each bot has a generated + funded key (from players.local.json), signs its OWN
 * delegations (gameplay + budget) with its OWN key, pays the buy-in via x402 (real
 * USDC from its wallet → Pot), and on its turn submits a gasless dice roll. When a
 * bot lands on an owned property it PAYS RENT (real x402). Bots NEVER buy — only the
 * human buys — so the human deterministically reaches the property target and wins.
 *
 * This script also orchestrates the game: it calls /api/new-game (human seat 0 +
 * bots), so the human's browser just connects, discovers its seat, pays, and plays.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "@nexus/types";
import type { SignedDelegation } from "@nexus/core";
import { getEngine, signBudgetDelegation, signGameplayDelegation } from "../lib/engine";
import { deployment } from "../lib/deployment";
import { ENTRY_FEE_USDC } from "../lib/config";

const SERVER = process.env.MONOPOLY_BACKEND_URL ?? "http://localhost:8791";
const PLAYERS = join(import.meta.dirname, "..", "players.local.json");
const FEE = process.env.ENTRY_FEE ?? ENTRY_FEE_USDC;
// Budget caps must cover one charge (perAction) and the bot's lifetime spend.
const PER_ACTION_CAP = process.env.PER_ACTION_CAP ?? "0.5";
const TOTAL_CAP = process.env.TOTAL_CAP ?? "5";

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

  const newGame = await post("/api/new-game", { human: human.address, bots: bots.map((b) => b.address), fee: FEE });
  if (!newGame.body.ok) throw new Error(`new-game failed: ${JSON.stringify(newGame.body)}`);
  const roomId = newGame.body.roomId as string;
  console.log(`[bots] game room ${roomId} created; human plays via the browser UI.`);

  const botCtx = await Promise.all(
    bots.map(async (b) => {
      const account = privateKeyToAccount(b.privateKey);
      const signedGameplay: SignedDelegation = await signGameplayDelegation(account, BigInt(roomId));
      const signedBudget: SignedDelegation = await signBudgetDelegation(account, deployment.pot, PER_ACTION_CAP, TOTAL_CAP);
      return { ...b, account, signedGameplay, signedBudget, paid: false };
    }),
  );

  // Each bot pays its buy-in (real x402). A failure (e.g. a drained wallet) is
  // non-fatal: the bot still takes its turns so the game completes.
  for (const b of botCtx) {
    const r = await post("/api/charge", { player: b.address, signedBudget: b.signedBudget });
    if (!r.body.ok) {
      console.warn(`[bots] bot#${b.index} buy-in skipped: ${r.body.error?.slice?.(0, 120) ?? r.body.error}`);
      continue;
    }
    b.paid = true;
    console.log(`[bots] bot#${b.index} BUY-IN ${FEE} USDC — tx ${r.body.txHash}`);
  }

  const DEADLINE = Date.now() + 9 * 60_000;
  while (Date.now() < DEADLINE) {
    const st = await getState();
    if (!st.ok) { await sleep(1500); continue; }
    // STOP the instant a winner exists — no more rolls (saves gas + noise).
    if (st.winner) {
      console.log(`[bots] game over — winner ${st.winner}; payout tx ${st.payoutTx}`);
      return;
    }
    const current: Address | null = st.currentTurn;
    const bot = botCtx.find((b) => current && b.address.toLowerCase() === current.toLowerCase());
    if (!bot) { await sleep(1500); continue; }

    // Find this bot's seat to see if it has a pending action (rent) to resolve first.
    const seat = (st.seats as any[]).find((s) => s.address.toLowerCase() === bot.address.toLowerCase());
    const pending = seat?.pending as { kind: "buy" | "rent"; spaceId: number } | null;

    try {
      if (pending?.kind === "rent") {
        const r = await post("/api/rent", { player: bot.address, signedBudget: bot.signedBudget });
        // A 409 "game already won" (the human won between our read and this submit) is
        // benign — stop. Other rejections (stale turn) just retry next tick.
        if (r.body.winner || /already won/i.test(r.body.error ?? "")) { console.log(`[bots] game over — stopping.`); return; }
        if (!r.body.ok) { console.log(`[bots] bot#${bot.index} rent rejected: ${r.body.error}`); await sleep(1500); continue; }
        console.log(`[bots] bot#${bot.index} PAID RENT — tx ${r.body.txHash}`);
      } else if (pending?.kind === "buy") {
        // Bots NEVER buy (only the human buys, so the human is the deterministic
        // winner). Decline the pending buy so the bot can roll again next turn —
        // the property stays unowned for the human to claim.
        const r = await post("/api/skip", { player: bot.address });
        if (!r.body.ok) { console.log(`[bots] bot#${bot.index} skip rejected: ${r.body.error}`); await sleep(1500); continue; }
        console.log(`[bots] bot#${bot.index} declined to buy.`);
      } else {
        const r = await post("/api/roll", { player: bot.address, signedGameplay: bot.signedGameplay });
        if (/already won/i.test(r.body.error ?? "")) { console.log(`[bots] game over — stopping.`); return; }
        if (!r.body.ok) { console.log(`[bots] bot#${bot.index} roll rejected: ${r.body.error}`); await sleep(1500); continue; }
        console.log(`[bots] bot#${bot.index} rolled ${r.body.die1}+${r.body.die2} → ${r.body.space} (${r.body.pending?.kind ?? "free"}) — tx ${r.body.txHash}`);
      }
    } catch (err) {
      console.log(`[bots] bot#${bot.index} error:`, err instanceof Error ? err.message : err);
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

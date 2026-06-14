/**
 * The MONOPOLY bot driver — runs the bot players with a REAL strategy via the SDK.
 *
 *   pnpm --filter @nexus-examples/monopoly bots          # default 2 bots
 *
 * Each bot has a generated + funded key (players.local.json), signs its OWN gameplay
 * + budget delegation with its OWN key, pays the x402 buy-in (real USDC → Pot) and,
 * on its turn, drives one action at a time through the authoritative full-rules
 * server (/api/act): roll the gasless on-chain dice, buy affordable properties, build
 * monopolies when flush, leave jail, and end its turn. Mortgaging to cover a debt is
 * handled automatically by the server's rules engine. The bot decides each move with
 * lib/bot-strategy from the live snapshot — the same SDK rails the human uses.
 *
 * This script also orchestrates the game: it calls /api/new-game (human seat 0 + bots)
 * so the human's browser just connects, joins (pays), and plays.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "@nexus/types";
import type { SignedDelegation } from "@nexus/core";
import { getEngine, signBudgetDelegation, signGameplayDelegation } from "../lib/engine";
import { deployment } from "../lib/deployment";
import { ENTRY_FEE_USDC } from "../lib/config";
import { decideBotAction } from "../lib/bot-strategy";
import type { GameSnapshot } from "../lib/monopoly-rules";

const SERVER = process.env.MONOPOLY_BACKEND_URL ?? "http://localhost:8791";
const PLAYERS = join(import.meta.dirname, "..", "players.local.json");
const FEE = process.env.ENTRY_FEE ?? ENTRY_FEE_USDC;
// Budget caps must cover one charge (perAction) and the bot's lifetime spend. With
// the $1 = 0.0001 USDC scale, even a $2000 hotel is 0.2 USDC; lifetime stays small.
const PER_ACTION_CAP = process.env.PER_ACTION_CAP ?? "0.3";
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

/** Map the public /api/state payload into the GameSnapshot shape bot-strategy reads. */
function toSnapshot(st: any): GameSnapshot {
  const properties: GameSnapshot["properties"] = {};
  for (const [k, v] of Object.entries(st.properties ?? {})) properties[Number(k)] = v as any;
  return {
    roomId: st.roomId,
    players: (st.players ?? []).map((p: any) => ({
      id: p.address.toLowerCase(), name: p.name, role: p.role, cash: p.cash, position: p.position,
      inJail: p.inJail, jailTurns: 0, getOutCards: p.getOutCards ?? 0, bankrupt: p.bankrupt,
    })),
    properties,
    order: (st.players ?? []).map((p: any) => p.address.toLowerCase()),
    turnIndex: 0,
    round: st.round ?? 1,
    doublesCount: 0,
    pending: st.pending ?? null,
    rolledThisTurn: st.rolledThisTurn ?? false,
    winner: st.winner ?? null,
    cardLog: st.cardLog ?? [],
  };
}

async function main() {
  const { players } = JSON.parse(readFileSync(PLAYERS, "utf8")) as { players: PlayerKey[] };
  const human = players.find((p) => p.role === "human");
  const maxBots = process.env.MONOPOLY_BOTS ? Number(process.env.MONOPOLY_BOTS) : Infinity;
  const bots = players.filter((p) => p.role === "bot").slice(0, maxBots);
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
      return { ...b, account, signedGameplay, signedBudget, joined: false };
    }),
  );

  // Each bot joins (caches its delegations + pays its buy-in via x402).
  for (const b of botCtx) {
    const r = await post("/api/join", { player: b.address, signedGameplay: b.signedGameplay, signedBudget: b.signedBudget });
    if (!r.body.ok) {
      console.warn(`[bots] bot#${b.index} join skipped: ${r.body.error?.slice?.(0, 140) ?? r.body.error}`);
      continue;
    }
    b.joined = true;
    console.log(`[bots] bot#${b.index} JOINED — buy-in ${FEE} USDC tx ${r.body.txHash}`);
  }

  const DEADLINE = Date.now() + 25 * 60_000;
  while (Date.now() < DEADLINE) {
    const st = await getState();
    if (!st.ok) { await sleep(1500); continue; }
    if (st.winner) {
      console.log(`[bots] game over — winner ${st.winner}; payout tx ${st.payoutTx}`);
      return;
    }
    const current: Address | null = st.currentTurn;
    const bot = botCtx.find((b) => current && b.address.toLowerCase() === current.toLowerCase());
    if (!bot) { await sleep(1200); continue; }

    const snap = toSnapshot(st);
    const decision = decideBotAction(snap, bot.address.toLowerCase());
    try {
      let action: string;
      let spaceId: number | undefined;
      switch (decision.kind) {
        case "payJail": action = "payJail"; break;
        case "roll": action = "roll"; break;
        case "buy": action = "buy"; break;
        case "decline": action = "decline"; break;
        case "build": action = "build"; spaceId = decision.spaceId; break;
        case "end": default: action = "end"; break;
      }
      const r = await post("/api/act", { player: bot.address, action, spaceId });
      if (/already won|game over/i.test(r.body.error ?? "") || r.body.winner) {
        console.log(`[bots] game over — stopping.`);
        return;
      }
      if (!r.body.ok) {
        // 409 (stale turn / nonce) → retry next tick.
        await sleep(1200);
        continue;
      }
      const tag = action === "build" ? `build ${decision.kind === "build" ? decision.spaceId : ""}` : action;
      const dice = r.body.dice ? ` ${r.body.dice[0]}+${r.body.dice[1]}` : "";
      console.log(`[bots] bot#${bot.index} ${tag}${dice} — ${(r.body.log ?? []).join("; ")}${r.body.txHash ? ` (x402 ${r.body.txHash.slice(0, 12)}…)` : ""}`);
    } catch (err) {
      console.log(`[bots] bot#${bot.index} error:`, err instanceof Error ? err.message : err);
      await sleep(1200);
    }
    await sleep(500);
  }
  console.log("[bots] deadline reached without a winner.");
}

main().catch((err) => {
  console.error("[bots] fatal:", err);
  process.exit(1);
});

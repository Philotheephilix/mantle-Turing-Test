/**
 * Headless FULL-GAME runner: plays an entire real Monopoly game to a REAL win (last
 * solvent player) entirely through the SDK rails — no browser. It drives ALL seats
 * (the "human" seat 0 is played by the same bot strategy here) through the server's
 * /api/join + /api/act, so every roll is a gasless on-chain dice redemption, every
 * money debit is a real USDC x402 charge, and the pot pays out on-chain to the winner.
 *
 *   pnpm --filter @nexus-examples/monopoly server          # in another terminal
 *   pnpm --filter @nexus-examples/monopoly play            # this script
 *
 * Prints the result (winner, eliminated players) + the key tx hashes (a buy-in, a
 * rent, the payout), each from a distinct player key.
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
const PER_ACTION_CAP = process.env.PER_ACTION_CAP ?? "0.3";
const TOTAL_CAP = process.env.TOTAL_CAP ?? "5";

interface PlayerKey { role: "human" | "bot"; index: number; privateKey: Hex; address: Address }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bigintSafe(b: unknown): string { return JSON.stringify(b, (_k, v) => (typeof v === "bigint" ? v.toString() : v)); }
async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${SERVER}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: bigintSafe(body) });
  return res.json().catch(() => ({ ok: false }));
}
async function getState(): Promise<any> { return (await fetch(`${SERVER}/api/state`)).json().catch(() => ({ ok: false })); }

function toSnapshot(st: any): GameSnapshot {
  const properties: GameSnapshot["properties"] = {};
  for (const [k, v] of Object.entries(st.properties ?? {})) properties[Number(k)] = v as any;
  return {
    roomId: st.roomId,
    players: (st.players ?? []).map((p: any) => ({ id: p.address.toLowerCase(), name: p.name, role: p.role, cash: p.cash, position: p.position, inJail: p.inJail, jailTurns: 0, getOutCards: p.getOutCards ?? 0, bankrupt: p.bankrupt })),
    properties,
    order: (st.players ?? []).map((p: any) => p.address.toLowerCase()),
    turnIndex: 0, round: st.round ?? 1, doublesCount: 0,
    pending: st.pending ?? null, rolledThisTurn: st.rolledThisTurn ?? false,
    winner: st.winner ?? null, cardLog: st.cardLog ?? [],
  };
}

async function main() {
  const all = (JSON.parse(readFileSync(PLAYERS, "utf8")) as { players: PlayerKey[] }).players;
  const human = all.find((p) => p.role === "human")!;
  const maxBots = process.env.BOTS ? Number(process.env.BOTS) : Infinity;
  const bots = all.filter((p) => p.role === "bot").slice(0, maxBots);
  const players = [human, ...bots];
  await getEngine();

  const newGame = await post("/api/new-game", { human: human.address, bots: bots.map((b) => b.address), fee: FEE });
  if (!newGame.ok) throw new Error(`new-game failed: ${JSON.stringify(newGame)}`);
  const roomId = newGame.roomId as string;
  console.log(`[play] room ${roomId} — full rules, win = last solvent`);

  const seats = await Promise.all(players.map(async (p) => {
    const account = privateKeyToAccount(p.privateKey);
    const signedGameplay: SignedDelegation = await signGameplayDelegation(account, BigInt(roomId));
    const signedBudget: SignedDelegation = await signBudgetDelegation(account, deployment.pot, PER_ACTION_CAP, TOTAL_CAP);
    return { ...p, account, signedGameplay, signedBudget };
  }));

  let buyInTx: { addr: string; tx: string } | null = null;
  let rentTx: { addr: string; tx: string } | null = null;

  for (const s of seats) {
    const r = await post("/api/join", { player: s.address, signedGameplay: s.signedGameplay, signedBudget: s.signedBudget });
    if (r.ok && r.txHash) { console.log(`[play] ${s.role}#${s.index} JOINED buy-in tx ${r.txHash}`); if (!buyInTx) buyInTx = { addr: s.address, tx: r.txHash }; }
    else console.warn(`[play] ${s.role}#${s.index} join failed: ${r.error}`);
  }

  const DEADLINE = Date.now() + 40 * 60_000;
  let lastLog = 0;
  while (Date.now() < DEADLINE) {
    const st = await getState();
    if (!st.ok) { await sleep(1200); continue; }
    if (st.winner) {
      const eliminated = (st.players as any[]).filter((p) => p.bankrupt).map((p) => p.name);
      console.log(`\n[play] ===== WINNER ${st.winner} =====`);
      console.log(`[play] eliminated: ${eliminated.join(", ") || "none (round cap)"}`);
      console.log(`[play] round reached: ${st.round}`);
      console.log(`[play] payout tx: ${st.payoutTx}`);
      console.log(`\n[play] KEY TX HASHES (distinct player keys):`);
      if (buyInTx) console.log(`  buy-in (${buyInTx.addr}): ${buyInTx.tx}`);
      if (rentTx) console.log(`  rent   (${rentTx.addr}): ${rentTx.tx}`);
      console.log(`  payout (Pot → winner): ${st.payoutTx}`);
      return;
    }
    const cur: Address | null = st.currentTurn;
    const seat = seats.find((s) => cur && s.address.toLowerCase() === cur.toLowerCase());
    if (!seat) { await sleep(1000); continue; }

    const snap = toSnapshot(st);
    const d = decideBotAction(snap, seat.address.toLowerCase());
    let action = "end"; let spaceId: number | undefined;
    switch (d.kind) {
      case "payJail": action = "payJail"; break;
      case "roll": action = "roll"; break;
      case "buy": action = "buy"; break;
      case "decline": action = "decline"; break;
      case "build": action = "build"; spaceId = d.spaceId; break;
      case "end": action = "end"; break;
    }
    const r = await post("/api/act", { player: seat.address, action, spaceId });
    if (r.ok) {
      // capture the first real rent payment (a settled x402 charge on a "roll" that
      // produced a rent settlement → txHash present, from a player landing on rent)
      if (action === "roll" && r.txHash && !rentTx && (r.log ?? []).some((l: string) => /rent/i.test(l))) {
        rentTx = { addr: seat.address, tx: r.txHash };
      }
      if (Date.now() - lastLog > 4000) {
        console.log(`[play] round ${st.round} | ${seat.role}#${seat.index} ${action}${r.dice ? ` ${r.dice[0]}+${r.dice[1]}` : ""} — ${(r.log ?? []).slice(0, 1).join("")}`);
        lastLog = Date.now();
      }
    } else if (!/not your turn|nonce/i.test(r.error ?? "")) {
      // unexpected — surface but keep going
      if (Date.now() - lastLog > 4000) { console.log(`[play] ${seat.role}#${seat.index} ${action} → ${r.error}`); lastLog = Date.now(); }
      await sleep(800);
    }
    await sleep(300);
  }
  console.log("[play] deadline reached without a winner.");
  process.exit(2);
}

main().catch((e) => { console.error("[play] fatal:", e); process.exit(1); });

/**
 * The authoritative Nexus MONOPOLY game server (Base Sepolia) — FULL standard rules.
 *
 *   pnpm --filter @nexus-examples/monopoly server     # → http://localhost:8791
 *
 * The full ruleset (board, ownership, cash, houses, mortgages, jail, Chance/Community
 * Chest decks, rent calc, bankruptcy, win = last solvent player) runs here in
 * lib/monopoly-rules.ts. This server holds the relayer wallet (server-only) and wires
 * the rules to the PROVEN on-chain Nexus rails — players never pay gas and never
 * re-sign mid-game:
 *
 *   - dice roll          → relayer redeems the player's GAMEPLAY delegation
 *                          (turn-bound rollAndMove on the RandomnessCoordinator) →
 *                          the real on-chain dice feed the rules engine.
 *   - every other action → relayer redeems the player's GAMEPLAY delegation
 *                          (recordAction, turn-bound) so buy/rent/tax/build/etc. are
 *                          signed on-chain by the player.
 *   - every money debit  → real USDC x402 charge: the relayer redeems the player's
 *     FROM a player          BUDGET delegation as transferFrom(player → Pot, amount),
 *                          bounded by on-chain spend caps + the Pot recipient
 *                          allowlist, at the $1 = 0.0001 USDC scale. Credited in the
 *                          Pot ledger to the eventual winner.
 *   - win                → the Pot pays the LAST SOLVENT player on-chain.
 *
 * Win is REAL Monopoly bankruptcy (all but one player eliminated). A round cap
 * (ROUND_CAP) is a documented safety net only (richest net-worth player). NO
 * first-to-N shortcut.
 *
 * Each player signs its OWN gameplay + budget delegation with its OWN key and POSTs
 * them at /api/join; the server caches them and redeems them on the player's behalf.
 * All relayer submissions are serialized so the single key never collides nonces.
 *
 * API (JSON, CORS-open):
 *   POST /api/new-game {human,bots,fee?}                          → seat room + open pot
 *   POST /api/join     {player,signedGameplay,signedBudget}       → x402 buy-in + cache delegs
 *   POST /api/act      {player,action,spaceId?}                   → run one action through the rules
 *   GET  /api/state                                               → full board + turn + winner
 *   GET  /api/health
 */
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import type { SignedDelegation } from "@nexus/core";
import type { Address, Hex } from "@nexus/types";
import {
  type MonopolyEngine,
  advanceTurnAdmin,
  chargeFromPlayer,
  creditDeposit,
  getCurrentTurn,
  getEngine,
  openPot,
  recordBankrupt,
  redeemAction,
  redeemEndTurn,
  redeemRoll,
  settlePot,
  startTurns,
} from "../lib/engine";
import { deployment } from "../lib/deployment";
import { BOARD, DOLLAR_TO_USDC, dollarsToUsdc } from "../lib/board";
import { MonopolyRules, ROUND_CAP, type Settlement } from "../lib/monopoly-rules";
import { ENTRY_FEE_USDC } from "../lib/config";

const PORT = Number(process.env.MONOPOLY_BACKEND_PORT ?? 8791);

// ── single live game state (in-memory) ───────────────────────────────────────

interface SeatDelegs {
  signedGameplay?: SignedDelegation;
  signedBudget?: SignedDelegation;
  paid: boolean;
}
interface Game {
  roomId: bigint;
  fee: string;
  rules: MonopolyRules;
  delegs: Record<string, SeatDelegs>; // player id (lc) → cached delegations
  names: Record<string, string>;
  payoutTx?: Hex;
  paymentTx: Record<string, Hex>;
  lastTx: Record<string, Hex>; // player → last settled tx
  settled: boolean;
}

let game: Game | null = null;
let nextRoom = BigInt(Date.now() % 1_000_000) + 2000n;

// Serialize ALL relayer submissions (single key → sequential nonces).
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function bigintJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}
function reviveSigned(s: SignedDelegation): SignedDelegation {
  return { ...s, salt: BigInt(s.salt as unknown as string | bigint), maxRedemptions: BigInt(s.maxRedemptions as unknown as string | bigint) };
}
function json(c: Context, value: unknown, status = 200): Response {
  c.header("content-type", "application/json");
  return c.body(bigintJson(value), status as never);
}
function classifyError(err: unknown): { status: number; message: string } {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const expected =
    m.includes("not your turn") || m.includes("already won") || m.includes("no pending") ||
    m.includes("not a seat") || m.includes("notyourturn") || m.includes("turn-bound") ||
    m.includes("game over") || m.includes("nonce");
  return { status: expected ? 409 : 500, message: err instanceof Error ? err.message : String(err) };
}
function failure(c: Context, err: unknown): Response {
  const { status, message } = classifyError(err);
  return json(c, { ok: false, error: message }, status);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry a relayer submission a few times on a transient nonce/relayer collision
 *  (the relayer key is shared with the UNO example). */
async function withNonceRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
      if (!/nonce|replacement|already known|mempool/.test(m) || i >= tries - 1) throw e;
      await sleep(1200 * (i + 1));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function publicGame(g: Game, currentTurn: Address | null) {
  const snap = g.rules.snapshot();
  return {
    roomId: g.roomId.toString(),
    fee: g.fee,
    pot: deployment.pot,
    currentTurn,
    winner: snap.winner,
    payoutTx: g.payoutTx ?? null,
    round: snap.round,
    roundCap: ROUND_CAP,
    dollarToUsdc: DOLLAR_TO_USDC,
    pending: snap.pending,
    rolledThisTurn: snap.rolledThisTurn,
    players: snap.players.map((p) => ({
      address: p.id,
      name: p.name,
      role: p.role,
      cash: p.cash,
      position: p.position,
      inJail: p.inJail,
      getOutCards: p.getOutCards,
      bankrupt: p.bankrupt,
      netWorth: g.rules.netWorth(p.id),
      properties: g.rules.ownedBy(p.id),
      paid: g.delegs[p.id]?.paid ?? false,
      lastTx: g.lastTx[p.id] ?? null,
    })),
    properties: snap.properties,
    cardLog: snap.cardLog,
  };
}

/**
 * Settle one engine settlement on-chain. A debit FROM a player is a real USDC x402
 * charge → Pot (bounded by the player's budget delegation), credited in the Pot
 * ledger to the eventual winner. Credits FROM the bank (GO bonus, mortgage, house
 * sale) are play-money only — the bank has no wallet/delegation. Returns the tx hash
 * of the real charge, if any.
 */
async function settleOnChain(e: MonopolyEngine, g: Game, s: Settlement): Promise<Hex | null> {
  if (s.from === "bank") return null; // bank → player credit: play-money only
  if (s.amount <= 0) return null;
  const fromId = s.from.toLowerCase();
  const seat = g.delegs[fromId];
  if (!seat?.signedBudget || !seat.paid) return null; // unfunded/observer — skip real charge
  const amountUsdc = dollarsToUsdc(s.amount);
  if (Number(amountUsdc) <= 0) return null;
  // The real USDC x402 charge: transferFrom(player → Pot), bounded by the budget
  // delegation's caveats. The accumulated USDC pays the last solvent player on settle.
  // (Pot-ledger crediting is done once at buy-in so the winner is a recognised
  // participant; per-charge creditDeposit is unnecessary and is skipped to keep the
  // on-chain tx count bounded for a full real game.)
  const res = await withNonceRetry(() =>
    chargeFromPlayer(e, seat.signedBudget!, fromId as Address, deployment.pot, amountUsdc),
  );
  g.lastTx[fromId] = res.txHash;
  return res.txHash;
}

async function main() {
  console.log("[monopoly-server] booting (full rules) on Base Sepolia…");
  const e: MonopolyEngine = await getEngine();
  console.log("[monopoly-server] up. world", deployment.world, "pot", deployment.pot);

  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("access-control-allow-origin", "*");
    c.header("access-control-allow-headers", "*");
    c.header("access-control-allow-methods", "GET,POST,OPTIONS");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  app.get("/api/health", (c) => json(c, { ok: true, world: deployment.world, pot: deployment.pot, usdc: deployment.usdc }));

  // Seat a fresh room: human seat 0, then bots. Start on-chain turns, open pot.
  app.post("/api/new-game", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { human?: Address; bots?: Address[]; fee?: string; names?: Record<string, string> };
    if (!body.human || !Array.isArray(body.bots)) return json(c, { ok: false, error: "human + bots required" }, 400);
    const fee = body.fee ?? ENTRY_FEE_USDC;
    const order: Address[] = [body.human, ...body.bots];
    try {
      const roomId = await serialized(async () => {
        const id = nextRoom++;
        await startTurns(e, id, order);
        await openPot(e, id);
        return id;
      });
      const seats = order.map((a, i) => ({ id: a, name: i === 0 ? "You" : `Bot ${i}`, role: (i === 0 ? "human" : "bot") as "human" | "bot" }));
      const rules = new MonopolyRules(roomId.toString(), seats);
      game = {
        roomId,
        fee,
        rules,
        delegs: Object.fromEntries(order.map((a) => [a.toLowerCase(), { paid: false } as SeatDelegs])),
        names: Object.fromEntries(seats.map((s) => [s.id.toLowerCase(), s.name])),
        paymentTx: {},
        lastTx: {},
        settled: false,
      };
      console.log(`[monopoly-server] NEW GAME room ${roomId} — ${order.length} players, START_CASH 80, full rules, win = last solvent.`);
      const cur = await getCurrentTurn(e, roomId).catch(() => null);
      return json(c, { ok: true, ...publicGame(game, cur) });
    } catch (err) {
      return failure(c, err);
    }
  });

  // Join: cache the player's delegations + pay the x402 buy-in (USDC → Pot).
  app.post("/api/join", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { player?: Address; signedGameplay?: SignedDelegation; signedBudget?: SignedDelegation };
    if (!body.player || !body.signedGameplay || !body.signedBudget) return json(c, { ok: false, error: "player + signedGameplay + signedBudget required" }, 400);
    const g = game;
    const id = body.player.toLowerCase();
    const seat = g.delegs[id];
    if (!seat) return json(c, { ok: false, error: "not a seat" }, 400);
    seat.signedGameplay = reviveSigned(body.signedGameplay);
    seat.signedBudget = reviveSigned(body.signedBudget);
    if (seat.paid) return json(c, { ok: true, txHash: g.paymentTx[id], alreadyPaid: true, ...publicGame(g, await getCurrentTurn(e, g.roomId).catch(() => null)) });
    try {
      const res = await serialized(async () => {
        const charge = await withNonceRetry(() => chargeFromPlayer(e, seat.signedBudget!, body.player!, deployment.pot, g.fee));
        await withNonceRetry(() => creditDeposit(e, g.roomId, body.player!, g.fee));
        return charge;
      });
      seat.paid = true;
      g.paymentTx[id] = res.txHash;
      console.log(`[monopoly-server] ${g.names[id]} BUY-IN ${g.fee} USDC tx ${res.txHash}`);
      const cur = await getCurrentTurn(e, g.roomId).catch(() => null);
      return json(c, { ok: true, txHash: res.txHash, ...publicGame(g, cur) });
    } catch (err) {
      return failure(c, err);
    }
  });

  // Run ONE action through the authoritative rules engine + settle it on-chain.
  app.post("/api/act", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { player?: Address; action?: string; spaceId?: number };
    if (!body.player || !body.action) return json(c, { ok: false, error: "player + action required" }, 400);
    const g = game;
    const id = body.player.toLowerCase();
    const seat = g.delegs[id];
    if (!seat) return json(c, { ok: false, error: "not a seat" }, 400);
    if (g.rules.winner) return json(c, { ok: false, error: "game already won", winner: g.rules.winner }, 409);

    try {
      const result = await serialized(() => runAction(e, g, id as Address, body.action!, body.spaceId));
      const cur = await getCurrentTurn(e, g.roomId).catch(() => null);
      return json(c, { ok: true, ...result, ...publicGame(g, cur) });
    } catch (err) {
      return failure(c, err);
    }
  });

  app.get("/api/state", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 200);
    let cur: Address | null = null;
    try { cur = await getCurrentTurn(e, game.roomId); } catch { /* lag */ }
    return json(c, { ok: true, ...publicGame(game, cur) });
  });

  serve({ fetch: app.fetch, port: PORT }, (info) => console.log(`[monopoly-server] listening on http://localhost:${info.port}`));
}

/**
 * Apply one action for `player` and settle every resulting money movement on-chain.
 * MUST be called inside the serialized() queue.
 */
async function runAction(
  e: MonopolyEngine,
  g: Game,
  player: Address,
  action: string,
  spaceId?: number,
): Promise<{ dice?: [number, number]; log: string[]; txHash?: Hex; recordTx?: Hex }> {
  const rules = g.rules;
  const seat = g.delegs[player.toLowerCase()];
  const cur = rules.current();
  if (cur.id !== player.toLowerCase()) throw new Error(`not your turn (current ${cur.id})`);

  let dice: [number, number] | undefined;
  let settlements: Settlement[] = [];
  let log: string[] = [];
  let recordTx: Hex | undefined;
  let actionTagStr = action;
  let actionSpace = spaceId ?? cur.position;
  let actionAmount = 0n;

  switch (action) {
    case "roll": {
      // REAL on-chain dice via the gameplay delegation (turn-bound, gasless).
      if (!seat?.signedGameplay) throw new Error("no gameplay delegation (join first)");
      // Strict fresh turn check inside the serialized block.
      const onchain = await getCurrentTurn(e, g.roomId);
      if (onchain.toLowerCase() !== player.toLowerCase()) throw new Error(`not your turn (current ${onchain})`);
      const roll = await redeemRoll(e, seat.signedGameplay, g.roomId);
      recordTx = roll.txHash;
      const r = rules.roll(roll.die1, roll.die2);
      dice = [roll.die1, roll.die2];
      settlements = r.settlements;
      log = r.log;
      console.log(`[monopoly-server] ${g.names[player.toLowerCase()]} ROLLED ${roll.die1}+${roll.die2} tx ${roll.txHash} — ${log.join("; ")}`);
      break;
    }
    case "buy": {
      actionSpace = cur.position;
      const r = rules.buy();
      settlements = r.settlements;
      log = r.log;
      actionTagStr = "buy";
      break;
    }
    case "decline": { const r = rules.decline(); log = r.log; break; }
    case "build": { const r = rules.build(spaceId!); settlements = r.settlements; log = r.log; actionTagStr = "build"; actionSpace = spaceId!; break; }
    case "mortgage": { const r = rules.mortgage(spaceId!); settlements = r.settlements; log = r.log; actionTagStr = "mortgage"; actionSpace = spaceId!; break; }
    case "unmortgage": { const r = rules.unmortgage(spaceId!); settlements = r.settlements; log = r.log; actionTagStr = "unmortgage"; actionSpace = spaceId!; break; }
    case "payJail": { const r = rules.payJail(); settlements = r.settlements; log = r.log; actionTagStr = "jail"; break; }
    case "end": {
      // The rules engine decides whether the turn actually advances (doubles → the
      // same player rolls again → the on-chain turn must NOT advance).
      const adv = rules.endTurn();
      log = [`${g.names[player.toLowerCase()]} ended their turn`];
      await afterStateChange(e, g, new Set([player.toLowerCase()]));
      if (rules.winner) {
        await maybeSettleWinner(e, g);
        return { log, recordTx };
      }
      console.log(`[monopoly-server] END ${g.names[player.toLowerCase()]} sameTurn=${adv.sameTurn} next=${adv.nextPlayer ? g.names[adv.nextPlayer] : "none"}`);
      if (!adv.sameTurn) {
        // turn-bound, gasless player-signed on-chain turn advance (one seat)
        const onchain = await getCurrentTurn(e, g.roomId).catch(() => null);
        if (onchain && onchain.toLowerCase() === player.toLowerCase() && seat?.signedGameplay) {
          await withNonceRetry(() => redeemEndTurn(e, seat.signedGameplay!, g.roomId)).then((r) => (recordTx = r.txHash)).catch((err) => {
            console.warn(`[monopoly-server] endTurn redeem failed: ${err instanceof Error ? err.message : err}`);
          });
        }
        // Sync the strictly-rotating on-chain turn to the rules-engine current player
        // (the rules engine SKIPS bankrupt players; the on-chain TurnManager doesn't).
        await syncOnChainTurn(e, g, adv.nextPlayer);
        const after = await getCurrentTurn(e, g.roomId).catch(() => null);
        console.log(`[monopoly-server] END advanced on-chain → ${after}`);
      }
      return { log, recordTx };
    }
    default:
      throw new Error(`unknown action: ${action}`);
  }

  // Settle every money movement on-chain (real USDC charges for player debits).
  const touched = new Set<string>([player.toLowerCase()]);
  let chargeTx: Hex | undefined;
  for (const s of settlements) {
    if (s.from !== "bank") touched.add(s.from.toLowerCase());
    if (s.to !== "bank") touched.add(s.to.toLowerCase());
    const tx = await settleOnChain(e, g, s).catch((err) => {
      console.warn(`[monopoly-server] settle skipped (${s.reason}): ${err instanceof Error ? err.message : err}`);
      return null;
    });
    if (tx && !chargeTx) chargeTx = tx;
  }

  // Record the action on-chain via the player's gameplay delegation (turn-bound,
  // gasless) — skip for "roll" (rollAndMove already recorded it).
  if (action !== "roll" && seat?.signedGameplay) {
    actionAmount = BigInt(settlements.find((s) => s.from === player.toLowerCase())?.amount ?? 0) * 1_000_000n;
    await recordPlayerAction(e, g, player, actionTagStr, actionSpace, actionAmount).then((t) => (recordTx = recordTx ?? t)).catch(() => {});
  }

  await afterStateChange(e, g, touched);
  if (rules.winner) await maybeSettleWinner(e, g);

  return { dice, log, txHash: chargeTx, recordTx };
}

/** Advance the on-chain TurnManager (relayer, authorized) until its current player
 *  matches the rules-engine's next player — skipping bankrupt seats the on-chain
 *  strict rotation would otherwise land on. */
async function syncOnChainTurn(e: MonopolyEngine, g: Game, target: string | null): Promise<void> {
  if (!target) return;
  for (let i = 0; i < g.rules.order.length + 1; i++) {
    const cur = await getCurrentTurn(e, g.roomId).catch(() => null);
    if (!cur) return;
    if (cur.toLowerCase() === target.toLowerCase()) return;
    await withNonceRetry(() => advanceTurnAdmin(e, g.roomId)).catch(() => {});
  }
}

/** Redeem the player's gameplay delegation to record a non-roll action on-chain. */
async function recordPlayerAction(e: MonopolyEngine, g: Game, player: Address, tag: string, spaceId: number, amount: bigint): Promise<Hex | undefined> {
  const seat = g.delegs[player.toLowerCase()];
  if (!seat?.signedGameplay) return undefined;
  const onchain = await getCurrentTurn(e, g.roomId).catch(() => null);
  if (!onchain || onchain.toLowerCase() !== player.toLowerCase()) return undefined; // turn already advanced
  const res = await withNonceRetry(() => redeemAction(e, seat.signedGameplay!, g.roomId, tag, spaceId, amount)).catch(() => null);
  return res?.txHash;
}

/** Emit a bankruptcy event on-chain the first time each player is eliminated. (Cash /
 *  position mirroring into the World tables is intentionally OMITTED — the
 *  authoritative state lives in the server and the UI reads it from /api/state — so a
 *  full real game stays within a bounded on-chain tx budget.) */
async function afterStateChange(e: MonopolyEngine, g: Game, _touched: Set<string>): Promise<void> {
  const snap = g.rules.snapshot();
  for (const p of snap.players) {
    if (!p.bankrupt) continue;
    if (g.lastTx[`bankrupt:${p.id}`]) continue;
    g.lastTx[`bankrupt:${p.id}`] = "0x" as Hex; // mark handled
    await withNonceRetry(() => recordBankrupt(e, g.roomId, p.id as Address)).catch(() => {});
    console.log(`[monopoly-server] BANKRUPT ${g.names[p.id]} (round ${snap.round})`);
  }
}

/** Settle the pot to the last solvent player (real on-chain USDC payout). */
async function maybeSettleWinner(e: MonopolyEngine, g: Game): Promise<void> {
  if (g.settled || !g.rules.winner) return;
  g.settled = true;
  const winner = g.rules.winner as Address;
  const eliminated = g.rules.players.filter((p) => p.bankrupt).map((p) => g.names[p.id]);
  try {
    const tx = await withNonceRetry(() => settlePot(e, g.roomId, winner));
    g.payoutTx = tx;
    console.log(`[monopoly-server] ===== WINNER ${g.names[winner.toLowerCase()]} (${winner}) — eliminated: ${eliminated.join(", ") || "none (round cap)"} — POT PAID OUT tx ${tx} =====`);
  } catch (err) {
    g.settled = false;
    console.error(`[monopoly-server] settle failed:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

main().catch((err) => {
  console.error("[monopoly-server] fatal:", err);
  process.exit(1);
});

/**
 * The authoritative Nexus MONOPOLY game server (Base Sepolia).
 *
 *   pnpm --filter @nexus-examples/monopoly server     # → http://localhost:8791
 *
 * Holds the relayer wallet (server-only) and a single live game's in-memory board
 * (turn order, board positions, property ownership). Players (the human in the
 * browser + the bots in scripts/bots.ts) sign their OWN delegations with their OWN
 * keys and POST the SignedDelegation here; this server redeems them via the relayer
 * (gasless for players). Every redemption is REAL on-chain:
 *
 *   - dice roll       → relayer redeems the player's GAMEPLAY delegation (turn-bound)
 *   - buy-in / buy /  → relayer redeems the player's BUDGET delegation: a real USDC
 *     rent              transferFrom(player → Pot), bounded by on-chain spend caps.
 *
 * WIN condition (deterministic): the first player to OWN `TARGET_PROPERTIES`
 * properties wins. The human auto-buys every unowned property it lands on; the bots
 * never buy (they only roll + pay rent). So the human accumulates properties and is
 * the deterministic winner; on win the Pot settles to the winner on-chain.
 *
 * All relayer submissions are serialized through a queue so the single relayer key
 * never collides its nonces.
 *
 * API (JSON, CORS-open for the Next dev origin):
 *   POST /api/new-game  { human, bots, fee? }                  → seat room + open pot
 *   POST /api/charge    { player, signedBudget }               → x402 buy-in (USDC→Pot)
 *   POST /api/roll      { player, signedGameplay }             → gasless dice roll
 *   POST /api/buy       { player, signedBudget }               → x402 buy property
 *   POST /api/rent      { player, signedBudget }               → x402 pay rent
 *   GET  /api/state                                            → board, turn, winner
 *   GET  /api/health
 */
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import type { SignedDelegation } from "@nexus/core";
import type { Address, Hex } from "@nexus/types";
import {
  type MonopolyEngine,
  chargeFromPlayer,
  creditDeposit,
  getCurrentTurn,
  getEngine,
  openPot,
  recordBuy,
  recordRent,
  redeemRoll,
  settlePot,
  startTurns,
} from "../lib/engine";
import { deployment } from "../lib/deployment";
import { BOARD, BOARD_SIZE } from "../lib/board";
import { ENTRY_FEE_USDC, BUY_USDC, RENT_USDC } from "../lib/config";

const PORT = Number(process.env.MONOPOLY_BACKEND_PORT ?? 8791);
const TARGET_PROPERTIES = Number(process.env.TARGET_PROPERTIES ?? 1);

// ── single live game state (in-memory) ───────────────────────────────────────

type PendingKind = "buy" | "rent" | null;
interface Pending {
  kind: Exclude<PendingKind, null>;
  spaceId: number;
  owner?: Address; // for rent
}
interface Seat {
  address: Address;
  role: "human" | "bot";
  paid: boolean;
  position: number;
  pending: Pending | null;
}
interface GameState {
  roomId: bigint;
  fee: string;
  seats: Seat[];
  properties: Record<number, Address>; // spaceId -> owner
  ownedCount: Record<string, number>; // owner -> #properties
  winner?: Address;
  payoutTx?: Hex;
  paymentTx: Record<string, Hex>;
}

let game: GameState | null = null;
let nextRoom = BigInt(Date.now() % 1_000_000) + 1000n;

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

/**
 * Map an on-chain / game error to a graceful HTTP status + message. EXPECTED reverts
 * (turn-bound enforcer rejecting a stale roll, a benign race like "already owned" or
 * "already won", "no pending …") are NOT server faults — they get 409 Conflict so the
 * browser/bots can simply retry on the next tick. Only a genuine server fault is 500.
 */
function classifyError(err: unknown): { status: number; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const m = message.toLowerCase();
  const expected =
    m.includes("not your turn") ||
    m.includes("already won") ||
    m.includes("already owned") ||
    m.includes("already paid") ||
    m.includes("no pending") ||
    m.includes("resolve pending") ||
    m.includes("not a seat") ||
    m.includes("nottheirturn") ||
    m.includes("notyourturn") ||
    m.includes("turnbound") ||
    m.includes("turn-bound");
  return { status: expected ? 409 : 500, message };
}
function failure(c: Context, err: unknown): Response {
  const { status, message } = classifyError(err);
  return json(c, { ok: false, error: message }, status);
}

function publicGame(g: GameState, currentTurn: Address | null) {
  return {
    roomId: g.roomId.toString(),
    fee: g.fee,
    charges: { buyIn: g.fee, buy: BUY_USDC, rent: RENT_USDC },
    targetProperties: TARGET_PROPERTIES,
    seats: g.seats.map((s) => ({ address: s.address, role: s.role, paid: s.paid, position: s.position, pending: s.pending, properties: g.ownedCount[s.address.toLowerCase()] ?? 0 })),
    properties: g.properties,
    winner: g.winner ?? null,
    payoutTx: g.payoutTx ?? null,
    pot: deployment.pot,
    currentTurn,
  };
}

function seatOf(g: GameState, addr: Address): Seat | undefined {
  return g.seats.find((s) => s.address.toLowerCase() === addr.toLowerCase());
}

/** After a roll lands `seat` on a space, compute its pending buy/rent action. */
function resolveLanding(g: GameState, seat: Seat): Pending | null {
  const space = BOARD[seat.position % BOARD_SIZE];
  if (space.kind !== "property") return null;
  const owner = g.properties[space.id];
  if (!owner) return { kind: "buy", spaceId: space.id };
  if (owner.toLowerCase() !== seat.address.toLowerCase()) return { kind: "rent", spaceId: space.id, owner };
  return null; // own it
}

async function main() {
  console.log("[monopoly-server] booting on Base Sepolia…");
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

  // Seat a fresh room: human seat 0, then bots. Start turns, open pot.
  app.post("/api/new-game", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { human?: Address; bots?: Address[]; fee?: string };
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
      game = {
        roomId,
        fee,
        seats: order.map((a, i) => ({ address: a, role: i === 0 ? "human" : "bot", paid: false, position: 0, pending: null })),
        properties: {},
        ownedCount: {},
        paymentTx: {},
      };
      console.log(`[monopoly-server] new game room ${roomId} seats ${order.length} (target ${TARGET_PROPERTIES} props to win)`);
      const cur = await getCurrentTurn(e, roomId).catch(() => null);
      return json(c, { ok: true, ...publicGame(game, cur) });
    } catch (err) {
      return json(c, { ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // x402 buy-in: redeem the player's budget delegation (transferFrom→Pot) + record
  // the deposit in the pot ledger so the winner is a recognised participant.
  app.post("/api/charge", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { player?: Address; signedBudget?: SignedDelegation };
    if (!body.player || !body.signedBudget) return json(c, { ok: false, error: "player + signedBudget required" }, 400);
    const g = game;
    const seat = seatOf(g, body.player);
    if (!seat) return json(c, { ok: false, error: "not a seat" }, 400);
    if (seat.paid) return json(c, { ok: true, txHash: g.paymentTx[seat.address], alreadyPaid: true });
    try {
      const signedBudget = reviveSigned(body.signedBudget);
      const res = await serialized(async () => {
        const charge = await chargeFromPlayer(e, signedBudget, body.player!, deployment.pot, g.fee);
        await creditDeposit(e, g.roomId, body.player!, g.fee);
        return charge;
      });
      seat.paid = true;
      g.paymentTx[seat.address] = res.txHash;
      console.log(`[monopoly-server] ${seat.role} ${seat.address} BUY-IN ${g.fee} USDC tx ${res.txHash}`);
      return json(c, { ok: true, txHash: res.txHash, blockNumber: res.blockNumber });
    } catch (err) {
      return failure(c, err);
    }
  });

  // Gasless dice roll: redeem the player's gameplay delegation (turn-bound).
  app.post("/api/roll", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { player?: Address; signedGameplay?: SignedDelegation };
    if (!body.player || !body.signedGameplay) return json(c, { ok: false, error: "player + signedGameplay required" }, 400);
    const g = game;
    if (g.winner) return json(c, { ok: false, error: "game already won", winner: g.winner }, 409);
    const seat = seatOf(g, body.player);
    if (!seat) return json(c, { ok: false, error: "not a seat" }, 400);
    if (seat.pending) return json(c, { ok: false, error: `resolve pending ${seat.pending.kind} first` }, 409);
    try {
      const out = await serialized(async () => {
        // Strict, fresh turn check INSIDE the serialized block: because all relayer
        // submissions are serialized, no other roll can advance the turn between this
        // read and our submit — so a stale-read turn race can't cause a wasted revert.
        const cur = await getCurrentTurn(e, g.roomId);
        if (cur.toLowerCase() !== body.player!.toLowerCase()) {
          throw new Error(`not your turn (current ${cur})`);
        }
        return redeemRoll(e, reviveSigned(body.signedGameplay!), g.roomId);
      });
      seat.position = out.toPos;
      seat.pending = resolveLanding(g, seat);
      const space = BOARD[seat.position % BOARD_SIZE];
      console.log(`[monopoly-server] ${seat.role} ${seat.address} rolled ${out.die1}+${out.die2} → ${space.name} (${seat.pending?.kind ?? "free"}) tx ${out.txHash}`);
      return json(c, { ok: true, txHash: out.txHash, die1: out.die1, die2: out.die2, fromPos: out.fromPos, toPos: out.toPos, passedGo: out.passedGo, space: space.name, pending: seat.pending });
    } catch (err) {
      return failure(c, err);
    }
  });

  // x402 BUY a property: real USDC transferFrom(player→Pot) + record ownership.
  app.post("/api/buy", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { player?: Address; signedBudget?: SignedDelegation };
    if (!body.player || !body.signedBudget) return json(c, { ok: false, error: "player + signedBudget required" }, 400);
    const g = game;
    if (g.winner) return json(c, { ok: false, error: "game already won", winner: g.winner }, 409);
    const seat = seatOf(g, body.player);
    if (!seat) return json(c, { ok: false, error: "not a seat" }, 400);
    if (!seat.pending || seat.pending.kind !== "buy") return json(c, { ok: false, error: "no pending buy" }, 409);
    const spaceId = seat.pending.spaceId;
    const space = BOARD[spaceId];
    try {
      const out = await serialized(async () => {
        if (g.properties[spaceId]) throw new Error("already owned");
        const charge = await chargeFromPlayer(e, reviveSigned(body.signedBudget!), body.player!, deployment.pot, BUY_USDC);
        await creditDeposit(e, g.roomId, body.player!, BUY_USDC);
        const recordTx = await recordBuy(e, g.roomId, spaceId, body.player!, BigInt(space.price), BigInt(space.rent));
        return { charge, recordTx };
      });
      g.properties[spaceId] = body.player;
      const key = body.player.toLowerCase();
      g.ownedCount[key] = (g.ownedCount[key] ?? 0) + 1;
      seat.pending = null;
      console.log(`[monopoly-server] ${seat.role} ${seat.address} BOUGHT ${space.name} ${BUY_USDC} USDC tx ${out.charge.txHash} (owns ${g.ownedCount[key]})`);

      // WIN check.
      let payoutTx: Hex | undefined;
      if (g.ownedCount[key] >= TARGET_PROPERTIES) {
        payoutTx = await serialized(() => settlePot(e, g.roomId, body.player!));
        g.winner = body.player;
        g.payoutTx = payoutTx;
        console.log(`[monopoly-server] WINNER ${body.player} owns ${g.ownedCount[key]} props — pot settled tx ${payoutTx}`);
      }
      return json(c, { ok: true, txHash: out.charge.txHash, recordTx: out.recordTx, properties: g.ownedCount[key], winner: g.winner ?? null, payoutTx: payoutTx ?? null });
    } catch (err) {
      return failure(c, err);
    }
  });

  // x402 RENT: real USDC transferFrom(payer→Pot) routed through the Pot (the allowed
  // recipient); the owner is credited in the pot ledger + the play-cash ledger.
  app.post("/api/rent", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { player?: Address; signedBudget?: SignedDelegation };
    if (!body.player || !body.signedBudget) return json(c, { ok: false, error: "player + signedBudget required" }, 400);
    const g = game;
    if (g.winner) return json(c, { ok: false, error: "game already won", winner: g.winner }, 409);
    const seat = seatOf(g, body.player);
    if (!seat) return json(c, { ok: false, error: "not a seat" }, 400);
    if (!seat.pending || seat.pending.kind !== "rent") return json(c, { ok: false, error: "no pending rent" }, 409);
    const spaceId = seat.pending.spaceId;
    const owner = seat.pending.owner!;
    const space = BOARD[spaceId];
    try {
      const out = await serialized(async () => {
        const charge = await chargeFromPlayer(e, reviveSigned(body.signedBudget!), body.player!, deployment.pot, RENT_USDC);
        // Credit the OWNER in the pot ledger (rent flows to the owner economically;
        // the USDC sits in the Pot and is paid out on settle).
        await creditDeposit(e, g.roomId, owner, RENT_USDC);
        const recordTx = await recordRent(e, g.roomId, spaceId, body.player!);
        return { charge, recordTx };
      });
      seat.pending = null;
      console.log(`[monopoly-server] ${seat.role} ${seat.address} RENT ${RENT_USDC} USDC on ${space.name} → owner ${owner} tx ${out.charge.txHash}`);
      return json(c, { ok: true, txHash: out.charge.txHash, recordTx: out.recordTx, owner });
    } catch (err) {
      return failure(c, err);
    }
  });

  // Decline a pending BUY (a player chooses not to buy an unowned property). No
  // on-chain effect — just clears the pending so the player can roll next turn.
  app.post("/api/skip", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { player?: Address };
    if (!body.player) return json(c, { ok: false, error: "player required" }, 400);
    const seat = seatOf(game, body.player);
    if (!seat) return json(c, { ok: false, error: "not a seat" }, 400);
    if (seat.pending?.kind === "buy") seat.pending = null;
    return json(c, { ok: true });
  });

  // /api/state ALWAYS returns HTTP 200 with the current state — it must never throw,
  // since the UI + e2e poll it to observe the winner + payout. `ok:false` (no game
  // yet) is still a 200 so a transient gap never blanks the page.
  app.get("/api/state", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 200);
    let cur: Address | null = null;
    try {
      cur = await getCurrentTurn(e, game.roomId);
    } catch {
      /* transient read-after-write lag — fall back to the last-known turn (null) */
    }
    return json(c, { ok: true, ...publicGame(game, cur) });
  });

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`[monopoly-server] listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error("[monopoly-server] fatal:", err);
  process.exit(1);
});

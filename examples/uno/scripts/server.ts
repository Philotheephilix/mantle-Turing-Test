/**
 * The Nexus UNO game server (Base Sepolia).
 *
 *   pnpm --filter @nexus/example-uno server     # → http://localhost:8790
 *
 * Holds the relayer wallet (server-only) and a single live game's in-memory board.
 * Players (the human in the browser + the bots in scripts/bots.ts) sign their OWN
 * delegations with their OWN keys and POST the SignedDelegation here; this server
 * redeems them via the relayer (gasless for players). Every redemption is real
 * on-chain. All relayer submissions are serialized through a queue so the single
 * relayer key never collides its nonces.
 *
 * API (JSON, CORS-open for the Next dev origin):
 *   POST /api/new-game   { human, botCount, fee? }        → seat room, deal, open pot
 *   POST /api/charge     { player, signedBudget }         → x402 entry fee (USDC→Pot)
 *   POST /api/move       { player, signedGameplay, kind, card } → gasless play/draw
 *   GET  /api/state                                       → board, turn, winner, payout
 *   GET  /api/health
 */
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import type { SignedDelegation } from "@nexus/core";
import type { Address, Hex } from "@nexus/types";
import {
  type UnoEngine,
  chargeEntryFee,
  creditDeposit,
  dealHand,
  getCurrentTurn,
  getWinner,
  getEngine,
  openPot,
  redeemMove,
  settlePot,
  startRoom,
  startTurns,
  waitForTurn,
} from "../lib/engine";
import { deployment } from "../lib/deployment";
import { HAND_SIZE } from "../lib/hand";
import { ENTRY_FEE_USDC } from "../lib/config";

const PORT = Number(process.env.UNO_BACKEND_PORT ?? 8790);

// ── single live game state (in-memory) ───────────────────────────────────────

interface Seat {
  address: Address;
  role: "human" | "bot";
  paid: boolean;
}
interface GameState {
  roomId: bigint;
  fee: string;
  seats: Seat[];
  topColor: number;
  topNumber: number;
  activeColor: number;
  winner?: Address;
  payoutTx?: Hex;
  startedPlay: boolean;
  paymentTx: Record<string, Hex>;
}

let game: GameState | null = null;
// A monotonically increasing room id base so each /new-game is a fresh room.
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

/** Revive a SignedDelegation's numeric fields (salt/maxRedemptions) back to bigint
 *  after JSON transport (the client stringifies bigints). Caveat terms are Hex. */
function reviveSigned(s: SignedDelegation): SignedDelegation {
  return { ...s, salt: BigInt(s.salt as unknown as string | bigint), maxRedemptions: BigInt(s.maxRedemptions as unknown as string | bigint) };
}
/** Send a bigint-safe JSON body through Hono (avoids raw-Response streaming bugs). */
function json(c: Context, value: unknown, status = 200): Response {
  c.header("content-type", "application/json");
  return c.body(bigintJson(value), status as never);
}

function publicGame(g: GameState) {
  return {
    roomId: g.roomId.toString(),
    fee: g.fee,
    seats: g.seats.map((s) => ({ address: s.address, role: s.role, paid: s.paid })),
    board: { topColor: g.topColor, topNumber: g.topNumber, activeColor: g.activeColor },
    winner: g.winner ?? null,
    payoutTx: g.payoutTx ?? null,
    startedPlay: g.startedPlay,
    pot: deployment.pot,
  };
}

async function main() {
  console.log("[uno-server] booting on Base Sepolia…");
  const e: UnoEngine = await getEngine();
  console.log("[uno-server] up. world", deployment.world, "pot", deployment.pot);

  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("access-control-allow-origin", "*");
    c.header("access-control-allow-headers", "*");
    c.header("access-control-allow-methods", "GET,POST,OPTIONS");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  app.get("/api/health", (c) => json(c, { ok: true, world: deployment.world, pot: deployment.pot, usdc: deployment.usdc }));

  // Seat a fresh room: human seat 0, then bots. Deal hands, seed board, open pot.
  app.post("/api/new-game", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { human?: Address; bots?: Address[]; fee?: string };
    if (!body.human || !Array.isArray(body.bots)) return json(c, { ok: false, error: "human + bots required" }, 400);
    const fee = body.fee ?? ENTRY_FEE_USDC;
    const order: Address[] = [body.human, ...body.bots];

    try {
      const result = await serialized(async () => {
        const roomId = nextRoom++;
        // Seat the turn order (human first so seat 0 finishes first).
        await startTurns(e, roomId, order);
        // Seed the public board: top = red 5.
        await startRoom(e, roomId, 1, 5, HAND_SIZE);
        // Deal each seat HAND_SIZE cards on-chain.
        for (const a of order) await dealHand(e, roomId, a, HAND_SIZE);
        // Open the pot for this room.
        await openPot(e, roomId);
        return roomId;
      });
      game = {
        roomId: result,
        fee,
        seats: order.map((a, i) => ({ address: a, role: i === 0 ? "human" : "bot", paid: false })),
        topColor: 1,
        topNumber: 5,
        activeColor: 1,
        startedPlay: false,
        paymentTx: {},
      };
      console.log(`[uno-server] new game room ${result} seats ${order.length}`);
      return json(c, { ok: true, ...publicGame(game) });
    } catch (err) {
      return json(c, { ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // x402 entry fee: redeem the player's budget delegation (transferFrom→Pot) and
  // record the deposit in the pot ledger. Real USDC moves from the player's wallet.
  app.post("/api/charge", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { player?: Address; signedBudget?: SignedDelegation };
    if (!body.player || !body.signedBudget) return json(c, { ok: false, error: "player + signedBudget required" }, 400);
    const g = game;
    const seat = g.seats.find((s) => s.address.toLowerCase() === body.player!.toLowerCase());
    if (!seat) return json(c, { ok: false, error: "not a seat" }, 400);
    if (seat.paid) return json(c, { ok: true, txHash: g.paymentTx[seat.address], alreadyPaid: true });

    try {
      const signedBudget = reviveSigned(body.signedBudget!);
      const res = await serialized(async () => {
        const charge = await chargeEntryFee(e, signedBudget, body.player!, deployment.pot, g.fee);
        await creditDeposit(e, g.roomId, body.player!, g.fee);
        return charge;
      });
      seat.paid = true;
      g.paymentTx[seat.address] = res.txHash;
      console.log(`[uno-server] ${seat.role} ${seat.address} PAID ${g.fee} USDC tx ${res.txHash}`);
      return json(c, { ok: true, txHash: res.txHash, blockNumber: res.blockNumber });
    } catch (err) {
      return json(c, { ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // A gasless move: redeem the player's gameplay delegation (play/draw). On a win
  // the pot is settled to the winner immediately.
  app.post("/api/move", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as {
      player?: Address;
      signedGameplay?: SignedDelegation;
      kind?: "play" | "draw";
      card?: { color: number; number: number };
    };
    if (!body.player || !body.signedGameplay || !body.kind) return json(c, { ok: false, error: "player + signedGameplay + kind required" }, 400);
    const g = game;
    if (g.winner) return json(c, { ok: false, error: "game already won", winner: g.winner }, 409);

    try {
      const out = await serialized(async () => {
        // Turn guard (read-after-write tolerant).
        const ok = await waitForTurn(e, g.roomId, body.player!, 3);
        if (!ok) {
          const cur = await getCurrentTurn(e, g.roomId);
          throw new Error(`not your turn (current ${cur})`);
        }
        const move = await redeemMove(e, reviveSigned(body.signedGameplay!), g.roomId, body.kind!, body.card);
        // Reflect the board.
        if (body.kind === "play" && body.card) {
          if (body.card.color === 0) {
            g.topColor = 0;
            g.topNumber = 0;
            g.activeColor = body.card.number;
          } else {
            g.topColor = body.card.color;
            g.topNumber = body.card.number;
            g.activeColor = body.card.color;
          }
        }
        g.startedPlay = true;
        // Win + settle.
        const winner = move.winner ?? (await getWinner(e, g.roomId));
        let payoutTx: Hex | undefined;
        if (winner) {
          g.winner = winner;
          payoutTx = await settlePot(e, g.roomId, winner);
          g.payoutTx = payoutTx;
          console.log(`[uno-server] WINNER ${winner} — pot settled tx ${payoutTx}`);
        }
        return { move, winner, payoutTx };
      });
      return json(c, { ok: true, txHash: out.move.txHash, board: { topColor: g.topColor, topNumber: g.topNumber, activeColor: g.activeColor }, winner: out.winner ?? null, payoutTx: out.payoutTx ?? null });
    } catch (err) {
      return json(c, { ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.get("/api/state", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 404);
    let currentTurn: Address | null = null;
    try {
      currentTurn = await getCurrentTurn(e, game.roomId);
    } catch {
      /* transient */
    }
    return json(c, { ok: true, ...publicGame(game), currentTurn });
  });

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`[uno-server] listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error("[uno-server] fatal:", err);
  process.exit(1);
});

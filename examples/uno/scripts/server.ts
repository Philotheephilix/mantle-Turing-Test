/**
 * The Nexus UNO game server (Base Sepolia) — the AUTHORITATIVE full-rules engine.
 *
 *   pnpm --filter @nexus/example-uno server     # → http://localhost:8790
 *
 * This server runs a REAL, complete game of UNO (official 108-card deck, all the
 * action cards, reshuffles, real win). It holds:
 *   - the deck + every player's PRIVATE hand (sealed with @nexus/secrets /
 *     LocalSecrets — real AES-256-GCM; revealed only to the owning player);
 *   - the discard pile, direction, active color, and the turn cursor.
 * The deck order is seeded by an ON-CHAIN random word (RandomnessCoordinator's
 * fast tier) so no one can peek the deal order before it mines.
 *
 * It validates EVERY play against the full rules and rejects illegal plays. Each
 * legal play/draw is ALSO recorded on-chain (gasless) by redeeming the player's
 * OWN gameplay delegation through the UnoGameSystem — the on-chain record carries
 * the real card (color, value) and enforces turn order; the win settles the pot.
 *
 * The proven SDK rails are unchanged: per-player ERC-7710 delegations (each
 * player signs with its own key), the x402 USDC entry fee, and the on-chain pot
 * payout to the winner. All relayer submissions are serialized.
 *
 * API (JSON, CORS-open):
 *   POST /api/new-game  { human, bots, fee? }              → seat, on-chain shuffle, deal, open pot
 *   POST /api/charge    { player, signedBudget }           → x402 entry fee (USDC→Pot)
 *   POST /api/hand      { player, sig?, message? }          → reveal the caller's sealed hand
 *   POST /api/move      { player, signedGameplay, kind, card?, chosenColor? } → gasless legal move
 *   GET  /api/state                                        → public board, turn, winner, payout
 *   GET  /api/health
 */
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import type { SignedDelegation } from "@nexus/core";
import { LocalSecrets, type Sealed, type AccessCondition } from "@nexus/secrets";
import type { Address, Hex } from "@nexus/types";
import {
  type UnoEngine,
  chargeEntryFee,
  creditDeposit,
  dealHand,
  getCurrentTurn,
  getEngine,
  openPot,
  randomShuffleWord,
  redeemMove,
  setTurnDirection,
  settlePot,
  startRoom,
  startTurns,
  waitForTurn,
} from "../lib/engine";
import { deployment } from "../lib/deployment";
import { UnoGame, HAND_SIZE } from "../lib/uno-game";
import { type UnoCard, cardLabel, isWildCard, legalPlays, REVERSE } from "../lib/uno-rules";
import { ENTRY_FEE_USDC } from "../lib/config";

const PORT = Number(process.env.UNO_BACKEND_PORT ?? 8790);

// Sealed-hand secrets layer (real AES-256-GCM). The owner-only access condition
// is evaluated by LocalSecrets' default predicate against an injected owner.
const secrets = new LocalSecrets();
function ownerCondition(): AccessCondition[] {
  return [{ chain: "base-sepolia", method: "ownerOf", returns: { comparator: "=", value: ":userAddress" } }];
}
const enc = new TextEncoder();
const dec = new TextDecoder();

// ── single live game state ────────────────────────────────────────────────────

interface Seat {
  address: Address;
  role: "human" | "bot";
  paid: boolean;
}
interface GameState {
  roomId: bigint;
  fee: string;
  seats: Seat[];
  game: UnoGame;
  /** sealed hand blobs per player (real AES-GCM ciphertext) */
  sealed: Map<Address, Sealed>;
  shuffleTx: Hex;
  shuffleWord: bigint;
  winner?: Address;
  payoutTx?: Hex;
  startedPlay: boolean;
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

/** Seal a player's hand with real AES-GCM (owner-only access condition). */
async function sealHand(hand: UnoCard[]): Promise<Sealed> {
  return secrets.seal(enc.encode(JSON.stringify(hand)), ownerCondition());
}
/** Reveal a player's sealed hand (owner-gated by the secrets predicate). */
async function revealHand(g: GameState, player: Address): Promise<UnoCard[]> {
  const sealed = g.sealed.get(player.toLowerCase() as Address);
  if (!sealed) return [];
  const bytes = await secrets.reveal(sealed, { caller: player, state: { ownerOf: player.toLowerCase() } });
  return JSON.parse(dec.decode(bytes)) as UnoCard[];
}
/** Re-seal the player's current authoritative hand (called after every mutation). */
async function reseal(g: GameState, player: Address): Promise<void> {
  const addr = player.toLowerCase() as Address;
  g.sealed.set(addr, await sealHand(g.game.handOf(addr)));
}

function publicGame(g: GameState) {
  const t = g.game.topState();
  return {
    roomId: g.roomId.toString(),
    fee: g.fee,
    seats: g.seats.map((s) => ({ address: s.address, role: s.role, paid: s.paid, handCount: g.game.handCount(s.address) })),
    board: { topColor: t.topColor, topValue: t.topValue, activeColor: t.activeColor },
    direction: g.game.direction,
    winner: g.winner ?? null,
    payoutTx: g.payoutTx ?? null,
    startedPlay: g.startedPlay,
    pot: deployment.pot,
    shuffleTx: g.shuffleTx,
  };
}

async function main() {
  console.log("[uno-server] booting on Base Sepolia…");
  const e: UnoEngine = await getEngine();
  console.log("[uno-server] up. world", deployment.world, "pot", deployment.pot, "randomness", deployment.randomness);

  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("access-control-allow-origin", "*");
    c.header("access-control-allow-headers", "*");
    c.header("access-control-allow-methods", "GET,POST,OPTIONS");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  app.get("/api/health", (c) => json(c, { ok: true, world: deployment.world, pot: deployment.pot, usdc: deployment.usdc, randomness: deployment.randomness }));

  // Seat a fresh room: human seat 0, then bots. ON-CHAIN shuffle → deal → seal
  // each hand → seed board → open pot.
  app.post("/api/new-game", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { human?: Address; bots?: Address[]; fee?: string };
    if (!body.human || !Array.isArray(body.bots)) return json(c, { ok: false, error: "human + bots required" }, 400);
    const fee = body.fee ?? ENTRY_FEE_USDC;
    const order: Address[] = [body.human, ...body.bots];

    try {
      const result = await serialized(async () => {
        const roomId = nextRoom++;
        // 1) Draw a REAL on-chain random word and deal a full 108-card game from it.
        const { word, txHash: shuffleTx } = await randomShuffleWord(e);
        const ug = new UnoGame(order);
        ug.deal(word);
        // 2) Seat the turn order on-chain (human seat 0).
        await startTurns(e, roomId, order);
        // 3) Seed the public board to the real start card.
        const top = ug.top;
        await startRoom(e, roomId, top.color, top.value, HAND_SIZE);
        // 4) Record each seat's real hand count on-chain.
        for (const a of order) await dealHand(e, roomId, a, ug.handCount(a));
        // 5) Open the pot.
        await openPot(e, roomId);
        return { roomId, ug, shuffleTx, word };
      });

      const sealed = new Map<Address, Sealed>();
      for (const a of order) sealed.set(a.toLowerCase() as Address, await sealHand(result.ug.handOf(a)));

      game = {
        roomId: result.roomId,
        fee,
        seats: order.map((a, i) => ({ address: a, role: i === 0 ? "human" : "bot", paid: false })),
        game: result.ug,
        sealed,
        shuffleTx: result.shuffleTx,
        shuffleWord: result.word,
        startedPlay: false,
        paymentTx: {},
      };
      const top = result.ug.top;
      console.log(`[uno-server] new game room ${result.roomId} seats ${order.length} — on-chain shuffle tx ${result.shuffleTx}, start card ${cardLabel(top)}`);
      return json(c, { ok: true, ...publicGame(game) });
    } catch (err) {
      return json(c, { ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // x402 entry fee (unchanged proven rail).
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

  // Reveal the caller's OWN sealed hand (owner-gated by the secrets predicate),
  // plus the indices that are currently legal to play.
  app.post("/api/hand", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { player?: Address };
    if (!body.player) return json(c, { ok: false, error: "player required" }, 400);
    const g = game;
    try {
      const hand = await revealHand(g, body.player);
      const legal = legalPlays(hand, g.game.topState());
      return json(c, { ok: true, hand, legal, handCount: hand.length });
    } catch (err) {
      return json(c, { ok: false, error: err instanceof Error ? err.message : String(err) }, 403);
    }
  });

  // A gasless legal move: validate against the full-rules engine, mirror it
  // on-chain (real card + turn effect), reseal affected hands, settle on win.
  app.post("/api/move", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as {
      player?: Address;
      signedGameplay?: SignedDelegation;
      kind?: "play" | "draw";
      card?: UnoCard;
      chosenColor?: number;
    };
    if (!body.player || !body.signedGameplay || !body.kind) return json(c, { ok: false, error: "player + signedGameplay + kind required" }, 400);
    const g = game;
    if (g.winner) return json(c, { ok: false, error: "game already won", winner: g.winner }, 409);

    try {
      const out = await serialized(async () => {
        // On-chain turn guard (read-after-write tolerant).
        const ok = await waitForTurn(e, g.roomId, body.player!, 3);
        if (!ok) {
          const cur = await getCurrentTurn(e, g.roomId);
          throw new Error(`not your turn (current ${cur})`);
        }

        const directionBefore = g.game.direction;

        if (body.kind === "play") {
          if (!body.card) throw new Error("card required for a play");
          // 1) Validate WITHOUT mutating (throws on illegal). Then commit + apply.
          g.game.validatePlay(body.player!, body.card);
          const effect = g.game.play(body.player!, body.card, body.chosenColor);
          const newCount = g.game.handCount(body.player!);
          const activeColor = g.game.activeColor;
          // advanceBy: 2 if the play skips the next player (Skip / Draw Two / WD4,
          // and Reverse in 2-player); else 1.
          const advanceBy = effect.skipped >= 1 ? 2 : 1;

          // 2) If direction flipped (Reverse, >2 players), reflect it on-chain
          //    BEFORE the move's advance so the on-chain cursor tracks the engine.
          if (effect.reversed && g.game.seats.length > 2) {
            await setTurnDirection(e, g.roomId, g.game.direction as 1 | -1);
          }

          // 3) Record the REAL card on-chain (gasless, turn-bound) — except on a
          //    win, where advanceBy is ignored by the contract.
          const move = await redeemMove(e, reviveSigned(body.signedGameplay!), g.roomId, "play", {
            color: body.card.color,
            value: body.card.value,
            activeColor,
            newHandCount: newCount,
            advanceBy: newCount === 0 ? 1 : advanceBy,
          });

          // 4) Reseal the mover's hand and any forced-draw target's hand.
          await reseal(g, body.player!);
          if (effect.forcedDrawTarget) await reseal(g, effect.forcedDrawTarget);

          g.startedPlay = true;
          const winner = move.winner ?? (g.game.winner as Address | undefined);
          let payoutTx: Hex | undefined;
          if (winner) {
            g.winner = winner;
            payoutTx = await settlePot(e, g.roomId, winner);
            g.payoutTx = payoutTx;
            console.log(`[uno-server] WINNER ${winner} — pot settled tx ${payoutTx}`);
          }
          return { txHash: move.txHash, winner, payoutTx, effect, directionBefore };
        }

        // DRAW: the current player draws one. If the drawn card is not playable
        // the turn passes (advanceBy 1); if playable they keep the turn (0) and
        // will play next.
        const { playable } = g.game.draw(body.player!);
        const newCount = g.game.handCount(body.player!);
        const advanceBy = playable ? 0 : 1;
        const move = await redeemMove(e, reviveSigned(body.signedGameplay!), g.roomId, "draw", { newHandCount: newCount, advanceBy });
        await reseal(g, body.player!);
        g.startedPlay = true;
        return { txHash: move.txHash, winner: undefined as Address | undefined, payoutTx: undefined as Hex | undefined, playable };
      });

      const t = g.game.topState();
      return json(c, {
        ok: true,
        txHash: out.txHash,
        board: { topColor: t.topColor, topValue: t.topValue, activeColor: t.activeColor },
        direction: g.game.direction,
        winner: out.winner ?? null,
        payoutTx: out.payoutTx ?? null,
        playable: (out as { playable?: boolean }).playable,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Map rule rejections to 409 so callers don't treat them as server errors.
      const ruleReject = /NOT_YOUR_TURN|ILLEGAL_MOVE|CARD_NOT_IN_HAND|BAD_COLOR|already won/.test(msg);
      return json(c, { ok: false, error: msg }, ruleReject ? 409 : 500);
    }
  });

  app.get("/api/state", async (c) => {
    if (!game) return json(c, { ok: false, error: "no game" }, 404);
    return json(c, { ok: true, ...publicGame(game), currentTurn: game.game.currentPlayer() });
  });

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`[uno-server] listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error("[uno-server] fatal:", err);
  process.exit(1);
});

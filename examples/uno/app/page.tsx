"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, type UnoCard, colorName } from "../components/Card";
import { UnoClient, type GameView } from "../lib/uno-client";
import { dealHand, chooseMove, isLegal as cardLegal, type Board } from "../lib/hand";
import { getGuestAccount, privyEnabled } from "../lib/signer";
import { POT_ADDRESS } from "../lib/deployment";
import type { LocalAccount } from "viem/accounts";

const BACKEND_URL = process.env.NEXT_PUBLIC_UNO_BACKEND_URL ?? "http://localhost:8790";

type Phase = "connect" | "waiting" | "lobby" | "paying" | "playing" | "done";

function short(a?: string | null) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
}

export default function Home() {
  const [account, setAccount] = useState<LocalAccount | null>(null);
  const [phase, setPhase] = useState<Phase>("connect");
  const [view, setView] = useState<GameView | null>(null);
  const [hand, setHand] = useState<UnoCard[]>([]);
  const [paymentTx, setPaymentTx] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<UnoClient | null>(null);
  const paidRef = useRef(false);
  // After we move, the polled turn lags ~2s; this guard blocks a double-submit
  // until the server confirms the turn has left us (advanced to an opponent).
  const [awaitingAdvance, setAwaitingAdvance] = useState(false);

  const addLog = useCallback((m: string) => {
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 40));
  }, []);

  const client = useMemo(() => {
    if (!account) return null;
    const c = new UnoClient(BACKEND_URL, account);
    clientRef.current = c;
    return c;
  }, [account]);

  const connect = useCallback(() => {
    setError(null);
    const a = getGuestAccount();
    setAccount(a);
    setHand(dealHand(a.address));
    setPhase("waiting");
    addLog(`connected as guest wallet ${short(a.address)}`);
  }, [addLog]);

  const board: Board = view
    ? view.board
    : { topColor: 1, topNumber: 5, activeColor: 1 };

  const mySeat = useMemo(() => {
    if (!account || !view) return null;
    return view.seats.find((s) => s.address.toLowerCase() === account.address.toLowerCase()) ?? null;
  }, [account, view]);

  const turnIsMine = Boolean(
    account && view?.currentTurn && view.currentTurn.toLowerCase() === account.address.toLowerCase(),
  );
  // It's actionably our turn only once the server confirms the turn is ours AND we
  // haven't already moved this turn (awaitingAdvance is a brief debounce after a
  // move so the lagging 2s poll can't trigger a duplicate out-of-turn submit).
  const myTurn = turnIsMine && !awaitingAdvance;

  // Clear the post-move guard either when the polled turn has advanced off us, or
  // after a short debounce (covers the case where the turn cycles back to us
  // between two polls, so `turnIsMine` is never observed false).
  useEffect(() => {
    if (!turnIsMine && awaitingAdvance) setAwaitingAdvance(false);
  }, [turnIsMine, awaitingAdvance]);
  useEffect(() => {
    if (!awaitingAdvance) return;
    const id = setTimeout(() => setAwaitingAdvance(false), 3000);
    return () => clearTimeout(id);
  }, [awaitingAdvance]);

  // Poll the game state from the server.
  useEffect(() => {
    if (!client || phase === "connect") return;
    let alive = true;
    const tick = async () => {
      try {
        const st = await client.state();
        if (!alive) return;
        if (st.ok) {
          setView(st);
          if (mySeatPhaseAdvance(st)) {
            // promote phase from waiting → lobby once seated
          }
        }
      } catch {
        /* transient */
      }
    };
    const mySeatPhaseAdvance = (st: GameView & { ok: boolean }) => {
      const seat = account && st.seats.find((s) => s.address.toLowerCase() === account.address.toLowerCase());
      if (seat) {
        setPhase((p) => {
          if (st.winner) return "done";
          if (p === "waiting") return "lobby";
          if (p === "lobby" && seat.paid) return "playing";
          if (p === "playing" && st.winner) return "done";
          return p;
        });
      }
      return Boolean(seat);
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [client, phase, account]);

  // Reflect winner → done.
  useEffect(() => {
    if (view?.winner) setPhase("done");
  }, [view?.winner]);

  const pay = useCallback(async () => {
    if (!client || !view || paidRef.current) return;
    paidRef.current = true;
    setBusy(true);
    setError(null);
    setPhase("paying");
    try {
      addLog(`signing budget delegation + paying ${view.fee} USDC entry fee (x402)…`);
      const res = await client.pay(POT_ADDRESS, view.fee);
      if (!res.ok || !res.txHash) throw new Error(res.error ?? "charge failed");
      setPaymentTx(res.txHash);
      addLog(`PAID — real USDC transfer settled, tx ${res.txHash}`);
      setPhase("playing");
    } catch (e) {
      paidRef.current = false;
      setError(e instanceof Error ? e.message : String(e));
      addLog(`payment error: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("lobby");
    } finally {
      setBusy(false);
    }
  }, [client, view, addLog]);

  const playCard = useCallback(
    async (idx: number) => {
      if (!client || !view) return;
      const c = hand[idx];
      if (!c || !cardLegal(c, board)) return;
      setBusy(true);
      setError(null);
      try {
        const isWild = c.wild || c.color === 0;
        const args = isWild ? { color: 0, number: 1 } : { color: c.color, number: c.number };
        addLog(`playing ${isWild ? "wild" : `${colorName(c.color)} ${c.number}`} (gasless move)…`);
        const res = await client.move(view.roomId, "play", args);
        if (!res.ok || !res.txHash) throw new Error(res.error ?? "move rejected");
        addLog(`move landed — tx ${res.txHash}`);
        setHand((h) => h.filter((_, i) => i !== idx));
        setAwaitingAdvance(true);
        if (res.winner) {
          addLog(`WINNER ${short(res.winner)} — pot payout tx ${res.payoutTx}`);
          setPhase("done");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        addLog(`move error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [client, view, hand, board, addLog],
  );

  const drawCard = useCallback(async () => {
    if (!client || !view) return;
    setBusy(true);
    try {
      addLog("drawing a card (gasless move)…");
      const res = await client.move(view.roomId, "draw");
      if (!res.ok || !res.txHash) throw new Error(res.error ?? "draw rejected");
      addLog(`drew — tx ${res.txHash}`);
      setHand((h) => [...h, { color: 0, number: 0, wild: true }]);
      setAwaitingAdvance(true);
    } catch (e) {
      addLog(`draw error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [client, view, addLog]);

  // Auto-play helper for the human seat: chooses the best legal card on its turn.
  const autoPlay = useCallback(async () => {
    if (!myTurn || busy || phase !== "playing") return;
    const choice = chooseMove(hand, board);
    if (choice) await playCard(choice.index);
    else await drawCard();
  }, [myTurn, busy, phase, hand, board, playCard, drawCard]);

  const topCard: UnoCard = {
    color: board.topColor,
    number: board.topNumber,
    wild: board.topColor === 0,
  };

  return (
    <main className="relative mx-auto min-h-screen max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">
            NEXUS <span className="text-uno-yellow">UNO</span>
          </h1>
          <p className="mt-1 text-sm text-white/55">
            Fully onchain · gasless moves · 1 USDC entry via x402 · vs bots · Base Sepolia
          </p>
        </div>
        <div className="text-right text-xs text-white/50 ledger">
          <div>wallet {short(account?.address)}</div>
          <div>{privyEnabled() ? "privy" : "guest"} mode</div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-3xl border border-white/10 bg-black/25 p-8 shadow-2xl backdrop-blur">
          {phase === "connect" && (
            <div className="flex min-h-[420px] flex-col items-center justify-center gap-6 text-center">
              <div className="text-6xl">🃏</div>
              <h2 className="text-2xl font-semibold">Sit down at the table</h2>
              <p className="max-w-md text-white/60">
                Connect a self-custodial <b>guest wallet</b> to join the game against the bots.
              </p>
              <button
                type="button"
                data-testid="connect"
                onClick={connect}
                className="rounded-full bg-uno-yellow px-8 py-3 font-bold text-black transition hover:brightness-110"
              >
                Connect wallet
              </button>
            </div>
          )}

          {phase === "waiting" && (
            <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 text-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-uno-yellow border-t-transparent" />
              <p className="text-white/70" data-testid="waiting">
                Waiting for a table… (start the bots: <code className="ledger text-uno-yellow">pnpm bots</code>)
              </p>
            </div>
          )}

          {phase === "lobby" && (
            <div className="flex min-h-[420px] flex-col items-center justify-center gap-6 text-center">
              <h2 className="text-2xl font-semibold">Buy in to the pot</h2>
              <p className="max-w-md text-white/60">
                The entry fee is <b>{view?.fee ?? "1"} USDC</b>, paid as a real x402 charge from{" "}
                <b>your</b> wallet to the Pot at {short(POT_ADDRESS)} — bounded on-chain by your
                budget delegation.
              </p>
              <button
                type="button"
                data-testid="join-and-pay"
                onClick={pay}
                disabled={busy}
                className="rounded-full bg-uno-green px-8 py-3 font-bold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {busy ? "Working…" : `Pay ${view?.fee ?? "1"} USDC`}
              </button>
            </div>
          )}

          {phase === "paying" && (
            <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 text-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-uno-yellow border-t-transparent" />
              <p className="text-white/70">Settling your {view?.fee ?? "1"} USDC entry fee on Base Sepolia…</p>
            </div>
          )}

          {(phase === "playing" || phase === "done") && (
            <div className="flex min-h-[420px] flex-col">
              <div className="mb-10 flex items-center justify-center gap-10">
                <div className="flex flex-col items-center gap-2">
                  <div className="text-xs uppercase tracking-widest text-white/40">discard</div>
                  <div data-testid="discard-top">
                    <Card card={topCard} disabled small={false} />
                  </div>
                  <div className="ledger text-xs text-white/50" data-testid="active-color">
                    active: {colorName(board.activeColor)}
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className="text-xs uppercase tracking-widest text-white/40">draw pile</div>
                  <button
                    type="button"
                    data-testid="draw"
                    onClick={drawCard}
                    disabled={busy || !myTurn || phase === "done"}
                    className="card-face flex h-36 w-24 items-center justify-center rounded-2xl border-2 border-white/15 bg-gradient-to-br from-zinc-800 to-zinc-950 text-3xl font-black text-white/70 disabled:opacity-50"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="mt-auto">
                <div className="mb-3 flex items-center justify-between">
                  <span
                    data-testid="turn-indicator"
                    className={`text-xs uppercase tracking-widest rounded-full px-3 py-1 ${
                      myTurn ? "turn-active text-white" : "text-white/40"
                    }`}
                  >
                    {phase === "done" ? "game over" : myTurn ? "your turn" : "waiting for opponents…"}
                  </span>
                  <button
                    type="button"
                    data-testid="auto-play"
                    onClick={autoPlay}
                    disabled={!myTurn || busy || phase === "done"}
                    className="rounded-full bg-uno-yellow/90 px-4 py-1 text-xs font-bold text-black disabled:opacity-40"
                  >
                    auto-play
                  </button>
                  <span className="ledger text-xs text-white/50">{hand.length} cards</span>
                </div>
                <div className="flex flex-wrap items-end gap-3" data-testid="hand">
                  {hand.map((c, i) => (
                    <Card
                      key={`${c.color}-${c.number}-${i}`}
                      card={c}
                      testid={`hand-card-${i}`}
                      disabled={busy || !myTurn || phase === "done" || !cardLegal(c, board)}
                      onClick={() => playCard(i)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-white/50">Payment</h3>
            {paymentTx ? (
              <div className="space-y-1">
                <div data-testid="payment-status" className="font-bold text-uno-green">
                  PAID · {view?.fee ?? "1"} USDC
                </div>
                <a
                  data-testid="payment-tx"
                  href={`https://sepolia.basescan.org/tx/${paymentTx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ledger block break-all text-xs text-uno-yellow underline"
                >
                  {paymentTx}
                </a>
              </div>
            ) : (
              <div className="text-sm text-white/40">No entry fee paid yet.</div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-white/50">Game</h3>
            <dl className="space-y-1 text-sm">
              <Row k="Room" v={view?.roomId ?? "—"} />
              <Row k="Seats" v={view ? String(view.seats.length) : "—"} />
              <Row k="Pot" v={short(POT_ADDRESS)} />
              <Row k="Top card" v={`${colorName(board.topColor)} ${board.topNumber}`} />
              <Row k="Turn" v={short(view?.currentTurn)} />
              <Row k="Winner" v={short(view?.winner)} />
            </dl>
            {view?.winner && (
              <div data-testid="winner-banner" className="mt-3 rounded-lg bg-uno-green/15 p-2 text-center text-sm font-bold text-uno-green">
                WINNER {short(view.winner)}
                {view.payoutTx && (
                  <a
                    data-testid="payout-tx"
                    href={`https://sepolia.basescan.org/tx/${view.payoutTx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ledger mt-1 block break-all text-[10px] font-normal text-uno-yellow underline"
                  >
                    payout {view.payoutTx}
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 rounded-2xl border border-white/10 bg-black/30 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-white/50">Activity</h3>
            <div className="ledger max-h-72 space-y-1 overflow-auto text-[11px] leading-relaxed text-white/55">
              {log.length === 0 ? <div className="text-white/30">—</div> : log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-uno-red/40 bg-uno-red/10 p-4 text-xs text-uno-red" data-testid="error">
              {error}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-white/40">{k}</dt>
      <dd className="ledger text-white/75">{v}</dd>
    </div>
  );
}

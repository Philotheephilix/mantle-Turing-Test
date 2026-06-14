"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalAccount } from "viem/accounts";
import { getGuestAccount, PRIVY_ENABLED } from "./wallet";
import { Board } from "./components/Board";
import { Dice } from "./components/Dice";
import { MonopolyClient, type GameView } from "@/lib/monopoly-client";
import { BOARD } from "@/lib/board";

const BACKEND_URL = process.env.NEXT_PUBLIC_MONOPOLY_BACKEND_URL ?? "http://localhost:8791";

type Phase = "connect" | "waiting" | "lobby" | "playing" | "done";

function short(a?: string | null) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
}

export default function Page() {
  const [account, setAccount] = useState<LocalAccount | null>(null);
  const [phase, setPhase] = useState<Phase>("connect");
  const [view, setView] = useState<GameView | null>(null);
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paymentTx, setPaymentTx] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<{ text: string; tx: string } | null>(null);
  const [die, setDie] = useState<{ d1: number; d2: number }>({ d1: 0, d2: 0 });
  const [log, setLog] = useState<string[]>([]);
  const paidRef = useRef(false);

  const addLog = useCallback((m: string) => {
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 40));
  }, []);

  const client = useMemo(() => (account ? new MonopolyClient(BACKEND_URL, account) : null), [account]);

  const connect = useCallback(() => {
    setErr(null);
    const a = getGuestAccount();
    setAccount(a);
    setPhase("waiting");
    addLog(`connected as guest wallet ${short(a.address)}`);
    if (typeof window !== "undefined") (window as unknown as Record<string, unknown>).__MONOPOLY_ADDR__ = a.address;
  }, [addLog]);

  const mySeat = useMemo(() => {
    if (!account || !view) return null;
    return view.seats.find((s) => s.address.toLowerCase() === account.address.toLowerCase()) ?? null;
  }, [account, view]);

  const myTurn = Boolean(account && view?.currentTurn && view.currentTurn.toLowerCase() === account.address.toLowerCase());
  const pending = mySeat?.pending ?? null;

  // Poll game state.
  useEffect(() => {
    if (!client || phase === "connect") return;
    let alive = true;
    const tick = async () => {
      try {
        const st = await client.state();
        if (!alive || !st.ok) return;
        setView(st);
        const seat = account && st.seats.find((s) => s.address.toLowerCase() === account.address.toLowerCase());
        setPhase((p) => {
          if (st.winner) return "done";
          if (!seat) return p === "waiting" ? "waiting" : p;
          if (p === "waiting") return "lobby";
          if (p === "lobby" && seat.paid) return "playing";
          return p;
        });
      } catch {
        /* transient */
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [client, phase, account]);

  const pay = useCallback(async () => {
    if (!client || !view || paidRef.current) return;
    paidRef.current = true;
    setBusy(true);
    setErr(null);
    try {
      addLog(`signing budget delegation + paying ${view.fee} USDC buy-in (x402)…`);
      const res = await client.payBuyIn(view.pot);
      if (!res.ok || !res.txHash) throw new Error(res.error ?? "buy-in failed");
      setPaymentTx(res.txHash);
      setLastTx({ text: `Buy-in ${view.fee} USDC settled`, tx: res.txHash });
      addLog(`PAID buy-in — tx ${res.txHash}`);
      setPhase("playing");
    } catch (e) {
      paidRef.current = false;
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [client, view, addLog]);

  const roll = useCallback(async () => {
    if (!client || !view) return;
    setBusy(true);
    setRolling(true);
    setErr(null);
    try {
      addLog("rolling onchain dice (gasless)…");
      const res = await client.roll(view.roomId);
      if (!res.ok || !res.txHash) throw new Error(res.error ?? "roll rejected");
      if (res.die1 != null && res.die2 != null) setDie({ d1: res.die1, d2: res.die2 });
      setLastTx({ text: `Rolled ${res.die1}+${res.die2} → ${res.space}`, tx: res.txHash });
      addLog(`rolled ${res.die1}+${res.die2} → ${res.space} (${res.pending?.kind ?? "free"}) — tx ${res.txHash}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setTimeout(() => setRolling(false), 500);
    }
  }, [client, view, addLog]);

  const buy = useCallback(async () => {
    if (!client || !view) return;
    setBusy(true);
    setErr(null);
    try {
      addLog(`buying property (real ${view.charges.buy} USDC x402)…`);
      const res = await client.buy(view.pot);
      if (!res.ok || !res.txHash) throw new Error(res.error ?? "buy rejected");
      setLastTx({ text: `Bought property · ${view.charges.buy} USDC`, tx: res.txHash });
      addLog(`BOUGHT — tx ${res.txHash} (owns ${res.properties})`);
      if (res.winner) addLog(`WINNER ${short(res.winner)} — payout tx ${res.payoutTx}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [client, view, addLog]);

  const rent = useCallback(async () => {
    if (!client || !view) return;
    setBusy(true);
    setErr(null);
    try {
      addLog(`paying rent (real ${view.charges.rent} USDC x402)…`);
      const res = await client.rent(view.pot);
      if (!res.ok || !res.txHash) throw new Error(res.error ?? "rent rejected");
      setLastTx({ text: `Paid rent · ${view.charges.rent} USDC`, tx: res.txHash });
      addLog(`PAID RENT — tx ${res.txHash}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [client, view, addLog]);

  const position = mySeat?.position ?? 0;
  const space = BOARD[position % BOARD.length];

  // ── connect ──
  if (phase === "connect") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="panel rounded-3xl p-10 max-w-md w-full text-center">
          <div className="gold-text text-5xl font-bold tracking-tight">NEXUS</div>
          <div className="text-emerald-200/80 tracking-[0.3em] text-sm mt-2">ONCHAIN MONOPOLY</div>
          <p className="text-emerald-100/70 mt-6 text-sm leading-relaxed">
            Gasless dice via an onchain randomness coordinator. Buy-in, property buys and rent settle
            as <span className="gold-text">real per-player USDC payments</span> on Base Sepolia — each
            from <b>your own</b> wallet, bounded by a single Nexus delegation you sign. First to own{" "}
            <b>{view?.targetProperties ?? 2}</b> properties wins the pot.
          </p>
          <button data-testid="login-btn" onClick={connect} className="btn btn-primary w-full mt-8 py-3 text-base">
            {PRIVY_ENABLED ? "Log in with Privy" : "Play as Guest"}
          </button>
          <div className="text-emerald-300/50 text-[11px] mt-4">
            Guest wallet (generated locally · no account needed)
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-5">
          <div>
            <span className="gold-text text-2xl font-bold tracking-tight">NEXUS</span>
            <span className="text-emerald-200/70 text-sm ml-2 tracking-[0.25em]">MONOPOLY</span>
          </div>
          <div className="panel rounded-xl px-3 py-1.5 text-right">
            <div className="text-[10px] text-emerald-300/60 uppercase tracking-wider">guest wallet</div>
            <div data-testid="wallet-address" className="mono text-xs text-emerald-100">
              {account ? `${account.address.slice(0, 6)}…${account.address.slice(-4)}` : "—"}
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-[1fr_340px] gap-6">
          <div>
            <Board board={BOARD} position={position} properties={(view?.properties as Record<number, string>) ?? {}} playerAddress={account?.address ?? null} />
          </div>

          <aside className="space-y-4">
            {phase === "waiting" && (
              <div className="panel rounded-2xl p-6 text-center" data-testid="waiting">
                <div className="h-8 w-8 mx-auto animate-spin rounded-full border-4 border-emerald-400 border-t-transparent" />
                <p className="text-emerald-200/70 text-sm mt-3">Waiting for a table… (start the bots: <code className="gold-text">pnpm bots</code>)</p>
              </div>
            )}

            {phase === "lobby" && (
              <div className="panel rounded-2xl p-5 text-center">
                <div className="text-sm text-emerald-100/80 mb-3">
                  Buy in to the pot — <b>{view?.fee} USDC</b>, paid as a real x402 charge from <b>your</b>{" "}
                  wallet to the Pot {short(view?.pot)}, bounded on-chain by your budget delegation.
                </div>
                <button data-testid="join-btn" onClick={pay} disabled={busy} className="btn btn-gold w-full py-3">
                  {busy ? "Paying buy-in…" : `Join · pay ${view?.fee} USDC`}
                </button>
              </div>
            )}

            {(phase === "playing" || phase === "done") && (
              <>
                <div className="panel rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-emerald-300/60 uppercase tracking-wider">On</div>
                    <div className="text-emerald-100 font-semibold">{space.name}</div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-emerald-200/60">
                    <span>pos <span data-testid="position" className="mono">{position}</span></span>
                    <span>properties <span data-testid="my-properties" className="mono gold-text">{mySeat?.properties ?? 0}</span> / {view?.targetProperties ?? 2}</span>
                  </div>
                </div>

                <div className="panel rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[11px] text-emerald-300/60 uppercase tracking-wider">Onchain dice</div>
                    <div className="text-[10px] text-emerald-300/40">RandomnessCoordinator</div>
                  </div>
                  <div className="flex items-center justify-center py-2">
                    <Dice die1={die.d1} die2={die.d2} rolling={rolling} />
                  </div>

                  <div className="mb-2 text-center text-[11px]">
                    <span data-testid="turn-indicator" className={myTurn ? "gold-text font-bold" : "text-emerald-200/40"}>
                      {phase === "done" ? "game over" : myTurn ? "your turn" : "waiting for opponents…"}
                    </span>
                  </div>

                  {phase === "done" ? (
                    <div className="text-center text-emerald-300/70 text-sm py-2">Game over.</div>
                  ) : pending?.kind === "buy" ? (
                    <button data-testid="buy-btn" onClick={buy} disabled={busy} className="btn btn-primary w-full py-3">
                      {busy ? "Buying…" : `Buy ${BOARD[pending.spaceId].name} · ${view?.charges.buy} USDC`}
                    </button>
                  ) : pending?.kind === "rent" ? (
                    <button data-testid="rent-btn" onClick={rent} disabled={busy} className="btn btn-danger w-full py-3">
                      {busy ? "Paying rent…" : `Pay rent · ${view?.charges.rent} USDC`}
                    </button>
                  ) : (
                    <button data-testid="roll-btn" onClick={roll} disabled={busy || !myTurn} className="btn btn-primary w-full py-3">
                      {busy ? "Rolling onchain…" : myTurn ? "Roll dice" : "Wait for your turn"}
                    </button>
                  )}
                </div>
              </>
            )}

            {paymentTx && (
              <div className="panel rounded-2xl p-4">
                <div className="text-[11px] text-emerald-300/60 uppercase tracking-wider mb-1">Buy-in</div>
                <div data-testid="payment-status" className="text-sm font-bold text-emerald-300">PAID · {view?.fee} USDC</div>
                <a data-testid="payment-tx" className="tx-link text-xs mono break-all block" href={`https://sepolia.basescan.org/tx/${paymentTx}`} target="_blank" rel="noreferrer">{paymentTx}</a>
              </div>
            )}

            {lastTx && (
              <div className="panel rounded-2xl p-4" data-testid="last-tx">
                <div className="text-[11px] text-emerald-300/60 uppercase tracking-wider mb-1">Settled onchain</div>
                <div className="text-sm text-emerald-100">{lastTx.text}</div>
                <a className="tx-link text-xs mono break-all" href={`https://sepolia.basescan.org/tx/${lastTx.tx}`} target="_blank" rel="noreferrer">{lastTx.tx}</a>
              </div>
            )}

            {view?.winner && (
              <div data-testid="winner-banner" className="panel rounded-2xl p-4 text-center text-sm font-bold text-emerald-300">
                WINNER {short(view.winner)}
                {view.payoutTx && (
                  <a data-testid="payout-tx" className="tx-link block mono text-[10px] font-normal break-all mt-1" href={`https://sepolia.basescan.org/tx/${view.payoutTx}`} target="_blank" rel="noreferrer">
                    {view.payoutTx}
                  </a>
                )}
              </div>
            )}

            {err && <div className="rounded-2xl p-3 bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs" data-testid="error">{err}</div>}

            <div className="panel rounded-2xl p-4">
              <div className="text-[11px] text-emerald-300/60 uppercase tracking-wider mb-2">Activity</div>
              <ul className="space-y-1 max-h-56 overflow-auto text-[11px] text-emerald-100/70" data-testid="log">
                {log.length === 0 ? <li className="text-emerald-200/40">No moves yet.</li> : log.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

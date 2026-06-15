"use client";

import { motion } from "framer-motion";
import { GAMES } from "@/lib/games";
import { GameCard } from "./GameCard";
import { IsoScene } from "./IsoScene";
import { IsoTilt } from "./IsoTilt";
import { Mascot } from "./Mascot";
import { Reveal } from "./Reveal";
import { Marquee } from "./Marquee";
import { SquiggleUnderline } from "./SquiggleUnderline";
import { MagneticButton } from "./MagneticButton";
import { GaslessFlow } from "./GaslessFlow";
import { DiceRoller } from "./DiceRoller";

function Kicker({ children }: { children: React.ReactNode }) {
  return <span className="font-display text-sm font-extrabold uppercase tracking-wider text-coral">{children}</span>;
}

const STEPS = [
  { n: "01", t: "Grab a seat", b: "Join a room and pick your wallet. Free to look around, no setup marathon.", a: "bg-coral" },
  { n: "02", t: "Sign once", b: "One signature sets your spend caps and turn rules. Then your wallet goes quiet.", a: "bg-amber" },
  { n: "03", t: "Play & win", b: "Every move is gasless. The pot is real USDC, paid out onchain to the winner.", a: "bg-grass" },
];

export function GamerHome() {
  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-6xl px-5 sm:px-8"
    >
      {/* Hero */}
      <section className="grid items-center gap-6 py-10 lg:grid-cols-[1.05fr_1fr] lg:py-16">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border-[2px] border-ink bg-paper px-3 py-1 text-xs font-bold uppercase tracking-wide shadow-sticker-sm">
            <span className="h-2 w-2 rounded-full bg-grass" />
            Live on Base
          </span>
          <h1 className="mt-6 font-display text-[clamp(2.8rem,8vw,5.2rem)] font-extrabold leading-[0.95]">
            Play onchain
            <br />
            games.{" "}
            <span className="relative inline-block">
              <span className="relative z-10">Zero gas.</span>
              <SquiggleUnderline className="absolute -bottom-3 left-0 h-5 w-full" />
            </span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-soft">
            Sign once when you sit down. After that every move and every USDC bet runs
            with no wallet popup, capped onchain so you stay in control. Real games, real
            stakes.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <MagneticButton href="#library" className="sticker rounded-full bg-coral px-7 py-3.5 text-base font-bold text-paper">
              Play the games
            </MagneticButton>
            <a href="#how" className="rounded-full px-5 py-3.5 text-base font-bold text-ink underline decoration-ink/30 decoration-2 underline-offset-4 hover:decoration-ink">
              How it works
            </a>
          </div>
        </div>

        <div className="relative">
          <IsoTilt className="mx-auto w-full max-w-[560px]">
            <IsoScene className="drop-shadow-[0_24px_24px_oklch(0.245_0.03_55_/_0.12)]" />
          </IsoTilt>
          <motion.div
            className="absolute -bottom-2 left-2 sm:left-6"
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            <Mascot accent="coral" width={92} />
          </motion.div>
        </div>
      </section>

      <div className="-mx-5 sm:-mx-8">
        <Marquee items={["Gasless moves", "Real USDC stakes", "Sealed hands", "Spend caps onchain", "No wallet popups", "Settled on Base"]} />
      </div>

      {/* How to play */}
      <section id="how" className="scroll-mt-20 py-12 sm:py-20">
        <Reveal className="max-w-2xl">
          <Kicker>How to play</Kicker>
          <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-tight">
            Sit down, sign once, the rest just flows.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.08}>
              <div className="sticker h-full rounded-chunk bg-paper p-6">
                <span className={`grid h-12 w-12 place-items-center rounded-2xl border-[2.5px] border-ink font-display text-lg font-extrabold text-paper shadow-sticker-sm ${s.a}`}>
                  {s.n}
                </span>
                <h3 className="mt-5 font-display text-xl font-bold">{s.t}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{s.b}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Gasless flow */}
      <section className="py-12 sm:py-20">
        <Reveal>
          <div className="sticker overflow-hidden rounded-chunk bg-paper-deep p-6 sm:p-10">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <Kicker>The magic trick</Kicker>
                <h2 className="mt-2 font-display text-[clamp(1.6rem,3.6vw,2.2rem)] font-extrabold leading-tight">
                  Your USDC moves. Your gas doesn&apos;t.
                </h2>
              </div>
              <p className="max-w-xs text-sm text-ink-soft">
                One signature, then a relayer pushes every move and payout onchain and
                eats the gas. You just play.
              </p>
            </div>
            <GaslessFlow accent="coral" endLabel="You win" endKind="coin" className="mt-4 w-full" />
          </div>
        </Reveal>
      </section>

      {/* Library */}
      <section id="library" className="scroll-mt-20 py-12 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Reveal className="max-w-2xl">
            <Kicker>The library</Kicker>
            <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-tight">
              Pick a table. Pull up a chair.
            </h2>
          </Reveal>
          <p className="text-sm font-semibold text-ink-faint">Served right here on Steamlink</p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {GAMES.map((game, i) => (
            <Reveal key={game.slug} delay={i * 0.07}>
              <GameCard game={game} />
            </Reveal>
          ))}
        </div>
      </section>

      {/* The pot is real */}
      <section className="py-12 sm:py-20">
        <Reveal>
          <div className="sticker relative overflow-hidden rounded-chunk bg-coral p-8 text-paper sm:p-12">
            <div className="relative z-10 max-w-xl">
              <span className="font-display text-sm font-extrabold uppercase tracking-wider text-paper/80">The pot is real</span>
              <h2 className="mt-3 font-display text-[clamp(1.8rem,4vw,2.6rem)] font-extrabold leading-tight">
                You&apos;re not playing for points.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-paper/90">
                Entry fees and bets are real USDC, bounded onchain by your own spend caps
                and held in escrow by the contract. When you win, the contract pays you,
                not a server. No house, no custody, no fake win.
              </p>
            </div>
            <div className="relative z-10 mt-7 flex items-center gap-4 sm:absolute sm:right-10 sm:top-1/2 sm:mt-0 sm:-translate-y-1/2">
              <div className="rounded-chunk border-[2.5px] border-ink bg-paper/95 p-4 text-center text-ink shadow-sticker">
                <DiceRoller />
                <p className="mt-1 max-w-[8rem] text-[11px] font-semibold leading-snug text-ink-soft">
                  Onchain randomness. Roll a 6 for a treat.
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </motion.main>
  );
}

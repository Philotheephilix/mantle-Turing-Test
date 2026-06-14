"use client";

import { motion } from "framer-motion";
import { GAMES } from "@/lib/games";
import { IsoTilt } from "./IsoTilt";
import { IsoWorkbench } from "./IsoWorkbench";
import { Mascot } from "./Mascot";
import { Reveal } from "./Reveal";
import { Marquee } from "./Marquee";
import { SquiggleUnderline } from "./SquiggleUnderline";
import { MagneticButton } from "./MagneticButton";
import { GaslessFlow } from "./GaslessFlow";

function Kicker({ children }: { children: React.ReactNode }) {
  return <span className="font-display text-sm font-extrabold uppercase tracking-wider text-sky">{children}</span>;
}

const STEPS = [
  { n: "01", t: "defineGame()", b: "Describe tables and systems in TypeScript. Codegen emits the Solidity table glue and a deploy manifest.", a: "bg-sky" },
  { n: "02", t: "Deploy once", b: "One CLI deploys the World, systems and caveat enforcers to Base. Migrate logic without touching stored state.", a: "bg-grape" },
  { n: "03", t: "Gasless from move one", b: "Players sign a single delegation. The relayer redeems every move and x402 charge. Zero gas for them.", a: "bg-coral" },
];

const PACKAGES = [
  { n: "core", d: "defineGame, codegen, signing" },
  { n: "contracts", d: "World ECS, enforcers, Pot" },
  { n: "react", d: "live state, optimistic UI" },
  { n: "relayer", d: "gasless redemption" },
  { n: "server", d: "x402 paywall middleware" },
  { n: "secrets", d: "sealed hidden state" },
];

const CAVEATS = {
  gameplay: ["TurnBound", "LimitedCalls", "SystemAllowlist", "Timestamp"],
  budget: ["PerActionCap", "TransferAmount", "AllowedRecipients"],
};

export function DeveloperHome() {
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
            <span className="h-2 w-2 rounded-full bg-sky" />
            Onchain game engine · Base
          </span>
          <h1 className="mt-6 font-display text-[clamp(2.6rem,7.5vw,5rem)] font-extrabold leading-[0.95]">
            Build onchain
            <br />
            games.{" "}
            <span className="relative inline-block">
              <span className="relative z-10">One sig.</span>
              <SquiggleUnderline className="absolute -bottom-3 left-0 h-5 w-full" color="oklch(0.64 0.15 245)" />
            </span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-soft">
            A fully onchain, turn-based game engine for Base. Define a game as data and
            Solidity, deploy with one CLI, and one ERC-7710 delegation powers gasless
            moves plus x402 payments bounded by onchain spend caps.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <MagneticButton href="#start" className="sticker rounded-full bg-sky px-7 py-3.5 text-base font-bold text-paper">
              Get started
            </MagneticButton>
            <a href="#engine" className="rounded-full px-5 py-3.5 text-base font-bold text-ink underline decoration-ink/30 decoration-2 underline-offset-4 hover:decoration-ink">
              See the engine
            </a>
          </div>
        </div>

        <div className="relative">
          <IsoTilt className="mx-auto w-full max-w-[560px]">
            <IsoWorkbench className="drop-shadow-[0_24px_24px_oklch(0.245_0.03_55_/_0.12)]" />
          </IsoTilt>
          <motion.div
            className="absolute -bottom-2 right-2 sm:right-6"
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            <Mascot accent="sky" width={92} />
          </motion.div>
        </div>
      </section>

      <div className="-mx-5 sm:-mx-8">
        <Marquee items={["defineGame()", "ERC-7710 delegation", "Gasless relayer", "x402 paywall", "Sealed state", "One CLI deploy", "Base only"]} />
      </div>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 py-12 sm:py-20">
        <Reveal className="max-w-2xl">
          <Kicker>The workflow</Kicker>
          <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-tight">
            Data in, a deployed game out.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.08}>
              <div className="sticker h-full rounded-chunk bg-paper p-6">
                <span className={`grid h-12 w-12 place-items-center rounded-2xl border-[2.5px] border-ink font-display text-lg font-extrabold text-paper shadow-sticker-sm ${s.a}`}>
                  {s.n}
                </span>
                <h3 className="mt-5 font-mono text-base font-bold">{s.t}</h3>
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
                <Kicker>Gasless, end to end</Kicker>
                <h2 className="mt-2 font-display text-[clamp(1.6rem,3.6vw,2.2rem)] font-extrabold leading-tight">
                  Players sign. The relayer settles.
                </h2>
              </div>
              <p className="max-w-xs text-sm text-ink-soft">
                One ERC-7710 delegation is redeemed for every move and x402 charge. Gas is
                paid in stablecoin by the relayer, never by the player.
              </p>
            </div>
            <GaslessFlow accent="sky" endLabel="Base settles" endKind="base" className="mt-4 w-full" />
          </div>
        </Reveal>
      </section>

      {/* The engine: code + one delegation */}
      <section id="engine" className="scroll-mt-20 py-12 sm:py-20">
        <Reveal>
          <div className="sticker overflow-hidden rounded-chunk bg-paper">
            <div className="grid lg:grid-cols-[1fr_1fr]">
              <div className="p-8 sm:p-12">
                <Kicker>One delegation</Kicker>
                <h2 className="mt-3 font-display text-[clamp(1.8rem,4vw,2.4rem)] font-extrabold leading-tight">
                  Two caveat groups. Enforced onchain.
                </h2>
                <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">
                  A player signs once. That single grant carries gameplay rules and budget
                  rules, each compiled into concrete caveat enforcers the contracts check
                  on every redemption.
                </p>
                <div className="mt-6 space-y-4">
                  <div>
                    <p className="font-mono text-xs font-bold uppercase tracking-wide text-coral">Gameplay caveats</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {CAVEATS.gameplay.map((c) => (
                        <span key={c} className="rounded-full border-[2px] border-ink bg-paper-deep px-2.5 py-0.5 text-[11px] font-bold">{c}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="font-mono text-xs font-bold uppercase tracking-wide text-sky">Budget caveats</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {CAVEATS.budget.map((c) => (
                        <span key={c} className="rounded-full border-[2px] border-ink bg-paper-deep px-2.5 py-0.5 text-[11px] font-bold">{c}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t-[2.5px] border-ink bg-ink p-6 sm:p-8 lg:border-l-[2.5px] lg:border-t-0">
                <div className="mb-4 flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-coral" />
                  <span className="h-3 w-3 rounded-full bg-amber" />
                  <span className="h-3 w-3 rounded-full bg-grass" />
                  <span className="ml-2 font-mono text-xs text-paper/50">game.ts</span>
                </div>
                <pre className="overflow-x-auto font-mono text-[13px] leading-relaxed text-paper/90">
                  <code>{`defineGame({
  name: "uno",
  tables: {
    Hand: { player: t.address, cards: t.bytes },
    Pot:  { roomId: t.uint256, amount: t.uint256 },
  },
  systems: { PlayCard: "src/PlayCard.sol" },
  economy: {
    entryFee: { amount: "1.00", token: "USDC" },
    pot: { type: "winner-take-all" },
  },
})`}</code>
                </pre>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* SDK surface */}
      <section className="py-12 sm:py-20">
        <Reveal className="max-w-2xl">
          <Kicker>The SDK</Kicker>
          <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-tight">
            Batteries included, ports everywhere.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PACKAGES.map((p, i) => (
            <Reveal key={p.n} delay={i * 0.05}>
              <div className="sticker sticker-lift h-full rounded-chunk bg-paper p-5">
                <p className="font-mono text-base font-bold">
                  <span className="text-ink-faint">@steamlink/</span>
                  {p.n}
                </p>
                <p className="mt-1.5 text-sm text-ink-soft">{p.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Built with Steamlink (compact library) */}
      <section className="py-12 sm:py-20">
        <Reveal className="max-w-2xl">
          <Kicker>Built with Steamlink</Kicker>
          <h2 className="mt-3 font-display text-[clamp(1.8rem,4vw,2.4rem)] font-extrabold leading-tight">
            Reference games, shipped to Base.
          </h2>
        </Reveal>
        <div className="mt-10 flex flex-wrap gap-3">
          {GAMES.map((g) => (
            <a key={g.slug} href={`/play/${g.slug}`} className="sticker sticker-lift rounded-full bg-paper px-5 py-2.5 text-sm font-bold">
              {g.title}
            </a>
          ))}
        </div>
      </section>

      {/* Get started */}
      <section id="start" className="scroll-mt-20 py-12 sm:py-20">
        <Reveal>
          <div className="sticker rounded-chunk bg-sky p-8 text-paper sm:p-12">
            <span className="font-display text-sm font-extrabold uppercase tracking-wider text-paper/80">Get started</span>
            <h2 className="mt-3 font-display text-[clamp(1.8rem,4vw,2.6rem)] font-extrabold leading-tight">
              One command to scaffold a game.
            </h2>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <span className="sticker rounded-full bg-ink px-5 py-2.5 font-mono text-sm font-bold text-paper">
                npx @steamlink/cli init my-game
              </span>
              <span className="text-sm font-bold text-paper/80">Docs coming soon</span>
            </div>
          </div>
        </Reveal>
      </section>
    </motion.main>
  );
}

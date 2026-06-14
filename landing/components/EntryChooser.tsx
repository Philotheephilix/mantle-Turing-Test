"use client";

import { motion } from "framer-motion";
import { Mascot } from "./Mascot";
import { fireConfettiFrom } from "@/lib/confetti";
import type { Mode } from "@/lib/mode";

const PANELS: {
  mode: Mode;
  label: string;
  title: string;
  blurb: string;
  chips: string[];
  accent: string;
  ring: string;
  mascot: "coral" | "sky";
}[] = [
  {
    mode: "gamer",
    label: "I'm a",
    title: "Gamer",
    blurb: "Real games, real stakes, zero gas. Sit down, sign once, play.",
    chips: ["UNO", "Monopoly", "Win the pot"],
    accent: "bg-coral",
    ring: "group-hover:shadow-[10px_10px_0_0_oklch(0.55_0.19_29)]",
    mascot: "coral",
  },
  {
    mode: "developer",
    label: "I'm a",
    title: "Developer",
    blurb: "Define a game as data and Solidity. Deploy to Base, gasless from move one.",
    chips: ["defineGame()", "One CLI", "x402"],
    accent: "bg-sky",
    ring: "group-hover:shadow-[10px_10px_0_0_oklch(0.5_0.14_244)]",
    mascot: "sky",
  },
];

export function EntryChooser({ onChoose }: { onChoose: (m: Mode) => void }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-5 py-16">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 mb-10 text-center"
      >
        <span className="inline-flex items-center gap-2 rounded-full border-[2px] border-ink bg-paper px-3 py-1 text-xs font-bold uppercase tracking-wide shadow-sticker-sm">
          <span className="h-2 w-2 rounded-full bg-grass" />
          Welcome to Steamlink
        </span>
        <h1 className="mt-5 font-display text-[clamp(2.2rem,7vw,4rem)] font-extrabold leading-[0.95]">
          How do you want
          <br />
          to{" "}
          <span className="relative inline-block">
            <span className="relative z-10">roll?</span>
            <span className="absolute inset-x-[-4px] bottom-1 z-0 h-4 -rotate-1 rounded-sm bg-amber" aria-hidden />
          </span>
        </h1>
        <p className="mt-4 text-base font-medium text-ink-soft">
          Pick your side. You can switch any time.
        </p>
      </motion.div>

      <div className="relative z-10 grid w-full max-w-3xl gap-5 sm:grid-cols-2">
        {PANELS.map((p, i) => (
          <motion.button
            key={p.mode}
            onClick={(e) => {
              fireConfettiFrom(e.currentTarget);
              setTimeout(() => onChoose(p.mode), 180);
            }}
            initial={{ opacity: 0, y: 28, rotate: i === 0 ? -2 : 2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ duration: 0.6, delay: 0.15 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -6, rotate: i === 0 ? -1.2 : 1.2 }}
            whileTap={{ scale: 0.97 }}
            className={`group sticker relative flex flex-col items-center overflow-hidden rounded-chunk bg-paper p-7 text-center transition-shadow ${p.ring}`}
          >
            <div className={`absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full blur-2xl ${p.accent} opacity-20`} aria-hidden />
            <div className="wiggle-hover">
              <Mascot accent={p.mascot} width={120} />
            </div>
            <span className="mt-2 text-sm font-bold uppercase tracking-wide text-ink-faint">{p.label}</span>
            <span className="font-display text-3xl font-extrabold">{p.title}</span>
            <p className="mt-2 max-w-[15rem] text-[15px] leading-relaxed text-ink-soft">{p.blurb}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {p.chips.map((c) => (
                <span key={c} className="rounded-full border-[2px] border-ink bg-paper-deep px-2.5 py-0.5 text-[11px] font-bold">
                  {c}
                </span>
              ))}
            </div>
            <span className={`mt-6 inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-bold text-paper ${p.accent} border-[2.5px] border-ink shadow-sticker-sm`}>
              Let&apos;s go
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M3 8h9M8 4l4 4-4 4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

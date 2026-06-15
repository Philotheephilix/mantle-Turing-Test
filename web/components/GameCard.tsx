"use client";

import type { GameAccent, GameEntry } from "@/lib/games";
import { motion, useMotionValue, useSpring } from "framer-motion";
import Link from "next/link";

/** Per-accent class bundles. Literal strings so Tailwind keeps them. */
const ACCENT: Record<GameAccent, { tile: string; chip: string; glow: string }> = {
  coral: { tile: "bg-coral text-paper", chip: "bg-coral/15 text-coral-deep", glow: "bg-coral/25" },
  grape: { tile: "bg-grape text-paper", chip: "bg-grape/15 text-grape", glow: "bg-grape/25" },
  sky: { tile: "bg-sky text-paper", chip: "bg-sky/15 text-sky", glow: "bg-sky/25" },
  grass: { tile: "bg-grass text-ink", chip: "bg-grass/20 text-ink-soft", glow: "bg-grass/25" },
  amber: { tile: "bg-amber text-ink", chip: "bg-amber/25 text-ink-soft", glow: "bg-amber/30" },
  berry: { tile: "bg-berry text-paper", chip: "bg-berry/15 text-berry", glow: "bg-berry/25" },
};

const STATUS_LABEL: Record<GameEntry["status"], string> = {
  live: "Live now",
  demo: "Demo",
  "coming-soon": "Coming soon",
};

export function GameCard({ game }: { game: GameEntry }) {
  const a = ACCENT[game.accent];
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const rotateX = useSpring(rx, { stiffness: 220, damping: 18 });
  const rotateY = useSpring(ry, { stiffness: 220, damping: 18 });

  function onMove(e: React.MouseEvent) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    ry.set(px * 11);
    rx.set(-py * 11);
  }
  function reset() {
    rx.set(0);
    ry.set(0);
  }

  return (
    <Link href={`/play/${game.slug}`} className="block [perspective:900px]">
      <motion.div
        onMouseMove={onMove}
        onMouseLeave={reset}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        whileHover={{ y: -4 }}
        className="sticker group relative flex h-full flex-col overflow-hidden rounded-chunk bg-paper p-5"
      >
        {/* shine sweep */}
        <span
          className="pointer-events-none absolute inset-0 -translate-x-[150%] skew-x-12 bg-gradient-to-r from-transparent via-white/35 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[150%]"
          aria-hidden
        />
        {/* corner glow */}
        <div
          className={`pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full blur-2xl ${a.glow}`}
          aria-hidden
        />

        <div className="mb-5 flex items-start justify-between">
          <span
            className={`grid h-14 w-14 place-items-center rounded-2xl border-[2.5px] border-ink font-display text-2xl font-extrabold shadow-sticker-sm transition-transform duration-200 group-hover:-rotate-6 group-hover:scale-110 ${a.tile}`}
          >
            {game.monogram}
          </span>
          <span className="rounded-full border-[2px] border-ink bg-paper px-3 py-1 text-[11px] font-semibold uppercase tracking-wide">
            {STATUS_LABEL[game.status]}
          </span>
        </div>

        <h3 className="font-display text-2xl font-bold">{game.title}</h3>
        <p className="mt-1.5 flex-1 text-[15px] leading-relaxed text-ink-soft">{game.tagline}</p>

        <div className="mt-5 flex flex-wrap gap-1.5">
          {game.tags.map((tag) => (
            <span
              key={tag}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${a.chip}`}
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between border-t-2 border-dashed border-ink/15 pt-4 text-sm font-semibold">
          <span className="text-ink-faint">{game.players} players</span>
          <span className="inline-flex items-center gap-1 text-ink transition-transform group-hover:translate-x-0.5">
            Play
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M3 8h9M8 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </motion.div>
    </Link>
  );
}

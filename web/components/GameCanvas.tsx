"use client";

import type { GameAccent } from "@/lib/games";
import { Mascot } from "./Mascot";

/**
 * The game surface: an arcade-cabinet bezel around a "powered-on" screen. This is
 * the porting seam — the real game mounts inside the screen later. For now it's a
 * delightful standby placeholder (scanlines, drifting bits, blinking caret).
 */

const TILE: Record<GameAccent, string> = {
  coral: "bg-coral text-paper",
  grape: "bg-grape text-paper",
  sky: "bg-sky text-paper",
  grass: "bg-grass text-ink",
  amber: "bg-amber text-ink",
  berry: "bg-berry text-paper",
};

const MASCOT: Record<GameAccent, "coral" | "sky" | "amber" | "grape" | "grass"> = {
  coral: "coral",
  grape: "grape",
  sky: "sky",
  grass: "grass",
  amber: "amber",
  berry: "coral",
};

const FLOATERS = [
  { left: "12%", top: "24%", d: 9, glyph: "♦", color: "oklch(0.66 0.2 30)" },
  { left: "82%", top: "30%", d: 11, glyph: "$", color: "oklch(0.82 0.15 78)" },
  { left: "18%", top: "70%", d: 12, glyph: "♣", color: "oklch(0.71 0.15 150)" },
  { left: "86%", top: "66%", d: 10, glyph: "●", color: "oklch(0.64 0.15 245)" },
];

export function GameCanvas({
  monogram,
  title,
  accent,
}: {
  monogram: string;
  title: string;
  accent: GameAccent;
}) {
  return (
    <div className="sticker rounded-[1.8rem] bg-ink p-2.5 shadow-sticker-lg sm:p-4">
      {/* marquee strip */}
      <div className="mb-2.5 flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-coral" />
          <span className="h-3 w-3 rounded-full bg-amber" />
          <span className="h-3 w-3 rounded-full bg-grass" />
        </div>
        <span className="font-display text-xs font-extrabold uppercase tracking-[0.25em] text-paper/70">
          {title} · cabinet
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-grass">
          <span className="h-2 w-2 rounded-full bg-grass anim-pulse" />
          Standby
        </span>
      </div>

      {/* screen */}
      <div
        className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border-2 border-ink/60"
        style={{ background: "radial-gradient(120% 120% at 50% 0%, oklch(0.22 0.03 285) 0%, oklch(0.13 0.02 285) 70%)" }}
      >
        {/* grid + scanlines */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(oklch(0.7 0.1 250 / 0.12) 1px, transparent 1px), linear-gradient(90deg, oklch(0.7 0.1 250 / 0.12) 1px, transparent 1px)",
            backgroundSize: "34px 34px",
          }}
        />
        <div
          className="absolute inset-0 opacity-50"
          style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent 0 2px, oklch(0 0 0 / 0.18) 2px 3px)" }}
        />
        {/* moving scan bar */}
        <div className="anim-scan absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-transparent via-white/8 to-transparent" />

        {/* drifting suit glyphs */}
        {FLOATERS.map((f, i) => (
          <span
            key={i}
            className="absolute font-display text-2xl font-bold opacity-30"
            style={{ left: f.left, top: f.top, color: f.color, animation: `drift ${f.d}s ease-in-out ${i * 0.5}s infinite` }}
          >
            {f.glyph}
          </span>
        ))}

        {/* center content */}
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6 text-center">
          <span className={`mb-5 grid h-16 w-16 place-items-center rounded-2xl border-[2.5px] border-ink font-display text-3xl font-extrabold shadow-sticker float-a ${TILE[accent]}`}>
            {monogram}
          </span>
          <p className="font-display text-2xl font-extrabold tracking-tight text-paper sm:text-3xl">
            Game loads here
            <span className="anim-caret ml-1 inline-block text-coral">▍</span>
          </p>
          <p className="mt-2 max-w-sm text-sm text-paper/55">
            {title} mounts on the Steamlink canvas when it&apos;s ported into the
            library. The cabinet is wired and powered on.
          </p>
        </div>

        {/* mascot peeking from the bottom */}
        <div className="absolute -bottom-3 right-4 z-20 float-b">
          <Mascot accent={MASCOT[accent]} width={74} />
        </div>
      </div>
    </div>
  );
}

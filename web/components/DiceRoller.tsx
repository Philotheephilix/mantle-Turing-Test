"use client";

import { fireConfettiFrom } from "@/lib/confetti";
import { motion, useAnimationControls } from "framer-motion";
import { useState } from "react";

/** Pip layouts for faces 1–6 on a 100×100 die face. */
const FACES: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [28, 28],
    [50, 50],
    [72, 72],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [28, 28],
    [72, 28],
    [50, 50],
    [28, 72],
    [72, 72],
  ],
  6: [
    [28, 26],
    [72, 26],
    [28, 50],
    [72, 50],
    [28, 74],
    [72, 74],
  ],
};

const INK = "oklch(0.245 0.03 55)";

/** A clickable die: click to roll, it tumbles and lands on a face. Roll a 6 → confetti. */
export function DiceRoller() {
  const [face, setFace] = useState(5);
  const [rolling, setRolling] = useState(false);
  const controls = useAnimationControls();

  async function roll(e: React.MouseEvent<HTMLButtonElement>) {
    if (rolling) return;
    setRolling(true);
    const btn = e.currentTarget;
    // shuffle faces for a beat
    const ticks = 0;
    const shuffle = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 80);
    await controls.start({
      rotate: [0, 90, 200, 320, 360],
      scale: [1, 1.12, 0.96, 1.06, 1],
      transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
    });
    clearInterval(shuffle);
    const final = 1 + Math.floor(Math.random() * 6);
    setFace(final);
    setRolling(false);
    void ticks;
    if (final === 6) fireConfettiFrom(btn);
  }

  return (
    <button
      onClick={roll}
      aria-label={`Dice showing ${face}. Click to roll.`}
      className="group inline-flex flex-col items-center gap-2"
    >
      <motion.span
        animate={controls}
        className="block sticker rounded-2xl bg-paper p-1"
        style={{ lineHeight: 0 }}
      >
        <svg width="76" height="76" viewBox="0 0 100 100">
          <rect x="4" y="4" width="92" height="92" rx="20" fill="oklch(0.97 0.01 90)" />
          {FACES[face].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="9" fill={face === 6 ? "oklch(0.66 0.2 30)" : INK} />
          ))}
        </svg>
      </motion.span>
      <span className="text-xs font-bold uppercase tracking-wide text-ink-soft transition-colors group-hover:text-ink">
        {rolling ? "Rolling…" : "Roll me!"}
      </span>
    </button>
  );
}

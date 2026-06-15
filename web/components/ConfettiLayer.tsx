"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { CONFETTI_EVENT } from "@/lib/confetti";

type Burst = { id: number; x: number; y: number };
type Bit = { dx: number; dy: number; rot: number; color: string; shape: "sq" | "tri" | "dot"; size: number };

const COLORS = [
  "oklch(0.66 0.2 30)", // coral
  "oklch(0.82 0.15 78)", // amber
  "oklch(0.71 0.15 150)", // grass
  "oklch(0.64 0.15 245)", // sky
  "oklch(0.56 0.17 300)", // grape
];

function makeBits(): Bit[] {
  return Array.from({ length: 22 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 120;
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - 40, // bias upward
      rot: (Math.random() - 0.5) * 540,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: (["sq", "tri", "dot"] as const)[Math.floor(Math.random() * 3)],
      size: 7 + Math.random() * 8,
    };
  });
}

function Piece({ bit }: { bit: Bit }) {
  const common = { backgroundColor: bit.shape !== "tri" ? bit.color : undefined };
  return (
    <motion.span
      className="absolute block"
      style={{
        width: bit.size,
        height: bit.size,
        borderRadius: bit.shape === "dot" ? "50%" : bit.shape === "sq" ? 2 : 0,
        clipPath: bit.shape === "tri" ? "polygon(50% 0, 100% 100%, 0 100%)" : undefined,
        ...common,
      }}
      initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
      animate={{ x: bit.dx, y: bit.dy + 160, opacity: 0, rotate: bit.rot, scale: 0.7 }}
      transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
    />
  );
}

export function ConfettiLayer() {
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let n = 0;
    function onFire(e: Event) {
      const { x, y } = (e as CustomEvent).detail;
      const id = ++n;
      setBursts((b) => [...b, { id, x, y }]);
      setTimeout(() => setBursts((b) => b.filter((it) => it.id !== id)), 1300);
    }
    window.addEventListener(CONFETTI_EVENT, onFire);
    return () => window.removeEventListener(CONFETTI_EVENT, onFire);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]" aria-hidden>
      <AnimatePresence>
        {bursts.map((b) => (
          <div key={b.id} className="absolute" style={{ left: b.x, top: b.y }}>
            {makeBits().map((bit, i) => (
              <Piece key={i} bit={bit} />
            ))}
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}

"use client";

import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "framer-motion";
import { useEffect } from "react";

/** Decorative bits that parallax with the pointer at different depths. */
type BitDef = { left: string; top: string; depth: number; drift: number; delay: number; kind: "star" | "coin" | "pip" | "card" | "ring"; size: number };

const BITS: BitDef[] = [
  { left: "8%", top: "22%", depth: 38, drift: 12, delay: 0, kind: "star", size: 30 },
  { left: "86%", top: "16%", depth: -46, drift: 14, delay: 1.2, kind: "coin", size: 26 },
  { left: "78%", top: "70%", depth: 30, drift: 11, delay: 0.6, kind: "card", size: 34 },
  { left: "14%", top: "72%", depth: -34, drift: 13, delay: 1.8, kind: "pip", size: 24 },
  { left: "50%", top: "10%", depth: 24, drift: 9, delay: 0.9, kind: "ring", size: 26 },
  { left: "94%", top: "44%", depth: -28, drift: 12, delay: 0.3, kind: "star", size: 20 },
  { left: "4%", top: "48%", depth: 32, drift: 10, delay: 1.5, kind: "coin", size: 22 },
];

const INK = "oklch(0.245 0.03 55)";

function Shape({ kind, size }: { kind: BitDef["kind"]; size: number }) {
  switch (kind) {
    case "star":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M12 0c1 6 5 10 11 12-6 2-10 6-11 12-1-6-5-10-11-12C7 10 11 6 12 0Z" fill="oklch(0.82 0.15 78)" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case "coin":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="oklch(0.82 0.15 78)" stroke={INK} strokeWidth="1.8" />
          <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="800" fill={INK} fontFamily="var(--font-display)">$</text>
        </svg>
      );
    case "pip":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect x="2" y="2" width="20" height="20" rx="5" fill="oklch(0.98 0.008 90)" stroke={INK} strokeWidth="1.8" />
          <circle cx="12" cy="12" r="3" fill="oklch(0.66 0.2 30)" />
        </svg>
      );
    case "ring":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" fill="none" stroke="oklch(0.56 0.17 300)" strokeWidth="3.4" />
        </svg>
      );
    case "card":
      return (
        <svg width={size} height={size * 1.4} viewBox="0 0 24 34">
          <rect x="2" y="2" width="20" height="30" rx="4" fill="oklch(0.66 0.2 30)" stroke={INK} strokeWidth="1.8" />
          <ellipse cx="12" cy="17" rx="6" ry="9" fill="none" stroke="oklch(0.98 0.008 90)" strokeWidth="2.2" />
        </svg>
      );
  }
}

function ParallaxBit({ bit, mx, my }: { bit: BitDef; mx: MotionValue<number>; my: MotionValue<number> }) {
  const x = useTransform(mx, (v) => (v - 0.5) * bit.depth);
  const y = useTransform(my, (v) => (v - 0.5) * bit.depth);
  return (
    <motion.div className="absolute" style={{ left: bit.left, top: bit.top, x, y }}>
      <div style={{ animation: `drift ${10 + bit.drift}s ease-in-out ${bit.delay}s infinite` }}>
        <Shape kind={bit.kind} size={bit.size} />
      </div>
    </motion.div>
  );
}

export function InteractiveBackground() {
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const sx = useSpring(mx, { stiffness: 50, damping: 20 });
  const sy = useSpring(my, { stiffness: 50, damping: 20 });
  const spotX = useTransform(sx, (v) => `${v * 100}%`);
  const spotY = useTransform(sy, (v) => `${v * 100}%`);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    function onMove(e: PointerEvent) {
      mx.set(e.clientX / window.innerWidth);
      my.set(e.clientY / window.innerHeight);
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [mx, my]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {/* cursor spotlight */}
      <motion.div
        className="absolute h-[42rem] w-[42rem] rounded-full blur-3xl"
        style={{
          left: spotX,
          top: spotY,
          x: "-50%",
          y: "-50%",
          background: "radial-gradient(circle, oklch(0.85 0.12 55 / 0.5) 0%, oklch(0.8 0.1 30 / 0.18) 35%, transparent 68%)",
        }}
      />
      {BITS.map((bit, i) => (
        <ParallaxBit key={i} bit={bit} mx={sx} my={sy} />
      ))}
    </div>
  );
}

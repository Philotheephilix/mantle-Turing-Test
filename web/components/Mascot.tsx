"use client";

import { motion, useMotionValue, useSpring } from "framer-motion";
import { useEffect, useId, useRef } from "react";

/**
 * Pip — the Steamlink mascot. A soft, glossy blob with big eyes that track the
 * cursor, rosy cheeks and a little energy spark on top. Squishes when you hover.
 * Recolor with `accent`; add a float-* class on the parent to make it bob.
 */

type MascotAccent = "coral" | "sky" | "amber" | "grape" | "grass";

const BODY: Record<MascotAccent, { base: string; light: string }> = {
  coral: { base: "oklch(0.66 0.2 30)", light: "oklch(0.76 0.17 35)" },
  sky: { base: "oklch(0.64 0.15 245)", light: "oklch(0.74 0.13 240)" },
  amber: { base: "oklch(0.82 0.15 78)", light: "oklch(0.89 0.12 85)" },
  grape: { base: "oklch(0.56 0.17 300)", light: "oklch(0.67 0.15 300)" },
  grass: { base: "oklch(0.71 0.15 150)", light: "oklch(0.8 0.13 150)" },
};

const INK = "oklch(0.245 0.03 55)";
const SCLERA = "oklch(0.98 0.008 90)";

export function Mascot({
  accent = "coral",
  className = "",
  width = 120,
  track = true,
}: {
  accent?: MascotAccent;
  className?: string;
  width?: number;
  track?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const gid = useId().replace(/:/g, "");
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 250, damping: 17 });
  const sy = useSpring(py, { stiffness: 250, damping: 17 });
  const c = BODY[accent];

  useEffect(() => {
    if (!track) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    function onMove(e: PointerEvent) {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.5;
      const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / (r.width * 0.7)));
      const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / (r.height * 0.7)));
      px.set(dx * 3.4);
      py.set(dy * 2.6);
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [track, px, py]);

  return (
    <motion.div
      className={`inline-block ${className}`}
      style={{ transformOrigin: "bottom center" }}
      whileHover={{ scaleX: 1.08, scaleY: 0.92 }}
      transition={{ type: "spring", stiffness: 320, damping: 12 }}
    >
      <svg ref={ref} viewBox="0 0 140 150" width={width} role="img" aria-label="Pip, the Steamlink mascot">
        <defs>
          <linearGradient id={`body-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={c.light} />
            <stop offset="1" stopColor={c.base} />
          </linearGradient>
        </defs>

        {/* contact shadow */}
        <ellipse cx="70" cy="138" rx="42" ry="8" fill="oklch(0.245 0.03 55 / 0.12)" />

        {/* spark antenna */}
        <path
          d="M73 4c.8 8 4 11 9 13-5 2-8 5-9 12-1-7-4-10-9-12 5-2 8-5 9-13Z"
          fill="oklch(0.82 0.15 78)"
          stroke={INK}
          strokeWidth="2.5"
          strokeLinejoin="round"
          style={{ transformBox: "fill-box", transformOrigin: "center", animation: "twinkle 3s ease-in-out infinite" }}
        />

        {/* feet */}
        <ellipse cx="52" cy="128" rx="12" ry="8" fill={c.base} stroke={INK} strokeWidth="3" />
        <ellipse cx="88" cy="128" rx="12" ry="8" fill={c.base} stroke={INK} strokeWidth="3" />

        {/* body blob */}
        <path
          d="M22 84 C22 50 44 34 70 34 C96 34 118 50 118 84 C118 112 98 126 70 126 C42 126 22 112 22 84 Z"
          fill={`url(#body-${gid})`}
          stroke={INK}
          strokeWidth="3.5"
        />
        {/* gloss */}
        <ellipse cx="52" cy="60" rx="20" ry="14" fill="oklch(0.99 0.005 90 / 0.35)" />

        {/* eyes: sclera + tracking pupils, with a blink */}
        <g style={{ transformBox: "fill-box", transformOrigin: "center", animation: "blink 4.6s infinite" }}>
          <circle cx="54" cy="82" r="12" fill={SCLERA} stroke={INK} strokeWidth="2" />
          <circle cx="86" cy="82" r="12" fill={SCLERA} stroke={INK} strokeWidth="2" />
          <motion.g style={{ x: sx, y: sy }}>
            <circle cx="54" cy="83" r="5.6" fill={INK} />
            <circle cx="86" cy="83" r="5.6" fill={INK} />
            <circle cx="56" cy="80.5" r="1.9" fill={SCLERA} />
            <circle cx="88" cy="80.5" r="1.9" fill={SCLERA} />
          </motion.g>
        </g>

        {/* cheeks */}
        <ellipse cx="38" cy="98" rx="6.5" ry="4.5" fill="oklch(0.62 0.2 25 / 0.5)" />
        <ellipse cx="102" cy="98" rx="6.5" ry="4.5" fill="oklch(0.62 0.2 25 / 0.5)" />
        {/* smile */}
        <path d="M62 100 q8 8 16 0" stroke={INK} strokeWidth="3.2" strokeLinecap="round" fill="none" />
      </svg>
    </motion.div>
  );
}

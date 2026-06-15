"use client";

import { motion, useMotionValue, useSpring } from "framer-motion";
import { useRef } from "react";

/**
 * A button that leans toward the cursor and springs back on leave. Renders an
 * anchor when `href` is set, otherwise a button. Keeps the sticker press feel.
 */
export function MagneticButton({
  href,
  onClick,
  className = "",
  children,
  strength = 0.4,
}: {
  href?: string;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  className?: string;
  children: React.ReactNode;
  strength?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 300, damping: 18 });
  const sy = useSpring(y, { stiffness: 300, damping: 18 });

  function onMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  }
  function reset() {
    x.set(0);
    y.set(0);
  }

  const MotionTag = (href ? motion.a : motion.button) as typeof motion.a;

  return (
    <MotionTag
      ref={ref as never}
      href={href}
      onClick={onClick}
      onMouseMove={onMove}
      onMouseLeave={reset}
      whileTap={{ scale: 0.94 }}
      style={{ x: sx, y: sy }}
      className={className}
    >
      {children}
    </MotionTag>
  );
}

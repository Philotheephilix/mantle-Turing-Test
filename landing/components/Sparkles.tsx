/**
 * Decorative floating bits: sparkles, coins, pips and a stray card drifting
 * behind the content. Fixed positions (no runtime randomness) so SSR is stable.
 * Purely cosmetic, hidden from assistive tech.
 */

type Bit = { x: string; y: string; s: number; d: number; delay: number; kind: "star" | "coin" | "pip" | "card" };

const BITS: Bit[] = [
  { x: "6%", y: "18%", s: 26, d: 11, delay: 0, kind: "star" },
  { x: "88%", y: "12%", s: 20, d: 13, delay: 1.5, kind: "coin" },
  { x: "16%", y: "70%", s: 16, d: 9, delay: 0.8, kind: "pip" },
  { x: "92%", y: "62%", s: 30, d: 14, delay: 2.2, kind: "card" },
  { x: "78%", y: "82%", s: 22, d: 12, delay: 0.4, kind: "star" },
  { x: "4%", y: "44%", s: 18, d: 10, delay: 1.1, kind: "coin" },
  { x: "46%", y: "8%", s: 14, d: 8, delay: 1.9, kind: "pip" },
  { x: "30%", y: "90%", s: 24, d: 15, delay: 0.6, kind: "star" },
];

function Shape({ kind, s }: { kind: Bit["kind"]; s: number }) {
  const ink = "oklch(0.245 0.03 55)";
  switch (kind) {
    case "star":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" style={{ animation: "twinkle 5s ease-in-out infinite" }}>
          <path d="M12 0c1 6 5 10 11 12-6 2-10 6-11 12-1-6-5-10-11-12C7 10 11 6 12 0Z" fill="oklch(0.82 0.15 78)" stroke={ink} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case "coin":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="oklch(0.82 0.15 78)" stroke={ink} strokeWidth="1.8" />
          <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="800" fill={ink} fontFamily="var(--font-display)">$</text>
        </svg>
      );
    case "pip":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24">
          <rect x="2" y="2" width="20" height="20" rx="5" fill="oklch(0.97 0.01 90)" stroke={ink} strokeWidth="1.8" />
          <circle cx="12" cy="12" r="3" fill="oklch(0.66 0.2 30)" />
        </svg>
      );
    case "card":
      return (
        <svg width={s} height={s * 1.4} viewBox="0 0 24 34">
          <rect x="2" y="2" width="20" height="30" rx="4" fill="oklch(0.66 0.2 30)" stroke={ink} strokeWidth="1.8" />
          <ellipse cx="12" cy="17" rx="6" ry="9" fill="none" stroke="oklch(0.97 0.01 90)" strokeWidth="2.2" />
        </svg>
      );
  }
}

export function Sparkles({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      {BITS.map((b, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: b.x,
            top: b.y,
            animation: `drift ${b.d}s ease-in-out ${b.delay}s infinite`,
          }}
        >
          <Shape kind={b.kind} s={b.s} />
        </div>
      ))}
    </div>
  );
}

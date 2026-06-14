/**
 * A hand-drawn underline that strokes itself in. Position it under a word with an
 * absolutely-placed wrapper. `color` and `delay` are tunable.
 */
export function SquiggleUnderline({
  className = "",
  color = "oklch(0.82 0.15 78)",
  delay = 0.25,
}: {
  className?: string;
  color?: string;
  delay?: number;
}) {
  return (
    <svg
      viewBox="0 0 300 22"
      preserveAspectRatio="none"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        className="squiggle-path"
        pathLength={1}
        d="M6 14 C 64 5, 116 19, 168 11 S 256 5, 294 13"
        stroke={color}
        strokeWidth={9}
        strokeLinecap="round"
        style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: `draw 0.85s ${delay}s cubic-bezier(0.22,1,0.36,1) forwards` }}
      />
    </svg>
  );
}

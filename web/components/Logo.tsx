/**
 * Steamlink logo: a sticker tile holding interlocked chain links (the "link",
 * onchain) with an energy spark (the "steam"), plus a two-tone wordmark. The
 * mark tilts and the spark twinkles on hover.
 */
export function Logo({
  size = 38,
  showWord = true,
  wordClassName = "",
  className = "",
}: {
  size?: number;
  showWord?: boolean;
  wordClassName?: string;
  className?: string;
}) {
  return (
    <span className={`group inline-flex items-center gap-2.5 ${className}`}>
      <span
        className="relative grid shrink-0 place-items-center rounded-[0.7rem] border-[2.5px] border-ink bg-coral text-paper shadow-sticker-sm transition-transform duration-200 group-hover:-rotate-[8deg]"
        style={{ width: size, height: size }}
      >
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" aria-hidden>
          <g
            transform="rotate(-45 12 12)"
            stroke="oklch(0.97 0.01 90)"
            strokeWidth="3.1"
            fill="none"
          >
            <rect x="2.5" y="8.4" width="11.5" height="7.2" rx="3.6" />
            <rect x="10" y="8.4" width="11.5" height="7.2" rx="3.6" />
          </g>
        </svg>
        {/* spark */}
        <svg
          className="absolute -right-1 -top-1 transition-transform duration-300 group-hover:scale-125"
          width={size * 0.34}
          height={size * 0.34}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            d="M12 0c1 6 5 10 11 12-6 2-10 6-11 12-1-6-5-10-11-12C7 10 11 6 12 0Z"
            fill="oklch(0.82 0.15 78)"
            stroke="oklch(0.245 0.03 55)"
            strokeWidth="1.8"
            strokeLinejoin="round"
            style={{
              transformBox: "fill-box",
              transformOrigin: "center",
              animation: "twinkle 3.4s ease-in-out infinite",
            }}
          />
        </svg>
      </span>
      {showWord && (
        <span className={`font-display text-xl font-extrabold tracking-tight ${wordClassName}`}>
          Steam<span className="text-coral">link</span>
        </span>
      )}
    </span>
  );
}

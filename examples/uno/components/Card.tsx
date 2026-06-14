"use client";

export interface UnoCard {
  /** 0 = wild, 1=red 2=green 3=blue 4=yellow */
  color: number;
  /** 0..9 for colored; for a wild this is the chosen color when played */
  number: number;
  wild?: boolean;
}

const COLOR_HEX: Record<number, string> = {
  1: "#e4002b",
  2: "#3aa935",
  3: "#0073cf",
  4: "#ffcc00",
};

const COLOR_NAME: Record<number, string> = {
  0: "wild",
  1: "red",
  2: "green",
  3: "blue",
  4: "yellow",
};

export function colorName(c: number): string {
  return COLOR_NAME[c] ?? "—";
}

export function Card({
  card,
  onClick,
  disabled,
  small,
  testid,
}: {
  card: UnoCard;
  onClick?: () => void;
  disabled?: boolean;
  small?: boolean;
  testid?: string;
}) {
  const isWild = card.wild || card.color === 0;
  const bg = isWild ? "#101216" : COLOR_HEX[card.color] ?? "#3a3a3a";
  const dim = small ? "w-16 h-24 text-2xl" : "w-24 h-36 text-5xl";
  const label = isWild ? "W" : String(card.number);
  const accent = card.color === 4 ? "#1a1a1a" : "#ffffff";

  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      className={`card-face relative ${dim} rounded-2xl border-2 border-white/15 shadow-xl select-none ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      }`}
      style={{ background: bg, color: accent }}
      aria-label={`${colorName(card.color)} ${isWild ? "wild" : card.number}`}
    >
      <span className="absolute top-1.5 left-2 text-xs font-bold opacity-90">{label}</span>
      <span
        className="absolute inset-0 flex items-center justify-center font-extrabold"
        style={{
          textShadow: isWild ? "0 0 12px rgba(255,255,255,0.3)" : "0 2px 0 rgba(0,0,0,0.18)",
        }}
      >
        {isWild ? (
          <span className="text-3xl">
            <span style={{ color: "#e4002b" }}>◆</span>
            <span style={{ color: "#3aa935" }}>◆</span>
            <span style={{ color: "#0073cf" }}>◆</span>
            <span style={{ color: "#ffcc00" }}>◆</span>
          </span>
        ) : (
          label
        )}
      </span>
      <span className="absolute bottom-1.5 right-2 text-xs font-bold rotate-180 opacity-90">
        {label}
      </span>
      {/* gloss */}
      <span className="absolute inset-x-2 top-2 h-1/3 rounded-full bg-white/15 blur-md pointer-events-none" />
    </button>
  );
}

/**
 * An animated SVG band showing the gasless path: a coin travels from the player,
 * through the relayer, to the finish — using native <animateMotion> along a path,
 * with a marching-ants dashed line underneath. Themed per audience via `accent`.
 */

const INK = "oklch(0.245 0.03 55)";

const ACCENTS: Record<string, string> = {
  coral: "oklch(0.66 0.2 30)",
  sky: "oklch(0.64 0.15 245)",
};

function StickerNode({
  cx,
  fill,
  label,
  children,
}: {
  cx: number;
  fill: string;
  label: string;
  children: React.ReactNode;
}) {
  const w = 116;
  const h = 84;
  const x = cx - w / 2;
  const y = 28;
  return (
    <g>
      {/* offset sticker shadow */}
      <rect x={x + 5} y={y + 5} width={w} height={h} rx={22} fill={INK} />
      <rect x={x} y={y} width={w} height={h} rx={22} fill={fill} stroke={INK} strokeWidth={3} />
      <g transform={`translate(${cx}, ${y + 40})`}>{children}</g>
      <text
        x={cx}
        y={142}
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontWeight={800}
        fontSize={18}
        fill={INK}
      >
        {label}
      </text>
    </g>
  );
}

export function GaslessFlow({
  accent = "coral",
  endLabel = "You win",
  endKind = "coin",
  className = "",
}: {
  accent?: "coral" | "sky";
  endLabel?: string;
  endKind?: "coin" | "mantle";
  className?: string;
}) {
  const a = ACCENTS[accent];
  const path = "M170 70 Q 330 16 490 70 T 810 70";
  const paper = "oklch(0.97 0.01 90)";

  return (
    <svg
      viewBox="0 0 920 170"
      className={className}
      role="img"
      aria-label="A coin travels gaslessly from the player, through the relayer, to the finish."
    >
      <defs>
        <path id="gasless-path" d={path} />
      </defs>

      {/* marching-ants connection */}
      <use
        href="#gasless-path"
        fill="none"
        stroke={INK}
        strokeOpacity={0.28}
        strokeWidth={4}
        strokeDasharray="2 12"
        strokeLinecap="round"
        style={{ animation: "ants 1.1s linear infinite" }}
      />

      {/* player */}
      <StickerNode cx={110} fill={paper} label="You sign once">
        <circle cx={-14} cy={-4} r={4.5} fill={INK} />
        <circle cx={14} cy={-4} r={4.5} fill={INK} />
        <path
          d="M-13 10 q13 11 26 0"
          stroke={INK}
          strokeWidth={3.5}
          fill="none"
          strokeLinecap="round"
        />
      </StickerNode>

      {/* relayer */}
      <StickerNode cx={490} fill={a} label="Relayer pays gas">
        <path
          d="M6 -22 -12 6h12l-4 18 18-28H10l4-18Z"
          fill={paper}
          stroke={INK}
          strokeWidth={2.5}
          strokeLinejoin="round"
          transform="translate(-2,-2)"
        />
      </StickerNode>

      {/* finish */}
      <StickerNode cx={810} fill={paper} label={endLabel}>
        {endKind === "coin" ? (
          <>
            <circle cx={0} cy={0} r={20} fill="oklch(0.82 0.15 78)" stroke={INK} strokeWidth={3} />
            <text
              x={0}
              y={7}
              textAnchor="middle"
              fontFamily="var(--font-display)"
              fontWeight={800}
              fontSize={22}
              fill={INK}
            >
              $
            </text>
          </>
        ) : (
          <>
            <rect
              x={-18}
              y={-2}
              width={16}
              height={16}
              rx={3}
              fill="oklch(0.64 0.15 245)"
              stroke={INK}
              strokeWidth={2.5}
            />
            <rect
              x={-4}
              y={-8}
              width={16}
              height={16}
              rx={3}
              fill="oklch(0.64 0.15 245)"
              stroke={INK}
              strokeWidth={2.5}
            />
            <rect
              x={2}
              y={2}
              width={16}
              height={16}
              rx={3}
              fill="oklch(0.64 0.15 245)"
              stroke={INK}
              strokeWidth={2.5}
            />
          </>
        )}
      </StickerNode>

      {/* traveling coins */}
      {[0, -1.6].map((begin, i) => (
        <g key={i}>
          <circle r={13} fill="oklch(0.82 0.15 78)" stroke={INK} strokeWidth={2.5} />
          <text
            textAnchor="middle"
            y={5}
            fontFamily="var(--font-display)"
            fontWeight={800}
            fontSize={14}
            fill={INK}
          >
            $
          </text>
          <animateMotion
            dur="3.2s"
            begin={`${begin}s`}
            repeatCount="indefinite"
            keyPoints="0;1"
            keyTimes="0;1"
            calcMode="linear"
          >
            <mpath href="#gasless-path" />
          </animateMotion>
        </g>
      ))}

      {/* 0 GAS badge — outer g positions, inner g animates (CSS transform would
          override the positioning transform attribute, so keep them separate) */}
      <g transform="translate(300, 126)">
        <g
          style={{
            transformBox: "fill-box",
            transformOrigin: "center",
            animation: "wiggle 3s ease-in-out infinite",
          }}
        >
          <rect
            x={-34}
            y={-15}
            width={68}
            height={30}
            rx={15}
            fill="oklch(0.71 0.15 150)"
            stroke={INK}
            strokeWidth={2.5}
          />
          <text
            x={0}
            y={6}
            textAnchor="middle"
            fontFamily="var(--font-display)"
            fontWeight={800}
            fontSize={15}
            fill={INK}
          >
            0 GAS
          </text>
        </g>
      </g>
    </svg>
  );
}

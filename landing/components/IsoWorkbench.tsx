import { Cuboid, INK, project, pts, U, type Faces, type P } from "./iso/primitives";

/**
 * The developer hero scene: an isometric workbench. A terminal slab streaming
 * code, a chain of Base "blocks" climbing up, a coral deploy crate, cogs, and
 * floating code glyphs. Same dimetric projection as the gamer tabletop so the
 * two worlds feel like one universe.
 */

const C = {
  board: { top: "oklch(0.94 0.03 82)", right: "oklch(0.85 0.04 75)", left: "oklch(0.77 0.05 70)" } as Faces,
  term: { top: "oklch(0.32 0.02 55)", right: "oklch(0.27 0.02 55)", left: "oklch(0.22 0.02 55)" } as Faces,
  block: { top: "oklch(0.72 0.13 245)", right: "oklch(0.62 0.14 245)", left: "oklch(0.52 0.13 244)" } as Faces,
  crate: { top: "oklch(0.7 0.2 30)", right: "oklch(0.6 0.19 29)", left: "oklch(0.5 0.17 28)" } as Faces,
  cog: { top: "oklch(0.66 0.15 300)", right: "oklch(0.56 0.15 300)", left: "oklch(0.47 0.13 299)" } as Faces,
};

/** A flat colored quad lying on the top plane at height z. */
function Plate({ x, y, w, d, z, fill }: { x: number; y: number; w: number; d: number; z: number; fill: string }) {
  return (
    <polygon
      points={pts(project(x, y, z), project(x + w, y, z), project(x + w, y + d, z), project(x, y + d, z))}
      fill={fill}
    />
  );
}

/** A cog lying flat on the board (a circle becomes an iso ellipse). */
function Cog({ x, y, z, r, color }: { x: number; y: number; z: number; r: number; color: string }) {
  const [cx, cy] = project(x, y, z);
  const rx = r * U;
  const ry = (r * U) / 2;
  const teeth = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const tx = cx + Math.cos(ang) * rx * 1.18;
    const ty = cy + Math.sin(ang) * ry * 1.18;
    teeth.push(<circle key={i} cx={tx} cy={ty} r={3} fill={color} />);
  }
  return (
    <g>
      {teeth}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={color} stroke={INK} strokeWidth={1.5} />
      <ellipse cx={cx} cy={cy} rx={rx * 0.4} ry={ry * 0.4} fill="oklch(0.94 0.03 82)" />
    </g>
  );
}

export function IsoWorkbench({ className = "" }: { className?: string }) {
  const BZ = 18;
  const codeLines = [
    { x: -2.45, y: -2.25, w: 1.0, fill: "oklch(0.78 0.16 150)" },
    { x: -2.45, y: -1.78, w: 1.7, fill: "oklch(0.72 0.14 245)" },
    { x: -2.45, y: -1.31, w: 0.8, fill: "oklch(0.82 0.15 78)" },
    { x: -2.45, y: -0.84, w: 1.3, fill: "oklch(0.78 0.16 150)" },
  ];

  return (
    <svg
      viewBox="-275 -150 550 330"
      className={className}
      role="img"
      aria-label="An isometric developer workbench: a terminal streaming code, a chain of Base blocks, a deploy crate, cogs and floating code glyphs."
    >
      <ellipse cx="0" cy="140" rx="225" ry="42" fill="oklch(0.245 0.03 55 / 0.12)" />

      {/* board slab */}
      <Cuboid x={-3.6} y={-3.6} w={7.2} d={7.2} h={BZ} faces={C.board} />

      {/* terminal slab with code */}
      <g className="float-b">
        <Cuboid x={-2.9} y={-2.7} w={2.6} d={2.4} h={11} z={BZ} faces={C.term} />
        {/* screen inset */}
        <Plate x={-2.7} y={-2.5} w={2.2} d={2.0} z={BZ + 11} fill="oklch(0.18 0.02 55)" />
        {/* prompt + code lines */}
        <Plate x={-2.62} y={-2.62} w={0.22} d={0.18} z={BZ + 11.1} fill="oklch(0.7 0.2 30)" />
        {codeLines.map((l, i) => (
          <Plate key={i} x={l.x} y={l.y} w={l.w} d={0.16} z={BZ + 11.1} fill={l.fill} />
        ))}
      </g>

      {/* chain of Base blocks climbing up-right */}
      <g className="float-a">
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <Cuboid x={1.3 + i * 0.25} y={-2.4} w={1.4} d={1.4} h={14} z={BZ + i * 14} faces={C.block} />
            {(() => {
              const [sx, sy] = project(2.0 + i * 0.25, -1.7, BZ + (i + 1) * 14);
              return <circle cx={sx} cy={sy} r={4.5} fill="none" stroke="oklch(0.95 0.02 245)" strokeWidth={2.4} />;
            })()}
          </g>
        ))}
      </g>

      {/* deploy crate with floating up-arrow */}
      <g className="float-c">
        <Cuboid x={1.2} y={1.3} w={1.9} d={1.9} h={22} z={BZ} faces={C.crate} />
        {(() => {
          const [sx, sy] = project(2.15, 2.25, BZ + 22);
          return (
            <g style={{ transformBox: "fill-box", transformOrigin: "center" }}>
              <path
                d={`M${sx} ${sy - 54} l16 18 h-9 v16 h-14 v-16 h-9 Z`}
                fill="oklch(0.82 0.15 78)"
                stroke={INK}
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
            </g>
          );
        })()}
      </g>

      {/* cogs */}
      <Cog x={-1.0} y={2.1} z={BZ} r={0.62} color={C.cog.top} />
      <Cog x={0.35} y={2.75} z={BZ} r={0.42} color={C.cog.top} />

      {/* floating code glyphs */}
      {(() => {
        const g1 = project(-3.4, 0.4, BZ + 70) as P;
        const g2 = project(3.5, 1.2, BZ + 50) as P;
        const g3 = project(0.2, -3.6, BZ + 64) as P;
        const style = { fontFamily: "ui-monospace, monospace", fontWeight: 800 as const, fill: INK };
        return (
          <>
            <text className="float-a" x={g1[0]} y={g1[1]} fontSize={26} {...style}>{"{ }"}</text>
            <text className="float-b" x={g2[0]} y={g2[1]} fontSize={22} {...style}>{"</>"}</text>
            <text className="float-c" x={g3[0]} y={g3[1]} fontSize={24} {...style}>Σ</text>
          </>
        );
      })()}
    </svg>
  );
}

import { Cuboid, type Faces, INK, project, pts } from "./iso/primitives";

/**
 * The gamer hero scene: a warm isometric tabletop loaded with game bits — a UNO
 * deck, a USDC coin stack, dice, two little houses and a green token — each
 * bobbing on its own phase. Pure SVG; motion from CSS, reduced-motion aware.
 */

const C = {
  board: {
    top: "oklch(0.94 0.03 82)",
    right: "oklch(0.85 0.04 75)",
    left: "oklch(0.77 0.05 70)",
  } as Faces,
  deck: {
    top: "oklch(0.7 0.2 30)",
    right: "oklch(0.6 0.19 29)",
    left: "oklch(0.5 0.17 28)",
  } as Faces,
  coin: {
    top: "oklch(0.85 0.15 85)",
    right: "oklch(0.74 0.15 80)",
    left: "oklch(0.64 0.14 76)",
  } as Faces,
  die: {
    top: "oklch(0.97 0.01 90)",
    right: "oklch(0.9 0.02 85)",
    left: "oklch(0.82 0.03 82)",
  } as Faces,
  wall: {
    top: "oklch(0.74 0.13 245)",
    right: "oklch(0.63 0.14 245)",
    left: "oklch(0.53 0.13 244)",
  } as Faces,
  wall2: {
    top: "oklch(0.66 0.15 300)",
    right: "oklch(0.56 0.15 300)",
    left: "oklch(0.47 0.13 299)",
  } as Faces,
  roof: {
    top: "oklch(0.68 0.18 30)",
    right: "oklch(0.58 0.17 29)",
    left: "oklch(0.49 0.15 28)",
  } as Faces,
  token: {
    top: "oklch(0.75 0.15 150)",
    right: "oklch(0.64 0.15 150)",
    left: "oklch(0.54 0.13 149)",
  } as Faces,
};

function Pip({ x, y, z, color = INK }: { x: number; y: number; z: number; color?: string }) {
  const [sx, sy] = project(x, y, z);
  return <circle cx={sx} cy={sy} r={3.4} fill={color} />;
}

function House({ x, y, walls }: { x: number; y: number; walls: Faces }) {
  const BZ = 18;
  const z = BZ + 30;
  const A = project(x, y, z);
  const D = project(x, y + 1.9, z);
  const B = project(x + 1.9, y, z);
  const Cc = project(x + 1.9, y + 1.9, z);
  const ridgeA = project(x + 0.95, y, z + 26);
  const ridgeB = project(x + 0.95, y + 1.9, z + 26);
  return (
    <>
      <Cuboid x={x} y={y} w={1.9} d={1.9} h={30} z={BZ} faces={walls} />
      <g strokeLinejoin="round">
        <polygon points={pts(B, Cc, ridgeB, ridgeA)} fill={C.roof.right} />
        <polygon points={pts(A, D, ridgeB, ridgeA)} fill={C.roof.top} />
      </g>
    </>
  );
}

export function IsoScene({ className = "" }: { className?: string }) {
  const BZ = 18;
  return (
    <svg
      viewBox="-275 -135 550 320"
      className={className}
      role="img"
      aria-label="An isometric tabletop with a card deck, a stack of USDC coins, dice, two little houses and a green token, floating in warm light."
    >
      <ellipse cx="0" cy="138" rx="225" ry="42" fill="oklch(0.245 0.03 55 / 0.12)" />

      {/* board slab */}
      <Cuboid x={-3.6} y={-3.6} w={7.2} d={7.2} h={BZ} faces={C.board} />
      <g opacity={0.45}>
        {[-2.2, 0, 2.2].map((gx) =>
          [-2.2, 0, 2.2].map((gy) => {
            const a = project(gx - 0.95, gy - 0.95, BZ);
            const b = project(gx + 0.95, gy - 0.95, BZ);
            const c = project(gx + 0.95, gy + 0.95, BZ);
            const dd = project(gx - 0.95, gy + 0.95, BZ);
            return (
              <polygon
                key={`${gx}-${gy}`}
                points={pts(a, b, c, dd)}
                fill="none"
                stroke="oklch(0.7 0.05 70 / 0.6)"
                strokeWidth={1.2}
              />
            );
          }),
        )}
      </g>

      {/* UNO deck */}
      <g className="float-a">
        <Cuboid x={-2.9} y={-2.7} w={1.7} d={2.3} h={26} z={BZ} faces={C.deck} />
        {(() => {
          const z = BZ + 26;
          const a = project(-2.65, -2.45, z);
          const b = project(-1.45, -2.45, z);
          const c = project(-1.45, -0.65, z);
          const dd = project(-2.65, -0.65, z);
          const cx = project(-2.05, -1.55, z);
          return (
            <>
              <polygon points={pts(a, b, c, dd)} fill="oklch(0.97 0.01 90)" />
              <circle
                cx={cx[0]}
                cy={cx[1]}
                r={11}
                fill="none"
                stroke="oklch(0.6 0.19 29)"
                strokeWidth={3.5}
              />
            </>
          );
        })()}
      </g>

      {/* coin stack */}
      <g className="float-b">
        {[0, 1, 2, 3, 4].map((i) => (
          <Cuboid
            key={i}
            x={1.5}
            y={-2.8}
            w={1.5}
            d={1.5}
            h={6.5}
            z={BZ + i * 6.5}
            faces={C.coin}
          />
        ))}
        {(() => {
          const [sx, sy] = project(2.25, -2.05, BZ + 5 * 6.5);
          return (
            <text
              x={sx}
              y={sy + 6}
              textAnchor="middle"
              fontFamily="var(--font-display)"
              fontWeight={800}
              fontSize={20}
              fill="oklch(0.5 0.14 76)"
            >
              $
            </text>
          );
        })()}
      </g>

      {/* dice */}
      <g className="float-c">
        <Cuboid x={-1.3} y={1.5} w={1.25} d={1.25} h={28} z={BZ} faces={C.die} />
        <Pip x={-0.675} y={2.125} z={BZ + 28} />
        <Cuboid x={0.45} y={2.2} w={1.25} d={1.25} h={28} z={BZ} faces={C.die} />
        <Pip x={0.9} y={2.65} z={BZ + 28} color="oklch(0.55 0.19 29)" />
        <Pip x={1.5} y={3.25} z={BZ + 28} color="oklch(0.55 0.19 29)" />
      </g>

      {/* houses */}
      <g className="float-a" style={{ animationDelay: "-1.4s" }}>
        <House x={1.5} y={1.2} walls={C.wall} />
      </g>
      <g className="float-b" style={{ animationDelay: "-2.1s" }}>
        <House x={2.9} y={-0.2} walls={C.wall2} />
      </g>

      {/* green token */}
      <g className="float-c" style={{ animationDelay: "-0.8s" }}>
        <Cuboid x={-2.7} y={1.9} w={1} d={1} h={12} z={BZ} faces={C.token} />
        <Cuboid x={-2.55} y={2.05} w={0.7} d={0.7} h={6} z={BZ + 12} faces={C.token} />
      </g>
    </svg>
  );
}

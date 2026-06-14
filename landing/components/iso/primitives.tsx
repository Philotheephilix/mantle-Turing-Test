/**
 * Shared isometric drawing primitives (2:1 dimetric projection).
 * Used by both hero scenes so cuboids shade consistently.
 */

export const U = 30; // half-tile width in px
export const INK = "oklch(0.245 0.03 55)";

export type P = [number, number];

/** Project grid (x, y) + height z(px) into 2:1 isometric screen space. */
export function project(x: number, y: number, z = 0): P {
  return [(x - y) * U, (x + y) * (U / 2) - z];
}

export function pts(...p: P[]): string {
  return p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

export interface Faces {
  top: string;
  right: string;
  left: string;
}

/** A shaded box from a footprint (x,y) of size (w,d), raised h px above baseZ. */
export function Cuboid({
  x,
  y,
  w,
  d,
  h,
  z = 0,
  faces,
}: {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  z?: number;
  faces: Faces;
}) {
  const topZ = z + h;
  const A = project(x, y, topZ);
  const B = project(x + w, y, topZ);
  const C = project(x + w, y + d, topZ);
  const D = project(x, y + d, topZ);
  const Bb = project(x + w, y, z);
  const Cb = project(x + w, y + d, z);
  const Db = project(x, y + d, z);
  return (
    <g strokeLinejoin="round">
      <polygon points={pts(B, C, Cb, Bb)} fill={faces.right} stroke={faces.right} strokeWidth={1} />
      <polygon points={pts(D, C, Cb, Db)} fill={faces.left} stroke={faces.left} strokeWidth={1} />
      <polygon points={pts(A, B, C, D)} fill={faces.top} stroke={faces.top} strokeWidth={1} />
    </g>
  );
}

/** Build a 3-shade face set from an OKLCH lightness/chroma/hue. */
export function shade(l: number, c: number, h: number): Faces {
  return {
    top: `oklch(${l} ${c} ${h})`,
    right: `oklch(${Math.max(0.2, l - 0.1)} ${c} ${h})`,
    left: `oklch(${Math.max(0.16, l - 0.18)} ${Math.max(0, c - 0.01)} ${h})`,
  };
}

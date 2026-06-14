"use client";

import type { Space } from "@/lib/board";

/**
 * A square 4x4 perimeter ring of 12 tiles (the board). Space 0 (GO) is bottom-right;
 * the ring runs counter-clockwise up the right, across the top, down the left, and
 * back along the bottom — the classic Monopoly travel direction. Each tile shows its
 * color band, name, and price; the active tile (player position) and owned tiles are
 * highlighted. The player token hops to its tile.
 */

// grid cells (row,col) in a 4x4 grid for spaceIds 0..11, going around the ring.
// 0 bottom-right corner, then up the right edge, across top, down left, across bottom.
const RING: Array<{ r: number; c: number }> = [
  { r: 4, c: 4 }, // 0 GO (bottom-right)
  { r: 3, c: 4 }, // 1
  { r: 2, c: 4 }, // 2
  { r: 1, c: 4 }, // 3 (top-right corner)
  { r: 1, c: 3 }, // 4
  { r: 1, c: 2 }, // 5
  { r: 1, c: 1 }, // 6 (top-left corner)
  { r: 2, c: 1 }, // 7
  { r: 3, c: 1 }, // 8 (Jail) -> down left
  { r: 4, c: 1 }, // 9 (bottom-left corner)
  { r: 4, c: 2 }, // 10
  { r: 4, c: 3 }, // 11
];

function fmtUsdc(units: number): string {
  return (units / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function Board({
  board,
  position,
  properties,
  playerAddress,
}: {
  board: Space[];
  position: number;
  properties: Record<number, string>;
  playerAddress: string | null;
}) {
  return (
    <div className="felt rounded-3xl p-3 sm:p-5">
      <div
        className="relative grid gap-2"
        style={{ gridTemplateColumns: "repeat(4, 1fr)", gridTemplateRows: "repeat(4, 1fr)", aspectRatio: "1 / 1" }}
      >
        {/* center medallion */}
        <div
          className="flex flex-col items-center justify-center rounded-2xl"
          style={{ gridColumn: "2 / 4", gridRow: "2 / 4" }}
        >
          <div className="text-center select-none">
            <div className="gold-text text-4xl sm:text-6xl font-bold tracking-tight">NEXUS</div>
            <div className="text-emerald-200/80 text-xs sm:text-sm tracking-[0.3em] mt-1">ONCHAIN MONOPOLY</div>
            <div className="mt-3 text-[10px] sm:text-xs text-emerald-300/60 uppercase tracking-widest">
              Base Sepolia · gasless dice · real USDC
            </div>
          </div>
        </div>

        {board.map((sp) => {
          const cell = RING[sp.id];
          const owner = properties[sp.id];
          const isActive = sp.id === position % board.length;
          const isOwned = !!owner;
          const isMine = owner && playerAddress && owner.toLowerCase() === playerAddress.toLowerCase();
          return (
            <div
              key={sp.id}
              data-testid={`tile-${sp.id}`}
              data-active={isActive ? "1" : "0"}
              className={`tile relative rounded-lg overflow-hidden flex flex-col ${isActive ? "active animate-pop" : ""} ${isOwned ? "owned" : ""}`}
              style={{ gridColumn: cell.c, gridRow: cell.r }}
            >
              {sp.kind === "property" && (
                <div className="h-2.5 w-full" style={{ background: sp.color }} />
              )}
              <div className="flex-1 p-1.5 flex flex-col justify-between">
                <div
                  className={`leading-tight font-semibold ${sp.kind === "go" || sp.kind === "jail" ? "text-[13px]" : "text-[10px] sm:text-[11px]"}`}
                >
                  {sp.name}
                </div>
                {sp.kind === "property" && (
                  <div className="mono text-[9px] text-black/60">${fmtUsdc(sp.price)}</div>
                )}
                {sp.kind === "go" && <div className="text-[16px]">→</div>}
              </div>
              {isOwned && (
                <div
                  className={`absolute bottom-0 right-0 px-1 py-0.5 text-[8px] font-bold rounded-tl ${isMine ? "bg-emerald-500 text-black" : "bg-rose-500 text-white"}`}
                  data-testid={`owned-${sp.id}`}
                >
                  {isMine ? "YOU" : "OWNED"}
                </div>
              )}
              {isActive && (
                <div
                  data-testid="player-token"
                  className="token absolute -top-1 -left-1 w-5 h-5 rounded-full animate-hop"
                  title="You are here"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

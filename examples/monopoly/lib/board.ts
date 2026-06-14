/**
 * The 12-space Monopoly board (shared by the UI and the backend bookkeeping).
 * Prices/rents are denominated in USDC base units (6 decimals) for the play-cash
 * ledger; the REAL x402 charge uses a small fraction of these so a live testnet
 * payment is affordable (see CHARGE_USDC).
 */
export type SpaceKind = "go" | "property" | "tax" | "chance" | "jail";

export interface Space {
  id: number;
  name: string;
  kind: SpaceKind;
  /** play-cash price (6dp), 0 for non-property */
  price: number;
  /** play-cash rent (6dp) */
  rent: number;
  /** accent color for the UI */
  color: string;
}

const M = 1_000_000; // 1 USDC in base units

export const BOARD: Space[] = [
  { id: 0, name: "GO", kind: "go", price: 0, rent: 0, color: "#22c55e" },
  { id: 1, name: "Genesis Block", kind: "property", price: 60 * M, rent: 6 * M, color: "#a855f7" },
  { id: 2, name: "Mempool Ave", kind: "property", price: 80 * M, rent: 8 * M, color: "#a855f7" },
  { id: 3, name: "Gas Tax", kind: "tax", price: 0, rent: 0, color: "#64748b" },
  { id: 4, name: "Rollup Road", kind: "property", price: 120 * M, rent: 14 * M, color: "#06b6d4" },
  { id: 5, name: "Oracle Sq", kind: "chance", price: 0, rent: 0, color: "#f59e0b" },
  { id: 6, name: "L2 Lane", kind: "property", price: 140 * M, rent: 16 * M, color: "#06b6d4" },
  { id: 7, name: "Validator Vault", kind: "property", price: 180 * M, rent: 22 * M, color: "#ef4444" },
  { id: 8, name: "Jail", kind: "jail", price: 0, rent: 0, color: "#64748b" },
  { id: 9, name: "Bridge Blvd", kind: "property", price: 200 * M, rent: 26 * M, color: "#ef4444" },
  { id: 10, name: "ZK Park", kind: "property", price: 240 * M, rent: 30 * M, color: "#eab308" },
  { id: 11, name: "Sequencer St", kind: "property", price: 280 * M, rent: 36 * M, color: "#eab308" },
];

export const BOARD_SIZE = BOARD.length;

/**
 * The REAL on-chain USDC amounts for x402 charges (kept tiny so the funded testnet
 * relayer's ~15 USDC lasts many games). These are what actually settle on Base
 * Sepolia. Buy and rent each move a small real USDC amount to the bank/owner.
 */
export const CHARGE_USDC = {
  buyIn: "0.10", // join the game
  buy: "0.05", // purchase a property
  rent: "0.02", // pay rent
} as const;

export function spaceAt(position: number): Space {
  return BOARD[((position % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE];
}

/**
 * The FULL standard US-edition Monopoly board (40 spaces, canonical order) and the
 * published deed values. This is the single source of truth shared by the
 * authoritative backend rules engine (lib/monopoly-rules.ts), the UI, and the bots.
 *
 * In-game money is denominated in plain dollars (integers). A small fixed scale maps
 * in-game dollars → micro-USDC for the REAL x402 charges on Base Sepolia (see
 * DOLLAR_TO_USDC): a real but tiny on-chain payment. The pot/payout is real USDC.
 */

export type SpaceKind =
  | "go"
  | "property"
  | "railroad"
  | "utility"
  | "tax"
  | "chance"
  | "chest"
  | "jail"
  | "free"
  | "gotojail";

export type ColorGroup =
  | "brown"
  | "lightblue"
  | "pink"
  | "orange"
  | "red"
  | "yellow"
  | "green"
  | "darkblue"
  | "railroad"
  | "utility";

export interface Space {
  id: number;
  name: string;
  kind: SpaceKind;
  group?: ColorGroup;
  /** purchase price (dollars) for ownable spaces (property/railroad/utility) */
  price?: number;
  /** mortgage value (dollars) — 50% of price */
  mortgage?: number;
  /** house cost (dollars) for color properties */
  houseCost?: number;
  /** rent table [base, 1H, 2H, 3H, 4H, hotel] for color properties */
  rent?: number[];
  /** flat tax amount (dollars) for tax spaces */
  tax?: number;
  /** UI accent color (hex) */
  color: string;
}

/** Hex swatches for the color groups (UI). */
export const GROUP_COLOR: Record<ColorGroup, string> = {
  brown: "#8B5A2B",
  lightblue: "#AAD8F0",
  pink: "#D6398E",
  orange: "#F08E2E",
  red: "#E0282E",
  yellow: "#F6E219",
  green: "#1FA055",
  darkblue: "#1B4FA0",
  railroad: "#2B2B2B",
  utility: "#9AA0A6",
};

const c = (g: ColorGroup) => GROUP_COLOR[g];

export const BOARD: Space[] = [
  { id: 0, name: "GO", kind: "go", color: "#22c55e" },
  { id: 1, name: "Mediterranean Ave", kind: "property", group: "brown", price: 60, mortgage: 30, houseCost: 50, rent: [2, 10, 30, 90, 160, 250], color: c("brown") },
  { id: 2, name: "Community Chest", kind: "chest", color: "#60a5fa" },
  { id: 3, name: "Baltic Ave", kind: "property", group: "brown", price: 60, mortgage: 30, houseCost: 50, rent: [4, 20, 60, 180, 320, 450], color: c("brown") },
  { id: 4, name: "Income Tax", kind: "tax", tax: 200, color: "#64748b" },
  { id: 5, name: "Reading Railroad", kind: "railroad", group: "railroad", price: 200, mortgage: 100, color: c("railroad") },
  { id: 6, name: "Oriental Ave", kind: "property", group: "lightblue", price: 100, mortgage: 50, houseCost: 50, rent: [6, 30, 90, 270, 400, 550], color: c("lightblue") },
  { id: 7, name: "Chance", kind: "chance", color: "#f59e0b" },
  { id: 8, name: "Vermont Ave", kind: "property", group: "lightblue", price: 100, mortgage: 50, houseCost: 50, rent: [6, 30, 90, 270, 400, 550], color: c("lightblue") },
  { id: 9, name: "Connecticut Ave", kind: "property", group: "lightblue", price: 120, mortgage: 60, houseCost: 50, rent: [8, 40, 100, 300, 450, 600], color: c("lightblue") },
  { id: 10, name: "Jail / Just Visiting", kind: "jail", color: "#64748b" },
  { id: 11, name: "St. Charles Place", kind: "property", group: "pink", price: 140, mortgage: 70, houseCost: 100, rent: [10, 50, 150, 450, 625, 750], color: c("pink") },
  { id: 12, name: "Electric Company", kind: "utility", group: "utility", price: 150, mortgage: 75, color: c("utility") },
  { id: 13, name: "States Ave", kind: "property", group: "pink", price: 140, mortgage: 70, houseCost: 100, rent: [10, 50, 150, 450, 625, 750], color: c("pink") },
  { id: 14, name: "Virginia Ave", kind: "property", group: "pink", price: 160, mortgage: 80, houseCost: 100, rent: [12, 60, 180, 500, 700, 900], color: c("pink") },
  { id: 15, name: "Pennsylvania Railroad", kind: "railroad", group: "railroad", price: 200, mortgage: 100, color: c("railroad") },
  { id: 16, name: "St. James Place", kind: "property", group: "orange", price: 180, mortgage: 90, houseCost: 100, rent: [14, 70, 200, 550, 750, 950], color: c("orange") },
  { id: 17, name: "Community Chest", kind: "chest", color: "#60a5fa" },
  { id: 18, name: "Tennessee Ave", kind: "property", group: "orange", price: 180, mortgage: 90, houseCost: 100, rent: [14, 70, 200, 550, 750, 950], color: c("orange") },
  { id: 19, name: "New York Ave", kind: "property", group: "orange", price: 200, mortgage: 100, houseCost: 100, rent: [16, 80, 220, 600, 800, 1000], color: c("orange") },
  { id: 20, name: "Free Parking", kind: "free", color: "#64748b" },
  { id: 21, name: "Kentucky Ave", kind: "property", group: "red", price: 220, mortgage: 110, houseCost: 150, rent: [18, 90, 250, 700, 875, 1050], color: c("red") },
  { id: 22, name: "Chance", kind: "chance", color: "#f59e0b" },
  { id: 23, name: "Indiana Ave", kind: "property", group: "red", price: 220, mortgage: 110, houseCost: 150, rent: [18, 90, 250, 700, 875, 1050], color: c("red") },
  { id: 24, name: "Illinois Ave", kind: "property", group: "red", price: 240, mortgage: 120, houseCost: 150, rent: [20, 100, 300, 750, 925, 1100], color: c("red") },
  { id: 25, name: "B&O Railroad", kind: "railroad", group: "railroad", price: 200, mortgage: 100, color: c("railroad") },
  { id: 26, name: "Atlantic Ave", kind: "property", group: "yellow", price: 260, mortgage: 130, houseCost: 150, rent: [22, 110, 330, 800, 975, 1150], color: c("yellow") },
  { id: 27, name: "Ventnor Ave", kind: "property", group: "yellow", price: 260, mortgage: 130, houseCost: 150, rent: [22, 110, 330, 800, 975, 1150], color: c("yellow") },
  { id: 28, name: "Water Works", kind: "utility", group: "utility", price: 150, mortgage: 75, color: c("utility") },
  { id: 29, name: "Marvin Gardens", kind: "property", group: "yellow", price: 280, mortgage: 140, houseCost: 150, rent: [24, 120, 360, 850, 1025, 1200], color: c("yellow") },
  { id: 30, name: "Go To Jail", kind: "gotojail", color: "#64748b" },
  { id: 31, name: "Pacific Ave", kind: "property", group: "green", price: 300, mortgage: 150, houseCost: 200, rent: [26, 130, 390, 900, 1100, 1275], color: c("green") },
  { id: 32, name: "North Carolina Ave", kind: "property", group: "green", price: 300, mortgage: 150, houseCost: 200, rent: [26, 130, 390, 900, 1100, 1275], color: c("green") },
  { id: 33, name: "Community Chest", kind: "chest", color: "#60a5fa" },
  { id: 34, name: "Pennsylvania Ave", kind: "property", group: "green", price: 320, mortgage: 160, houseCost: 200, rent: [28, 150, 450, 1000, 1200, 1400], color: c("green") },
  { id: 35, name: "Short Line Railroad", kind: "railroad", group: "railroad", price: 200, mortgage: 100, color: c("railroad") },
  { id: 36, name: "Chance", kind: "chance", color: "#f59e0b" },
  { id: 37, name: "Park Place", kind: "property", group: "darkblue", price: 350, mortgage: 175, houseCost: 200, rent: [35, 175, 500, 1100, 1300, 1500], color: c("darkblue") },
  { id: 38, name: "Luxury Tax", kind: "tax", tax: 100, color: "#64748b" },
  { id: 39, name: "Boardwalk", kind: "property", group: "darkblue", price: 400, mortgage: 200, houseCost: 200, rent: [50, 200, 600, 1400, 1700, 2000], color: c("darkblue") },
];

export const BOARD_SIZE = BOARD.length; // 40
export const GO_INDEX = 0;
export const JAIL_INDEX = 10;
export const GO_TO_JAIL_INDEX = 30;
export const GO_BONUS = 60; // smaller-bankroll variant: reduced GO income so
// bankruptcies (full rents) are reached within a bounded round budget. The published
// rent tables are UNCHANGED — only the bankroll/GO income is scaled down.
export const JAIL_FINE = 50;

/** Railroad rent by number of railroads the owner holds. */
export const RAILROAD_RENT = [0, 25, 50, 100, 200];

/** The color groups and their member space ids (for monopoly / building checks). */
export const GROUP_MEMBERS: Record<ColorGroup, number[]> = (() => {
  const m: Partial<Record<ColorGroup, number[]>> = {};
  for (const s of BOARD) {
    if (s.group) (m[s.group] ??= []).push(s.id);
  }
  return m as Record<ColorGroup, number[]>;
})();

export function spaceAt(position: number): Space {
  return BOARD[((position % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE];
}

export function isOwnable(s: Space): boolean {
  return s.kind === "property" || s.kind === "railroad" || s.kind === "utility";
}

/**
 * In-game dollars → micro-USDC scale for REAL x402 charges. $1 in game = 0.0001 USDC
 * on-chain, so a $200 tax is a real 0.02 USDC transfer and a typical game's total
 * real spend per player stays well under a funded testnet wallet (~0.8 USDC). The
 * pot accumulates these real USDC charges and pays the winner.
 */
export const DOLLAR_TO_USDC = 0.0001;

/** Format an in-game dollar amount → the USDC charge string (6dp) for x402. */
export function dollarsToUsdc(dollars: number): string {
  const usdc = dollars * DOLLAR_TO_USDC;
  return usdc.toFixed(6);
}

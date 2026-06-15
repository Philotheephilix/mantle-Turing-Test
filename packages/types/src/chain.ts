/**
 * Chain constants. Nexus is Mantle-only by design (see docs/roadmap conventions).
 * Mantle Sepolia is the default test target; Mantle mainnet is used only where a
 * feature is mainnet-only.
 */

export const CHAINS = {
  "mantle-sepolia": {
    id: 5003,
    name: "Mantle Sepolia",
    isTestnet: true,
    defaultRpcUrl: "https://rpc.sepolia.mantle.xyz",
    explorer: "https://sepolia.mantlescan.xyz",
    // Budget/charge token on Mantle Sepolia. Mantle Sepolia has no canonical
    // Circle USDC, so the stack deploys its own 6-decimals TestUSDC and records
    // the address in each game's deployments/mantle-sepolia.json.
    usdc: "0x189BdF9e9e4FfE4AC0e8eD0479b158843Bcd0cde",
  },
  mantle: {
    id: 5000,
    name: "Mantle",
    isTestnet: false,
    defaultRpcUrl: "https://rpc.mantle.xyz",
    explorer: "https://mantlescan.xyz",
    // Canonical bridged USDC on Mantle mainnet.
    usdc: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9",
  },
} as const;

export type ChainKey = keyof typeof CHAINS;

export function isChainKey(v: string): v is ChainKey {
  return v === "mantle" || v === "mantle-sepolia";
}

export function chainConfig(chain: ChainKey) {
  return CHAINS[chain];
}

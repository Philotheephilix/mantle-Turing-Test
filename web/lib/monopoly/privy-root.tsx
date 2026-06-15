"use client";

/**
 * Opt-in Privy root. Swap `WalletProvider` in app/layout.tsx for this to enable Privy
 * login (requires NEXT_PUBLIC_PRIVY_APP_ID). Re-exported separately so the default
 * (guest) build never imports the Privy graph.
 */
export { PrivyWalletProvider } from "./privy";

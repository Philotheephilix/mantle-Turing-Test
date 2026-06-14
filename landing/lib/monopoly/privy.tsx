"use client";

/**
 * Privy wallet provider — OPT-IN. Only compiled when you wire it in app/layout.tsx
 * (see app/wallet.tsx "Switching to real Privy"). Wraps the app in PrivyProvider and
 * exposes the embedded-wallet address through the shared WalletContext, so the rest of
 * the app is identical whether using Privy or the guest fallback.
 */
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { useMemo } from "react";
import type { Address } from "viem";
import { WalletContext, type WalletState } from "./wallet";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";

function Bridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const address = (wallets[0]?.address as Address | undefined) ?? null;
  const value = useMemo<WalletState>(
    () => ({
      address: authenticated ? address : null,
      mode: "privy",
      ready,
      login: () => login(),
      logout: () => logout(),
    }),
    [authenticated, address, ready, login, logout],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function PrivyWalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        appearance: { theme: "dark", accentColor: "#5eead4" },
      }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}

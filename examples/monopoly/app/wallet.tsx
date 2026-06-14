"use client";

/**
 * Wallet seam (player identity). The DEFAULT provider is the GUEST fallback — a
 * wallet generated in the browser (persisted in localStorage) so the app is fully
 * runnable and testable with NO Privy account. The guest address is only the player
 * identity; it never signs or holds funds (the server-side funded wallet settles all
 * USDC).
 *
 * IMPORTANT: this file intentionally has NO static reference to the Privy module, so
 * Privy's (very heavy) dependency graph never enters the default homepage compile.
 *
 * ── Switching to real Privy ──────────────────────────────────────────────────────
 *   1. set NEXT_PUBLIC_PRIVY_APP_ID in examples/monopoly/.env.local
 *   2. in app/layout.tsx, swap:
 *          import { WalletProvider } from "./wallet";
 *      for:
 *          import { PrivyWalletProvider as WalletProvider } from "./privy-root";
 *   The rest of the app is identical (same useWallet() contract). The Privy graph is
 *   then compiled only on that opt-in path.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type LocalAccount, generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
export const PRIVY_ENABLED = PRIVY_APP_ID.length > 0;

const GUEST_KEY_STORAGE = "monopoly.guest.pk";

/** Get-or-create the persistent guest wallet's underlying viem LocalAccount (used to
 *  sign the player's OWN gameplay + budget delegations in the browser). */
export function getGuestAccount(): LocalAccount {
  let key = typeof window !== "undefined" ? window.localStorage.getItem(GUEST_KEY_STORAGE) : null;
  if (!key) {
    key = generatePrivateKey();
    if (typeof window !== "undefined") window.localStorage.setItem(GUEST_KEY_STORAGE, key);
  }
  return privateKeyToAccount(key as `0x${string}`);
}

export interface WalletState {
  address: Address | null;
  mode: "privy" | "guest" | null;
  ready: boolean;
  login: () => void;
  logout: () => void;
}

export const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a wallet provider");
  return ctx;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    if (typeof window === "undefined") return;
    const pk = window.localStorage.getItem(GUEST_KEY_STORAGE);
    if (pk) {
      try {
        setAddress(privateKeyToAccount(pk as `0x${string}`).address);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const login = useCallback(() => {
    let pk = typeof window !== "undefined" ? window.localStorage.getItem(GUEST_KEY_STORAGE) : null;
    if (!pk) {
      pk = generatePrivateKey();
      window.localStorage.setItem(GUEST_KEY_STORAGE, pk);
    }
    setAddress(privateKeyToAccount(pk as `0x${string}`).address);
  }, []);

  const logout = useCallback(() => setAddress(null), []);

  const value = useMemo<WalletState>(
    () => ({ address, mode: "guest", ready, login, logout }),
    [address, ready, login, logout],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

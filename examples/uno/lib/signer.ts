/**
 * Player signer abstraction.
 *
 * Two backends:
 *   1. GUEST WALLET (default when NEXT_PUBLIC_PRIVY_APP_ID is empty): a viem
 *      LocalAccount generated from a random key, persisted in localStorage so the
 *      session survives reloads (and the Playwright persistent context). Fully
 *      self-contained — no Privy account needed, so the e2e is runnable as-is.
 *   2. PRIVY: when an app id is set, the app wraps the tree in PrivyProvider and
 *      adapts the Privy embedded wallet into the same signer shape (address +
 *      signMessage + signTypedData). See components/PrivyBridge.tsx.
 *
 * The gateway client and @nexus/core's signDelegation only ever use `address`,
 * `signMessage`, and `signTypedData`.
 */
import type { Address, Hex } from "@nexus/types";
import { type LocalAccount, generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const GUEST_KEY_STORAGE = "uno.guest.privateKey";

export interface PlayerSigner {
  address: Address;
  signMessage: (args: { message: string }) => Promise<Hex>;
  signTypedData: (args: never) => Promise<Hex>;
  kind: "guest" | "privy";
}

/** Get-or-create a persistent guest wallet's underlying viem LocalAccount. */
export function getGuestAccount(): LocalAccount {
  let key = typeof window !== "undefined" ? window.localStorage.getItem(GUEST_KEY_STORAGE) : null;
  if (!key) {
    key = generatePrivateKey();
    if (typeof window !== "undefined") window.localStorage.setItem(GUEST_KEY_STORAGE, key);
  }
  return privateKeyToAccount(key as Hex);
}

/** Get-or-create a persistent guest wallet (localStorage-backed). */
export function getGuestSigner(): PlayerSigner {
  const account = getGuestAccount();
  return {
    address: account.address,
    signMessage: (args) => account.signMessage(args),
    signTypedData: (args) => account.signTypedData(args as never),
    kind: "guest",
  };
}

export function privyEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
}

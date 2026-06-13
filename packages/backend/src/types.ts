import type { GameDefinition } from "@nexus/core";
import type { SignedDelegation } from "@nexus/core";
import type { Address, Hex } from "@nexus/types";

export type { SignedDelegation } from "@nexus/core";

/** A game module is a `defineGame` definition; mounted at `/game/:name`. */
export type GameModule = GameDefinition;

export type RoomId = string;

export type RoomState = "open" | "filling" | "active" | "settling" | "closed";

/** A relayer-side reference (prod) instead of holding the full signed delegation. */
export interface RelayerRef {
  kind: "relayer-ref";
  ref: string;
}

/**
 * The signed GameDelegation as the room/session service holds it. We accept the
 * developer-facing config (caveat groups, for sanity validation) plus the signed
 * delegation tuple (for redemption). Either the full signed delegation or a
 * relayer reference is stored (backend spec §6).
 */
export interface GameDelegation {
  /** The player's smart account (delegator). */
  player: Address;
  /** Caveat groups as approved at join — validated for sanity. */
  caveats: {
    gameplay: {
      allowedSystems: Hex[];
      turnBound?: boolean;
      expiresAt: number;
      maxActions?: number;
    };
    budget: {
      token: "USDC";
      totalCap: string;
      perActionCap: string;
      allowedRecipients: Address[];
    };
  };
  /** The signed delegation tuple, or a relayer-side reference. */
  signed: SignedDelegation | RelayerRef;
  /** The relayer `targetAddress` the delegation's `to` must equal. */
  to: Address;
}

export interface Session {
  sessionId: string;
  roomId: RoomId;
  player: Address;
  delegation: GameDelegation;
  createdAt: number;
}

export interface PotRef {
  roomId: RoomId;
  /** The pot's MetaMask Smart Account escrow address. */
  account: Address;
  /** The pot's own signed delegation, redeemed at settle/refund. */
  delegation: SignedDelegation | RelayerRef;
  /** Participants who funded the pot (for pro-rata refund). */
  participants: Address[];
}

export interface RoomConfig {
  /** Players required to move `filling → active`. */
  quorum: number;
  /** Optional explicit pot escrow account (else derived/opened lazily). */
  potAccount?: Address;
}

export interface Refund {
  player: Address;
  amount: string;
  bundleId?: string;
}

export interface Payout {
  winner: Address;
  amount: string;
  rake: string;
  bundleId?: string;
}

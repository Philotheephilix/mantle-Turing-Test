/**
 * Browser-side Monopoly client for the game server (/api/*). The human signs its
 * OWN delegations with the guest wallet (a viem LocalAccount); the server redeems
 * them via the relayer. The human pays zero gas; the buy-in / property buy / rent
 * are real USDC charges from the human's own wallet, bounded by the budget delegation.
 */
import type { Address, Hex } from "@nexus/types";
import type { LocalAccount } from "viem/accounts";
import { signBudgetDelegation, signGameplayDelegation } from "./delegations";

export interface SeatView {
  address: Address;
  role: "human" | "bot";
  paid: boolean;
  position: number;
  pending: { kind: "buy" | "rent"; spaceId: number; owner?: Address } | null;
  properties: number;
}
export interface GameView {
  roomId: string;
  fee: string;
  charges: { buyIn: string; buy: string; rent: string };
  targetProperties: number;
  seats: SeatView[];
  properties: Record<number, Address>;
  winner: Address | null;
  payoutTx: Hex | null;
  pot: Address;
  currentTurn?: Address | null;
}

// Caps that comfortably cover the human's buy-in + several property buys.
const PER_ACTION_CAP = "0.5";
const TOTAL_CAP = "5";

export class MonopolyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly account: LocalAccount,
  ) {}

  get address(): Address {
    return this.account.address;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    return res.json() as Promise<T>;
  }
  private async post<T>(path: string, body: unknown): Promise<T> {
    const payload = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const res = await fetch(`${this.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
    return res.json() as Promise<T>;
  }

  state(): Promise<GameView & { ok: boolean }> {
    return this.get("/api/state");
  }

  // Cache the signed budget delegation (covers buy-in + buys + rents) for the game.
  private budgetByPot = new Map<string, Awaited<ReturnType<typeof signBudgetDelegation>>>();
  private async budget(pot: Address) {
    let s = this.budgetByPot.get(pot.toLowerCase());
    if (!s) {
      s = await signBudgetDelegation(this.account, pot, PER_ACTION_CAP, TOTAL_CAP);
      this.budgetByPot.set(pot.toLowerCase(), s);
    }
    return s;
  }

  // Cache the signed gameplay delegation (covers all rolls) for the room.
  private gameplayByRoom = new Map<string, Awaited<ReturnType<typeof signGameplayDelegation>>>();
  private async gameplay(roomId: string) {
    let s = this.gameplayByRoom.get(roomId);
    if (!s) {
      s = await signGameplayDelegation(this.account, BigInt(roomId));
      this.gameplayByRoom.set(roomId, s);
    }
    return s;
  }

  /** Pay the buy-in (real USDC → Pot). */
  async payBuyIn(pot: Address): Promise<{ ok: boolean; txHash?: Hex; error?: string }> {
    const signedBudget = await this.budget(pot);
    return this.post("/api/charge", { player: this.address, signedBudget });
  }

  /** Gasless dice roll. */
  async roll(roomId: string): Promise<{ ok: boolean; txHash?: Hex; die1?: number; die2?: number; toPos?: number; space?: string; pending?: SeatView["pending"]; error?: string }> {
    const signedGameplay = await this.gameplay(roomId);
    return this.post("/api/roll", { player: this.address, signedGameplay });
  }

  /** Buy the pending property (real USDC → Pot). */
  async buy(pot: Address): Promise<{ ok: boolean; txHash?: Hex; properties?: number; winner?: Address | null; payoutTx?: Hex | null; error?: string }> {
    const signedBudget = await this.budget(pot);
    return this.post("/api/buy", { player: this.address, signedBudget });
  }

  /** Pay the pending rent (real USDC → Pot). */
  async rent(pot: Address): Promise<{ ok: boolean; txHash?: Hex; error?: string }> {
    const signedBudget = await this.budget(pot);
    return this.post("/api/rent", { player: this.address, signedBudget });
  }
}

/**
 * SERVER-ONLY — the low-level Nexus redemption engine for Monopoly, driving a REAL
 * multiplayer game to a win with distinct per-player keys (mirrors examples/uno).
 *
 * Each player signs their OWN delegations (gameplay + budget) with their OWN key;
 * the relayer (the single funded key, server-side) redeems them via the
 * NexusDelegationManager:
 *   - gameplay delegation  → gasless dice rolls (turn-bound rollAndMove)
 *   - budget delegation    → real x402 USDC charges (buy-in / property buy / rent),
 *                            each a transferFrom(player -> Pot) bounded on-chain by
 *                            the player's spend caps + recipient allowlist.
 * No player ever pays gas. recordBuy / recordRent (ownership + play-cash ledger),
 * room seating, openPot and the final settle are admin/authority ops driven by the
 * relayer directly (it is the TurnManager admin, the game admin, and the Pot
 * settle authority). ALL relayer submissions are serialized so the single key's
 * nonces never collide.
 */
import {
  type DeploymentAddresses,
  type SignedDelegation,
  buildChargeFromExecution,
  buildMoveExecution,
  buildRedeemCalldata,
  encodePermissionContext,
  usdcToWei,
} from "@nexus/core";
import { revertDataOf } from "@nexus/relayer";
import type { Address, Hex } from "@nexus/types";
import {
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
} from "viem";
import { type LocalAccount, privateKeyToAccount } from "viem/accounts";
import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_RPC_URL, RELAYER_PRIVATE_KEY } from "./config";
import { addresses, deployment, MONOPOLY_SYSTEM_ID } from "./deployment";

export const baseSepolia = {
  id: BASE_SEPOLIA_CHAIN_ID,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [BASE_SEPOLIA_RPC_URL] } },
} as const satisfies Chain;

// ── ABIs ────────────────────────────────────────────────────────────────────

export const MONOPOLY_ABI = [
  {
    type: "function",
    name: "rollAndMove",
    inputs: [{ name: "roomId", type: "uint256" }],
    outputs: [
      { name: "die1", type: "uint8" },
      { name: "die2", type: "uint8" },
      { name: "newPos", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "joinGame",
    inputs: [{ name: "roomId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "recordBuy",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "spaceId", type: "uint256" },
      { name: "player", type: "address" },
      { name: "price", type: "uint256" },
      { name: "rent", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "recordRent",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "spaceId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cashOf",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ownerOf",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "spaceId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "Monopoly_Rolled",
    inputs: [
      { name: "roomId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "die1", type: "uint8", indexed: false },
      { name: "die2", type: "uint8", indexed: false },
      { name: "fromPos", type: "uint256", indexed: false },
      { name: "toPos", type: "uint256", indexed: false },
      { name: "passedGo", type: "bool", indexed: false },
    ],
  },
] as const;

export const TURN_MANAGER_ABI = [
  {
    type: "function",
    name: "startTurns",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "order", type: "address[]" },
      { name: "turnBlocks", type: "uint64" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  { type: "function", name: "getCurrent", inputs: [{ name: "roomId", type: "uint256" }], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
] as const;

export const POT_ABI = [
  { type: "function", name: "openPot", inputs: [{ name: "roomId", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  {
    type: "function",
    name: "creditDeposit",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "player", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settle",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "winner", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const USDC_ABI = [
  { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "allowance", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

// ── engine ──────────────────────────────────────────────────────────────────

export interface MonopolyEngine {
  publicClient: PublicClient;
  relayerWallet: WalletClient;
  relayer: LocalAccount;
  addrs: DeploymentAddresses;
}

let cached: Promise<MonopolyEngine> | null = null;
export function getEngine(): Promise<MonopolyEngine> {
  if (!cached) cached = boot();
  return cached;
}

async function boot(): Promise<MonopolyEngine> {
  const relayer = privateKeyToAccount(RELAYER_PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC_URL) }) as PublicClient;
  const relayerWallet = createWalletClient({ account: relayer, chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC_URL) });
  return { publicClient, relayerWallet, relayer, addrs: addresses };
}

// Per-player delegation signing (each player signs with its OWN key) lives in the
// browser-safe ./delegations module; re-export for server-side callers.
export { signGameplayDelegation, signBudgetDelegation } from "./delegations";

// ── retry / submit helpers ────────────────────────────────────────────────────

/** A revert (named custom error / "execution reverted") is a DETERMINISTIC failure
 *  (e.g. the turn-bound enforcer rejecting a stale roll) — retrying won't help. Only
 *  retry genuinely transient RPC/network errors. */
function isOnChainRevert(e: unknown): boolean {
  const data = revertDataOf(e) ?? revertDataOf((e as { cause?: unknown })?.cause);
  return data !== undefined || /execution reverted|reverted on-chain/i.test(String(e));
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4, retryOnRevert = true): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const revert = isOnChainRevert(e);
      if ((revert && !retryOnRevert) || i >= attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function submitAndConfirm(
  e: MonopolyEngine,
  data: Hex,
): Promise<{ txHash: Hex; blockNumber: bigint; logs: { address: string; topics: readonly Hex[]; data: Hex }[] }> {
  const hash = (await e.relayerWallet.sendTransaction({
    account: e.relayer,
    chain: baseSepolia,
    to: e.addrs.delegationManager,
    data,
  })) as Hex;
  const receipt = await e.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`redemption reverted on-chain (tx ${hash})`);
  return {
    txHash: hash,
    blockNumber: receipt.blockNumber,
    logs: receipt.logs.map((l) => ({ address: l.address, topics: l.topics as readonly Hex[], data: l.data })),
  };
}

export interface RollResult {
  status: "mined";
  txHash: Hex;
  blockNumber: bigint;
  die1: number;
  die2: number;
  fromPos: number;
  toPos: number;
  passedGo: boolean;
}

// ── per-player redemptions (the relayer submits; players pay zero gas) ──────────

/** Redeem a player's gameplay delegation for a gasless dice roll (turn-bound). */
export async function redeemRoll(
  e: MonopolyEngine,
  signedGameplay: SignedDelegation,
  roomId: bigint,
): Promise<RollResult> {
  const inner = encodeFunctionData({ abi: MONOPOLY_ABI, functionName: "rollAndMove", args: [roomId] });
  const exec = buildMoveExecution(e.addrs, MONOPOLY_SYSTEM_ID, inner);
  const ctx = encodePermissionContext(signedGameplay);
  const data = buildRedeemCalldata(ctx, exec);
  // A roll revert == "not your turn" (turn-bound enforcer) — fail fast, don't retry.
  const { txHash, blockNumber, logs } = await withRetry(() => submitAndConfirm(e, data), 3, false);

  // Decode the Monopoly_Rolled event from the move's own receipt logs (immune to
  // public-RPC read-after-write lag). topics: [sig, roomId, player]; data holds the
  // non-indexed (die1, die2, fromPos, toPos, passedGo).
  const log = logs.find((l) => l.address.toLowerCase() === deployment.monopolyGame.toLowerCase() && l.topics.length === 3);
  if (!log) throw new Error("no Monopoly_Rolled event in roll receipt");
  // ABI-decode the 5 non-indexed words from data.
  const d = log.data.slice(2);
  const word = (i: number) => d.slice(i * 64, (i + 1) * 64);
  const die1 = Number.parseInt(word(0), 16);
  const die2 = Number.parseInt(word(1), 16);
  const fromPos = Number.parseInt(word(2), 16);
  const toPos = Number.parseInt(word(3), 16);
  const passedGo = Number.parseInt(word(4), 16) === 1;
  return { status: "mined", txHash, blockNumber, die1, die2, fromPos, toPos, passedGo };
}

/** Redeem a player's budget delegation: real USDC transferFrom(player → Pot). The
 *  headline x402 charge (buy-in / property buy / rent — all routed to the Pot). */
export async function chargeFromPlayer(
  e: MonopolyEngine,
  signedBudget: SignedDelegation,
  player: Address,
  pot: Address,
  amount: string,
): Promise<{ status: "mined"; txHash: Hex; blockNumber: bigint }> {
  const exec = buildChargeFromExecution(e.addrs, player, pot, amount);
  const ctx = encodePermissionContext(signedBudget);
  const data = buildRedeemCalldata(ctx, exec);
  const { txHash, blockNumber } = await withRetry(() => submitAndConfirm(e, data));
  return { status: "mined", txHash, blockNumber };
}

// ── admin / authority ops (relayer is TurnManager admin + game admin + Pot auth) ──

async function adminWrite(e: MonopolyEngine, to: Address, abi: readonly unknown[], fn: string, args: readonly unknown[]): Promise<Hex> {
  const hash = await e.relayerWallet.writeContract({
    address: to,
    abi: abi as never,
    functionName: fn as never,
    args: args as never,
    account: e.relayer,
    chain: baseSepolia,
  } as never);
  await e.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function startTurns(e: MonopolyEngine, roomId: bigint, order: Address[], turnBlocks = 5_000_000n): Promise<Hex> {
  return adminWrite(e, deployment.turnManager, TURN_MANAGER_ABI, "startTurns", [roomId, order, turnBlocks]);
}

export async function openPot(e: MonopolyEngine, roomId: bigint): Promise<Hex> {
  return adminWrite(e, deployment.pot, POT_ABI, "openPot", [roomId]);
}

export async function creditDeposit(e: MonopolyEngine, roomId: bigint, player: Address, amount: string): Promise<Hex> {
  return adminWrite(e, deployment.pot, POT_ABI, "creditDeposit", [roomId, player, usdcToWei(amount)]);
}

export async function settlePot(e: MonopolyEngine, roomId: bigint, winner: Address): Promise<Hex> {
  return adminWrite(e, deployment.pot, POT_ABI, "settle", [roomId, winner]);
}

/** Record a property purchase on-chain (ownership + play-cash ledger). Admin op
 *  routed through World.call so the System resolves _msgSender()==relayer(admin). */
export async function recordBuy(e: MonopolyEngine, roomId: bigint, spaceId: number, player: Address, price: bigint, rent: bigint): Promise<Hex> {
  const inner = encodeFunctionData({ abi: MONOPOLY_ABI, functionName: "recordBuy", args: [roomId, BigInt(spaceId), player, price, rent] });
  return adminWrite(e, deployment.world, WORLD_CALL_ABI, "call", [MONOPOLY_SYSTEM_ID, inner]);
}

/** Record a rent payment on-chain (play-cash ledger). Admin op. */
export async function recordRent(e: MonopolyEngine, roomId: bigint, spaceId: number, player: Address): Promise<Hex> {
  const inner = encodeFunctionData({ abi: MONOPOLY_ABI, functionName: "recordRent", args: [roomId, BigInt(spaceId), player] });
  return adminWrite(e, deployment.world, WORLD_CALL_ABI, "call", [MONOPOLY_SYSTEM_ID, inner]);
}

const WORLD_CALL_ABI = [
  {
    type: "function",
    name: "call",
    inputs: [
      { name: "systemId", type: "bytes32" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes" }],
    stateMutability: "nonpayable",
  },
] as const;

// ── reads ─────────────────────────────────────────────────────────────────────

export async function getCurrentTurn(e: MonopolyEngine, roomId: bigint): Promise<Address> {
  return (await e.publicClient.readContract({
    address: deployment.turnManager,
    abi: TURN_MANAGER_ABI,
    functionName: "getCurrent",
    args: [roomId],
  })) as Address;
}

export async function getCash(e: MonopolyEngine, roomId: bigint, player: Address): Promise<bigint> {
  return (await e.publicClient.readContract({ address: deployment.monopolyGame, abi: MONOPOLY_ABI, functionName: "cashOf", args: [roomId, player] })) as bigint;
}

export async function getOwner(e: MonopolyEngine, roomId: bigint, spaceId: number): Promise<Address> {
  return (await e.publicClient.readContract({ address: deployment.monopolyGame, abi: MONOPOLY_ABI, functionName: "ownerOf", args: [roomId, BigInt(spaceId)] })) as Address;
}

export async function usdcBalance(e: MonopolyEngine, addr: Address): Promise<bigint> {
  return (await e.publicClient.readContract({ address: deployment.usdc, abi: USDC_ABI, functionName: "balanceOf", args: [addr] })) as bigint;
}

/** Wait for the TurnManager's getCurrent to reflect `expected` (read-after-write lag). */
export async function waitForTurn(e: MonopolyEngine, roomId: bigint, expected: Address, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const cur = await getCurrentTurn(e, roomId);
    if (cur.toLowerCase() === expected.toLowerCase()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

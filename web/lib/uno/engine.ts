/**
 * SERVER-ONLY — the proven low-level Nexus redemption engine for UNO, driving a
 * REAL multiplayer game to a win with distinct per-player keys.
 *
 * This mirrors scripts/live/integration.ts exactly: each player signs their OWN
 * delegation (gameplay + budget) with their OWN key; the relayer (the single
 * funded key, server-side) redeems it via the NexusDelegationManager for every
 * move (gasless for the player) and for the entry-fee x402 charge. No player ever
 * pays gas; the entry fee is a real USDC transferFrom from the player's wallet,
 * bounded on-chain by the budget delegation's caveats.
 *
 *   - signGameplayDelegation / signBudgetDelegation  → the player signs (own key)
 *   - redeemMove(signedGameplay, kind, card, roomId) → relayer redeems play/draw
 *   - chargeEntryFee(signedBudget, player, roomId)   → relayer redeems transferFrom
 *
 * Room setup (seat / deal / open pot) and pot settlement are admin/authority ops
 * driven directly by the relayer (it is the TurnManager admin + Pot authority).
 */
import {
  type DeploymentAddresses,
  type SignedDelegation,
  buildChargeFromExecution,
  buildMoveExecution,
  buildRedeemCalldata,
  encodePermissionContext,
  usdcToWei,
} from "@steamlink/core";
import { revertDataOf } from "@steamlink/relayer";
import type { Address, Hex } from "@steamlink/types";
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
import { MANTLE_SEPOLIA_CHAIN_ID, MANTLE_SEPOLIA_RPC_URL, RELAYER_PRIVATE_KEY } from "./config";
import { addresses, deployment } from "./deployment";
import { UNO_ALIAS_SYSTEM_ID } from "./game";

export const mantleSepoliaTestnet = {
  id: MANTLE_SEPOLIA_CHAIN_ID,
  name: "Mantle Sepolia",
  nativeCurrency: { name: "Mantle", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: [MANTLE_SEPOLIA_RPC_URL] } },
} as const satisfies Chain;

// ── ABIs ────────────────────────────────────────────────────────────────────

export const UNO_ABI = [
  {
    type: "function",
    name: "playCard",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "color", type: "uint8" },
      { name: "value", type: "uint8" },
      { name: "activeColor", type: "uint8" },
      { name: "newHandCount", type: "uint8" },
      { name: "advanceBy", type: "uint8" },
    ],
    outputs: [{ name: "winner", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "draw",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "newHandCount", type: "uint8" },
      { name: "advanceBy", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "startRoom",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "topColor", type: "uint8" },
      { name: "topValue", type: "uint8" },
      { name: "handCount", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "dealHand",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "player", type: "address" },
      { name: "count", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "handOf",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "winnerOf",
    inputs: [{ name: "roomId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "Uno_Played",
    inputs: [
      { name: "roomId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "color", type: "uint8", indexed: false },
      { name: "value", type: "uint8", indexed: false },
      { name: "activeColor", type: "uint8", indexed: false },
      { name: "handCount", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Uno_Won",
    inputs: [
      { name: "roomId", type: "uint256", indexed: true },
      { name: "winner", type: "address", indexed: true },
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
  {
    type: "function",
    name: "setDirection",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "direction", type: "int8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const RANDOMNESS_ABI = [
  { type: "function", name: "fastRandom", inputs: [], outputs: [{ name: "randomWord", type: "uint256" }], stateMutability: "nonpayable" },
  {
    type: "event",
    name: "FastRandom",
    inputs: [
      { name: "requester", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: true },
      { name: "randomWord", type: "uint256", indexed: false },
    ],
  },
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

const WORLD_ADMIN_ABI = [
  { type: "function", name: "registerSystem", inputs: [{ name: "systemId", type: "bytes32" }, { name: "systemAddr", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "getSystemAddress", inputs: [{ name: "systemId", type: "bytes32" }], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
] as const;

// ── engine ──────────────────────────────────────────────────────────────────

export interface UnoEngine {
  publicClient: PublicClient;
  /** Retry-wrapped relayer wallet (fresh nonce + gas bump + backoff on every submit). */
  relayerWallet: RelayerWallet;
  relayer: LocalAccount;
  addrs: DeploymentAddresses;
}

let cached: Promise<UnoEngine> | null = null;
export function getEngine(): Promise<UnoEngine> {
  if (!cached) cached = boot();
  return cached;
}

async function boot(): Promise<UnoEngine> {
  const relayer = privateKeyToAccount(RELAYER_PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: mantleSepoliaTestnet, transport: http(MANTLE_SEPOLIA_RPC_URL) }) as PublicClient;
  const rawWallet = createWalletClient({ account: relayer, chain: mantleSepoliaTestnet, transport: http(MANTLE_SEPOLIA_RPC_URL) });
  // Every relayer submission goes through the retry wrapper: serialized sends,
  // fresh pending nonce + gas bump per attempt, jittered backoff on
  // underpriced/nonce/RPC errors (robust to the shared-key contention + flaky RPC).
  const relayerWallet = wrapRetryingWallet(rawWallet, publicClient, relayer);

  // Reconcile the alias system-id so caveat/SystemAllowlist/World dispatch all agree.
  const existing = (await publicClient.readContract({
    address: deployment.world,
    abi: WORLD_ADMIN_ABI,
    functionName: "getSystemAddress",
    args: [UNO_ALIAS_SYSTEM_ID],
  })) as Address;
  if (existing.toLowerCase() !== deployment.unoGame.toLowerCase()) {
    const hash = await relayerWallet.writeContract({
      address: deployment.world,
      abi: WORLD_ADMIN_ABI,
      functionName: "registerSystem",
      args: [UNO_ALIAS_SYSTEM_ID, deployment.unoGame],
      account: relayer,
      chain: mantleSepoliaTestnet,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  return { publicClient, relayerWallet, relayer, addrs: addresses };
}

// Delegation signing (each player signs with their OWN key) lives in the
// browser-safe ./delegations module; re-export for server-side callers.
export { signGameplayDelegation, signBudgetDelegation } from "./delegations";

// ── redemption (the relayer submits; players pay zero gas) ───────────────────

export interface MoveResult {
  status: "mined" | "failed";
  txHash?: Hex;
  blockNumber?: bigint;
  winner?: Address;
}

function isTransient(e: unknown): boolean {
  const data = revertDataOf(e) ?? revertDataOf((e as { cause?: unknown })?.cause);
  return data !== undefined || /execution reverted/i.test(String(e));
}

/** Flatten an error (message + details + nested cause chain) for classification. */
function errText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur; i++) {
    const o = cur as { message?: unknown; details?: unknown; shortMessage?: unknown; cause?: unknown };
    parts.push(String(o.shortMessage ?? ""), String(o.details ?? ""), String(o.message ?? ""));
    cur = o.cause;
  }
  return parts.join(" ");
}

/**
 * Classify a relayer-submission error. These are the failures seen when the
 * single relayer key is contended (multiple processes) or the public RPC is
 * flaky — they MUST be retried (with a fresh nonce + a gas bump), unlike a
 * genuine on-chain enforcer revert.
 */
function retryClass(e: unknown): "nonce" | "underpriced" | "rpc" | "revert" | "fatal" {
  const m = errText(e);
  if (/replacement transaction underpriced|transaction underpriced|fee too low|max fee per gas less than|priority fee/i.test(m))
    return "underpriced";
  if (/nonce too low|nonce too high|invalid nonce|already known|already imported|nonce has already been used|replacement/i.test(m))
    return "nonce";
  if (/missing or invalid parameters|timeout|timed out|fetch failed|socket|other side closed|ECONNRESET|ETIMEDOUT|service unavailable|bad gateway|rate limit|429|502|503|504|invalid json|could not be found|header not found|block is out of range/i.test(m))
    return "rpc";
  if (/insufficient funds|exceeds the balance|gas required exceeds/i.test(m)) return "fatal";
  if (isTransient(e)) return "revert"; // on-chain revert (may be read-after-write lag)
  return "rpc"; // unknown → treat as transient infra and retry
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransient(e) || i >= attempts - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * A relayer-wallet wrapper giving EVERY submission robust retry. The single
 * relayer key may be contended across processes (e.g. the UNO and Monopoly
 * examples both relay from it), which produces "replacement transaction
 * underpriced" / "nonce too low" / "already known"; the public RPC also
 * intermittently rejects raw txs. On each attempt we serialize (a process-wide
 * mutex so concurrent sends never grab the same pending nonce), fetch a FRESH
 * pending nonce, and BUMP the priority fee on retries to win replacement races;
 * we back off with jitter on nonce/underpriced/RPC errors. Reverts get a few
 * retries (read-after-write lag) then surface. `fatal` (insufficient funds) is
 * never retried.
 */
type RelayerWallet = {
  writeContract: (args: Record<string, unknown>) => Promise<Hex>;
  sendTransaction: (args: Record<string, unknown>) => Promise<Hex>;
  account: ReturnType<typeof privateKeyToAccount>;
};

function wrapRetryingWallet(
  wallet: { writeContract: (a: never) => Promise<Hex>; sendTransaction: (a: never) => Promise<Hex> },
  publicClient: PublicClient,
  account: ReturnType<typeof privateKeyToAccount>,
): RelayerWallet {
  let chain: Promise<unknown> = Promise.resolve(); // serialize all sends in this process
  const MAX = 12;

  async function attempt(kind: "write" | "send", args: Record<string, unknown>): Promise<Hex> {
    let last: unknown;
    for (let i = 0; i < MAX; i++) {
      try {
        const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
        const fees = await publicClient.estimateFeesPerGas().catch(() => ({}) as Record<string, bigint>);
        const bump = (v?: bigint) => (v ? (v * BigInt(100 + 25 * i)) / 100n : undefined);
        const gas =
          fees.maxFeePerGas !== undefined
            ? { maxFeePerGas: bump(fees.maxFeePerGas), maxPriorityFeePerGas: bump(fees.maxPriorityFeePerGas ?? fees.maxFeePerGas) }
            : {};
        const full = { ...args, nonce, ...gas } as never;
        return kind === "write" ? await wallet.writeContract(full) : await wallet.sendTransaction(full);
      } catch (e) {
        last = e;
        const cls = retryClass(e);
        const revertCap = cls === "revert" && i >= 4; // don't grind a genuine revert forever
        if (cls === "fatal" || revertCap || i >= MAX - 1) throw e;
        // longer waits for nonce/underpriced (let the contending tx mine), with jitter
        const base = cls === "nonce" || cls === "underpriced" ? 2500 : 1200;
        await sleep(base + i * 1000 + Math.floor(Math.random() * 900));
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  const run = (kind: "write" | "send", args: Record<string, unknown>): Promise<Hex> => {
    const p = chain.then(() => attempt(kind, args));
    chain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  };

  return {
    account,
    writeContract: (args) => run("write", args),
    sendTransaction: (args) => run("send", args),
  };
}

async function submitAndConfirm(
  e: UnoEngine,
  data: Hex,
): Promise<{ txHash: Hex; blockNumber: bigint; logs: { address: string; topics: readonly Hex[]; data: Hex }[] }> {
  const hash = (await e.relayerWallet.sendTransaction({
    account: e.relayer,
    chain: mantleSepoliaTestnet,
    to: e.addrs.delegationManager,
    data,
  })) as Hex;
  const receipt = await e.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`redemption reverted on-chain (tx ${hash})`);
  }
  return {
    txHash: hash,
    blockNumber: receipt.blockNumber,
    logs: receipt.logs.map((l) => ({ address: l.address, topics: l.topics as readonly Hex[], data: l.data })),
  };
}

// keccak256("Uno_Won(uint256,address)") — the win event topic.
const UNO_WON_TOPIC: Hex = "0x8c7f7301b9fbf231a1ae7ee823c6d13193ca12e8be3dc110f2c916f24e298a73";

export interface PlayArgs {
  color: number;
  value: number;
  activeColor: number;
  newHandCount: number;
  advanceBy: number;
}
export interface DrawArgs {
  newHandCount: number;
  advanceBy: number;
}

/** Redeem a player's gameplay delegation for a play/draw move (gasless for them). */
export async function redeemMove(
  e: UnoEngine,
  signedGameplay: SignedDelegation,
  roomId: bigint,
  kind: "play" | "draw",
  args: PlayArgs | DrawArgs,
): Promise<MoveResult> {
  const inner =
    kind === "play"
      ? encodeFunctionData({
          abi: UNO_ABI,
          functionName: "playCard",
          args: [
            roomId,
            (args as PlayArgs).color,
            (args as PlayArgs).value,
            (args as PlayArgs).activeColor,
            (args as PlayArgs).newHandCount,
            (args as PlayArgs).advanceBy,
          ],
        })
      : encodeFunctionData({ abi: UNO_ABI, functionName: "draw", args: [roomId, (args as DrawArgs).newHandCount, (args as DrawArgs).advanceBy] });
  const exec = buildMoveExecution(e.addrs, UNO_ALIAS_SYSTEM_ID, inner);
  const ctx = encodePermissionContext(signedGameplay);
  const data = buildRedeemCalldata(ctx, exec);
  const { txHash, blockNumber, logs } = await withRetry(() => submitAndConfirm(e, data));
  // Detect the win DEFINITIVELY from the move's own receipt logs (a Uno_Won event
  // from the game contract) — immune to public-RPC read-after-write lag.
  const wonLog = logs.find(
    (l) =>
      l.address.toLowerCase() === deployment.unoGame.toLowerCase() &&
      l.topics[0]?.toLowerCase() === UNO_WON_TOPIC,
  );
  const winner = wonLog ? (`0x${wonLog.topics[2]!.slice(26)}` as Address) : undefined;
  return { status: "mined", txHash, blockNumber, winner };
}

/** Redeem a player's budget delegation: real USDC transferFrom(player → Pot). */
export async function chargeEntryFee(
  e: UnoEngine,
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

// ── admin / authority ops (relayer is TurnManager admin + Pot authority) ─────

export async function startTurns(e: UnoEngine, roomId: bigint, order: Address[], turnBlocks = 200_000n): Promise<Hex> {
  const hash = await e.relayerWallet.writeContract({
    address: deployment.turnManager,
    abi: TURN_MANAGER_ABI,
    functionName: "startTurns",
    args: [roomId, order, turnBlocks],
    account: e.relayer,
    chain: mantleSepoliaTestnet,
  });
  await e.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function startRoom(e: UnoEngine, roomId: bigint, topColor: number, topValue: number, handCount: number): Promise<Hex> {
  const hash = await e.relayerWallet.writeContract({
    address: deployment.unoGame,
    abi: UNO_ABI,
    functionName: "startRoom",
    args: [roomId, topColor, topValue, handCount],
    account: e.relayer,
    chain: mantleSepoliaTestnet,
  });
  await e.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Flip the on-chain TurnManager direction (admin/authorized op, off the redemption path). */
export async function setTurnDirection(e: UnoEngine, roomId: bigint, direction: 1 | -1): Promise<Hex> {
  const hash = await e.relayerWallet.writeContract({
    address: deployment.turnManager,
    abi: TURN_MANAGER_ABI,
    functionName: "setDirection",
    args: [roomId, direction],
    account: e.relayer,
    chain: mantleSepoliaTestnet,
  });
  await e.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// keccak256("FastRandom(address,uint256,uint256)") — the on-chain random-word event.
const FAST_RANDOM_TOPIC: Hex = "0xd8cc16a65d72177b2867ad1a15bb6b21d0e93220fdd47e8e67c3690de5f6502f";

/**
 * Draw a REAL on-chain random word from the RandomnessCoordinator's `fast` tier
 * (a single tx + a `FastRandom` event). This seeds the authoritative deck shuffle
 * — no Math.random ever touches the deal order.
 */
export async function randomShuffleWord(e: UnoEngine): Promise<{ word: bigint; txHash: Hex }> {
  const hash = await e.relayerWallet.writeContract({
    address: deployment.randomness,
    abi: RANDOMNESS_ABI,
    functionName: "fastRandom",
    args: [],
    account: e.relayer,
    chain: mantleSepoliaTestnet,
  });
  const receipt = await e.publicClient.waitForTransactionReceipt({ hash });
  const log = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === deployment.randomness.toLowerCase() &&
      l.topics[0]?.toLowerCase() === FAST_RANDOM_TOPIC,
  );
  if (!log) throw new Error("RandomnessCoordinator.fastRandom emitted no FastRandom event");
  // The random word is the (single) non-indexed data field.
  return { word: BigInt(log.data), txHash: hash };
}

export async function dealHand(e: UnoEngine, roomId: bigint, player: Address, count: number): Promise<Hex> {
  const hash = await e.relayerWallet.writeContract({
    address: deployment.unoGame,
    abi: UNO_ABI,
    functionName: "dealHand",
    args: [roomId, player, count],
    account: e.relayer,
    chain: mantleSepoliaTestnet,
  });
  await e.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function openPot(e: UnoEngine, roomId: bigint): Promise<Hex> {
  const hash = await e.relayerWallet.writeContract({
    address: deployment.pot,
    abi: POT_ABI,
    functionName: "openPot",
    args: [roomId],
    account: e.relayer,
    chain: mantleSepoliaTestnet,
  });
  await e.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function creditDeposit(e: UnoEngine, roomId: bigint, player: Address, amount: string): Promise<Hex> {
  const hash = await e.relayerWallet.writeContract({
    address: deployment.pot,
    abi: POT_ABI,
    functionName: "creditDeposit",
    args: [roomId, player, usdcToWei(amount)],
    account: e.relayer,
    chain: mantleSepoliaTestnet,
  });
  await e.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function settlePot(e: UnoEngine, roomId: bigint, winner: Address): Promise<Hex> {
  const hash = await e.relayerWallet.writeContract({
    address: deployment.pot,
    abi: POT_ABI,
    functionName: "settle",
    args: [roomId, winner],
    account: e.relayer,
    chain: mantleSepoliaTestnet,
  });
  await e.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function getCurrentTurn(e: UnoEngine, roomId: bigint): Promise<Address> {
  return (await e.publicClient.readContract({
    address: deployment.turnManager,
    abi: TURN_MANAGER_ABI,
    functionName: "getCurrent",
    args: [roomId],
  })) as Address;
}

export async function getHandCount(e: UnoEngine, roomId: bigint, player: Address): Promise<number> {
  return Number(
    await e.publicClient.readContract({ address: deployment.unoGame, abi: UNO_ABI, functionName: "handOf", args: [roomId, player] }),
  );
}

export async function getWinner(e: UnoEngine, roomId: bigint): Promise<Address | undefined> {
  const w = (await e.publicClient.readContract({ address: deployment.unoGame, abi: UNO_ABI, functionName: "winnerOf", args: [roomId] })) as Address;
  return w === "0x0000000000000000000000000000000000000000" ? undefined : w;
}

/** Wait for the TurnManager's getCurrent to reflect `expected` (read-after-write lag). */
export async function waitForTurn(e: UnoEngine, roomId: bigint, expected: Address, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const cur = await getCurrentTurn(e, roomId);
    if (cur.toLowerCase() === expected.toLowerCase()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * SERVER-ONLY redemption of an ERC-7715 grant — the sip402 createDirectRedeemSettler
 * pattern, adapted for Nexus Monopoly's buy-in charge.
 *
 * NEVER import this from a client component — it uses the relayer key (lib/config.ts).
 *
 * When an ERC-7715 / MetaMask player buys in, their spend authorization is the
 * granted permission `context` (player smart account → our relayer), captured via
 * MetaMask's native popup (see lib/erc7715.ts). This module redeems THAT context
 * through the CANONICAL MetaMask DelegationManager to execute a real USDC transfer
 * from the player's smart account to the Pot:
 *
 *   contracts.DelegationManager.encode.redeemDelegations({
 *     delegations: [context],
 *     modes:       [ExecutionMode.SingleDefault],
 *     executions:  [[createExecution({ target: USDC, value: 0n,
 *                     callData: transfer(pot, feeAtoms) })]],
 *   })
 *   → relayer EOA sendTransaction({ to: env.DelegationManager, data }) → wait receipt.
 *
 * This REPLACES, for the ERC-7715 player, the custom budget-delegation buy-in charge
 * in lib/engine.ts (chargeFromPlayer). The funds come from the grant's `from` (the
 * player's MetaMask smart account), settled by the canonical manager; the on-chain
 * ERC20PeriodTransferEnforcer bounds the spend to the granted cap.
 *
 * `getSmartAccountsEnvironment(84532)` resolves the canonical Base Sepolia manager:
 *   DelegationManager = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
 */
import type { Address, Hex } from "@nexus/types";
import {
  http,
  type Chain,
  type PublicClient,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  contracts,
  createExecution,
  ExecutionMode,
  getSmartAccountsEnvironment,
  type Delegation,
} from "@metamask/smart-accounts-kit";
import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_RPC_URL, RELAYER_PRIVATE_KEY } from "./config";
import { deployment } from "./deployment";

const baseSepolia = {
  id: BASE_SEPOLIA_CHAIN_ID,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [BASE_SEPOLIA_RPC_URL] } },
} as const satisfies Chain;

/** The canonical MetaMask Smart Accounts environment for Base Sepolia. */
const ENV = getSmartAccountsEnvironment(BASE_SEPOLIA_CHAIN_ID);

/** The canonical DelegationManager every granted ERC-7715 context redeems through. */
export const CANONICAL_DELEGATION_MANAGER = ENV.DelegationManager as Address;

let cached:
  | {
      publicClient: PublicClient;
      walletClient: ReturnType<typeof createWalletClient>;
      relayer: ReturnType<typeof privateKeyToAccount>;
    }
  | null = null;

function clients() {
  if (cached) return cached;
  const relayer = privateKeyToAccount(RELAYER_PRIVATE_KEY);
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC_URL),
  }) as PublicClient;
  const walletClient = createWalletClient({
    account: relayer,
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC_URL),
  });
  cached = { publicClient, walletClient, relayer };
  return cached;
}

export interface Erc7715GrantContext {
  /** The signed permission context (player smart account → relayer). */
  context: Hex;
  /** The granting MetaMask smart account (funds source). */
  from: Address;
}

/**
 * Redeem a granted ERC-7715 permission context to charge `feeUsd` USDC from the
 * player's MetaMask smart account into the Pot, via the canonical DelegationManager.
 *
 * Returns the on-chain tx hash. Throws if the redemption reverts (e.g. the spend
 * exceeds the granted period cap, or the smart account is unfunded).
 */
export async function chargeViaGrant(
  grant: Erc7715GrantContext,
  pot: Address,
  feeUsd: string,
): Promise<{ txHash: Hex; blockNumber: bigint }> {
  const { publicClient, walletClient, relayer } = clients();
  const feeAtoms = parseUnits(feeUsd, 6);

  // The USDC transfer execution: transfer(pot, feeAtoms) from the player's smart account.
  const execution = createExecution({
    target: deployment.usdc,
    value: 0n,
    callData: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [pot, feeAtoms],
    }),
  });

  // Encode redeemDelegations against the granted permission context. `delegations`
  // is PermissionContext[]; each entry IS the full signed chain (the granted Hex
  // blob). Do NOT double-nest it.
  const data = contracts.DelegationManager.encode.redeemDelegations({
    delegations: [grant.context as Hex | Delegation[]],
    modes: [ExecutionMode.SingleDefault],
    executions: [[execution]],
  });

  // Plain EOA tx to the CANONICAL DelegationManager (relayer pays gas; no bundler on testnet).
  const txHash = (await walletClient.sendTransaction({
    account: relayer,
    chain: baseSepolia,
    to: CANONICAL_DELEGATION_MANAGER,
    data,
  })) as Hex;

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`ERC-7715 grant redemption reverted (tx ${txHash})`);
  }
  return { txHash, blockNumber: receipt.blockNumber };
}

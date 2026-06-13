/**
 * The Nexus zero-mock integration suite, parameterized by target chain. The same
 * code runs against a local anvil chain (no funding needed) and against Base
 * Sepolia / Base mainnet (needs a funded relayer key). Everything here is real:
 * real contracts deployed on the target, real EIP-712 signatures, real on-chain
 * caveat enforcement. No mocks.
 */
import {
  type DeploymentAddresses,
  type GameDelegationConfig,
  buildGameplayCaveats,
  buildMoveExecution,
  buildRedeemCalldata,
  encodePermissionContext,
  signDelegation,
} from "@nexus/core";
import { DirectRelayer } from "@nexus/relayer";
import type { Address, Hex } from "@nexus/types";
import {
  type Chain,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseEventLogs,
  toFunctionSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type DeployedNexus, deployNexus } from "../lib/deploy.js";
import { assert, log } from "../lib/log.js";

export interface IntegrationTarget {
  label: string;
  chain: Chain;
  rpcUrl: string;
  chainId: number;
  /** Funded account — deploys, pays gas, redeems on the player's behalf. */
  relayer: { key: Hex; address: Address };
  /** The player — signs ONE delegation, never pays gas, needs no funding. */
  player: { key: Hex; address: Address };
  /** A second seat so the turn rotates after the first move. */
  player2Address: Address;
}

const COUNTER_ABI = [
  {
    type: "function",
    name: "increment",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "target", type: "uint256" },
    ],
    outputs: [{ name: "winner", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "CounterGame_Moved",
    inputs: [
      { name: "roomId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

const TARGET_VALUE = 100n;

function configFor(systemId: Hex, expiresAt: number, turnBound = true): GameDelegationConfig {
  return {
    gameplay: { allowedSystems: [systemId], turnBound, expiresAt, maxActions: 100 },
    budget: { token: "USDC", totalCap: "0", perActionCap: "0", allowedRecipients: [] },
  };
}

/** Run the full suite against a target. Returns the number of failed assertions. */
export async function runIntegration(t: IntegrationTarget): Promise<number> {
  log.title(`Nexus LIVE integration — ${t.label} (zero mocks)`);
  let failures = 0;

  const pub = createPublicClient({ chain: t.chain, transport: http(t.rpcUrl) });

  log.step("Deploying World + DelegationManager + game + enforcers on-chain…");
  const d: DeployedNexus = deployNexus({
    rpcUrl: t.rpcUrl,
    deployerKey: t.relayer.key,
    player: t.player.address,
    player2: t.player2Address,
    roomId: 1n,
    chainId: t.chainId,
  });
  log.ok(`World ${d.world}`);
  log.ok(`DelegationManager ${d.delegationManager}`);

  const addrs: DeploymentAddresses = d;
  const player = privateKeyToAccount(t.player.key);
  const relayerWallet = createWalletClient({
    account: privateKeyToAccount(t.relayer.key),
    chain: t.chain,
    transport: http(t.rpcUrl),
  });
  const relayer = new DirectRelayer({ wallet: relayerWallet, publicClient: pub, usdc: addrs.usdc });

  const future = Date.now() + 3 * 3600_000;
  const innerMove = encodeFunctionData({
    abi: COUNTER_ABI,
    functionName: "increment",
    args: [d.roomId, TARGET_VALUE],
  });

  async function redeemMove(cfg: GameDelegationConfig, salt = 0n) {
    const caveats = buildGameplayCaveats(cfg, addrs, d.roomId);
    const signed = await signDelegation(player, {
      chainId: t.chainId,
      delegationManager: addrs.delegationManager,
      delegate: t.relayer.address,
      caveats,
      salt,
    });
    const ctx = encodePermissionContext(signed);
    const exec = buildMoveExecution(addrs, d.counterGameSystemId, innerMove);
    const data = buildRedeemCalldata(ctx, exec);
    const handle = await relayer.submitBundle({
      encodedTxns: [{ to: addrs.delegationManager, data }],
    });
    return pub.waitForTransactionReceipt({ hash: handle.txHash! });
  }

  // TEST 1 — one signature, gasless move
  log.step("TEST 1 — one signature, gasless move redeemed by relayer");
  {
    const before = await pub.getBalance({ address: player.address });
    const receipt = await redeemMove(configFor(d.counterGameSystemId, future));
    const after = await pub.getBalance({ address: player.address });
    const moved = parseEventLogs({ abi: COUNTER_ABI, eventName: "CounterGame_Moved", logs: receipt.logs });
    assert(moved.length === 1, "expected one CounterGame_Moved event");
    assert(
      moved[0]!.args.player.toLowerCase() === player.address.toLowerCase(),
      `move attributed to ${moved[0]!.args.player}, expected ${player.address}`,
    );
    assert(moved[0]!.args.value === 1n, "counter should be 1 after first move");
    assert(before === after, "player paid ZERO gas (gasless)");
    log.ok("move landed: counter=1, _msgSender=player, player gas spent=0 (relayer paid)");
  }

  async function expectRevert(name: string, cfg: GameDelegationConfig, errorSig: string, salt: bigint) {
    const selector = toFunctionSelector(errorSig);
    try {
      await redeemMove(cfg, salt);
      log.fail(`${name}: expected revert ${errorSig} but redemption succeeded`);
      failures++;
    } catch (e) {
      const blob = JSON.stringify(e instanceof Error ? { m: e.message, c: String(e.cause) } : e);
      if (blob.includes(selector)) log.ok(`${name}: rejected on-chain with ${errorSig} (${selector})`);
      else {
        log.fail(`${name}: reverted but not with ${errorSig} (${selector}). Got: ${blob.slice(0, 160)}`);
        failures++;
      }
    }
  }

  log.step("TEST 2 — SystemAllowlistEnforcer rejects a non-allowed system");
  await expectRevert("SystemAllowlist", configFor(`0x${"ab".repeat(32)}` as Hex, future), "SystemNotAllowed()", 2n);

  log.step("TEST 3 — TimestampEnforcer rejects an expired delegation");
  await expectRevert("Timestamp", configFor(d.counterGameSystemId, Date.now() - 3600_000, false), "DelegationExpired()", 3n);

  log.step("TEST 4 — TurnBoundEnforcer rejects a move out of turn");
  await expectRevert("TurnBound", configFor(d.counterGameSystemId, future), "NotYourTurn()", 4n);

  log.title(failures === 0 ? `${t.label}: ALL LIVE TESTS PASSED` : `${t.label}: ${failures} FAILED`);
  return failures;
}

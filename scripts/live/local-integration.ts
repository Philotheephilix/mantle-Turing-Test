/**
 * LIVE integration test on a local anvil chain (real EVM, real contracts, real
 * EIP-712 signatures, real caveat enforcers — ZERO mocks; only the chain is
 * local). The identical code path runs against Base Sepolia once the funded key
 * is set (see live/run-all.ts). Proves the headline thesis:
 *
 *   a player signs ONE delegation, then the relayer redeems gasless moves on
 *   their behalf, and the on-chain enforcers reject illegal / wrong-turn /
 *   expired / out-of-scope redemptions.
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
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseEventLogs,
  toFunctionSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ANVIL_ACCOUNTS, ANVIL_CHAIN_ID, ANVIL_RPC, startAnvil } from "../lib/anvil.js";
import { type DeployedNexus, deployNexus } from "../lib/deploy.js";
import { assert, log } from "../lib/log.js";

const localChain = {
  id: ANVIL_CHAIN_ID,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
} as const;

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

const TARGET = 100n;

function configFor(systemId: Hex, expiresAt: number, turnBound = true): GameDelegationConfig {
  return {
    gameplay: { allowedSystems: [systemId], turnBound, expiresAt, maxActions: 100 },
    budget: { token: "USDC", totalCap: "0", perActionCap: "0", allowedRecipients: [] },
  };
}

async function main() {
  log.title("Nexus LIVE integration (local anvil — zero mocks)");
  const { stop } = await startAnvil();
  let failures = 0;

  try {
    const pub = createPublicClient({ chain: localChain, transport: http(ANVIL_RPC) });

    // ── deploy the full stack on the real (local) chain ──
    log.step("Deploying World + DelegationManager + game + enforcers…");
    const d: DeployedNexus = deployNexus({
      rpcUrl: ANVIL_RPC,
      deployerKey: ANVIL_ACCOUNTS.deployer.key as Hex,
      player: ANVIL_ACCOUNTS.player.address as Address,
      player2: ANVIL_ACCOUNTS.player2.address as Address,
      roomId: 1n,
      chainId: ANVIL_CHAIN_ID,
    });
    log.ok(`World ${d.world}`);
    log.ok(`DelegationManager ${d.delegationManager}`);

    const addrs: DeploymentAddresses = d;
    const player = privateKeyToAccount(ANVIL_ACCOUNTS.player.key as Hex);
    const relayerWallet = createWalletClient({
      account: privateKeyToAccount(ANVIL_ACCOUNTS.deployer.key as Hex),
      chain: localChain,
      transport: http(ANVIL_RPC),
    });
    const relayer = new DirectRelayer({ wallet: relayerWallet, publicClient: pub, usdc: addrs.usdc });

    const future = Date.now() + 3 * 3600_000;
    const innerMove = encodeFunctionData({
      abi: COUNTER_ABI,
      functionName: "increment",
      args: [d.roomId, TARGET],
    });

    // helper: sign a delegation + redeem a move, returns the receipt
    async function redeemMove(cfg: GameDelegationConfig, salt = 0n) {
      const caveats = buildGameplayCaveats(cfg, addrs, d.roomId);
      const signed = await signDelegation(player, {
        chainId: ANVIL_CHAIN_ID,
        delegationManager: addrs.delegationManager,
        delegate: ANVIL_ACCOUNTS.deployer.address as Address, // the relayer redeems
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

    // ── TEST 1: one signature → gasless move (happy path) ──
    log.step("TEST 1 — one signature, gasless move redeemed by relayer");
    {
      const before = await pub.getBalance({ address: player.address });
      const receipt = await redeemMove(configFor(d.counterGameSystemId, future));
      const after = await pub.getBalance({ address: player.address });
      const moved = parseEventLogs({ abi: COUNTER_ABI, eventName: "CounterGame_Moved", logs: receipt.logs });
      assert(moved.length === 1, "expected one CounterGame_Moved event");
      assert(
        moved[0]!.args.player.toLowerCase() === player.address.toLowerCase(),
        `move attributed to ${moved[0]!.args.player}, expected player ${player.address}`,
      );
      assert(moved[0]!.args.value === 1n, "counter should be 1 after first move");
      assert(before === after, "player paid ZERO gas (gasless) — balance unchanged");
      log.ok(`move landed: counter=1, _msgSender=player, player gas spent=0 (relayer paid)`);
    }

    // helper: expect a redemption to revert with a specific custom error selector
    async function expectRevert(name: string, cfg: GameDelegationConfig, errorSig: string, salt = 1n) {
      const selector = toFunctionSelector(errorSig);
      try {
        await redeemMove(cfg, salt);
        log.fail(`${name}: expected revert ${errorSig} but redemption succeeded`);
        failures++;
      } catch (e) {
        const blob = JSON.stringify(e instanceof Error ? { m: e.message, c: String(e.cause) } : e);
        if (blob.includes(selector)) {
          log.ok(`${name}: rejected on-chain with ${errorSig} (${selector})`);
        } else {
          log.fail(`${name}: reverted, but not with ${errorSig} (${selector}). Got: ${blob.slice(0, 200)}`);
          failures++;
        }
      }
    }

    // ── TEST 2: SystemAllowlistEnforcer rejects an out-of-scope system ──
    log.step("TEST 2 — SystemAllowlistEnforcer rejects a non-allowed system");
    {
      const wrong = configFor(("0x" + "ab".repeat(32)) as Hex, future); // allow a different system
      await expectRevert("SystemAllowlist", wrong, "SystemNotAllowed()", 2n);
    }

    // ── TEST 3: TimestampEnforcer rejects an expired delegation ──
    // turnBound:false so the expiry caveat is the one under test (the player is
    // no longer the current turn after TEST 1's rotation).
    log.step("TEST 3 — TimestampEnforcer rejects an expired delegation");
    {
      const expired = configFor(d.counterGameSystemId, Date.now() - 3600_000, false);
      await expectRevert("Timestamp", expired, "DelegationExpired()", 3n);
    }

    // ── TEST 4: TurnBoundEnforcer rejects a move out of turn ──
    // After TEST 1 the turn rotated to player2, so player is no longer current.
    log.step("TEST 4 — TurnBoundEnforcer rejects a move when it is not the player's turn");
    {
      await expectRevert("TurnBound", configFor(d.counterGameSystemId, future), "NotYourTurn()", 4n);
    }

    log.title(failures === 0 ? "ALL LIVE TESTS PASSED" : `${failures} LIVE TEST(S) FAILED`);
  } finally {
    stop();
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  log.fail(e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});

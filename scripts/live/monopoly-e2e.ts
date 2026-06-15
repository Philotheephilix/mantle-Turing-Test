/**
 * REAL end-to-end Monopoly move on Mantle Sepolia (zero mocks).
 *
 * Reads the live Monopoly deployment (packages/contracts/deployments/5003.json
 * written by DeployMonopoly), has the seated player sign ONE gameplay delegation,
 * then the relayer redeems a gasless `rollAndMove` through NexusDelegationManager.
 * Asserts the on-chain `Monopoly_Rolled` event fired for the player, proving the
 * recovered MonopolyGameSystem (with on-chain dice) works end-to-end.
 *
 * Run: pnpm --filter @nexus/scripts exec tsx live/monopoly-e2e.ts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type DeploymentAddresses,
  type GameDelegationConfig,
  buildGameplayCaveats,
  buildMoveExecution,
  buildRedeemCalldata,
  encodePermissionContext,
  signDelegation,
} from "@nexus/core";
import type { Hex } from "@nexus/types";
import {
  http,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mantleSepoliaTestnet } from "viem/chains";
import { log } from "../lib/log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS = resolve(__dirname, "..", "..", "packages", "contracts");

const RPC = process.env.MANTLE_SEPOLIA_RPC_URL ?? "https://rpc.sepolia.mantle.xyz";
const RELAYER_KEY = (process.env.PRIVATE_KEY ??
  "0x18842c41d9c77a305c3e4c88d75d22c085d60a3e5e2452f5444633167a6dbaae") as Hex;
const PLAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;

const MONO_ABI = parseAbi([
  "function rollAndMove(uint256 roomId) returns (uint8 die1, uint8 die2, uint256 newPos)",
  "event Monopoly_Rolled(uint256 indexed roomId, address indexed player, uint8 die1, uint8 die2, uint256 fromPos, uint256 newPos, bool passedGo)",
]);

async function main() {
  log.title("Monopoly live e2e — Mantle Sepolia (real tx)");

  const j = JSON.parse(readFileSync(resolve(CONTRACTS, "deployments", "5003.json"), "utf8"));
  if (!j.monopolyGame || j.monopolyGame === "0x0000000000000000000000000000000000000000") {
    throw new Error("deployments/5003.json has no monopolyGame — run DeployMonopoly first");
  }
  const addrs: DeploymentAddresses = {
    world: j.world,
    delegationManager: j.delegationManager,
    turnManager: j.turnManager,
    usdc: j.usdc,
    enforcers: { ...j.enforcers },
  };
  const systemId = j.monopolyGameSystemId as Hex;
  const roomId = BigInt(j.roomId);

  const player = privateKeyToAccount(PLAYER_KEY);
  const relayer = privateKeyToAccount(RELAYER_KEY);
  const pub = createPublicClient({ chain: mantleSepoliaTestnet, transport: http(RPC) });
  const wallet = createWalletClient({
    account: relayer,
    chain: mantleSepoliaTestnet,
    transport: http(RPC),
  });

  log.step(`World ${addrs.world}`);
  log.step(`MonopolyGame ${j.monopolyGame} (system ${systemId.slice(0, 12)}…)`);
  log.step(`Player (signer, gasless) ${player.address}`);

  const cfg: GameDelegationConfig = {
    gameplay: {
      allowedSystems: [systemId],
      turnBound: true,
      expiresAt: Date.now() + 3_600_000,
      maxActions: 100,
    },
    budget: { token: "USDC", totalCap: "0", perActionCap: "0", allowedRecipients: [] },
  };
  const caveats = buildGameplayCaveats(cfg, addrs, roomId);
  const signed = await signDelegation(player, {
    chainId: 5003,
    delegationManager: addrs.delegationManager,
    delegate: relayer.address,
    caveats,
    maxRedemptions: 10n,
  });
  const ctx = encodePermissionContext(signed);
  log.ok("player signed one gameplay delegation");

  const balBefore = await pub.getBalance({ address: player.address });
  const move = encodeFunctionData({ abi: MONO_ABI, functionName: "rollAndMove", args: [roomId] });
  const exec = buildMoveExecution(addrs, systemId, move);
  const data = buildRedeemCalldata(ctx, exec);

  log.step("relayer redeems the gasless rollAndMove…");
  const hash = await wallet.sendTransaction({ to: addrs.delegationManager, data });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`redemption reverted: ${hash}`);

  let rolled: { player: string; die1: number; die2: number; newPos: bigint } | null = null;
  for (const lg of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: MONO_ABI, data: lg.data, topics: lg.topics });
      if (d.eventName === "Monopoly_Rolled") {
        const a = d.args as unknown as {
          player: string;
          die1: number;
          die2: number;
          newPos: bigint;
        };
        rolled = { player: a.player, die1: a.die1, die2: a.die2, newPos: a.newPos };
      }
    } catch {
      /* not our event */
    }
  }
  if (!rolled) throw new Error("no Monopoly_Rolled event in receipt");
  if (rolled.player.toLowerCase() !== player.address.toLowerCase()) {
    throw new Error(`_msgSender wrong: ${rolled.player} != ${player.address}`);
  }
  if (rolled.die1 < 1 || rolled.die1 > 6 || rolled.die2 < 1 || rolled.die2 > 6) {
    throw new Error(`dice out of range: ${rolled.die1},${rolled.die2}`);
  }
  const balAfter = await pub.getBalance({ address: player.address });
  if (balAfter !== balBefore) throw new Error("player spent gas — not gasless");

  log.ok(
    `rollAndMove landed: Monopoly_Rolled(player=${player.address.slice(0, 8)}…, dice ${rolled.die1}+${rolled.die2}, pos→${rolled.newPos}), player spent 0 gas — tx ${hash}`,
  );
  log.title("Monopoly live e2e — PASSED on Mantle Sepolia");
}

main().catch((e) => {
  log.fail(String(e?.message ?? e));
  process.exit(1);
});

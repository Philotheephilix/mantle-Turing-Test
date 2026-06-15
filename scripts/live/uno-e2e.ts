/**
 * REAL end-to-end UNO move on Mantle Sepolia (zero mocks).
 *
 * Reads the live UNO deployment (packages/contracts/deployments/5003.json written
 * by DeployUno), has the seated player sign ONE gameplay delegation, then the
 * relayer redeems a gasless `playCard` move through NexusDelegationManager. Asserts
 * the on-chain `Uno_Played` event fired with the correct player + board, proving
 * the recovered UnoGameSystem works end-to-end with the delegation flow.
 *
 * Run: pnpm --filter @nexus/scripts exec tsx live/uno-e2e.ts
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
// Funded relayer (pays gas, redeems). Same demo testnet key the repo uses.
const RELAYER_KEY = (process.env.PRIVATE_KEY ??
  "0x18842c41d9c77a305c3e4c88d75d22c085d60a3e5e2452f5444633167a6dbaae") as Hex;
// The seated player (anvil #1): signs ONE delegation, never funded, spends 0 gas.
const PLAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;

const UNO_ABI = parseAbi([
  "function playCard(uint256 roomId, uint8 color, uint8 value, uint8 activeColor, uint8 newHandCount, uint8 advanceBy) returns (address)",
  "event Uno_Played(uint256 indexed roomId, address indexed player, uint8 color, uint8 value, uint8 activeColor, uint8 newHandCount)",
]);

async function main() {
  log.title("UNO live e2e — Mantle Sepolia (real tx)");

  const j = JSON.parse(readFileSync(resolve(CONTRACTS, "deployments", "5003.json"), "utf8"));
  if (!j.unoGame || j.unoGame === "0x0000000000000000000000000000000000000000") {
    throw new Error("deployments/5003.json has no unoGame — run DeployUno first");
  }
  const addrs: DeploymentAddresses = {
    world: j.world,
    delegationManager: j.delegationManager,
    turnManager: j.turnManager,
    usdc: j.usdc,
    enforcers: { ...j.enforcers },
  };
  const unoGameSystemId = j.unoGameSystemId as Hex;
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
  log.step(`UnoGame ${j.unoGame} (system ${unoGameSystemId.slice(0, 12)}…)`);
  log.step(`Player (signer, gasless) ${player.address}`);
  log.step(`Relayer (pays gas)        ${relayer.address}`);

  // 1) player signs ONE gameplay delegation (turn-bound, system-allowlisted).
  const cfg: GameDelegationConfig = {
    gameplay: {
      allowedSystems: [unoGameSystemId],
      turnBound: true,
      expiresAt: Date.now() + 3_600_000, // epoch ms; TimestampEnforcer converts to s
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

  // 2) build a real playCard move. Board seeded (red=1, 5, hand 7) by DeployUno;
  //    play red(1) 7, keep active color red, hand 7 -> 6, advance 1 seat.
  const balBefore = await pub.getBalance({ address: player.address });
  const move = encodeFunctionData({
    abi: UNO_ABI,
    functionName: "playCard",
    args: [roomId, 1, 7, 1, 6, 1],
  });
  const exec = buildMoveExecution(addrs, unoGameSystemId, move);
  const data = buildRedeemCalldata(ctx, exec);

  // 3) relayer redeems — gasless for the player.
  log.step("relayer redeems the gasless playCard move…");
  const hash = await wallet.sendTransaction({ to: addrs.delegationManager, data });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`redemption reverted: ${hash}`);

  // 4) verify the on-chain Uno_Played event.
  let played: {
    roomId: bigint;
    player: string;
    color: number;
    value: number;
    handCount: number;
  } | null = null;
  for (const lg of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: UNO_ABI, data: lg.data, topics: lg.topics });
      if (d.eventName === "Uno_Played") {
        const a = d.args as unknown as {
          roomId: bigint;
          player: string;
          color: number;
          value: number;
          activeColor: number;
          newHandCount: number;
        };
        played = {
          roomId: a.roomId,
          player: a.player,
          color: a.color,
          value: a.value,
          handCount: a.newHandCount,
        };
      }
    } catch {
      /* not our event */
    }
  }
  if (!played) throw new Error("no Uno_Played event in receipt");
  if (played.player.toLowerCase() !== player.address.toLowerCase()) {
    throw new Error(`_msgSender wrong: ${played.player} != ${player.address}`);
  }
  if (played.color !== 1 || played.value !== 7 || played.handCount !== 6) {
    throw new Error(`board mismatch: ${JSON.stringify(played)}`);
  }
  const balAfter = await pub.getBalance({ address: player.address });
  if (balAfter !== balBefore) throw new Error("player spent gas — not gasless");

  log.ok(
    `playCard landed: Uno_Played(player=${player.address.slice(0, 8)}…, red 7, hand 6), player spent 0 gas — tx ${hash}`,
  );
  log.title("UNO live e2e — PASSED on Mantle Sepolia");
}

main().catch((e) => {
  log.fail(String(e?.message ?? e));
  process.exit(1);
});

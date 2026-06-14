/**
 * Generate + fund the UNO player keys (1 human + N bots), SEQUENTIALLY (await
 * each relayer tx receipt before the next, so the relayer's nonces never collide).
 *
 * For each player the relayer sends, in order:
 *   1. a small ETH top-up  (so the player can send its ONE approve() tx itself)
 *   2. a small USDC top-up (so the entry-fee x402 charge has funds to move)
 * Then each player sends its own approve(manager) so the relayer can redeem the
 * budget delegation's transferFrom on its behalf.
 *
 * Writes examples/uno/players.local.json (gitignored): the human + bot keys, used
 * by scripts/bots.ts and tests/uno.spec.ts (which injects the human key into the
 * browser's localStorage guest wallet).
 *
 *   pnpm --filter @nexus/example-uno fund-players          # default 2 bots
 *   BOT_COUNT=3 USDC_EACH=0.5 ETH_EACH=0.0008 pnpm ... fund-players
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { http, createPublicClient, createWalletClient, formatEther, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "@nexus/types";
import { BASE_SEPOLIA_RPC_URL, RELAYER_PRIVATE_KEY } from "../lib/config";
import { deployment } from "../lib/deployment";
import { baseSepolia, USDC_ABI } from "../lib/engine";
import { usdcToWei } from "@nexus/core";

const BOT_COUNT = Number(process.env.BOT_COUNT ?? 2);
const USDC_EACH = process.env.USDC_EACH ?? "0.5";
const ETH_EACH = process.env.ETH_EACH ?? "0.0009";
const OUT = join(import.meta.dirname, "..", "players.local.json");

interface PlayerKey {
  role: "human" | "bot";
  index: number;
  privateKey: Hex;
  address: `0x${string}`;
}

async function main() {
  const relayer = privateKeyToAccount(RELAYER_PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC_URL) });
  const relayerWallet = createWalletClient({ account: relayer, chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC_URL) });

  // Reuse existing keys (idempotent top-up) unless FRESH=1 or the file is missing.
  let players: PlayerKey[];
  if (existsSync(OUT) && process.env.FRESH !== "1") {
    players = (JSON.parse(readFileSync(OUT, "utf8")) as { players: PlayerKey[] }).players;
    console.log(`reusing ${players.length} existing player key(s) from players.local.json`);
  } else {
    players = [];
    const humanKey = generatePrivateKey();
    players.push({ role: "human", index: 0, privateKey: humanKey, address: privateKeyToAccount(humanKey).address });
    for (let i = 0; i < BOT_COUNT; i++) {
      const k = generatePrivateKey();
      players.push({ role: "bot", index: i, privateKey: k, address: privateKeyToAccount(k).address });
    }
  }

  console.log(`relayer ${relayer.address}`);
  const relEth = await publicClient.getBalance({ address: relayer.address });
  console.log(`relayer ETH ${formatEther(relEth)}`);

  // Fund each player SEQUENTIALLY (await receipts → no relayer nonce collisions).
  for (const p of players) {
    console.log(`\n[fund] ${p.role}#${p.index} ${p.address}`);

    // 1) ETH top-up (for the player's own approve tx).
    const haveEth = await publicClient.getBalance({ address: p.address });
    if (haveEth < parseEther(ETH_EACH)) {
      const ethHash = await relayerWallet.sendTransaction({
        account: relayer,
        chain: baseSepolia,
        to: p.address,
        value: parseEther(ETH_EACH),
      });
      await publicClient.waitForTransactionReceipt({ hash: ethHash });
      console.log(`  ETH +${ETH_EACH} tx ${ethHash}`);
    } else {
      console.log(`  ETH ok (${formatEther(haveEth)})`);
    }

    // 2) USDC top-up.
    const haveUsdc = (await publicClient.readContract({
      address: deployment.usdc,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [p.address],
    })) as bigint;
    if (haveUsdc < usdcToWei(USDC_EACH)) {
      const usdcHash = await relayerWallet.writeContract({
        address: deployment.usdc,
        abi: [
          { type: "function", name: "transfer", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }], stateMutability: "nonpayable" },
        ],
        functionName: "transfer",
        args: [p.address, usdcToWei(USDC_EACH)],
        account: relayer,
        chain: baseSepolia,
      });
      await publicClient.waitForTransactionReceipt({ hash: usdcHash });
      console.log(`  USDC +${USDC_EACH} tx ${usdcHash}`);
    } else {
      console.log(`  USDC ok (${Number(haveUsdc) / 1e6})`);
    }

    // 3) Player approves the manager to spend its USDC (the player's OWN tx).
    const account = privateKeyToAccount(p.privateKey);
    const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC_URL) });
    const allowance = (await publicClient.readContract({
      address: deployment.usdc,
      abi: USDC_ABI,
      functionName: "allowance",
      args: [p.address, deployment.delegationManager],
    })) as bigint;
    if (allowance < usdcToWei(USDC_EACH)) {
      const apHash = await wallet.writeContract({
        address: deployment.usdc,
        abi: USDC_ABI,
        functionName: "approve",
        args: [deployment.delegationManager, usdcToWei("1000")],
        account,
        chain: baseSepolia,
      });
      await publicClient.waitForTransactionReceipt({ hash: apHash });
      console.log(`  approve(manager) tx ${apHash}`);
    } else {
      console.log(`  approve ok`);
    }
  }

  writeFileSync(OUT, JSON.stringify({ players }, null, 2));
  console.log(`\nWrote ${OUT}`);
  console.log("Human:", players[0].address);
  console.log("Bots:", players.filter((p) => p.role === "bot").map((p) => p.address).join(", "));
}

main().catch((e) => {
  console.error("[fund-players] fatal:", e);
  process.exit(1);
});

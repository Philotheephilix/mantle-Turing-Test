export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { MANTLE_SEPOLIA_RPC_URL, RELAYER_PRIVATE_KEY } from "@/lib/monopoly/config";
import { deployment } from "@/lib/monopoly/deployment";
import { jsonResponse } from "@/lib/monopoly/json-response";
import type { Address, Hex } from "@steamlink/types";
import { http, createPublicClient, createWalletClient, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mantleSepoliaTestnet } from "viem/chains";

/**
 * Test faucet — funds the connected player's wallet so they can play Monopoly.
 * The relayer (server-only, funded) mints TestUSDC to the player (the deployed
 * TestUSDC.mint is permissionless) and tops up a little MNT for the one-time
 * approve gas. Always returns JSON, even on error.
 */
const TEST_USDC_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const USDC_GRANT = "5";
const MNT_GRANT = "0.05";
const MNT_THRESHOLD = parseEther("0.02");

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { player?: Address };
    const player = body.player;
    if (!player || !/^0x[0-9a-fA-F]{40}$/.test(player)) {
      return jsonResponse({ ok: false, error: "valid `player` address required" }, 400);
    }

    const usdcAddress = deployment.usdc as Address;
    const relayer = privateKeyToAccount(RELAYER_PRIVATE_KEY);
    const pub = createPublicClient({
      chain: mantleSepoliaTestnet,
      transport: http(MANTLE_SEPOLIA_RPC_URL),
    });
    const wallet = createWalletClient({
      account: relayer,
      chain: mantleSepoliaTestnet,
      transport: http(MANTLE_SEPOLIA_RPC_URL),
    });

    let nonce = await pub.getTransactionCount({ address: relayer.address, blockTag: "pending" });

    const usdcTx = (await wallet.writeContract({
      address: usdcAddress,
      abi: TEST_USDC_ABI,
      functionName: "mint",
      args: [player, parseUnits(USDC_GRANT, 6)],
      nonce: nonce++,
    })) as Hex;

    let mntTx: Hex | undefined;
    const bal = await pub.getBalance({ address: player });
    if (bal < MNT_THRESHOLD) {
      mntTx = (await wallet.sendTransaction({
        account: relayer,
        chain: mantleSepoliaTestnet,
        to: player,
        value: parseEther(MNT_GRANT),
        nonce: nonce++,
      })) as Hex;
    }

    await pub.waitForTransactionReceipt({ hash: usdcTx });
    let usdc = 0n;
    for (let i = 0; i < 5; i++) {
      usdc = (await pub.readContract({
        address: usdcAddress,
        abi: TEST_USDC_ABI,
        functionName: "balanceOf",
        args: [player],
      })) as bigint;
      if (usdc >= parseUnits(USDC_GRANT, 6)) break;
      await new Promise((r) => setTimeout(r, 800));
    }

    return jsonResponse({
      ok: true,
      usdcTx,
      mntTx,
      usdc: usdc.toString(),
      usdcHuman: (Number(usdc) / 1e6).toFixed(2),
      grantedUsdc: USDC_GRANT,
      grantedMnt: mntTx ? MNT_GRANT : "0",
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

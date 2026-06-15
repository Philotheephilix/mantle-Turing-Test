export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { MANTLE_SEPOLIA_RPC_URL, RELAYER_PRIVATE_KEY, USDC_ADDRESS } from "@/lib/uno/config";
import { jsonResponse } from "@/lib/uno/json-response";
import type { Address, Hex } from "@steamlink/types";
import { http, createPublicClient, createWalletClient, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mantleSepoliaTestnet } from "viem/chains";

/**
 * Test faucet — funds the connected player's wallet so they can play. The relayer
 * (server-only, funded) does two things, paying the gas itself:
 *   1. mints TestUSDC to the player (the deployed TestUSDC.mint is permissionless),
 *   2. tops up a little MNT so the player can sign the one-time approve(manager)
 *      and any wallet tx (gameplay itself is gasless via the relayer).
 * Always returns JSON (even on error) so the client never hits "Unexpected end of
 * JSON input".
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

const USDC_GRANT = "5"; // 5 TestUSDC (6 decimals)
const MNT_GRANT = "0.05"; // gas stipend
const MNT_THRESHOLD = parseEther("0.02"); // only top up if below this

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { player?: Address };
    const player = body.player;
    if (!player || !/^0x[0-9a-fA-F]{40}$/.test(player)) {
      return jsonResponse({ ok: false, error: "valid `player` address required" }, 400);
    }

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

    // Explicit sequential nonces so the two relayer txs don't collide.
    let nonce = await pub.getTransactionCount({ address: relayer.address, blockTag: "pending" });

    const usdcTx = (await wallet.writeContract({
      address: USDC_ADDRESS as Address,
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

    // Confirm the mint landed, then report the new balance. The public RPC can lag
    // read-after-write, so poll a few times until it reflects the mint.
    await pub.waitForTransactionReceipt({ hash: usdcTx });
    let usdc = 0n;
    for (let i = 0; i < 5; i++) {
      usdc = (await pub.readContract({
        address: USDC_ADDRESS as Address,
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

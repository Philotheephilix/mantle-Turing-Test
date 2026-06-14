export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { Address, Hex } from "@steamlink/types";
import { storeGrant } from "@/lib/uno/game-backend";
import { jsonResponse } from "@/lib/uno/json-response";

/**
 * /api/grant — store a player's MetaMask ERC-7715 spend authorization.
 *
 * The client drives MetaMask's native permission popup
 * (connectMetaMaskGrant → requestExecutionPermissions) and POSTs the granted
 * `{ context, from }` here. The backend redeems that context via the canonical
 * MetaMask DelegationManager to charge the entry fee (see /api/charge with
 * `{ grant: true }`).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    player?: Address;
    context?: Hex;
    from?: Address;
    delegationManager?: Address;
    dependencies?: { factory: string; factoryData: string }[];
  };
  if (!body.player || !body.context || !body.from) {
    return jsonResponse({ ok: false, error: "player + context + from required" }, 400);
  }
  const res = storeGrant(body.player, { context: body.context, from: body.from });
  return jsonResponse(res, res.ok ? 200 : 400);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { join, joinViaGrant } from "@/lib/monopoly/game-backend";
import { jsonResponse } from "@/lib/monopoly/json-response";
import type { SignedDelegation } from "@steamlink/core";
import type { Address } from "@steamlink/types";

/**
 * /api/join — seat + pay the buy-in. Two rails:
 *   - GUEST: `{ player, signedGameplay, signedBudget }` — cache both delegations
 *     and redeem our custom budget delegation for the buy-in (the existing rail;
 *     keeps the headless e2e unchanged).
 *   - ERC-7715 / MetaMask: `{ player, signedGameplay, grant: true }` — cache the
 *     gameplay delegation and redeem the player's previously-granted ERC-7715
 *     permission context (stored via /api/grant) through the canonical MetaMask
 *     DelegationManager for the buy-in.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    player?: Address;
    signedGameplay?: SignedDelegation;
    signedBudget?: SignedDelegation;
    grant?: boolean;
  };
  if (!body.player || !body.signedGameplay) {
    return jsonResponse({ ok: false, error: "player + signedGameplay required" }, 400);
  }
  if (body.grant) {
    const res = await joinViaGrant(body.player, body.signedGameplay);
    return jsonResponse(res, res.ok ? 200 : 500);
  }
  if (!body.signedBudget) {
    return jsonResponse(
      { ok: false, error: "player + signedGameplay + signedBudget (or grant:true) required" },
      400,
    );
  }
  const res = await join(body.player, body.signedGameplay, body.signedBudget);
  return jsonResponse(res, res.ok ? 200 : 500);
}

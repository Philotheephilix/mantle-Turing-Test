export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { charge, chargeGrant } from "@/lib/uno/game-backend";
import { jsonResponse } from "@/lib/uno/json-response";
import type { SignedDelegation } from "@steamlink/core";
import type { Address } from "@steamlink/types";

/**
 * /api/charge — settle the entry fee. Two rails:
 *   - GUEST: `{ player, signedBudget }` — redeem our custom budget delegation
 *     (the existing rail; keeps the headless e2e unchanged).
 *   - ERC-7715 / MetaMask: `{ player, grant: true }` — redeem the player's
 *     previously-granted ERC-7715 permission context (stored via /api/grant)
 *     through the canonical MetaMask DelegationManager.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    player?: Address;
    signedBudget?: SignedDelegation;
    grant?: boolean;
  };
  if (!body.player) {
    return jsonResponse({ ok: false, error: "player required" }, 400);
  }
  if (body.grant) {
    const res = await chargeGrant(body.player);
    return jsonResponse(res, res.ok ? 200 : 500);
  }
  if (!body.signedBudget) {
    return jsonResponse(
      { ok: false, error: "player + signedBudget (or grant:true) required" },
      400,
    );
  }
  const res = await charge(body.player, body.signedBudget);
  return jsonResponse(res, res.ok ? 200 : 500);
}

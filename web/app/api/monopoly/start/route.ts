export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { startGameForHuman } from "@/lib/monopoly/auto-start";
import { jsonResponse } from "@/lib/monopoly/json-response";
import type { Address } from "@steamlink/types";

/**
 * Start a fresh game seated with the connected player's wallet (seat 0) + the
 * server-side bots. Called by the browser "Start a game" button when the player's
 * address isn't already seated in the auto-started demo game.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { human?: Address };
  if (!body.human || !/^0x[0-9a-fA-F]{40}$/.test(body.human)) {
    return jsonResponse({ ok: false, error: "valid `human` address required" }, 400);
  }
  try {
    const res = await startGameForHuman(body.human);
    return jsonResponse(res, res.ok ? 200 : 500);
  } catch (e) {
    // Never return an empty 500 body — the client does res.json().
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

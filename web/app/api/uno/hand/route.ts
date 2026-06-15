export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { revealHand } from "@/lib/uno/game-backend";
import { jsonResponse } from "@/lib/uno/json-response";
import type { Address } from "@steamlink/types";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { player?: Address };
  if (!body.player) return jsonResponse({ ok: false, error: "player required" }, 400);
  const res = await revealHand(body.player);
  return jsonResponse(res, res.ok ? 200 : 403);
}

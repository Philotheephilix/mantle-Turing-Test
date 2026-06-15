export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getState } from "@/lib/uno/game-backend";
import { jsonResponse } from "@/lib/uno/json-response";

export async function GET() {
  const st = getState();
  return jsonResponse(st, st.ok ? 200 : 404);
}

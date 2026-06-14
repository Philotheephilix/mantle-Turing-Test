export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { health } from "@/lib/monopoly/game-backend";
import { jsonResponse } from "@/lib/monopoly/json-response";

export async function GET() {
  return jsonResponse(health());
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { health } from "@/lib/uno/game-backend";
import { jsonResponse } from "@/lib/uno/json-response";

export async function GET() {
  return jsonResponse(health());
}

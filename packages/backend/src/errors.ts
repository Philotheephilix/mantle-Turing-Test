/**
 * Backend-local error helpers. The canonical error surface is `NexusError` from
 * `@nexus/types`; the gateway maps codes to HTTP status. We do not invent new
 * error classes — only the HTTP projection lives here.
 */
import type { NexusErrorCode } from "@nexus/types";
import { NexusError } from "@nexus/types";

/** HTTP status for a NexusError code at the gateway boundary. */
export function httpStatusForCode(code: NexusErrorCode): number {
  switch (code) {
    case "PAYMENT_REQUIRED":
      return 402;
    case "CAVEATS_INVALID":
    case "TARGET_MISMATCH":
    case "NONCE_REUSED":
      return 400;
    case "NOT_CONNECTED":
    case "WEBHOOK_UNVERIFIED":
      return 401;
    case "SYSTEM_NOT_ALLOWED":
    case "RECIPIENT_NOT_ALLOWED":
    case "NOT_YOUR_TURN":
    case "ROOM_CLOSED":
      return 403;
    case "SESSION_NOT_FOUND":
      return 404;
    case "RELAYER_FAILED":
    case "CAPABILITIES_UNAVAILABLE":
      return 502;
    default:
      return 500;
  }
}

/** Project any thrown value into a JSON error body + HTTP status. */
export function errorResponse(err: unknown): {
  status: number;
  body: { error: ReturnType<NexusError["toJSON"]> | { code: string; message: string } };
} {
  if (NexusError.is(err)) {
    return { status: httpStatusForCode(err.code), body: { error: err.toJSON() } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: { code: "INTERNAL", message } } };
}

export { NexusError };

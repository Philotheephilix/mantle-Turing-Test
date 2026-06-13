import type { Address } from "@nexus/types";

/**
 * A gateway request as middleware sees it (backend spec §2.3). Middleware runs in
 * registration order; auth runs first (binds `caller`), then user middleware
 * (rate limit, anti-cheat, metrics), then routing. Middleware also sees every
 * redemption before it reaches an adapter (the `redemption` field on charge/move).
 */
export interface GatewayRequest {
  method: string;
  path: string;
  /** Route params (e.g. `{ name }` for /game/:name). */
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  /** Bound by auth middleware once the signature is verified. */
  caller?: Address;
  /** Set for /move and /charge so middleware can inspect/abort a redemption. */
  redemption?: { kind: "move" | "charge"; roomId?: string; amount?: string };
}

export interface GatewayResponse {
  status: number;
  body: unknown;
}

export type Middleware = (
  req: GatewayRequest,
  next: () => Promise<GatewayResponse>,
) => Promise<GatewayResponse>;

/** Compose middleware into a single handler around a terminal route. */
export function composeMiddleware(
  mws: Middleware[],
  terminal: (req: GatewayRequest) => Promise<GatewayResponse>,
): (req: GatewayRequest) => Promise<GatewayResponse> {
  return (req) => {
    let i = -1;
    const dispatch = (idx: number): Promise<GatewayResponse> => {
      if (idx <= i) return Promise.reject(new Error("next() called multiple times"));
      i = idx;
      const mw = mws[idx];
      if (!mw) return terminal(req);
      return mw(req, () => dispatch(idx + 1));
    };
    return dispatch(0);
  };
}

/** A simple per-room rate-limit middleware (example; backend spec §2.3). */
export function rateLimit(opts: { perRoom: number; windowMs?: number }): Middleware {
  const windowMs = opts.windowMs ?? 1000;
  const buckets = new Map<string, { count: number; reset: number }>();
  return async (req, next) => {
    const room = req.redemption?.roomId ?? req.params.name ?? "global";
    const now = Date.now();
    const b = buckets.get(room);
    if (!b || now > b.reset) {
      buckets.set(room, { count: 1, reset: now + windowMs });
    } else if (b.count >= opts.perRoom) {
      return {
        status: 429,
        body: { error: { code: "RATE_LIMITED", message: "too many requests" } },
      };
    } else {
      b.count++;
    }
    return next();
  };
}

import { type Context, Hono } from "hono";
import type { Backend } from "../compose/createBackend.js";
import type { GatewayRequest } from "../compose/middleware.js";
import { errorResponse } from "../errors.js";
import type { Where } from "../ports/indexer.js";
import {
  routeCharge,
  routeHealthz,
  routeJoin,
  routeMove,
  routeReadyz,
  routeState,
  routeWebhook,
} from "./routes.js";

/**
 * The Hono app factory (phase-05 §4.1). Exposes EXACTLY the backend spec §4.1
 * routes — no more. The gateway is stateless; any instance serves any request.
 * Session-scoped routes run the middleware pipeline (auth runs first when an auth
 * middleware is registered) before the terminal handler.
 *
 *   POST /game/:name/join          → RoomService.joinRoom
 *   POST /game/:name/move          → move lifecycle → Relayer.submitBundle
 *   POST /game/:name/charge        → charge lifecycle → Facilitator + Relayer
 *   GET  /game/:name/state/:table  → IndexerAdapter.query
 *   WS   /game/:name/subscribe     → IndexerAdapter.subscribe push (WsHub)
 *   POST /nexus/webhook            → WebhookHandler.ingest
 *   GET  /healthz /readyz          → ops
 */
export function createGatewayApp(backend: Backend): Hono {
  const app = new Hono();

  // Run the registered middleware pipeline around a terminal handler.
  const withPipeline = async (
    c: Context,
    redemption: GatewayRequest["redemption"],
    terminal: () => Promise<{ status: number; body: unknown }>,
  ) => {
    const body = await c.req.json().catch(() => ({}));
    const req: GatewayRequest = {
      method: c.req.method,
      path: c.req.path,
      params: c.req.param() as Record<string, string>,
      query: c.req.query() as Record<string, string>,
      body,
      headers: Object.fromEntries(
        // biome-ignore lint/suspicious/noExplicitAny: Hono header iteration
        [...(c.req.raw.headers as any)] as [string, string][],
      ),
      redemption,
    };
    const result = await backend.runPipeline(req, async () => {
      const r = await terminal();
      return { status: r.status, body: r.body };
    });
    return c.json(result.body as never, result.status as never);
  };

  app.post("/game/:name/join", async (c) => {
    try {
      const name = c.req.param("name");
      const body = (await c.req.json().catch(() => ({}))) as {
        roomId: string;
        delegation: unknown;
      };
      const r = await routeJoin(backend, name, body);
      return c.json(r.body as never, r.status as never);
    } catch (err) {
      const e = errorResponse(err);
      return c.json(e.body as never, e.status as never);
    }
  });

  app.post("/game/:name/move", async (c) => {
    const name = c.req.param("name");
    return withPipeline(c, { kind: "move" }, async () => {
      try {
        const body = (await cloneBody(c)) as Parameters<typeof routeMove>[2];
        return await routeMove(backend, name, body);
      } catch (err) {
        return errorResponse(err);
      }
    });
  });

  app.post("/game/:name/charge", async (c) => {
    const name = c.req.param("name");
    return withPipeline(c, { kind: "charge" }, async () => {
      try {
        const body = (await cloneBody(c)) as Parameters<typeof routeCharge>[2];
        return await routeCharge(backend, name, body);
      } catch (err) {
        return errorResponse(err);
      }
    });
  });

  app.get("/game/:name/state/:table", async (c) => {
    try {
      const name = c.req.param("name");
      const table = c.req.param("table");
      const where = c.req.query() as Where;
      const r = await routeState(backend, name, table, where);
      return c.json(r.body as never, r.status as never);
    } catch (err) {
      const e = errorResponse(err);
      return c.json(e.body as never, e.status as never);
    }
  });

  app.post("/nexus/webhook", async (c) => {
    try {
      const payload = (await c.req.json().catch(() => ({}))) as Parameters<typeof routeWebhook>[1];
      const headers = Object.fromEntries(
        // biome-ignore lint/suspicious/noExplicitAny: Hono header iteration
        [...(c.req.raw.headers as any)] as [string, string][],
      );
      const r = await routeWebhook(backend, payload, headers);
      return c.json(r.body as never, r.status as never);
    } catch (err) {
      const e = errorResponse(err);
      return c.json(e.body as never, e.status as never);
    }
  });

  app.get("/healthz", (c) => {
    const r = routeHealthz();
    return c.json(r.body as never, r.status as never);
  });

  app.get("/readyz", async (c) => {
    const r = await routeReadyz(backend);
    return c.json(r.body as never, r.status as never);
  });

  return app;
}

/** Read the JSON body once; Hono caches it so a second `.json()` is safe. */
async function cloneBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => ({}));
}

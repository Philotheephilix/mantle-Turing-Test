import { NexusError } from "@nexus/types";
import { describe, expect, it } from "vitest";
import { type Backend, createBackend, createGatewayApp } from "../src/index.js";
import { FakeRelayer, PLAYER, TARGET, lastBundle, saneDelegation, uno } from "./fixtures.js";

async function boot(): Promise<{ backend: Backend; relayer: FakeRelayer }> {
  const relayer = new FakeRelayer();
  const backend = createBackend({
    chain: "base",
    world: TARGET,
    relayer,
    games: [uno],
  });
  await backend.start();
  return { backend, relayer };
}

/** Join two players so the room is active, returning the first session id. */
async function activeRoom(backend: Backend): Promise<{ roomId: string; sessionId: string }> {
  const roomId = await backend.rooms.createRoom("uno", { quorum: 2 });
  const s = await backend.rooms.joinRoom(roomId, saneDelegation());
  const p2 = saneDelegation();
  p2.player = "0x3333333333333333333333333333333333333333";
  await backend.rooms.joinRoom(roomId, p2);
  return { roomId, sessionId: s.sessionId };
}

describe("gateway routes (Hono test client)", () => {
  it("GET /healthz works", async () => {
    const { backend } = await boot();
    const app = createGatewayApp(backend);
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("GET /readyz is green once capabilities + indexer resolve", async () => {
    const { backend } = await boot();
    const app = createGatewayApp(backend);
    const res = await app.request("/readyz");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ready: true });
  });

  it("unknown game → GAME_NOT_FOUND", async () => {
    const { backend } = await boot();
    const app = createGatewayApp(backend);
    const res = await app.request("/game/nope/state/TurnOrder");
    expect(res.status).toBe(500); // INVALID_CONFIG → 500; body carries the code
    expect(JSON.stringify(await res.json())).toContain("GAME_NOT_FOUND");
  });

  it("routes /move to the relayer and returns 202 { callId }", async () => {
    const { backend, relayer } = await boot();
    const { roomId, sessionId } = await activeRoom(backend);
    void roomId;
    const app = createGatewayApp(backend);
    const res = await app.request("/game/uno/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, caller: PLAYER, encodedExecution: `0x${"de".repeat(36)}` }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { callId: string };
    expect(body.callId).toMatch(/^fake-/);
    // the bundle went to the relayer
    expect(relayer.bundles).toHaveLength(1);
    expect(lastBundle(relayer).delegationContext).toBeTruthy();
  });

  it("returns 402 challenge body when /charge is issued without prior payment", async () => {
    const { backend, relayer } = await boot();
    const { sessionId } = await activeRoom(backend);
    const app = createGatewayApp(backend);
    const res = await app.request("/game/uno/charge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, caller: PLAYER, amount: "5", to: TARGET }),
    });
    // The stub facilitator mints a 402 challenge carried in the accepted body.
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      callId: string;
      challenge: { scheme: string; price: string; nonce: string };
    };
    expect(body.challenge.scheme).toBe("x402");
    expect(body.challenge.price).toBe("5");
    expect(body.challenge.nonce).toBeTruthy();
    // a budget bundle was submitted to the relayer
    expect(relayer.bundles).toHaveLength(1);
  });
});

describe("charge without payment surfaces PAYMENT_REQUIRED at the facilitator boundary", () => {
  it("StubFacilitator.verify rejects a redemption with no settlement (402 semantics)", async () => {
    const { backend } = await boot();
    await expect(
      backend.facilitator.verify({
        nonce: `0x${"00".repeat(32)}`,
        payer: PLAYER,
        delegationContext: "0x",
      }),
    ).rejects.toThrow(NexusError);
  });
});

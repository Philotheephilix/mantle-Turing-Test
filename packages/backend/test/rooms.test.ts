import { NexusError } from "@nexus/types";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAVEAT_POLICY,
  MemorySessionStore,
  RoomService,
  transition,
  validateCaveats,
} from "../src/index.js";
import { PLAYER, TARGET, saneDelegation, uno } from "./fixtures.js";

const policy = { ...DEFAULT_CAVEAT_POLICY, targetAddress: TARGET };

function freshRooms() {
  const store = new MemorySessionStore();
  const games = new Map([[uno.name, uno]]);
  const rooms = new RoomService({ store, games, caveatPolicy: () => policy });
  return { store, rooms };
}

describe("caveat sanity", () => {
  it("accepts a sane delegation", () => {
    expect(() => validateCaveats(saneDelegation(), uno, policy)).not.toThrow();
  });

  it("rejects a delegation with no expiry", () => {
    const d = saneDelegation();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately corrupt the field
    (d.caveats.gameplay as any).expiresAt = undefined;
    expect(() => validateCaveats(d, uno, policy)).toThrow(NexusError);
    try {
      validateCaveats(d, uno, policy);
    } catch (e) {
      expect((e as NexusError).code).toBe("CAVEATS_INVALID");
    }
  });

  it("rejects a far-future expiry", () => {
    const d = saneDelegation();
    d.caveats.gameplay.expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
    expect(() => validateCaveats(d, uno, policy)).toThrow(/too far/);
  });

  it("rejects a delegation with no spend cap", () => {
    const d = saneDelegation();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately corrupt the field
    (d.caveats.budget as any).totalCap = "";
    expect(() => validateCaveats(d, uno, policy)).toThrow(/spend cap/);
  });

  it("rejects empty allowedRecipients (over-broad spend)", () => {
    const d = saneDelegation();
    d.caveats.budget.allowedRecipients = [];
    expect(() => validateCaveats(d, uno, policy)).toThrow(/over-broad/);
  });

  it("rejects a target mismatch", () => {
    const d = saneDelegation();
    d.to = PLAYER; // != TARGET
    try {
      validateCaveats(d, uno, policy);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as NexusError).code).toBe("TARGET_MISMATCH");
    }
  });
});

describe("room lifecycle", () => {
  it("walks open → filling → active → settling → closed", () => {
    expect(transition("open", "fill")).toBe("filling");
    expect(transition("filling", "quorum")).toBe("active");
    expect(transition("active", "end")).toBe("settling");
    expect(transition("settling", "paid")).toBe("closed");
  });

  it("rejects illegal transitions", () => {
    expect(() => transition("closed", "fill")).toThrow(NexusError);
    expect(() => transition("open", "paid")).toThrow(/illegal/);
  });

  it("joinRoom validates caveats and advances state to active at quorum", async () => {
    const { rooms } = freshRooms();
    const roomId = await rooms.createRoom("uno", { quorum: 2 });
    expect(rooms.state(roomId)).toBe("open");

    const s1 = await rooms.joinRoom(roomId, saneDelegation());
    expect(rooms.state(roomId)).toBe("filling");
    expect(s1.sessionId).toBeTruthy();

    const p2 = saneDelegation();
    p2.player = "0x3333333333333333333333333333333333333333";
    await rooms.joinRoom(roomId, p2);
    expect(rooms.state(roomId)).toBe("active");
  });

  it("joinRoom rejects an insane delegation (no expiry)", async () => {
    const { rooms } = freshRooms();
    const roomId = await rooms.createRoom("uno", { quorum: 2 });
    const d = saneDelegation();
    // biome-ignore lint/suspicious/noExplicitAny: corrupt
    (d.caveats.gameplay as any).expiresAt = undefined;
    await expect(rooms.joinRoom(roomId, d)).rejects.toThrow(NexusError);
  });

  it("leaveRoom invalidates the session", async () => {
    const { rooms, store } = freshRooms();
    const roomId = await rooms.createRoom("uno", { quorum: 1 });
    const s = await rooms.joinRoom(roomId, saneDelegation());
    expect(rooms.state(roomId)).toBe("active");
    await rooms.leaveRoom(roomId, PLAYER);
    expect(await store.get(s.sessionId)).toBeNull();
  });
});

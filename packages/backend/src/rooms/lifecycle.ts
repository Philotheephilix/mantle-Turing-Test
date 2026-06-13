import { NexusError } from "@nexus/types";
import type { RoomState } from "../types.js";

/**
 * The room lifecycle state machine (backend spec §4.2, phase-05 §4.5):
 *
 *   open ──fill──▶ filling ──quorum──▶ active ──end──▶ settling ──paid──▶ closed
 *     │               │                                   │
 *     └── cancel ─────┴──── abandon (timeout) ────────────┴──▶ settling(refund)
 *
 * Guards: only `open|filling` accept `joinRoom`; only `active` accepts
 * `move`/`charge`; only `settling` accepts `settlePot`/refund; `closed` is terminal.
 */
export type RoomEvent = "fill" | "quorum" | "end" | "paid" | "cancel" | "abandon";

const TRANSITIONS: Record<RoomState, Partial<Record<RoomEvent, RoomState>>> = {
  open: { fill: "filling", cancel: "settling", abandon: "settling" },
  filling: { quorum: "active", cancel: "settling", abandon: "settling" },
  active: { end: "settling", abandon: "settling" },
  settling: { paid: "closed" },
  closed: {},
};

export function canTransition(from: RoomState, event: RoomEvent): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

/** Apply a lifecycle event, or throw `ROOM_CLOSED` for an illegal transition. */
export function transition(from: RoomState, event: RoomEvent): RoomState {
  const to = TRANSITIONS[from][event];
  if (to === undefined) {
    throw new NexusError("ROOM_CLOSED", `illegal room transition: ${from} --${event}-->`, {
      context: { from, event },
    });
  }
  return to;
}

export function assertCanJoin(state: RoomState): void {
  if (state !== "open" && state !== "filling") {
    throw new NexusError("ROOM_CLOSED", `cannot join room in state ${state}`);
  }
}

export function assertActive(state: RoomState): void {
  if (state !== "active") {
    throw new NexusError("ROOM_CLOSED", `room not active (state ${state})`);
  }
}

export function assertSettling(state: RoomState): void {
  if (state !== "settling") {
    throw new NexusError("ROOM_CLOSED", `room not settling (state ${state})`);
  }
}

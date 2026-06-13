import type { PotRef, RoomId, Session } from "../types.js";

/**
 * The `SessionStore` port (backend spec §6, phase-05 §4.5). Holds active
 * sessions, the signed `GameDelegation` (or a relayer reference), and the
 * per-room pot map. `MemorySessionStore` is the dev default; a Redis-backed store
 * implements the same interface (shape documented below).
 */
export interface SessionStore {
  put(s: Session): Promise<void>;
  get(sessionId: string): Promise<Session | null>;
  delete(sessionId: string): Promise<void>;
  /** All sessions in a room (for membership checks + fan-out). */
  byRoom(roomId: RoomId): Promise<Session[]>;
  setPot(roomId: RoomId, pot: PotRef): Promise<void>;
  potMap(roomId: RoomId): Promise<PotRef | null>;
}

/** Zero-dependency in-memory store — the `nexus serve` (dev) default. */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly pots = new Map<RoomId, PotRef>();

  async put(s: Session): Promise<void> {
    this.sessions.set(s.sessionId, s);
  }
  async get(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null;
  }
  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
  async byRoom(roomId: RoomId): Promise<Session[]> {
    return [...this.sessions.values()].filter((s) => s.roomId === roomId);
  }
  async setPot(roomId: RoomId, pot: PotRef): Promise<void> {
    this.pots.set(roomId, pot);
  }
  async potMap(roomId: RoomId): Promise<PotRef | null> {
    return this.pots.get(roomId) ?? null;
  }
}

/**
 * Redis-shaped store — DOCUMENTED SEAM (backend spec §6: Session store default is
 * Redis in prod). The interface above is the contract; a Redis implementation
 * uses these key conventions:
 *
 *   session:<sessionId>            → JSON(Session)            (HSET / GET)
 *   room:<roomId>:sessions         → Set<sessionId>          (SADD / SMEMBERS)
 *   room:<roomId>:pot              → JSON(PotRef)             (SET / GET)
 *
 * `byRoom` does SMEMBERS then an MGET pipeline; `delete` SREMs from the room set.
 * Delegations may be stored as a relayer-side reference (`RelayerRef`) rather than
 * the full signed tuple, per backend spec §6 / §8.6. A `RedisSessionStore`
 * implementing `SessionStore` drops in via `createBackend({ sessionStore })`.
 */

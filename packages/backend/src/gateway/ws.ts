import type { IndexerAdapter, Row, RowChange, Unsubscribe, Where } from "../ports/indexer.js";

/** WS subscribe contract frames (phase-06 §4.8). */
export type ClientFrame =
  | { op: "subscribe"; id: string; table: string; where: Where }
  | { op: "unsubscribe"; id: string };

export type ServerFrame =
  | { op: "snapshot"; id: string; rows: Row[] }
  | { op: "change"; id: string; change: RowChange }
  | { op: "error"; id: string; code: string };

/** A minimal socket sink — the real transport (ws/Hono) plugs in here. */
export interface SocketSink {
  send(frame: ServerFrame): void;
}

/**
 * The WS subscribe fabric + room-scoped fan-out (phase-05 §4.1 / phase-06 §4.7).
 * On `subscribe`, sends an initial snapshot then streams `change` frames for
 * matching rows. The hub is framework-agnostic; `createGatewayApp` wires it to a
 * real WebSocket. At scale, back the registry with a shared pub/sub (Redis).
 */
export class WsHub {
  private readonly subs = new Map<string, { unsub: Unsubscribe; table: string }>();

  constructor(private readonly indexer: IndexerAdapter) {}

  async handleFrame(frame: ClientFrame, sink: SocketSink): Promise<void> {
    if (frame.op === "unsubscribe") {
      const existing = this.subs.get(frame.id);
      if (existing) {
        existing.unsub();
        this.subs.delete(frame.id);
      }
      return;
    }
    // subscribe: snapshot then live changes
    const rows = await this.indexer.query(frame.table, frame.where);
    sink.send({ op: "snapshot", id: frame.id, rows });
    const unsub = this.indexer.subscribe(frame.table, frame.where, (change) => {
      sink.send({ op: "change", id: frame.id, change });
    });
    this.subs.set(frame.id, { unsub, table: frame.table });
  }

  closeAll(): void {
    for (const { unsub } of this.subs.values()) unsub();
    this.subs.clear();
  }
}

import type { StatusEvent } from "@nexus/relayer";
import { NexusError, codeFromRevert } from "@nexus/types";

export interface AwaitingResolution {
  status: "mined" | "failed";
  txHash?: string;
  blockNumber?: bigint;
}

interface Pending {
  resolve: (r: AwaitingResolution) => void;
  reject: (e: unknown) => void;
}

/**
 * The pending-call registry (phase-05 §4.7). Each in-flight move/charge registers
 * a promise keyed by bundleId; the relayer `onStatus` subscription (fed by webhook
 * ingestion) resolves or rejects it on terminal status. This is what makes the hot
 * path webhook-driven, not polled. Out-of-order webhooks (mined before register)
 * are buffered so the later registration resolves immediately.
 */
export class AwaitingRegistry {
  private readonly pending = new Map<string, Pending>();
  /** Terminal events seen before a register call (out-of-order webhook). */
  private readonly buffered = new Map<string, StatusEvent>();

  /** Subscribe to a relayer's status stream so webhooks resolve awaiting calls. */
  attach(onStatus: (cb: (e: StatusEvent) => void) => () => void): () => void {
    return onStatus((e) => this.ingest(e));
  }

  /** Feed a terminal `StatusEvent` (from webhook ingestion). */
  ingest(e: StatusEvent): void {
    if (e.status === "pending") return;
    const p = this.pending.get(e.bundleId);
    if (!p) {
      this.buffered.set(e.bundleId, e);
      return;
    }
    this.pending.delete(e.bundleId);
    this.settle(p, e);
  }

  /** Register an awaiting call; resolves when the matching terminal status arrives. */
  register(bundleId: string): Promise<AwaitingResolution> {
    const buffered = this.buffered.get(bundleId);
    if (buffered) {
      this.buffered.delete(bundleId);
      return new Promise((resolve, reject) => this.settle({ resolve, reject }, buffered));
    }
    return new Promise((resolve, reject) => {
      this.pending.set(bundleId, { resolve, reject });
    });
  }

  private settle(p: Pending, e: StatusEvent): void {
    if (e.status === "mined") {
      p.resolve({ status: "mined", txHash: e.txHash, blockNumber: e.blockNumber });
    } else {
      const code = e.revert ? codeFromRevert(e.revert) : "RELAYER_FAILED";
      p.reject(new NexusError(code, e.revert ?? "bundle failed", { txHash: e.txHash }));
    }
  }
}

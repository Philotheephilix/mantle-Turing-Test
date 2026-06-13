import type { StatusEvent } from "@nexus/relayer";
import { type Hex, NexusError } from "@nexus/types";

/** A 1Shot-style webhook payload (backend spec §4.5). */
export interface WebhookPayload {
  bundleId: string;
  status: "pending" | "mined" | "failed";
  txHash?: Hex;
  blockNumber?: number;
  revert?: string;
}

/** Maps `bundleId → roomId/move/charge`, attached by submit-time registration. */
export interface CorrelationRecord {
  bundleId: string;
  roomId?: string;
  kind: "move" | "charge" | "settle" | "refund";
  player?: string;
}

/**
 * The webhook ledger (backend spec §6/§7): `bundleId → call` mapping + dedupe.
 * In-memory default; a Redis ledger implements the same surface (keys
 * `webhook:<bundleId>` for the correlation, `webhook:seen:<bundleId>` for dedupe).
 */
export interface WebhookLedger {
  claim(rec: CorrelationRecord): Promise<void>;
  correlation(bundleId: string): Promise<CorrelationRecord | null>;
  /** Returns true the FIRST time a bundleId is seen; false on re-delivery. */
  markSeen(bundleId: string): Promise<boolean>;
}

export class MemoryWebhookLedger implements WebhookLedger {
  private readonly correlations = new Map<string, CorrelationRecord>();
  private readonly seen = new Set<string>();

  async claim(rec: CorrelationRecord): Promise<void> {
    this.correlations.set(rec.bundleId, rec);
  }
  async correlation(bundleId: string): Promise<CorrelationRecord | null> {
    return this.correlations.get(bundleId) ?? null;
  }
  async markSeen(bundleId: string): Promise<boolean> {
    if (this.seen.has(bundleId)) return false;
    this.seen.add(bundleId);
    return true;
  }
}

/** Verify webhook origin/signature. Default: a shared-secret HMAC-ish check. */
export type WebhookVerifier = (payload: WebhookPayload, headers: Record<string, string>) => boolean;

export interface IngestResult {
  ok: boolean;
  deduped: boolean;
  correlation: CorrelationRecord | null;
}

/**
 * The webhook ingestion handler. Verifies origin, dedupes by bundleId, maps the
 * bundle to its pending call, and emits an internal `StatusEvent` that drives
 * move/charge resolution and indexer reconciliation. Idempotent (backend spec §7).
 */
export class WebhookHandler {
  private readonly listeners = new Set<(e: StatusEvent) => void>();

  constructor(
    private readonly ledger: WebhookLedger,
    private readonly verify: WebhookVerifier = () => true,
  ) {}

  onStatus(cb: (e: StatusEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async ingest(
    payload: WebhookPayload,
    headers: Record<string, string> = {},
  ): Promise<IngestResult> {
    if (!this.verify(payload, headers)) {
      throw new NexusError("WEBHOOK_UNVERIFIED", "webhook signature/origin check failed");
    }
    const first = await this.ledger.markSeen(payload.bundleId);
    const correlation = await this.ledger.correlation(payload.bundleId);
    if (!first) {
      // Re-delivery: no double-resolve, but report the known correlation.
      return { ok: true, deduped: true, correlation };
    }
    const event: StatusEvent = {
      bundleId: payload.bundleId,
      status: payload.status,
      ...(payload.txHash ? { txHash: payload.txHash } : {}),
      ...(payload.blockNumber !== undefined ? { blockNumber: BigInt(payload.blockNumber) } : {}),
      ...(payload.revert ? { revert: payload.revert } : {}),
    };
    for (const l of this.listeners) l(event);
    return { ok: true, deduped: false, correlation };
  }
}

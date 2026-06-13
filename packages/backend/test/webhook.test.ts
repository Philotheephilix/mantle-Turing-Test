import type { Hex } from "@nexus/types";
import { describe, expect, it } from "vitest";
import {
  AwaitingRegistry,
  MemoryWebhookLedger,
  WebhookHandler,
  computePayout,
  computeRefunds,
} from "../src/index.js";

const TX = `0x${"ab".repeat(32)}` as Hex;

describe("webhook ingestion", () => {
  it("resolves a pending move/charge call via the bundleId correlation", async () => {
    const ledger = new MemoryWebhookLedger();
    const awaiting = new AwaitingRegistry();
    const webhook = new WebhookHandler(ledger);
    webhook.onStatus((e) => awaiting.ingest(e));

    // submit-time: claim the correlation + arm the awaiting promise
    await ledger.claim({ bundleId: "b-1", roomId: "room-1", kind: "move" });
    const pending = awaiting.register("b-1");

    const result = await webhook.ingest({
      bundleId: "b-1",
      status: "mined",
      txHash: TX,
      blockNumber: 42,
    });
    expect(result).toMatchObject({ ok: true, deduped: false });
    expect(result.correlation).toMatchObject({ roomId: "room-1", kind: "move" });

    const res = await pending;
    expect(res).toMatchObject({ status: "mined", txHash: TX });
  });

  it("dedupes a re-delivered webhook by bundleId (idempotent, no double resolve)", async () => {
    const ledger = new MemoryWebhookLedger();
    const awaiting = new AwaitingRegistry();
    const webhook = new WebhookHandler(ledger);
    let emitted = 0;
    webhook.onStatus((e) => {
      emitted++;
      awaiting.ingest(e);
    });

    await ledger.claim({ bundleId: "b-2", kind: "charge" });
    const first = await webhook.ingest({ bundleId: "b-2", status: "mined", txHash: TX });
    const second = await webhook.ingest({ bundleId: "b-2", status: "mined", txHash: TX });
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(emitted).toBe(1); // re-delivery does NOT re-emit a StatusEvent
  });

  it("resolves out-of-order (webhook before register)", async () => {
    const awaiting = new AwaitingRegistry();
    awaiting.ingest({ bundleId: "b-3", status: "mined", txHash: TX });
    const res = await awaiting.register("b-3");
    expect(res.status).toBe("mined");
  });

  it("rejects an unverified webhook", async () => {
    const ledger = new MemoryWebhookLedger();
    const webhook = new WebhookHandler(ledger, () => false);
    await expect(webhook.ingest({ bundleId: "b-4", status: "mined" })).rejects.toThrow(
      /check failed/i,
    );
  });
});

describe("pot rake math", () => {
  it("winner payout = pot − rake; sum == pot", () => {
    const split = computePayout("10", { pot: { type: "winner-take-all", rake: "0.1" } });
    expect(split.winner).toBe("9");
    expect(split.rake).toBe("1");
  });

  it("pro-rata refund sums to the pot", () => {
    const shares = computeRefunds("10", ["0xa", "0xb", "0xc"]);
    const sum = shares.reduce((acc, s) => acc + Number(s.amount), 0);
    expect(sum).toBeCloseTo(10, 6);
  });
});

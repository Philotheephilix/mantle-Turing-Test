/**
 * Full multiplayer e2e for Nexus MONOPOLY against the live Base Sepolia backend.
 *
 * PERSISTENT browser context (chromium.launchPersistentContext) so the guest wallet
 * survives across steps. The whole money path is real and PER-PLAYER:
 *
 *   inject the funded HUMAN key → load app → connect (guest wallet = funded seat 0)
 *   → wait for the bots' game → PAY the buy-in (real USDC x402, settled on-chain,
 *      from the HUMAN's OWN wallet) → play to a WIN via the real UI (human rolls +
 *      buys; bots play via the backend script) → assert the on-chain WINNER + the
 *      pot PAYOUT.
 *
 * Verified on-chain via viem: the buy-in tx carries a USDC Transfer(human → Pot) —
 * the logical payer (delegator) is the PLAYER key, not the relayer — and the payout
 * tx carries a USDC Transfer(Pot → winner).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type BrowserContext, chromium, expect, test } from "@playwright/test";
import { createPublicClient, http } from "viem";
import deployment from "../deployments/base-sepolia.json" assert { type: "json" };

const APP_URL = process.env.MONOPOLY_APP_URL ?? "http://localhost:3030";
const RPC = "https://sepolia.base.org";
const USDC = deployment.usdc.toLowerCase();
const POT = deployment.pot.toLowerCase();
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const GUEST_KEY_STORAGE = "monopoly.guest.pk";
const USER_DATA_DIR = join(tmpdir(), "monopoly-playwright-profile");
const BACKEND_URL = process.env.MONOPOLY_BACKEND_URL ?? "http://localhost:8791";

const pub = createPublicClient({
  chain: { id: 84532, name: "base-sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } },
  transport: http(RPC),
});

interface PlayerKey { role: string; privateKey: `0x${string}`; address: `0x${string}` }

let context: BrowserContext;
let humanKey: `0x${string}`;
let humanAddress: `0x${string}`;

test.beforeAll(async () => {
  const { players } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "players.local.json"), "utf8")) as { players: PlayerKey[] };
  const human = players.find((p) => p.role === "human");
  if (!human) throw new Error("no human in players.local.json (run fund-players)");
  humanKey = human.privateKey;
  humanAddress = human.address;

  context = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: true, viewport: { width: 1280, height: 900 } });
  // Inject the FUNDED human key into the guest wallet localStorage BEFORE any page
  // script runs, so the in-browser guest wallet IS the funded seat-0 player.
  await context.addInitScript(
    ([k, v]) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        /* ignore */
      }
    },
    [GUEST_KEY_STORAGE, humanKey] as [string, string],
  );
});

test.afterAll(async () => {
  // Teardown must not throw if the context is already closed.
  try {
    await context?.close();
  } catch {
    /* already closed */
  }
});

/** Read the backend game state directly (the source of truth for winner + payout). */
async function backendState(): Promise<any> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/state`);
    return await res.json();
  } catch {
    return { ok: false };
  }
}

test("multiplayer Monopoly: human pays buy-in (on-chain, own wallet) → plays to a WIN → pot pays out (on-chain)", async () => {
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("console", (m) => {
    if (m.type() === "error") console.log("[browser error]", m.text());
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  // 1) Connect the guest wallet (= the injected, funded seat-0 player). Retry until
  //    React hydrates and the lobby (join/pay) appears (bots' game discovered).
  const connectBtn = page.getByTestId("login-btn");
  await expect(connectBtn).toBeVisible();
  await expect(async () => {
    if (await connectBtn.isVisible().catch(() => false)) await connectBtn.click();
    await expect(page.getByTestId("join-btn")).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 90_000 });

  // Sanity: the browser wallet is the funded human seat.
  await expect(page.getByTestId("wallet-address")).toContainText(humanAddress.slice(0, 6));

  // 2) Pay the buy-in — the headline real per-player x402 payment from the human's
  //    OWN wallet.
  await page.getByTestId("join-btn").click();
  await expect(page.getByTestId("payment-status")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("payment-status")).toContainText("PAID");
  const payTxText = (await page.getByTestId("payment-tx").textContent())?.trim() ?? "";
  expect(payTxText).toMatch(/^0x[0-9a-fA-F]{64}$/);
  console.log("[e2e] buy-in tx:", payTxText);

  // 3) VERIFY on-chain: that tx carries a USDC Transfer(human → Pot). The `from` of
  //    the ERC-20 Transfer is the PLAYER (the delegator), proving a distinct player
  //    wallet signed the budget delegation — the relayer only submitted/redeemed.
  const payReceipt = await pub.getTransactionReceipt({ hash: payTxText as `0x${string}` });
  expect(payReceipt.status).toBe("success");
  const feeTransfer = payReceipt.logs.find(
    (l) =>
      l.address.toLowerCase() === USDC &&
      l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
      `0x${l.topics[1]?.slice(26)}`.toLowerCase() === humanAddress.toLowerCase() &&
      `0x${l.topics[2]?.slice(26)}`.toLowerCase() === POT,
  );
  expect(feeTransfer, "expected USDC Transfer(human → Pot) in the buy-in tx").toBeTruthy();
  const feeValue = BigInt(feeTransfer!.data);
  console.log(`[e2e] verified on-chain: buy-in USDC Transfer(human ${humanAddress} → Pot) = ${Number(feeValue) / 1e6} USDC`);
  expect(feeValue).toBeGreaterThan(0n);

  // 4) Play to a WIN. On the human's turn: roll (gasless) until it lands on an
  //    unowned property, then BUY (real x402). Repeat until the human owns the target
  //    and the winner banner appears.
  const winnerBanner = page.getByTestId("winner-banner");
  const rollBtn = page.getByTestId("roll-btn");
  const buyBtn = page.getByTestId("buy-btn");
  const rentBtn = page.getByTestId("rent-btn");

  // Plain drive loop (NOT toPass): each iteration claims a pending buy/rent (→ reaches
  // the win) or rolls on our turn. The WIN GATE is the BACKEND state (the source of
  // truth: winner + payoutTx), polled each iteration — NOT only the flaky DOM banner.
  // isVisible() returns false immediately for absent elements (no auto-wait stall).
  //
  // The drive deadline (900s) is well under the per-test timeout (1_200s) so we ALWAYS
  // assert/exit before Playwright force-closes the browser context — even with the
  // earlier connect + buy-in phases consuming part of the budget.
  const deadline = Date.now() + 900_000;
  let backendWinner: string | null = null;
  let backendPayoutTx: string | null = null;
  while (Date.now() < deadline) {
    // Source-of-truth win check (backend), robust to a stale/un-updated UI.
    const st = await backendState();
    if (st?.winner && st?.payoutTx) {
      backendWinner = String(st.winner).toLowerCase();
      backendPayoutTx = String(st.payoutTx);
      break;
    }
    // Drive the human's turn through the real UI when possible.
    if (await buyBtn.isVisible().catch(() => false)) {
      await buyBtn.click().catch(() => {});
      await page.waitForTimeout(2500);
    } else if (await rentBtn.isVisible().catch(() => false)) {
      await rentBtn.click().catch(() => {});
      await page.waitForTimeout(2500);
    } else if (await rollBtn.isEnabled().catch(() => false)) {
      await rollBtn.click().catch(() => {});
      await page.waitForTimeout(2500);
    } else {
      await page.waitForTimeout(1500); // not our turn — wait for the bots to cycle
    }
  }

  expect(backendWinner, "the human should reach the property target and win (backend winner)").toBeTruthy();
  expect(backendPayoutTx, "the backend should report a payout tx").toBeTruthy();
  console.log("[e2e] backend winner:", backendWinner, "payout:", backendPayoutTx);

  // The DOM banner is a nice-to-have (the UI polls /api/state every 2s). Give it a
  // moment but never let it gate the test.
  await expect(winnerBanner).toBeVisible({ timeout: 30_000 }).catch(() => {});

  // 5) Assert the WINNER on-chain + the pot PAYOUT (use the backend's payout tx).
  const payoutTxText = backendPayoutTx!;
  expect(payoutTxText).toMatch(/^0x[0-9a-fA-F]{64}$/);
  console.log("[e2e] payout tx:", payoutTxText);

  const payoutReceipt = await pub.getTransactionReceipt({ hash: payoutTxText as `0x${string}` });
  expect(payoutReceipt.status).toBe("success");
  const payoutTransfer = payoutReceipt.logs.find(
    (l) =>
      l.address.toLowerCase() === USDC &&
      l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
      `0x${l.topics[1]?.slice(26)}`.toLowerCase() === POT,
  );
  expect(payoutTransfer, "expected USDC Transfer(Pot → winner) in the payout tx").toBeTruthy();
  const winner = `0x${payoutTransfer!.topics[2]?.slice(26)}`.toLowerCase();
  const payoutValue = BigInt(payoutTransfer!.data);
  console.log(`[e2e] verified on-chain: pot payout USDC Transfer(Pot → ${winner}) = ${Number(payoutValue) / 1e6} USDC`);
  expect(payoutValue).toBeGreaterThan(0n);
  // The human (seat 0, the only buyer) is the deterministic winner.
  expect(winner).toBe(humanAddress.toLowerCase());
});

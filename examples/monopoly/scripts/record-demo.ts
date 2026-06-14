/**
 * Standalone DEMO RECORDER for Nexus MONOPOLY.
 *
 * Self-contained: it boots the entire live stack itself (fund-players → game server
 * → bots → `next dev`), waits for readiness, then launches a headless Chromium with
 * Playwright VIDEO RECORDING and drives the REAL UI through a full multiplayer
 * Monopoly game on Base Sepolia:
 *
 *   inject funded HUMAN key into localStorage (monopoly.guest.pk) → connect →
 *   join + pay the buy-in (real x402 USDC, on-chain, from the HUMAN's OWN wallet) →
 *   on each human turn roll / buy / pay-rent via the UI (gasless moves + real x402
 *   buys) while the bots play → WIN → pot pays out on-chain.
 *
 * KNOWN ISSUE: Monopoly's UI win banner does not reliably update from the DOM. So the
 * win is gated ENTIRELY on the BACKEND /api/state (winner + payoutTx) — the source of
 * truth — NOT the DOM. Once the backend reports the win we hold the live board on
 * screen for a few seconds, then close the context so Playwright finalizes the .webm,
 * which is moved to demos/monopoly-demo.webm (+ mp4 if ffmpeg is on PATH).
 *
 * Run:  pnpm --filter @nexus-examples/monopoly demo
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..");
const APP_URL = process.env.MONOPOLY_APP_URL ?? "http://localhost:3030";
const BACKEND_URL = process.env.MONOPOLY_BACKEND_URL ?? "http://localhost:8791";
const GUEST_KEY_STORAGE = "monopoly.guest.pk";
const USER_DATA_DIR = join(tmpdir(), "monopoly-demo-profile");
const VIDEO_DIR = join(ROOT, "demos", "monopoly-video");
const DEMO_WEBM = join(ROOT, "demos", "monopoly-demo.webm");
const DEMO_MP4 = join(ROOT, "demos", "monopoly-demo.mp4");
const tsxBin = join(ROOT, "node_modules", ".bin", "tsx");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const children: ChildProcess[] = [];

function spawnProc(cmd: string, args: string[], name: string): ChildProcess {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", detached: true, env: process.env });
  child.on("error", (e) => console.error(`[${name}] spawn error`, e));
  children.push(child);
  return child;
}

async function waitFor(url: string, label: string, timeoutMs: number, ok?: (j: any) => boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        if (!ok) return;
        const j = await res.json();
        if (ok(j)) return;
      }
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${label} (${url})`);
}

async function waitForApp(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok || res.status === 200) return;
    } catch {
      /* not up */
    }
    await sleep(1000);
  }
  throw new Error(`timeout waiting for Next app at ${APP_URL}`);
}

async function backendState(): Promise<any> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/state`);
    return await res.json();
  } catch {
    return { ok: false };
  }
}

function killAll() {
  for (const c of children) {
    try {
      if (c.pid) process.kill(-c.pid, "SIGTERM");
    } catch {
      /* ignore */
    }
    try {
      c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  // ---- 1. Boot the stack ---------------------------------------------------
  console.log("[demo] funding / topping up players (idempotent)…");
  const fund = spawnSync(tsxBin, ["scripts/fund-players.ts"], { cwd: ROOT, stdio: "inherit", env: process.env });
  if (fund.status !== 0) throw new Error(`fund-players exited ${fund.status}`);

  console.log("[demo] starting game server…");
  spawnProc(tsxBin, ["scripts/server.ts"], "server");
  await waitFor(`${BACKEND_URL}/api/health`, "game server health", 60_000);
  console.log("[demo] server healthy.");

  console.log("[demo] starting bots…");
  spawnProc(tsxBin, ["scripts/bots.ts"], "bots");
  await waitFor(`${BACKEND_URL}/api/state`, "bots to create game", 120_000, (j) => j?.ok && Array.isArray(j.seats) && j.seats.length > 0);
  console.log("[demo] game created by bots.");

  console.log("[demo] starting next dev on :3030…");
  spawnProc(join(ROOT, "node_modules", ".bin", "next"), ["dev", "-p", "3030"], "next");
  await waitForApp(180_000);
  console.log("[demo] Next app ready.");

  // ---- 2. Funded human key -------------------------------------------------
  const { players } = JSON.parse(readFileSync(join(ROOT, "players.local.json"), "utf8")) as {
    players: { role: string; privateKey: `0x${string}`; address: `0x${string}` }[];
  };
  const human = players.find((p) => p.role === "human");
  if (!human) throw new Error("no human in players.local.json");
  const humanAddress = human.address;
  console.log(`[demo] human seat: ${humanAddress}`);

  // ---- 3. Launch Chromium WITH VIDEO ---------------------------------------
  mkdirSync(VIDEO_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } },
  });
  await context.addInitScript(
    ([k, v]) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        /* ignore */
      }
    },
    [GUEST_KEY_STORAGE, human.privateKey] as [string, string],
  );

  let buyInTx = "";
  let payoutTx = "";

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("console", (m) => {
      if (m.type() === "error") console.log("[browser error]", m.text());
    });
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await sleep(1000);

    // Connect
    const connectBtn = page.getByTestId("login-btn");
    await connectBtn.waitFor({ state: "visible", timeout: 30_000 });
    const joinBtn = page.getByTestId("join-btn");
    const connectDeadline = Date.now() + 90_000;
    while (Date.now() < connectDeadline) {
      if (await joinBtn.isVisible().catch(() => false)) break;
      if (await connectBtn.isVisible().catch(() => false)) await connectBtn.click().catch(() => {});
      await sleep(800);
    }
    await joinBtn.waitFor({ state: "visible", timeout: 90_000 });
    console.log("[demo] connected; lobby visible.");
    await sleep(700);

    // Pay buy-in (real x402 USDC, from the human's own wallet)
    await joinBtn.click();
    const payStatus = page.getByTestId("payment-status");
    await payStatus.waitFor({ state: "visible", timeout: 180_000 });
    const payTxEl = page.getByTestId("payment-tx");
    await payTxEl.waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    buyInTx = (await payTxEl.textContent().catch(() => ""))?.trim() ?? "";
    console.log("[demo] buy-in tx:", buyInTx);
    await sleep(900);

    // Drive the human's turns through the real UI; the WIN GATE is the BACKEND
    // /api/state (winner + payoutTx) — NOT the DOM banner (known-unreliable).
    const buyBtn = page.getByTestId("buy-btn");
    const rentBtn = page.getByTestId("rent-btn");
    const rollBtn = page.getByTestId("roll-btn");
    let winner: string | null = null;
    const deadline = Date.now() + 720_000;
    while (Date.now() < deadline) {
      const st = await backendState();
      if (st?.payoutTx) {
        winner = st.winner ? String(st.winner) : winner;
        payoutTx = String(st.payoutTx);
        break;
      }
      if (st?.winner) {
        winner = String(st.winner); // win detected; pot settling — stop playing, poll for payout
        await sleep(1500);
        continue;
      }
      if (await buyBtn.isVisible().catch(() => false)) {
        await buyBtn.click().catch(() => {});
        await sleep(2500);
      } else if (await rentBtn.isVisible().catch(() => false)) {
        await rentBtn.click().catch(() => {});
        await sleep(2500);
      } else if (await rollBtn.isEnabled().catch(() => false)) {
        await rollBtn.click().catch(() => {});
        await sleep(2200 + Math.floor(Math.random() * 400));
      } else {
        await sleep(1400); // not our turn — let the bots cycle
      }
    }

    // Grace period: pot settlement tx can lag the winner by a confirmation.
    const payoutDeadline = Date.now() + 90_000;
    while (!payoutTx && Date.now() < payoutDeadline) {
      const st = await backendState();
      if (st?.payoutTx) {
        payoutTx = String(st.payoutTx);
        winner = st.winner ? String(st.winner) : winner;
      } else {
        await sleep(2000);
      }
    }
    console.log("[demo] backend winner:", winner, "payout tx:", payoutTx);

    // Hold the live board / winner state on screen for the video. (The DOM banner
    // may or may not appear; either way the live board is shown.)
    await page.getByTestId("winner-banner").waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    await sleep(5000);
  } finally {
    await context.close().catch(() => {});
  }

  // ---- 4. Move the produced video -> demos/monopoly-demo.webm --------------
  const webms = readdirSync(VIDEO_DIR)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => join(VIDEO_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (webms.length === 0) throw new Error("no .webm produced by Playwright");
  renameSync(webms[0], DEMO_WEBM);
  const size = statSync(DEMO_WEBM).size;
  console.log(`[demo] video: ${DEMO_WEBM} (${(size / 1024).toFixed(0)} KB)`);

  let mp4Path = "";
  const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  if (hasFfmpeg) {
    const r = spawnSync("ffmpeg", ["-y", "-i", DEMO_WEBM, DEMO_MP4], { stdio: "inherit" });
    if (r.status === 0 && existsSync(DEMO_MP4)) {
      mp4Path = DEMO_MP4;
      console.log(`[demo] transcoded mp4: ${DEMO_MP4} (${(statSync(DEMO_MP4).size / 1024).toFixed(0)} KB)`);
    }
  } else {
    console.log("[demo] ffmpeg not on PATH — keeping .webm only.");
  }

  console.log("\n======== MONOPOLY DEMO RESULT ========");
  console.log("video (webm):", DEMO_WEBM, `(${(size / 1024).toFixed(0)} KB)`);
  if (mp4Path) console.log("video (mp4): ", mp4Path);
  console.log("human:       ", humanAddress);
  console.log("buy-in tx:   ", buyInTx || "(not captured)");
  console.log("payout tx:   ", payoutTx || "(not captured)");
  console.log("======================================\n");

  if (size < 200 * 1024) console.warn("[demo] WARNING: video is < 200KB");
  if (!buyInTx || !payoutTx) {
    throw new Error(`demo did not reach a full on-chain win (buyIn=${buyInTx} payout=${payoutTx})`);
  }
}

let exitCode = 0;
main()
  .catch((e) => {
    console.error("[demo] FAILED:", e);
    exitCode = 1;
  })
  .finally(async () => {
    killAll();
    await sleep(1500);
    process.exit(exitCode);
  });

/**
 * Playwright globalSetup — boots the live game backend for the e2e:
 *   1. funds the player keys (1 human + 2 bots) if players.local.json is missing
 *   2. starts the UNO game server (scripts/server.ts) on :8790
 *   3. starts the bot driver (scripts/bots.ts) — it orchestrates /api/new-game
 *      (human seat 0 + bots) and plays the bots on their turns
 *
 * The Next dev app is started by playwright.config's `webServer`. The test injects
 * the funded human key into the browser's localStorage guest wallet so the human
 * in the browser IS the funded seat-0 player.
 *
 * PIDs are written to .e2e-pids.json for global-teardown to clean up.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PLAYERS = join(ROOT, "players.local.json");
const PIDS = join(ROOT, ".e2e-pids.json");
const SERVER_URL = process.env.UNO_BACKEND_URL ?? "http://localhost:8790";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function run(cmd: string, args: string[], name: string, detached = false): ChildProcess {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", detached, env: process.env });
  child.on("error", (e) => console.error(`[${name}] spawn error`, e));
  return child;
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  return false;
}

async function waitForGame(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/state`);
      if (res.ok) {
        const st = (await res.json()) as { ok?: boolean; seats?: unknown[] };
        if (st.ok && Array.isArray(st.seats) && st.seats.length > 0) return true;
      }
    } catch {
      /* none yet */
    }
    await sleep(1000);
  }
  return false;
}

export default async function globalSetup() {
  const tsx = join(ROOT, "node_modules", ".bin", "tsx");
  const pids: number[] = [];

  // 1) Fund / top-up players (synchronous — must finish before bots start). The
  //    fund script is idempotent: it only tops up wallets that are below the
  //    threshold and re-approves if needed, so repeated e2e runs stay funded. If
  //    players.local.json exists it keeps the SAME keys (only tops up balances)
  //    UNLESS KEEP_PLAYERS is unset and the file is missing (then it generates).
  console.log(existsSync(PLAYERS) ? "[e2e-setup] topping up existing players…" : "[e2e-setup] funding new players…");
  await new Promise<void>((resolve, reject) => {
    const f = run(tsx, ["scripts/fund-players.ts"], "fund", false);
    f.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`fund-players exited ${code}`))));
  });

  // 2) Start the game server.
  console.log("[e2e-setup] starting game server…");
  const server = run(tsx, ["scripts/server.ts"], "server", true);
  if (server.pid) pids.push(server.pid);
  if (!(await waitForHealth(SERVER_URL, 60_000))) throw new Error("game server did not become healthy");
  console.log("[e2e-setup] server healthy.");

  // 3) Start the bots (they create the game + play on their turns).
  console.log("[e2e-setup] starting bots…");
  const bots = run(tsx, ["scripts/bots.ts"], "bots", true);
  if (bots.pid) pids.push(bots.pid);
  if (!(await waitForGame(SERVER_URL, 90_000))) throw new Error("bots did not create a game");
  console.log("[e2e-setup] game created by bots.");

  writeFileSync(PIDS, JSON.stringify({ pids }));
}

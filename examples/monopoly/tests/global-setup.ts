/**
 * Playwright globalSetup — boots the live Monopoly backend for the e2e:
 *   1. funds the player keys (1 human + 2 bots) if players.local.json is missing
 *   2. starts the Monopoly game server (scripts/server.ts) on :8791
 *   3. starts the bot driver (scripts/bots.ts) — it orchestrates /api/new-game
 *      (human seat 0 + bots) and plays the bots on their turns
 *
 * The Next dev app is started by playwright.config's `webServer`. The test injects
 * the funded human key into the browser's localStorage guest wallet so the human in
 * the browser IS the funded seat-0 player. PIDs go to .e2e-pids.json for teardown.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PLAYERS = join(ROOT, "players.local.json");
const PIDS = join(ROOT, ".e2e-pids.json");
const SERVER_URL = process.env.MONOPOLY_BACKEND_URL ?? "http://localhost:8791";

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
      /* not up */
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
        const st = (await res.json()) as { ok?: boolean; players?: unknown[] };
        if (st.ok && Array.isArray(st.players) && st.players.length > 0) return true;
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

  // A full real Monopoly game is long; run a bounded 2-player (human + 1 bot) game so
  // the e2e reaches a real last-solvent finish within the test budget. Override with
  // MONOPOLY_BOTS to run more bots.
  if (!process.env.MONOPOLY_BOTS) process.env.MONOPOLY_BOTS = "1";

  console.log(existsSync(PLAYERS) ? "[e2e-setup] topping up existing players…" : "[e2e-setup] funding new players…");
  await new Promise<void>((resolve, reject) => {
    const f = run(tsx, ["scripts/fund-players.ts"], "fund", false);
    f.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`fund-players exited ${code}`))));
  });

  console.log("[e2e-setup] starting game server…");
  const server = run(tsx, ["scripts/server.ts"], "server", true);
  if (server.pid) pids.push(server.pid);
  if (!(await waitForHealth(SERVER_URL, 60_000))) throw new Error("game server did not become healthy");
  console.log("[e2e-setup] server healthy.");

  console.log("[e2e-setup] starting bots…");
  const bots = run(tsx, ["scripts/bots.ts"], "bots", true);
  if (bots.pid) pids.push(bots.pid);
  if (!(await waitForGame(SERVER_URL, 120_000))) throw new Error("bots did not create a game");
  console.log("[e2e-setup] game created by bots.");

  writeFileSync(PIDS, JSON.stringify({ pids }));
}

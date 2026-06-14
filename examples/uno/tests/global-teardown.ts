/** Playwright globalTeardown — kill the server + bots started in global-setup. */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PIDS = join(import.meta.dirname, "..", ".e2e-pids.json");

export default async function globalTeardown() {
  if (!existsSync(PIDS)) return;
  try {
    const { pids } = JSON.parse(readFileSync(PIDS, "utf8")) as { pids: number[] };
    for (const pid of pids) {
      try {
        // The children were spawned detached; kill the whole process group.
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
  } finally {
    rmSync(PIDS, { force: true });
  }
}

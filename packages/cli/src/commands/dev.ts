import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { requireFoundry, startAnvil } from "../lib/foundry.js";
import { log } from "../lib/log.js";
import { codegenCommand } from "./codegen.js";

export interface DevOptions {
  port?: number;
  forkRpc?: string;
  block?: number;
  noFork?: boolean;
  dryRun?: boolean;
  cwd?: string;
}

const DEV_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000 ETH)",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
];

/**
 * `nexus dev` — boot a local Base fork with the full stack pre-deployed, zero
 * credentials. `--dry-run` prints the plan without spawning anything; otherwise
 * it runs codegen, spawns anvil (forking Base unless `--no-fork`), and prints
 * the dev endpoints. (Backend + mock adapters are documented steps below.)
 */
export async function devCommand(opts: DevOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const port = opts.port ?? 8080;
  const rpcPort = 8545;
  const forkUrl = opts.noFork ? undefined : (opts.forkRpc ?? "https://mainnet.base.org");

  log.title("nexus dev");
  log.step("Plan:");
  log.info("1. codegen      — regenerate manifest + Solidity table glue");
  log.info(
    opts.noFork
      ? "2. anvil        — fresh local chain (no upstream state)"
      : `2. anvil        — fork Base from ${forkUrl}${opts.block ? ` @ block ${opts.block}` : ""}`,
  );
  log.info("3. deploy       — World + systems + enforcers onto the fork (forge)");
  log.info("4. mock adapters— relayer=mock secrets=mock-lit vrf=mock (no credentials)");
  log.info("5. backend      — dev mode, in-memory indexer, gateway");

  if (opts.dryRun) {
    log.warn("dry-run: printing the plan only, nothing spawned");
    log.arrow(`Gateway  would listen on  http://localhost:${port}`);
    log.arrow(`RPC      would listen on  http://localhost:${rpcPort}`);
    return;
  }

  // 1. codegen (best-effort: only if a game module is present)
  if (existsSync(resolve(cwd, "game/game.ts"))) {
    await codegenCommand({ cwd });
  } else {
    log.warn("no game/game.ts found — skipping codegen");
  }

  // 2. anvil fork
  requireFoundry();
  log.step("starting anvil…");
  const anvil = await startAnvil({
    port: rpcPort,
    forkUrl,
    forkBlockNumber: opts.block,
  });
  log.ok(
    `anvil up — ${anvil.rpcUrl}${forkUrl ? "  (forked Base, copy-on-read)" : "  (fresh chain)"}`,
  );

  // 3-5 are the backend/deploy orchestration (Phase 05 dependency). The fork is
  // live; deploy + backend wiring land when @nexus/backend ships. We keep anvil
  // running so the developer can deploy/interact, and stop it on Ctrl-C.
  log.warn("deploy + dev backend wiring requires @nexus/backend (Phase 05) — not yet wired");
  log.arrow(`RPC          ${anvil.rpcUrl}`);
  log.arrow(`Gateway      http://localhost:${port}  (pending @nexus/backend)`);
  log.info(`Dev accounts ${DEV_ACCOUNTS.join("  ")}`);
  log.info("Ctrl-C to stop the fork.");

  const stop = () => {
    anvil.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // Keep the process alive while anvil runs.
  await new Promise<void>((resolveProc) => {
    anvil.proc.on("exit", () => resolveProc());
  });
}

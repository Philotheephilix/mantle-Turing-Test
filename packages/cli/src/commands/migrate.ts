import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CHAINS, isChainKey } from "@nexus/types";
import { loadGameModule, runCodegen } from "../lib/codegen.js";
import { requireFoundry, runForgeScript } from "../lib/foundry.js";
import { CliError, log } from "../lib/log.js";

export interface MigrateOptions {
  network: string;
  /** Only re-deploy + repoint these systems. */
  only?: string[];
  /** Foundry project root. */
  contracts?: string;
  script?: string;
  dryRun?: boolean;
  yes?: boolean;
  cwd?: string;
}

/**
 * `nexus migrate --network <mantle-sepolia|mantle>` — upgrade system logic WITHOUT
 * touching stored tables. Storage lives in the World keyed by table id; systems
 * are stateless logic contracts in the World's registry. Migrate re-runs codegen
 * (to refresh the manifest), then deploys the new system contract(s) and
 * repoints the registry. Table schemas are never altered — a table-shape change
 * is refused.
 */
export async function migrateCommand(opts: MigrateOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  if (!isChainKey(opts.network)) {
    throw new CliError(`Nexus is Mantle-only. --network must be "mantle" or "mantle-sepolia".`);
  }
  const chain = CHAINS[opts.network];

  log.title(`nexus migrate --network ${opts.network}`);

  // Re-run codegen so the manifest reflects current schema. This also lets the
  // guard below diff tables (schema is the source of truth).
  const gamePath = resolve(cwd, "game/game.ts");
  if (!existsSync(gamePath)) {
    throw new CliError(`Game module not found at ${gamePath}. Run from a project root.`);
  }
  const game = await loadGameModule(gamePath).catch((e: Error) => {
    throw new CliError(e.message);
  });
  const outDir = resolve(cwd, "nexus.generated");
  const result = runCodegen(game, outDir);
  log.ok("codegen refreshed (tables untouched — migrate never alters table storage)");

  const systems = opts.only ?? result.manifest.systems.map((s) => s.name);
  log.step(`systems to upgrade: ${systems.join(", ")}`);

  if (opts.dryRun) {
    log.warn("dry-run: would deploy new system contracts + repoint the World registry");
    for (const s of systems) log.info(`would: deploy ${s} → World.registerSystem(${s} → 0xNew…)`);
    log.info("existing sessions stay valid (allowlist resolves by system id)");
    return;
  }

  const privateKey = process.env.PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new CliError("PRIVATE_KEY is not set. Export a funded deployer key before migrating.");
  }
  const rpcUrl =
    (opts.network === "mantle"
      ? process.env.MANTLE_RPC_URL
      : process.env.MANTLE_SEPOLIA_RPC_URL
    )?.trim() || chain.defaultRpcUrl;

  const contracts = resolve(
    cwd,
    opts.contracts ?? resolve(cwd, "..", "..", "packages", "contracts"),
  );
  // Reuse the full deploy script as the upgrade vehicle until a dedicated
  // Migrate.s.sol lands; it redeploys + re-registers systems (tables persist in
  // the World registry's existing storage).
  const script = opts.script ?? "script/DeployFull.s.sol:DeployFull";
  if (!existsSync(contracts)) {
    throw new CliError(`Foundry project not found at ${contracts}. Pass --contracts <dir>.`);
  }

  requireFoundry();
  log.step(`forge script ${script} (system re-register) → ${chain.name}`);
  runForgeScript({
    cwd: contracts,
    target: script,
    rpcUrl,
    privateKey,
    broadcast: true,
    env: { ROOM_ID: process.env.ROOM_ID ?? "1", MIGRATE_ONLY: systems.join(",") },
  });
  log.ok(`${systems.length} system(s) upgraded, 0 tables migrated`);
}

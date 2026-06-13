import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAINS, isChainKey } from "@nexus/types";
import { requireFoundry, runForgeScript } from "../lib/foundry.js";
import { CliError, log } from "../lib/log.js";
import { readManifest } from "../lib/manifest.js";

export interface DeployOptions {
  network: string;
  /** Path to the deploy manifest. Defaults to nexus.generated/manifest.json. */
  manifest?: string;
  /** Foundry project root (where the forge deploy script lives). */
  contracts?: string;
  /** "script/DeployFull.s.sol:DeployFull" */
  script?: string;
  dryRun?: boolean;
  yes?: boolean;
  cwd?: string;
}

/**
 * `nexus deploy --network <base-sepolia|base>` — read the manifest and invoke
 * the foundry deploy (forge script), then print/record the deployed addresses.
 *
 * Requires `PRIVATE_KEY` (a funded deployer) and a Base RPC URL in env
 * (`BASE_RPC_URL` / `BASE_SEPOLIA_RPC_URL`, else the public default).
 */
export function deployCommand(opts: DeployOptions): void {
  const cwd = opts.cwd ?? process.cwd();
  const network = opts.network;
  if (!isChainKey(network)) {
    throw new CliError(`Nexus is Base-only. --network must be "base" or "base-sepolia".`);
  }
  const chain = CHAINS[network];

  const manifestPath = resolve(cwd, opts.manifest ?? "nexus.generated/manifest.json");
  const manifest = readManifest(manifestPath);

  log.title(`nexus deploy --network ${network}`);
  log.step(
    `Plan: World + ${manifest.tables.length} tables + ${manifest.systems.length} systems + enforcers`,
  );
  for (const tbl of manifest.tables) log.info(`table  ${tbl.name}`);
  for (const sys of manifest.systems) log.info(`system ${sys.name}`);

  // Deployer key + RPC come from env (never relayer/Lit secrets).
  const privateKey = process.env.PRIVATE_KEY?.trim();
  const rpcUrl =
    (network === "base" ? process.env.BASE_RPC_URL : process.env.BASE_SEPOLIA_RPC_URL)?.trim() ||
    chain.defaultRpcUrl;

  if (opts.dryRun) {
    log.warn("dry-run: simulating, deploying nothing");
    log.info(`would deploy to ${chain.name} (chainId ${chain.id}) via ${rpcUrl}`);
    return;
  }

  if (!privateKey) {
    throw new CliError(
      "PRIVATE_KEY is not set. Export a funded deployer key (and a Base RPC URL) before deploying.",
    );
  }
  if (!opts.yes) {
    log.warn(
      `Deploying to ${chain.name}${network === "base" ? " MAINNET" : ""}. Re-run with --yes to confirm in CI.`,
    );
  }

  // Locate the foundry project + deploy script. Defaults to the monorepo
  // contracts package's DeployFull, matching scripts/lib/deploy.ts.
  const contracts = resolve(
    cwd,
    opts.contracts ?? resolve(cwd, "..", "..", "packages", "contracts"),
  );
  const script = opts.script ?? "script/DeployFull.s.sol:DeployFull";
  if (!existsSync(contracts)) {
    throw new CliError(
      `Foundry project not found at ${contracts}. Pass --contracts <dir> pointing at your forge project.`,
    );
  }

  requireFoundry();
  log.step(`forge script ${script} → ${chain.name}`);
  runForgeScript({
    cwd: contracts,
    target: script,
    rpcUrl,
    privateKey,
    broadcast: true,
    env: { ROOM_ID: process.env.ROOM_ID ?? "1" },
  });

  // Record the deployment pointer for the backend / migrate.
  const deploymentsDir = resolve(cwd, "deployments");
  mkdirSync(deploymentsDir, { recursive: true });
  const out = resolve(deploymentsDir, `${network}.json`);
  writeFileSync(
    out,
    `${JSON.stringify({ network, chainId: chain.id, game: manifest.name, manifest: manifestPath }, null, 2)}\n`,
  );
  log.ok(`wrote ${out}`);
  log.info("Set WORLD_ADDRESS in your backend env from the forge output above.");
}

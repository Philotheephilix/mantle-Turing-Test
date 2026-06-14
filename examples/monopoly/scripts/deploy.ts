/**
 * Deploy the Monopoly + Nexus stack to Base Sepolia using the hardcoded funded
 * relayer/deployer key. Runs the Foundry DeployMonopoly script (real on-chain
 * deployment), which writes examples/monopoly/deployments/base-sepolia.json.
 *
 *   pnpm deploy
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { serverConfig } from "../lib/config.ts";
import { MONOPOLY_SYSTEM_ID } from "../lib/game.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS = resolve(__dirname, "..", "contracts");
const FORGE = `${process.env.HOME}/.foundry/bin/forge`;

function main(): void {
  const cfg = serverConfig();
  const deployer = privateKeyToAccount(cfg.relayerKey);
  console.log(`Deploying Monopoly to Base Sepolia as ${deployer.address}`);
  console.log(`  USDC (bank token): ${cfg.usdc}`);
  console.log(`  system alias id:   ${MONOPOLY_SYSTEM_ID}`);

  execFileSync(
    FORGE,
    [
      "script",
      "DeployMonopoly.s.sol:DeployMonopoly",
      "--rpc-url",
      cfg.rpcUrl,
      "--private-key",
      cfg.relayerKey,
      "--broadcast",
      "--skip-simulation",
    ],
    {
      cwd: CONTRACTS,
      stdio: "inherit",
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}`,
        PLAYER: deployer.address,
        ROOM_ID: "1",
        USDC: cfg.usdc,
        ALIAS_SYS_ID: MONOPOLY_SYSTEM_ID,
        OUT_PATH: "base-sepolia.json",
      },
    },
  );

  console.log("\n✓ Monopoly deployed. Addresses at examples/monopoly/deployments/base-sepolia.json");
}

main();

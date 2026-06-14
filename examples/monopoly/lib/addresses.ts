/**
 * Load the Base Sepolia deployment (examples/monopoly/deployments/base-sepolia.json)
 * into the @nexus/core DeploymentAddresses shape used by the delegation engine and
 * the backend.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeploymentAddresses } from "@nexus/core";
import type { Address, Hex } from "@nexus/types";

export interface MonopolyDeployment extends DeploymentAddresses {
  monopolyGame: Address;
  monopolyGameSystemId: Hex;
  turnManager: Address;
  randomness: Address;
  pot: Address;
  roomId: bigint;
}

function deploymentPath(): string {
  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    here = process.cwd();
  }
  const candidates = [
    resolve(here, "..", "deployments", "base-sepolia.json"),
    resolve(process.cwd(), "deployments", "base-sepolia.json"),
    resolve(process.cwd(), "examples", "monopoly", "deployments", "base-sepolia.json"),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(
    `Monopoly deployment not found. Run \`pnpm deploy\` first. Looked in: ${candidates.join(", ")}`,
  );
}

export function loadDeployment(): MonopolyDeployment {
  const j = JSON.parse(readFileSync(deploymentPath(), "utf8"));
  return {
    world: j.world,
    delegationManager: j.delegationManager,
    turnManager: j.turnManager,
    monopolyGame: j.monopolyGame,
    monopolyGameSystemId: j.monopolyGameSystemId,
    randomness: j.randomness,
    usdc: j.usdc,
    pot: j.pot,
    roomId: BigInt(j.roomId),
    enforcers: {
      turnBound: j.enforcers.turnBound,
      systemAllowlist: j.enforcers.systemAllowlist,
      timestamp: j.enforcers.timestamp,
      limitedCalls: j.enforcers.limitedCalls,
      perActionCap: j.enforcers.perActionCap,
      erc20TransferAmount: j.enforcers.erc20TransferAmount,
      allowedRecipients: j.enforcers.allowedRecipients,
    },
  };
}

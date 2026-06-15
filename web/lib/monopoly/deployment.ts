/**
 * The deployed Mantle Sepolia addresses (written by DeployMonopoly). Safe to import
 * from the browser — these are public addresses only. Mirrors examples/uno/lib/deployment.ts.
 */
import type { DeploymentAddresses } from "@steamlink/core";
import type { Address, Hex } from "@steamlink/types";
import raw from "./deployments/mantle-sepolia.json" with { type: "json" };

export interface MonopolyDeploymentJson {
  chainId: number;
  world: Address;
  delegationManager: Address;
  turnManager: Address;
  monopolyGame: Address;
  monopolyGameSystemId: Hex;
  randomness: Address;
  usdc: Address;
  pot: Address;
  roomId: number;
  relayer: Address;
  enforcers: {
    turnBound: Address;
    systemAllowlist: Address;
    timestamp: Address;
    limitedCalls: Address;
    perActionCap: Address;
    erc20TransferAmount: Address;
    allowedRecipients: Address;
  };
}

export const deployment = raw as unknown as MonopolyDeploymentJson;

/** The DeploymentAddresses shape @steamlink/core's caveat builders expect. */
export const addresses: DeploymentAddresses = {
  world: deployment.world,
  delegationManager: deployment.delegationManager,
  turnManager: deployment.turnManager,
  usdc: deployment.usdc,
  enforcers: deployment.enforcers,
};

export const MONOPOLY_SYSTEM_ID = deployment.monopolyGameSystemId;
export const POT_ADDRESS = deployment.pot;
export const RELAYER_ADDRESS = deployment.relayer;
export const WORLD_ADDRESS = deployment.world;

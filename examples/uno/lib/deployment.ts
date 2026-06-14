/**
 * The deployed Base Sepolia addresses (written by scripts/deploy.sh / DeployUno).
 * Safe to import from the browser — these are public addresses only.
 */
import type { DeploymentAddresses } from "@nexus/core";
import type { Address, Hex } from "@nexus/types";
import raw from "../deployments/base-sepolia.json" with { type: "json" };

export interface UnoDeployment {
  chainId: number;
  world: Address;
  delegationManager: Address;
  turnManager: Address;
  unoGame: Address;
  randomness: Address;
  unoGameSystemId: Hex;
  usdc: Address;
  pot: Address;
  roomId: number;
  deployBlock: number;
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

export const deployment = raw as unknown as UnoDeployment;

/** The DeploymentAddresses shape @nexus/core's caveat builders expect. */
export const addresses: DeploymentAddresses = {
  world: deployment.world,
  delegationManager: deployment.delegationManager,
  turnManager: deployment.turnManager,
  usdc: deployment.usdc,
  enforcers: deployment.enforcers,
};

export const UNO_SYSTEM_ID = deployment.unoGameSystemId;
export const POT_ADDRESS = deployment.pot;
export const RELAYER_ADDRESS = deployment.relayer;
export const WORLD_ADDRESS = deployment.world;
export const ON_CHAIN_ROOM_ID = BigInt(deployment.roomId);

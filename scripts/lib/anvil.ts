import { type ChildProcess, spawn } from "node:child_process";
import { createPublicClient, http } from "viem";

/** Well-known anvil dev accounts (deterministic mnemonic). */
export const ANVIL_ACCOUNTS = {
  deployer: {
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  },
  player: {
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  },
  player2: {
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  },
} as const;

export const ANVIL_RPC = "http://127.0.0.1:8545";
export const ANVIL_CHAIN_ID = 31337;

/** Start a local anvil node and resolve once it answers JSON-RPC. */
export async function startAnvil(): Promise<{ proc: ChildProcess; stop: () => void }> {
  const proc = spawn("anvil", ["--silent", "--chain-id", String(ANVIL_CHAIN_ID)], {
    env: { ...process.env, PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}` },
    stdio: "ignore",
  });
  const probe = createPublicClient({ transport: http(ANVIL_RPC) });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await probe.getChainId();
      break;
    } catch {
      if (Date.now() > deadline) {
        proc.kill();
        throw new Error("anvil did not start within 15s");
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return { proc, stop: () => proc.kill() };
}

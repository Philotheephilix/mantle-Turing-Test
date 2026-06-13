import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createPublicClient, http } from "viem";
import { CliError } from "./log.js";

const FOUNDRY_BIN = `${process.env.HOME}/.foundry/bin`;
const FORGE = `${FOUNDRY_BIN}/forge`;
const ANVIL = `${FOUNDRY_BIN}/anvil`;

const FOUNDRY_INSTALL_HINT =
  "Foundry not found. Install: `curl -L https://foundry.paradigm.xyz | bash && foundryup`";

function foundryEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${FOUNDRY_BIN}:${process.env.PATH}` };
}

/** Assert `forge` and `anvil` resolve, else throw the install hint. */
export function requireFoundry(): void {
  try {
    execFileSync(FORGE, ["--version"], { stdio: "ignore", env: foundryEnv() });
    execFileSync(ANVIL, ["--version"], { stdio: "ignore", env: foundryEnv() });
  } catch {
    throw new CliError(FOUNDRY_INSTALL_HINT);
  }
}

export interface ForgeScriptParams {
  /** Foundry project root (cwd for forge). */
  cwd: string;
  /** "script/DeployFull.s.sol:DeployFull" */
  target: string;
  rpcUrl: string;
  privateKey: string;
  /** broadcast (real send). When false runs a simulation only (dry run). */
  broadcast: boolean;
  /** extra env vars passed to the script (PLAYER, ROOM_ID, …). */
  env?: Record<string, string>;
  extraArgs?: string[];
}

/**
 * Invoke `forge script` exactly like scripts/lib/deploy.ts does — same binary,
 * same env-PATH shim, stdio inherited so the forge trace streams to the user.
 */
export function runForgeScript(p: ForgeScriptParams): void {
  const args = ["script", p.target, "--rpc-url", p.rpcUrl, "--private-key", p.privateKey];
  if (p.broadcast) args.push("--broadcast", "--skip-simulation");
  if (p.extraArgs) args.push(...p.extraArgs);
  try {
    execFileSync(FORGE, args, {
      cwd: p.cwd,
      stdio: "inherit",
      env: { ...foundryEnv(), ...(p.env ?? {}) },
    });
  } catch (e) {
    throw new CliError(`forge script failed: ${(e as Error).message}`);
  }
}

export interface AnvilOptions {
  chainId?: number;
  port?: number;
  /** Base RPC to fork from (copy-on-read). Omit for a fresh chain. */
  forkUrl?: string;
  /** Pin the fork at a block for determinism. */
  forkBlockNumber?: number;
}

/** Start anvil and resolve once it answers JSON-RPC. */
export async function startAnvil(opts: AnvilOptions = {}): Promise<{
  proc: ChildProcess;
  rpcUrl: string;
  stop: () => void;
}> {
  const port = opts.port ?? 8545;
  const args = ["--silent", "--port", String(port)];
  if (opts.chainId !== undefined) args.push("--chain-id", String(opts.chainId));
  if (opts.forkUrl) args.push("--fork-url", opts.forkUrl);
  if (opts.forkBlockNumber !== undefined)
    args.push("--fork-block-number", String(opts.forkBlockNumber));

  const proc = spawn(ANVIL, args, { env: foundryEnv(), stdio: "ignore" });
  const rpcUrl = `http://127.0.0.1:${port}`;
  const probe = createPublicClient({ transport: http(rpcUrl) });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await probe.getChainId();
      break;
    } catch {
      if (Date.now() > deadline) {
        proc.kill();
        throw new CliError("anvil did not start within 15s");
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return { proc, rpcUrl, stop: () => proc.kill() };
}

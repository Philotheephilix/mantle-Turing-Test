import { CHAINS, isChainKey } from "@nexus/types";
import { requireFoundry, startAnvil } from "../lib/foundry.js";
import { CliError, log } from "../lib/log.js";

export interface ForkOptions {
  from?: string;
  at?: number;
  port?: number;
  forkRpc?: string;
  dryRun?: boolean;
}

/**
 * `nexus fork` — clone live Base state into a local staging fork via
 * `anvil --fork-url` (copy-on-read: real World/table storage is pulled lazily on
 * access). Nothing settles on real Base. Reads WORLD_ADDRESS so the staging
 * backend can talk to the forked copy of the live World.
 */
export async function forkCommand(opts: ForkOptions = {}): Promise<void> {
  const from = opts.from ?? "base";
  if (!isChainKey(from)) {
    throw new CliError(`--from must be "base" or "base-sepolia" (Base-only).`);
  }
  const chain = CHAINS[from];
  const port = opts.port ?? 8546;
  const forkUrl =
    opts.forkRpc?.trim() ||
    (from === "base" ? process.env.BASE_RPC_URL : process.env.BASE_SEPOLIA_RPC_URL)?.trim() ||
    chain.defaultRpcUrl;

  log.title(`nexus fork --from ${from}`);
  const world = process.env.WORLD_ADDRESS?.trim();
  if (world) log.info(`live World ${world}`);
  else log.warn("WORLD_ADDRESS unset — set it to the live World you want to fork");

  if (opts.dryRun) {
    log.warn("dry-run: would start anvil --fork-url, nothing spawned");
    log.info(`would fork ${chain.name} from ${forkUrl}${opts.at ? ` @ block ${opts.at}` : ""}`);
    log.arrow(`Staging RPC would listen on http://localhost:${port}`);
    return;
  }

  requireFoundry();
  log.step(`forking ${chain.name}…`);
  const anvil = await startAnvil({ port, forkUrl, forkBlockNumber: opts.at });
  log.ok(`forked ${chain.name}${opts.at ? ` @ ${opts.at}` : ""} — live state, copy-on-read`);
  log.arrow(`Staging RPC   ${anvil.rpcUrl}`);
  log.info("Live state cloned. Test migrations/features here; nothing settles on real Base.");
  log.info("Ctrl-C to stop the fork.");

  const stop = () => {
    anvil.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise<void>((resolveProc) => {
    anvil.proc.on("exit", () => resolveProc());
  });
}

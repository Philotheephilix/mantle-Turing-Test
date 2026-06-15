import { log } from "../lib/log.js";
import { scaffoldProject } from "../lib/scaffold.js";

export interface InitOptions {
  cwd?: string;
}

/** `nexus init <name>` — scaffold a new game project from the default template. */
export function initCommand(name: string, opts: InitOptions = {}): void {
  log.title(`nexus init ${name}`);
  const { dir, files } = scaffoldProject(name, opts.cwd);
  log.ok(`Scaffolded ${name}/ (template: default)`);
  for (const f of files) log.info(`wrote ${f}`);
  log.plain("");
  log.plain("  Next:");
  log.plain(`    cd ${name}`);
  log.plain("    nexus codegen      # generate Solidity glue + manifest");
  log.plain("    nexus dev          # local Mantle fork, full stack, zero credentials");
  log.plain("");
  void dir;
}

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadGameModule, runCodegen } from "../lib/codegen.js";
import { CliError, log } from "../lib/log.js";

export interface CodegenOptions {
  /** Path to the defineGame module. Defaults to ./game/game.ts. */
  game?: string;
  /** Output dir. Defaults to <project>/nexus.generated. */
  out?: string;
  cwd?: string;
}

/**
 * `nexus codegen [--game <path>]` — import a defineGame module, run
 * buildManifest + generateSolidityTables, and write the tables .sol + a
 * manifest.json into the game's generated/ dir.
 */
export async function codegenCommand(opts: CodegenOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const gamePath = resolve(cwd, opts.game ?? "game/game.ts");
  const outDir = resolve(cwd, opts.out ?? "nexus.generated");

  if (!existsSync(gamePath)) {
    throw new CliError(
      `Game module not found at ${gamePath}. Pass --game <path> or run from a project root.`,
    );
  }

  log.title("nexus codegen");
  log.step(`loading ${gamePath}`);
  const game = await loadGameModule(gamePath).catch((e: Error) => {
    throw new CliError(e.message);
  });
  const result = runCodegen(game, outDir);

  log.ok(
    `${game.name}: ${result.manifest.tables.length} tables, ${result.manifest.systems.length} systems`,
  );
  log.info(`wrote ${result.files.manifest}`);
  log.info(`wrote ${result.files.tablesSol}`);
}

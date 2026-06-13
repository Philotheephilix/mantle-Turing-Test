import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DeployManifest } from "@nexus/core";
import { CliError } from "./log.js";

/** Read + validate a deploy manifest written by codegen. */
export function readManifest(path: string): DeployManifest {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    throw new CliError(`Manifest not found at ${abs}. Run \`nexus codegen\` first.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    throw new CliError(`Manifest at ${abs} is not valid JSON: ${(e as Error).message}`);
  }
  const m = parsed as Partial<DeployManifest>;
  if (typeof m.name !== "string" || !Array.isArray(m.tables) || !Array.isArray(m.systems)) {
    throw new CliError(`Manifest at ${abs} is missing required fields (name/tables/systems).`);
  }
  return m as DeployManifest;
}

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../src/lib/log.js";
import { scaffoldProject } from "../src/lib/scaffold.js";

describe("scaffoldProject", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(resolve(tmpdir(), "nexus-init-"));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("creates the starter project file tree in a temp dir", () => {
    const { dir, files } = scaffoldProject("my-game", cwd);

    expect(dir).toBe(resolve(cwd, "my-game"));
    for (const rel of [
      "game/game.ts",
      "systems/PlayCard.sol",
      "nexus.config.ts",
      "package.json",
      "tsconfig.json",
      ".gitignore",
      ".env.example",
      "README.md",
    ]) {
      expect(files).toContain(rel);
      expect(existsSync(resolve(dir, rel))).toBe(true);
    }
  });

  it("writes a defineGame module named after the project", () => {
    const { dir } = scaffoldProject("checkers", cwd);
    const gameTs = readFileSync(resolve(dir, "game/game.ts"), "utf8");
    expect(gameTs).toContain('name: "checkers"');
    expect(gameTs).toContain("defineGame");
    expect(gameTs).toContain("export default game");

    const pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("checkers");
    expect(pkg.dependencies["@nexus/core"]).toBeDefined();
  });

  it("rejects an invalid project name", () => {
    expect(() => scaffoldProject("Bad Name", cwd)).toThrow(CliError);
  });

  it("refuses a non-empty target directory", () => {
    const target = resolve(cwd, "taken");
    writeFileSync(resolve(cwd, "placeholder.txt"), "x");
    // create the dir with a file in it
    scaffoldProject("taken", cwd);
    expect(() => scaffoldProject("taken", cwd)).toThrow(/not empty/);
    void target;
  });
});

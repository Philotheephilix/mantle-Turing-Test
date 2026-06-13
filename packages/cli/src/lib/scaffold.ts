import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CliError } from "./log.js";

export interface ScaffoldResult {
  dir: string;
  /** Project-relative paths of every file written. */
  files: string[];
}

/**
 * Scaffold a new Nexus game project into `<cwd>/<name>`. Writes a runnable
 * starter: a `defineGame` module (tables + systems + economy), a starter
 * system .sol, nexus.config.ts, package.json, tsconfig.json and a README.
 *
 * Throws if the target directory already exists and is non-empty.
 */
export function scaffoldProject(name: string, cwd = process.cwd()): ScaffoldResult {
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    throw new CliError(
      `Invalid project name "${name}": use lower-kebab/snake starting with a letter.`,
    );
  }
  const dir = resolve(cwd, name);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new CliError(`Directory not empty: ${dir}. Pass a new name or remove it.`);
  }

  const files = templates(name);
  for (const [rel, content] of Object.entries(files)) {
    const abs = resolve(dir, rel);
    mkdirSync(resolve(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return { dir, files: Object.keys(files) };
}

/** The starter project file map (relative path -> contents). */
function templates(name: string): Record<string, string> {
  return {
    "game/game.ts": GAME_TS(name),
    "systems/PlayCard.sol": PLAYCARD_SOL,
    "nexus.config.ts": NEXUS_CONFIG_TS,
    "package.json": PACKAGE_JSON(name),
    "tsconfig.json": TSCONFIG_JSON,
    ".gitignore": GITIGNORE,
    ".env.example": ENV_EXAMPLE,
    "README.md": README_MD(name),
  };
}

const GAME_TS = (name: string) => `import { defineGame, t } from "@nexus/core";

/**
 * Your game as data (tables) + logic (systems). This is the single source of
 * truth: \`nexus codegen\` derives the Solidity table library + deploy manifest
 * and the typed client from this file.
 */
export const game = defineGame({
  name: "${name}",

  // ── tables: your onchain state schema ──
  tables: {
    Player: { id: t.address, roomId: t.uint, isReady: t.bool },
    Hand: { player: t.address, commitment: t.bytes32, count: t.uint8 },
    DiscardPile: { roomId: t.uint, topCard: t.uint8, activeColor: t.uint8 },
    TurnOrder: { roomId: t.uint, current: t.address, direction: t.int8, deadline: t.uint },
  },

  // ── systems: your logic contracts (Solidity sources) ──
  systems: {
    PlayCardSystem: "./systems/PlayCard.sol",
  },

  // ── monetization hooks ──
  economy: {
    entryFee: { amount: "5", token: "USDC" },
    pot: { type: "winner-take-all", rake: "0.02" },
  },
});

export default game;
`;

const PLAYCARD_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {GameTables} from "../nexus.generated/GameTables.sol";

/**
 * Starter system. Systems are stateless logic contracts: they read/write tables
 * in the World (storage lives in the World, never in the system) and emit
 * events. Clients dispatch here via \`nexus.move("PlayCardSystem", { … })\`.
 *
 * The generated GameTables library (run \`nexus codegen\`) exposes the table ids
 * and row structs referenced below.
 */
contract PlayCardSystem {
    event CardPlayed(uint256 indexed roomId, address indexed player, uint8 card);

    /// @notice Play a card. Replace with your real rule checks + table writes.
    function playCard(uint256 roomId, uint8 card, uint8 colorChoice) external {
        // TODO: validate the move, write DiscardPile, rotate TurnOrder.
        emit CardPlayed(roomId, msg.sender, card);
    }
}
`;

const NEXUS_CONFIG_TS = `import { game } from "./game/game.js";

/**
 * Nexus project config. Read by the CLI (\`deploy\`, \`dev\`, \`migrate\`, \`fork\`)
 * and the backend. Nexus is Base-only by construction.
 */
export const config = {
  chain: "base" as const,
  /** Set after \`nexus deploy\` (or via WORLD_ADDRESS env). */
  world: process.env.WORLD_ADDRESS as \`0x\${string}\` | undefined,
  /** Where codegen writes the manifest + Solidity table glue. */
  generatedDir: "./nexus.generated",
  /** Path to the defineGame module the CLI imports for codegen/deploy. */
  gamePath: "./game/game.ts",
  games: [game],
};

export default config;
`;

const PACKAGE_JSON = (name: string) =>
  `${JSON.stringify(
    {
      name,
      version: "0.0.0",
      private: true,
      type: "module",
      scripts: {
        codegen: "nexus codegen",
        dev: "nexus dev",
        deploy: "nexus deploy --network base",
      },
      dependencies: {
        "@nexus/core": "workspace:*",
      },
      devDependencies: {
        "@nexus/cli": "workspace:*",
        tsx: "^4.19.2",
        typescript: "^5.7.2",
      },
    },
    null,
    2,
  )}\n`;

const TSCONFIG_JSON = `${JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true,
    },
    include: ["game", "nexus.config.ts", "nexus.generated"],
  },
  null,
  2,
)}\n`;

const GITIGNORE = `node_modules
nexus.generated/
.nexus/
.env
out/
cache/
`;

const ENV_EXAMPLE = `# Filled in for deploy / prod serve only. \`nexus dev\` needs NONE of these.
WORLD_ADDRESS=
# Funded deployer key used by \`nexus deploy\` (never your relayer/Lit secret).
PRIVATE_KEY=
# Base RPC (defaults to the public endpoint if unset).
BASE_RPC_URL=
BASE_SEPOLIA_RPC_URL=
`;

const README_MD = (name: string) => `# ${name}

A Nexus game — fully onchain, turn-based, on Base. Built with the
[\`@nexus/cli\`](https://github.com/) scaffolder.

## Quick start

\`\`\`bash
nexus codegen        # generate Solidity table glue + the deploy manifest
nexus dev --dry-run  # see the local-stack plan (anvil fork + deploy)
nexus dev            # boot a local Base fork, deploy, mock adapters (zero credentials)
\`\`\`

## Ship it

\`\`\`bash
# requires PRIVATE_KEY (funded deployer) + a Base RPC in .env
nexus deploy --network base-sepolia
\`\`\`

## Layout

| Path | What |
|---|---|
| \`game/game.ts\` | \`defineGame\`: tables + systems + economy (the source of truth). |
| \`systems/*.sol\` | Your logic contracts. |
| \`nexus.config.ts\` | Project config read by the CLI + backend. |
| \`nexus.generated/\` | Codegen output (gitignored): \`manifest.json\` + \`GameTables.sol\`. |

Edit \`game/game.ts\`, re-run \`nexus codegen\`, and your Solidity table glue +
deploy manifest regenerate from the schema.
`;

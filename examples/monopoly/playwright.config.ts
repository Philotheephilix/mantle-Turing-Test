import { defineConfig } from "@playwright/test";

/**
 * Full-flow Monopoly e2e against the LIVE Base Sepolia deployment. The test launches
 * a PERSISTENT browser context (chromium.launchPersistentContext) so the guest-wallet
 * session in localStorage survives across steps. globalSetup funds the player keys
 * and starts the game server + bots; the Next dev app is started by `webServer`.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/*.e2e.ts"],
  // A full real Monopoly game to a last-solvent finish (2 players, serialized relayer
  // txs, Base Sepolia confirmations) plus the connect + buy-in phases can run ~30 min.
  // Give a generous budget so the in-test drive-loop deadline (set in the test, lower
  // than this) always fires FIRST — the test asserts/exits cleanly instead of
  // Playwright force-closing the context mid-loop.
  timeout: 2_700_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/global-setup.ts",
  globalTeardown: "./tests/global-teardown.ts",
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3030",
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});

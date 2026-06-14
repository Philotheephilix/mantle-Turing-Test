import { defineConfig } from "@playwright/test";

/**
 * The full-flow e2e drives the REAL app against the REAL backend on Base Sepolia.
 * It uses a PERSISTENT browser context (see tests/uno.spec.ts) so the guest
 * wallet / login session survives across steps and runs.
 *
 * The dev server and backend must be running:
 *   pnpm --filter @nexus/example-uno backend     # gateway on :8790
 *   pnpm --filter @nexus/example-uno dev          # app on :3100
 * (or set webServer below to auto-start the Next app).
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/global-setup.ts",
  globalTeardown: "./tests/global-teardown.ts",
  use: {
    baseURL: process.env.UNO_APP_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: process.env.UNO_APP_URL ?? "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

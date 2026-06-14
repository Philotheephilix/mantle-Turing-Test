/**
 * SERVER-ONLY config. NEVER import this from a client component — it reads the
 * hardcoded relayer private key from examples/.shared-env.local / process.env.
 *
 * The relayer key both deploys the contracts and pays gas on Base Sepolia
 * (gasless for players). Players never see it: they log in with Privy (or the
 * dev guest wallet) and only SIGN gateway-auth requests + delegations.
 */
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Parse a dotenv-style file into a plain record (no external dep). */
function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

// examples/.shared-env.local lives one level above examples/uno.
const sharedEnv = parseEnvFile(resolve(ROOT, "..", ".shared-env.local"));
const localEnv = parseEnvFile(resolve(ROOT, ".env.local"));

function envVar(key: string, fallback?: string): string {
  return process.env[key] ?? localEnv[key] ?? sharedEnv[key] ?? fallback ?? "";
}

/**
 * ⚠️ TESTNET ONLY — hardcoded so the example is self-contained and runnable out of
 * the box. This is a Base Sepolia test key the project owner provided for the demo;
 * it holds only testnet ETH/USDC. ROTATE / replace before any mainnet use, and
 * never reuse it for real funds. Overridable via NEXUS_RELAYER_PRIVATE_KEY.
 */
const HARDCODED_RELAYER_KEY =
  "0x18842c41d9c77a305c3e4c88d75d22c085d60a3e5e2452f5444633167a6dbaae";
const HARDCODED_RELAYER_ADDRESS = "0xA3327d90d087cdddfB99E598E50B5Bdee7fC55bD";

export const RELAYER_PRIVATE_KEY = envVar(
  "NEXUS_RELAYER_PRIVATE_KEY",
  HARDCODED_RELAYER_KEY,
) as `0x${string}`;
export const RELAYER_ADDRESS = envVar(
  "NEXUS_RELAYER_ADDRESS",
  HARDCODED_RELAYER_ADDRESS,
) as `0x${string}`;
export const BASE_SEPOLIA_RPC_URL = envVar("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org");
export const USDC_ADDRESS = envVar(
  "USDC_ADDRESS",
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
) as `0x${string}`;
export const WEBHOOK_SECRET = envVar("NEXUS_WEBHOOK_SECRET", "uno-example-webhook-secret");
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Entry fee, in human USDC units. The headline x402 payment. Kept small for
 *  testnet so each funded player wallet (≈0.5 USDC) can cover the buy-in. */
export const ENTRY_FEE_USDC = envVar("ENTRY_FEE_USDC", "0.1");

export function assertServerConfig(): void {
  if (!RELAYER_PRIVATE_KEY || !RELAYER_PRIVATE_KEY.startsWith("0x")) {
    throw new Error(
      "NEXUS_RELAYER_PRIVATE_KEY missing — expected in examples/.shared-env.local",
    );
  }
}

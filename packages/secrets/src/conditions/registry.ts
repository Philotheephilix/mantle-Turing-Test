/**
 * Named access-condition templates (phase-08 Task 6 & 7, design §8).
 *
 * Developers pick a policy by name instead of hand-writing access-control
 * conditions; the registry expands the name → `AccessCondition[]`, substitutes
 * dynamic context variables, and pins `chain` to a Base value. Custom policies
 * can be registered and are validated at registration time.
 */

import { NexusError } from "@nexus/types";
import type { AccessCondition, Comparator, SecretsChain } from "../types.js";

/**
 * Variables a policy template may read. All optional — a template references the
 * ones it needs; referencing an undeclared one is rejected at registration.
 */
export type PolicyContext = {
  /** The World contract address. */
  world?: `0x${string}`;
  /** The escrow/facilitator contract (payment policies). */
  escrow?: `0x${string}`;
  handId?: string;
  roomId?: string;
  roundId?: string;
  invoiceId?: string;
  deadline?: string;
  /** Which Base chain to pin conditions to. Defaults to "base". */
  chain?: SecretsChain;
};

/** A policy template: a pure function from context to Base-only conditions. */
export type PolicyTemplate = (ctx: PolicyContext) => AccessCondition[];

const VALID_COMPARATORS: ReadonlySet<Comparator> = new Set(["=", ">", ">=", "<", "<=", "!="]);

function chainOf(ctx: PolicyContext): SecretsChain {
  return ctx.chain ?? "base";
}

/**
 * Built-in named templates. Each is a pure `(ctx) => AccessCondition[]`.
 *
 * - `only-owner` — only the owning player's address can decrypt.
 * - `reveal-after-round-end` — anyone may decrypt once the round has ended.
 * - `decrypt-after-payment-confirmed` — decrypt only after a payment settled on
 *   Base (x402 tie-in, Phase 07).
 */
export const BUILTIN_POLICIES: Record<string, PolicyTemplate> = {
  "only-owner": (ctx) => [
    {
      chain: chainOf(ctx),
      method: "ownerOf",
      standardContractType: "ERC721",
      contractAddress: ctx.world,
      parameters: [ctx.handId ?? ":handId"],
      returns: { comparator: "=", value: ":userAddress" },
    },
  ],

  "reveal-after-round-end": (ctx) => [
    {
      chain: chainOf(ctx),
      method: "isRoundEnded",
      standardContractType: "",
      contractAddress: ctx.world,
      parameters: [ctx.roomId ?? ":roomId", ctx.roundId ?? ":roundId"],
      returns: { comparator: "=", value: "true" },
    },
  ],

  "decrypt-after-payment-confirmed": (ctx) => [
    {
      chain: chainOf(ctx),
      method: "isSettled",
      standardContractType: "",
      contractAddress: ctx.escrow,
      parameters: [ctx.invoiceId ?? ":invoiceId"],
      returns: { comparator: "=", value: "true" },
    },
  ],
};

/** The set of context keys a template may legitimately reference. */
const KNOWN_CONTEXT_KEYS: ReadonlySet<string> = new Set<keyof PolicyContext>([
  "world",
  "escrow",
  "handId",
  "roomId",
  "roundId",
  "invoiceId",
  "deadline",
  "chain",
] as Array<keyof PolicyContext>) as ReadonlySet<string>;

/**
 * Validate that an expanded condition set honors the conventions:
 * every clause is Base-only and every `returns` is well-formed. Throws
 * `NexusError("INVALID_CONFIG")` otherwise.
 */
export function assertConditionsValid(conditions: AccessCondition[]): void {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new NexusError("INVALID_CONFIG", "policy produced no conditions");
  }
  for (const c of conditions) {
    if (c.chain !== "base" && c.chain !== "base-sepolia") {
      throw new NexusError(
        "INVALID_CONFIG",
        `non-Base condition rejected (chain=${String(c.chain)}); Nexus is Base-only`,
      );
    }
    if (typeof c.method !== "string" || c.method.length === 0) {
      throw new NexusError("INVALID_CONFIG", "condition missing method");
    }
    if (!c.returns || !VALID_COMPARATORS.has(c.returns.comparator)) {
      throw new NexusError(
        "INVALID_CONFIG",
        `condition has malformed returns: ${JSON.stringify(c.returns)}`,
      );
    }
  }
}

/**
 * Probe a template for references to undeclared context variables. We run the
 * template against a Proxy that records which context keys it reads; any read of
 * a key outside {@link KNOWN_CONTEXT_KEYS} is a registration error.
 */
function assertNoUndeclaredVars(build: PolicyTemplate): void {
  const accessed = new Set<string>();
  const probe = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "string") accessed.add(prop);
        // Return a placeholder string for any read so the template runs.
        return ":probe";
      },
    },
  ) as PolicyContext;
  try {
    build(probe);
  } catch {
    // A template that throws on a probe context is fine — we only care that it
    // does not *read* undeclared keys, which we still captured above.
  }
  for (const key of accessed) {
    if (!KNOWN_CONTEXT_KEYS.has(key)) {
      throw new NexusError(
        "INVALID_CONFIG",
        `policy template references undeclared context variable: ${key}`,
      );
    }
  }
}

/**
 * The named-policy registry. Holds the built-ins and any custom templates a
 * developer registers. The coordinator owns one instance.
 */
export class PolicyRegistry {
  private readonly templates = new Map<string, PolicyTemplate>();

  constructor() {
    for (const [name, tpl] of Object.entries(BUILTIN_POLICIES)) {
      this.templates.set(name, tpl);
    }
  }

  /** Register a custom named policy. Validated at registration time. */
  registerPolicy(name: string, build: PolicyTemplate): void {
    if (!name || typeof name !== "string") {
      throw new NexusError("INVALID_CONFIG", "policy name must be a non-empty string");
    }
    if (this.templates.has(name) && !(name in BUILTIN_POLICIES)) {
      throw new NexusError("INVALID_CONFIG", `policy already registered: ${name}`);
    }
    assertNoUndeclaredVars(build);
    // Smoke-expand against a fully-populated probe context and validate output.
    const probeCtx: PolicyContext = {
      world: "0x0000000000000000000000000000000000000000",
      escrow: "0x0000000000000000000000000000000000000000",
      handId: ":handId",
      roomId: ":roomId",
      roundId: ":roundId",
      invoiceId: ":invoiceId",
      deadline: ":deadline",
      chain: "base",
    };
    assertConditionsValid(build(probeCtx));
    this.templates.set(name, build);
  }

  /** List all registered policy names (built-in + custom). */
  listPolicies(): string[] {
    return [...this.templates.keys()];
  }

  /** True if a policy with this name is registered. */
  has(name: string): boolean {
    return this.templates.has(name);
  }

  /**
   * Expand a named policy into a concrete, validated `AccessCondition[]`.
   * Throws `NexusError("INVALID_CONFIG")` for an unknown name or invalid output.
   */
  expand(name: string, ctx: PolicyContext = {}): AccessCondition[] {
    const build = this.templates.get(name);
    if (!build) {
      throw new NexusError("INVALID_CONFIG", `unknown policy: ${name}`);
    }
    const conditions = build(ctx);
    assertConditionsValid(conditions);
    return conditions;
  }
}

/** A process-wide default registry (built-ins pre-loaded). */
export const defaultPolicyRegistry = new PolicyRegistry();

/** Typed helper for inline custom conditions (design §5 `defineAccessCondition`). */
export function defineAccessCondition(c: AccessCondition): AccessCondition {
  assertConditionsValid([c]);
  return c;
}

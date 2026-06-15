# Feedback — SteamLink / Nexus codebase

> Structured with the **feedback-mastery** framework (Preparation → Delivery →
> Follow-up; each point as **Situation–Behavior–Impact**). The goal is
> constructive: keep what's strong, fix what blocks reproducibility and safety.
> Every item is grounded in observable facts in this repo, not opinion.

## Preparation — context & goal

- **What this covers:** the state of the codebase after the Base → Mantle Sepolia
  migration, the contract redeploy, and the CI work.
- **Goal:** mutual understanding + a concrete punch-list — not criticism. Outcomes
  sought: (1) the headline games are reproducible from a clean clone, (2) no
  secrets in source, (3) CI stays a real merge gate.
- **Audience:** maintainers and future contributors/reviewers.

## Delivery — what's working (keep doing this)

**1 · Adapter-port architecture**
- **S:** Reviewing `packages/{relayer,backend,server,secrets}`.
- **B:** Every external dependency (relayer, secrets, indexer, facilitator,
  randomness) sits behind a TypeScript port with a default implementation; the
  hot path never hardcodes a vendor.
- **I:** Swapping `DirectRelayer` → `OneShotRelayer` or `LocalSecrets` → `LitSecrets`
  is a one-line change, and the engine stays testable and vendor-agnostic. This is
  the repo's strongest design decision.

**2 · On-chain security rigor**
- **S:** The Solidity under `packages/contracts/src`.
- **B:** `NexusDelegationManager` + the seven enforcers are covered by **88 Foundry
  tests** including dedicated hardening suites (`SenderSpoofing`, `ManagerHardening`,
  `MsgSenderResolution`); the manager verifies via `SignatureChecker` (ECDSA +
  ERC-1271), rejects non-zero `value`, and keys replay on the EIP-712 struct hash.
- **I:** An independent security pass found **no Critical/High** issues; a reviewer
  can trust the redemption seam quickly.

**3 · Typed, single-source-of-truth schema**
- **S:** `defineGame()` + codegen.
- **B:** One definition emits both the Solidity table library and the TS client
  types, and all errors flow through one `NexusError` taxonomy with
  `codeFromRevert()`.
- **I:** A misspelled table fails at compile time and on-chain reverts map to typed
  codes — fewer silent production failures.

## Delivery — what to improve (constructive)

**4 · A funded private key is committed in source** · _priority: high_
- **S:** `web/lib/uno/config.ts`.
- **B:** A testnet relayer **private key** (`0x1884…`) and its address are
  hardcoded and committed to git.
- **I:** Anyone who clones can drain its Mantle Sepolia MNT, and — more importantly
  — it normalizes committing keys, a habit that is catastrophic the first time it
  happens with a mainnet key. The code already supports a `NEXUS_RELAYER_PRIVATE_KEY`
  env override, so the hardcoded fallback is avoidable.
- **Ask:** move the key to env/secrets, delete the literal, and rotate the exposed
  key.

**5 · The headline games aren't reproducible from source** · _priority: high_
- **S:** Redeploying or running UNO / Monopoly from a clean clone.
- **B:** `web/lib/<game>/deployments/mantle-sepolia.json` references `unoGame` /
  `monopolyGame`, but the **game-system Solidity contracts are not in the repo** —
  only the shared stack + a reference `CounterGameSystem` is. Those addresses are
  therefore `0x0`.
- **I:** The "fully on-chain reference games" story can't be rebuilt from source;
  a contributor following the "add a game" guide has no example system contract to
  model. (This is documented in the deployment JSON `_note` and `AGENTS.md`, but
  the gap remains.)
- **Ask:** add the game-system contracts + their deploy scripts under
  `packages/contracts`, or state explicitly that they live in a separate repo and
  link it.

**6 · The web app uses published packages, not the workspace** · _priority: medium_
- **S:** `web/package.json`.
- **B:** The app depends on the **npm-published `@steamlink/*`** packages
  (Base-typed) rather than the local `@nexus/*` workspace.
- **I:** Editing `packages/*` doesn't change the running app, so a chain migration
  is only cosmetic at the app's SDK layer until those packages are republished —
  which surfaced as a `chain` type cast in `web/lib/uno/game-backend.ts`.
- **Ask:** alias `@steamlink/*` → the workspace via pnpm `overrides` for local dev,
  or publish updated packages, so the app exercises the code in this repo.

**7 · CI was never actually green** · _priority: medium (now fixed)_
- **S:** The GitHub Actions `CI` workflow.
- **B:** Every historical run failed at the **first** step — a duplicate pnpm
  version passed to `pnpm/action-setup` — so build/test/lint/live-anvil never ran.
  Unblocking it surfaced four more latent failures (frozen-install
  `ERR_PNPM_IGNORED_BUILDS`, biome formatting the foundry `broadcast/` artifacts, a
  missing `deployments/` dir in the live-anvil job, and pre-existing lint debt).
- **I:** A green check was assumed but never true; breakage accumulated unseen
  behind the early failure.
- **Ask:** treat green CI as a real merge gate (the fixes are now in `main`); add a
  branch-protection rule requiring it.

**8 · Pre-existing lint debt parked as warnings** · _priority: low_
- **S:** `biome.json`.
- **B:** 50 pre-existing web-UI findings (`noSvgWithoutTitle`, `useButtonType`,
  `noArrayIndexKey`, `useExhaustiveDependencies`) were **downgraded to warnings** to
  let `pnpm lint` pass.
- **I:** These are real (if minor) a11y/React-correctness issues that are now
  non-blocking; left indefinitely they erode the linter's value.
- **Ask:** schedule a burn-down and re-promote the rules to `error`.

## Follow-up — action items

| # | Action | Priority | Owner | Check-in |
|---|---|---|---|---|
| 4 | Remove + rotate the committed relayer key; require env var | High | — | next PR |
| 5 | Add game-system contracts to the repo (or link the external source) | High | — | next milestone |
| 6 | Point `web/` at the workspace SDK (pnpm overrides) or republish | Medium | — | next sprint |
| 7 | Enable branch protection requiring green CI | Medium | — | this week |
| 8 | Burn down the 50 lint warnings; re-promote to errors | Low | — | backlog |

**Suggested check-in:** revisit items 4–5 at the next review; they're the two that
block a clean-clone reviewer from reproducing the project end-to-end.

---

_Receiving this well (per the framework): the strengths are real and most gaps are
artifacts of a fast hackathon migration, not design flaws. Items 4 and 5 are the
highest-leverage fixes — both are small changes with outsized impact on safety and
reproducibility._

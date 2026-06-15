# Implementing Single-Delegation Gasless Actions + x402 Payments

A detailed, reusable guide to the pattern this repo uses: a user signs **one** ERC-7710
delegation, and a relayer redeems that single signature for **everything** afterward — gasless
state-changing actions (no wallet popups) *and* bounded stablecoin payments (x402), all enforced
on-chain by caveats. Apply this to any turn-based, pay-as-you-go onchain app (games, agent arenas,
metered APIs, paid multiplayer).

> **One-line mental model:** the player is the **delegator**, the relayer is the **delegate**
> (redeemer + gas payer). The player signs a delegation bounded by **caveats**; the relayer calls
> `redeemDelegations(...)` to execute actions and to pull payments via `transferFrom`, and can never
> exceed what the caveats allow.

---

## 1. The actors

| Actor | Role | Holds |
|---|---|---|
| **Player (delegator)** | Signs ONE delegation at join. Never sends a tx again. | Their own wallet + the payment token (e.g. USDC) |
| **Relayer (delegate)** | Submits every transaction, pays gas, redeems the delegation. | Gas (ETH/stablecoin); a hot key — **backend only** |
| **DelegationManager** | On-chain entry point. Verifies the signature + runs caveats + executes. | — |
| **Caveat enforcers** | On-chain guards (turn, allowlist, spend cap, recipient, expiry). | — |
| **Pot / escrow** | Receives payments; pays out winners/settlements. | The collected funds |
| **World / app systems** | Your game/app state contracts. Trust the manager as a forwarder. | App state |

Two trust-minimizing invariants make this safe to give the relayer your signature:

1. **Caveats bound everything.** A budget delegation can only `transferFrom(player → allowed
   recipient)`, never above the per-action cap or the lifetime cap.
2. **The relayer is the *delegate*, not the *delegator*.** It cannot mint new authority; it can only
   redeem what the player signed.

---

## 2. On-chain layer

### 2.1 The delegation (EIP-712)

A delegation is a signed struct. The verifying contract recomputes its EIP-712 digest and checks the
signature against the `delegator`.

```solidity
struct Caveat   { address enforcer; bytes terms; bytes args; }
struct Delegation {
    address delegate;        // who may redeem (the relayer); address(0) = anyone
    address delegator;       // the signer (the player) — funds come from here
    bytes32 authority;       // bytes32(0) = root (no delegation chains)
    Caveat[] caveats;        // the on-chain guards
    uint256 salt;
    uint256 maxRedemptions;  // bounded replay (e.g. 200 moves, 4 charges)
    bytes signature;
}
```

EIP-712 domain + types (keep these stable; the manager hardcodes the typehashes):

```
domain  = { name: "<Your App> Delegation", version: "1", chainId, verifyingContract: manager }
types   = { Caveat: [...], Delegation: [delegate, delegator, authority, caveats, salt, maxRedemptions] }
primaryType = "Delegation"
```

### 2.2 The DelegationManager

The manager verifies the signature, runs each caveat's `beforeHook`, executes the action, then runs
`afterHook`. **Critical detail for wallet flexibility — verify with `SignatureChecker`, not raw
`ECDSA.recover`:**

```solidity
// 1) verify signature is valid FOR the delegator — accepts BOTH a raw ECDSA
//    signature (an EOA) AND an ERC-1271 isValidSignature response (a smart account /
//    EIP-7702-upgraded EOA). This is what lets a MetaMask Smart Account sign.
bytes32 digest = _digest(_hashDelegation(delegation));
if (!SignatureChecker.isValidSignatureNow(delegation.delegator, digest, delegation.signature)) {
    revert InvalidDelegationSignature();
}
// 2) delegate authorization (relayer must match, unless address(0) = open)
// 2b) bounded replay: enforce maxRedemptions via a per-delegation counter keyed on structHash
// 3) run caveat beforeHooks → execute → afterHooks
```

> **Why `SignatureChecker`:** an EOA signs a 65-byte ECDSA sig; a smart-contract account signs via
> ERC-1271 (`isValidSignature(hash,sig) -> 0x1626ba7e`). `SignatureChecker.isValidSignatureNow`
> tries ECDSA first and falls back to ERC-1271 for contract accounts. Using raw `ECDSA.recover`
> would reject every smart-account delegation. (See §6.)

Entry point:

```solidity
function redeemDelegations(
    bytes[]   calldata permissionContexts,   // each = abi.encode(Delegation)
    ModeCode[] calldata modes,
    bytes[]   calldata executionCallDatas     // packed(target, value, callData)
) external;
```

`executionCallData` is `abi.encodePacked(target, uint256 value, bytes callData)` — the action the
manager performs as itself (`msg.sender == manager`). For a **payment** it's
`USDC.transferFrom(player, recipient, amount)`; for a **move** it's a call into your app's World/system.

### 2.3 The caveat enforcers

Each caveat is `(enforcer, terms, args)`. The manager calls `enforcer.beforeHook(terms, args, mode,
execution, delegationHash, delegator, redeemer)`. Build only the ones you need:

| Enforcer | Guards | terms encode |
|---|---|---|
| `SystemAllowlistEnforcer` | action targets only your allowed systems | `(world, allowedSystemIds[])` |
| `TurnBoundEnforcer` | action only on the delegator's turn | `(turnManager, roomId)` |
| `TimestampEnforcer` | delegation expires | `(expiresAt)` |
| `LimitedCallsEnforcer` | at most N actions | `(maxActions)` |
| `PerActionCapEnforcer` | each transfer ≤ a cap | `(token, perActionCapWei)` |
| `ERC20TransferAmountEnforcer` | lifetime spend ≤ a cap | `(token, totalCapWei)` |
| `AllowedRecipientsEnforcer` | transfers only to allowed addresses | `(token, recipients[])` |

The **gameplay** group = allowlist + (turn) + expiry + (limit). The **budget** group = per-action
cap + lifetime cap + recipient allowlist. Together they are the "single delegation."

### 2.4 The Pot / escrow

A minimal authority-gated escrow: `openPot(roomId)`, `creditDeposit`, `settle(roomId, winner)`.
The money path is the budget delegation (`transferFrom(player → pot)`); the pot just mirrors
balances and pays out. Authority = your settle key (often the relayer). Errors like
`Pot_AlreadyOpen` mean you reused a room id — make room ids unique + monotonic (use a full
timestamp, not `Date.now() % 1e6`, which cycles every ~16 min and collides across restarts).

---

## 3. The single-delegation flow

```
joinRoom():
  player signs ONE delegation  =  gameplay caveats  ⊕  budget caveats   (1 signature)
        │
        ├─ every later MOVE:    relayer → manager.redeemDelegations([gameplay], [move exec])      gasless, no popup
        └─ every later PAYMENT: relayer → manager.redeemDelegations([budget],   [transferFrom])   bounded by caveats
```

The wallet is **never** prompted again mid-session. The relayer pays gas; the player pays zero gas
and only the bounded token amounts.

---

## 4. SDK: building + signing the delegation (client)

Compile the two caveat groups, then sign once. (APIs mirror `@nexus/core` in this repo.)

```ts
import {
  buildGameplayCaveats, buildBudgetCaveats, signDelegation, usdcToWei,
} from "@your/core";

// GAMEPLAY: lets the relayer redeem the player's moves this room.
export async function signGameplayDelegation(player /* viem account-like */, roomId: bigint) {
  const cfg = {
    gameplay: { allowedSystems: [GAME_SYSTEM_ID], turnBound: true,
                expiresAt: Date.now() + 6*3600_000, maxActions: 200 },
    budget:   { token: "USDC", totalCap: "0", perActionCap: "0", allowedRecipients: [] },
  };
  return signDelegation(player, {
    chainId: 5003, delegationManager: addresses.delegationManager,
    delegate: RELAYER_ADDRESS,                                   // relayer = the only redeemer
    caveats: buildGameplayCaveats(cfg, addresses, roomId),
    salt: saltFor(player.address), maxRedemptions: 200n,
  });
}

// BUDGET: bounded x402 spend → the Pot only.
export async function signBudgetDelegation(player, pot, perActionCap, totalCap) {
  const cfg = {
    gameplay: { allowedSystems: [], expiresAt: Date.now() + 6*3600_000 },
    budget:   { token: "USDC", perActionCap, totalCap, allowedRecipients: [pot] },
  };
  return signDelegation(player, {
    chainId: 5003, delegationManager: addresses.delegationManager,
    delegate: RELAYER_ADDRESS,
    caveats: buildBudgetCaveats(cfg, addresses),
    salt: saltFor(player.address), maxRedemptions: 4n,
  });
}
```

`signDelegation` only needs the player object to expose `address` + `signTypedData` — so the SAME
code works for a guest `LocalAccount`, an embedded wallet, or a smart account (§6).

`buildBudgetCaveats` **rejects** an empty recipient list and a `"0"` total cap — there is no
unbounded-spend path by construction.

---

## 5. x402 monetization

### 5.1 Two ways to charge

1. **Direct redeem (what the games do).** The backend redeems the budget delegation:
   `manager.redeemDelegations([budgetDelegation], [transferFrom(player → pot, amount)])`. Bounded by
   `PerActionCap` + `ERC20TransferAmount` + `AllowedRecipients`. The relayer pays gas; the player
   pays only the USDC.

2. **HTTP x402 middleware (`@nexus/server`).** Put a paywall in front of any route:

```ts
import { monetize } from "@your/server";

app.use("/api/premium", monetize({
  price: "0.10", token: "USDC", chain: "mantle",
  recipient: POT_ADDRESS,
  facilitator: "nexus",            // default DelegationFacilitator
}));
```

- No/!valid payment → **HTTP 402** with a `Challenge402` body (price, token, recipient, nonce).
- Client retries with the redemption JSON in the **`x-payment`** header (payer in **`x-payer`**).
- The facilitator verifies + settles on-chain (the same budget-delegation `transferFrom`), then the
  request passes through with `req.settlement` attached.

### 5.2 The charge execution (server)

```ts
import { buildChargeFromExecution } from "@your/core";

// USDC.transferFrom(player → recipient, amount). The manager is msg.sender to the
// token, so the player must have approved the manager (see §6). This is the variant
// that debits the PAYER (plain `transfer` would move the manager's own zero balance).
const exec = buildChargeFromExecution(addresses, player, pot, "0.10");
await relayer.redeemDelegations([signedBudgetDelegation], [mode], [exec]);
```

### 5.3 Conventions (do not skip)

- **Capabilities are the source of truth.** Read the relayer's `targetAddress` + fee tokens from
  `relayer_getCapabilities` and cache them. **Never hardcode token addresses.** Reject a
  `targetAddress` mismatch before submitting.
- **Webhooks drive status.** Confirm settlement via relayer webhooks → internal status events; poll
  only as a silent fallback.
- **Idempotency.** Money bundles carry an idempotency key; the relayer dedupes.

---

## 6. Wallets: who can be the delegator

The delegator must expose `{ address, signTypedData }` and the manager must accept its signature.

### 6.1 Guest / embedded wallet (EOA, simplest)
A browser-generated `viem` `LocalAccount` (or an embedded wallet from an auth provider). It signs the
delegation typed-data as a 65-byte ECDSA sig; the manager's `SignatureChecker` takes the ECDSA path.
Fund it + `approve(manager)` once. Zero friction — ideal default.

### 6.2 MetaMask Smart Account (real user wallet)
A vanilla MetaMask **EOA cannot** sign these delegations: MetaMask blocks `eth_signTypedData` when
`primaryType === "Delegation"` AND `message.delegator` is one of its own internal accounts
("External signature requests cannot sign delegations for internal accounts"). The fix:

1. **Make the delegator a smart account** (e.g. a MetaMask Hybrid DeleGator from
   `@metamask/delegation-toolkit`'s `toMetaMaskSmartAccount`). Its address is a *contract*, not an
   internal MetaMask account, so the block never fires.
2. **The owner EOA signs the raw delegation digest directly** (plain ECDSA) — do NOT use the
   toolkit account's own `signTypedData`, which ERC-6492-wraps the sig (a plain `SignatureChecker`
   can't verify a 6492 wrapper).
3. On-chain, the manager's `SignatureChecker.isValidSignatureNow(smartAccount, digest, sig)` calls
   the deployed account's ERC-1271 `isValidSignature`, which does `ECDSA.recover(digest, sig) ==
   owner()` — validates the owner's plain signature. **The account must be deployed** (have code)
   for ERC-1271; counterfactual would force the 6492 wrapper.
4. **Approve + deploy via an ERC-4337 bundler.** A smart account's `execute` is `onlyEntryPoint`, so
   its USDC `approve` (and first-time deploy) go out as a **UserOperation** through a bundler. Use a
   **paymaster** to sponsor gas so the player needs no ETH:

```ts
const bundler = createBundlerClient({
  client: publicClient, transport: http(BUNDLER_URL),
  paymaster: true,                                  // Pimlico v2 endpoint = bundler + paymaster
  userOperation: { estimateFeesPerGas: async ({ bundlerClient }) =>
    (await bundlerClient.request({ method: "pimlico_getUserOperationGasPrice" })).standard },
});
await bundler.sendUserOperation({ account: smartAccount,
  calls: [{ to: usdc, data: approve(manager, maxUint256), value: 0n }] });
```

The delegation **signature itself needs no bundler** — only the one-time approve/deploy does.

> Trade-off: smart accounts need ERC-1271 in the manager + a bundler (+paymaster). Guest/embedded
> wallets need neither. Pick per audience.

---

## 7. Implement it in YOUR project — checklist

**Contracts (Foundry):**
1. Deploy `DelegationManager` that verifies with `SignatureChecker` (ECDSA + ERC-1271) and enforces
   `maxRedemptions`.
2. Deploy the caveat enforcers you need (allowlist, turn, timestamp, limited-calls, per-action cap,
   erc20-amount, allowed-recipients).
3. Deploy your `World`/app systems and **lock the manager as the trusted forwarder**
   (`setTrustedForwarder` — often one-time, so a new manager ⇒ a fresh stack redeploy).
4. Deploy the `Pot`/escrow with your settle authority.
5. Use the **canonical** payment token (e.g. Circle USDC) — don't redeploy money.

**SDK / client:**
6. `buildGameplayCaveats` + `buildBudgetCaveats` → `signDelegation` once at join.
7. Player object = `{ address, signTypedData }` (guest LocalAccount, embedded wallet, or smart
   account per §6).
8. One-time: fund the delegator + `approve(manager)` (or EIP-2612 permit for EOAs).

**Backend (relayer + server):**
9. Relayer holds the hot key (server only); reads `relayer_getCapabilities`; submits
   `redeemDelegations`; serializes submissions (single key → sequential nonces); retries on
   nonce/underpriced; drives status from webhooks.
10. For HTTP monetization, wrap routes with the `monetize` middleware (402 → `x-payment` →
    facilitator settles).
11. Make room/session ids unique + monotonic (full timestamp).

**Security invariants (always):**
- One delegation per player per session; no flow re-prompts the wallet.
- Caveats are the source of truth for spend; the relayer can't exceed them.
- Never hardcode token addresses; read + cache capabilities; reject `targetAddress` mismatch.
- The relayer/secret keys live only in the backend; the browser never sees them.
- Optimistic UI, on-chain truth: apply optimistically, reconcile on webhook, surface enforcer
  rejections as typed errors (`NOT_YOUR_TURN`, `BUDGET_EXCEEDED`).

---

## 8. End-to-end sequence (reference)

```
1. joinRoom()         player signs ONE delegation (gameplay ⊕ budget)            [1 signature]
2. pay buy-in         relayer.redeemDelegations([budget],  [transferFrom→pot])   [USDC moves, gasless for player]
3. take a turn        relayer.redeemDelegations([gameplay],[system call])        [state changes, no popup]
4. per-action charge  relayer.redeemDelegations([budget],  [transferFrom→pot])   [bounded by caveats]
5. settle             pot.settle(roomId, winner)                                  [payout on-chain]
```

Every step after #1 is the relayer redeeming the one signature, bounded on-chain. That is the whole
pattern.
</content>

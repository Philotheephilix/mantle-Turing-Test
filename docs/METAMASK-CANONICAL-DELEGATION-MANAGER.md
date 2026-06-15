# Using MetaMask's Canonical DelegationManager (ERC-7715 Rail)

This guide explains the **ERC-7715 spend rail**: instead of signing a custom delegation as opaque
EIP-712 typed-data, the player grants spending through MetaMask's **native permission popup**
(showing the token, cap, period, and a human-readable justification), and a relayer redeems that
granted permission against **MetaMask's own canonical DelegationManager**. This is the recommended
rail for real MetaMask users.

> **Why it exists.** A vanilla MetaMask EOA cannot sign a custom ERC-7710 delegation as typed-data —
> MetaMask blocks `eth_signTypedData` when `primaryType === "Delegation"` for its own accounts, and
> even when it doesn't, the user sees an unreadable hash. ERC-7715 (`wallet_requestExecutionPermissions`)
> replaces that with a first-class permission grant MetaMask renders intuitively.

---

## The two rails (pick per audience)

| | Custom rail (`NexusDelegationManager`) | **ERC-7715 rail (canonical manager)** |
|---|---|---|
| Authorization | sign a custom `Delegation` (EIP-712) | `requestExecutionPermissions` — native popup |
| What the user sees | opaque typed-data hash | "spend up to 1 USDC/day", adjustable |
| Manager | our `NexusDelegationManager` | MetaMask's canonical DelegationManager |
| Caveats | full custom set (turn-bound, system-allowlist, per-action cap, …) | standard scopes (e.g. `erc20-token-periodic`) |
| Best for | the built-in session/embedded wallet + arbitrary gameplay rules | a real MetaMask user paying for entry/actions |

The two coexist: gameplay moves and the session-wallet path keep the custom manager; a real
MetaMask user's **spend** authorization goes through ERC-7715.

---

## Addresses

- **Canonical DelegationManager (Mantle Sepolia, chain 5003):**
  `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`
  Resolve it in code with `getSmartAccountsEnvironment(5003).DelegationManager` — never hardcode
  across chains.
- **Package:** `@metamask/smart-accounts-kit` (the renamed MetaMask Delegation Toolkit).

```bash
npm install @metamask/smart-accounts-kit viem
```

---

## Step 1 — Client: grant the permission (the intuitive popup)

Extend a viem wallet client with the ERC-7715 provider actions, then request an
`erc20-token-periodic` permission. MetaMask renders the cap/period/justification natively.

```ts
import { createWalletClient, custom, parseUnits } from "viem";
import { mantleSepoliaTestnet } from "viem/chains";
import { erc7715ProviderActions } from "@metamask/smart-accounts-kit/actions";

export async function grantSpend(usdc: Address, relayer: Address) {
  const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  const walletClient = createWalletClient({ account, chain: mantleSepoliaTestnet, transport: custom(window.ethereum) })
    .extend(erc7715ProviderActions());

  const now = Math.floor(Date.now() / 1000);
  const grants = await walletClient.requestExecutionPermissions([
    {
      chainId: 5003,
      expiry: now + 7 * 24 * 60 * 60,        // permission valid for 7 days
      to: relayer,                            // the redeemer (your relayer)
      permission: {
        type: "erc20-token-periodic",         // a scope MetaMask understands → intuitive UI
        data: {
          tokenAddress: usdc,
          periodAmount: parseUnits("1", 6),   // cap: 1 USDC per period (covers the fee + buffer)
          periodDuration: 86400,              // per day
          startTime: now,
          justification: "Spend up to 1 USDC/day playing this game", // shown in the popup
        },
        isAdjustmentAllowed: true,            // the user may tweak the cap in the popup
      },
    },
  ]);

  // grants[0] = { context, from, delegationManager, dependencies }
  return grants[0];
}
```

- **`context`** is the redeemable granted permission (a hex blob — the full delegation chain).
- **`from`** is the address the funds come from: the user's **MetaMask smart account** (MetaMask
  deploys/initializes it on the first grant). Fund THAT address with the payment token, not the bare
  EOA.
- POST `{ context, from }` to your backend and store it per player.

## Step 2 — Server: redeem the granted permission

Each charge is a **plain relayer EOA transaction** to the canonical manager that redeems the stored
`context` and transfers the amount to your recipient (e.g. a Pot). **No bundler is required on
testnet** — the relayer (the `to` of the grant) pays gas directly.

```ts
import { createPublicClient, createWalletClient, http, encodeFunctionData, erc20Abi } from "viem";
import { mantleSepoliaTestnet } from "viem/chains";
import {
  contracts, getSmartAccountsEnvironment, createExecution, ExecutionMode,
} from "@metamask/smart-accounts-kit";

export async function chargeViaGrant(opts: {
  context: Hex; relayerAccount: LocalAccount; usdc: Address; recipient: Address; atoms: bigint; rpcUrl: string;
}) {
  const env = getSmartAccountsEnvironment(5003);          // canonical manager + encoders
  const publicClient = createPublicClient({ chain: mantleSepoliaTestnet, transport: http(opts.rpcUrl) });
  const walletClient = createWalletClient({ account: opts.relayerAccount, chain: mantleSepoliaTestnet, transport: http(opts.rpcUrl) });

  const execution = createExecution({
    target: opts.usdc,
    value: 0n,
    callData: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [opts.recipient, opts.atoms] }),
  });

  const data = contracts.DelegationManager.encode.redeemDelegations({
    delegations: [opts.context],                            // the granted permission context
    modes: [ExecutionMode.SingleDefault],
    executions: [[execution]],
  });

  const txHash = await walletClient.sendTransaction({ to: env.DelegationManager as Address, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === "reverted") throw new Error(`charge reverted: ${txHash}`);
  return { txHash };
}
```

The USDC moves **from the user's smart account → recipient**, bounded on-chain by the period cap.
Over-cap redemptions revert atomically; the user can revoke the permission to stop further draws.

## Step 3 — Wire it into your pay flow

1. On connect (MetaMask), call `grantSpend(...)` → store the returned `{ context, from }`.
2. Show the granted cap in the UI ("you authorized up to 1 USDC/day").
3. On each charge (entry fee, per-action), call `chargeViaGrant(...)` with the stored `context`.
4. Keep your session-wallet / custom-manager rail as the default for users without an ERC-7715
   wallet — branch on whether a grant exists.

---

## Requirements & caveats

- **An ERC-7715-capable MetaMask** (the Smart Accounts / Permissions feature). On a wallet without
  it, fall back to the session-wallet / custom-manager rail — wrap the grant call in try/catch and
  still seat the player.
- **Funds live in the smart account** (`grant.from`), which MetaMask deploys on the first grant. An
  unfunded smart account makes the redemption revert with `transfer amount exceeds balance`.
- **Gameplay vs. payment.** ERC-7715 standard scopes cover token spend, not arbitrary game rules
  (turn-bound, system-allowlist). Use this rail for the **spend** authorization; keep moves on your
  custom manager (or a session key).
- **No bundler on testnet.** The relayer redeems directly as an EOA. (A production/mainnet setup can
  route the same redemption through a relayer service.)
- **Capabilities first.** Resolve the manager + token from the environment / your relayer
  capabilities; do not hardcode token addresses across chains.

---

## Reference implementation

This pattern is implemented and live in this repo:

- Client grant: `examples/uno/lib/erc7715.ts`
- Server redeem: `examples/uno/lib/erc7715-settle.ts`
- Storage + charge rail: `examples/uno/lib/game-backend.ts`, `examples/uno/app/api/grant/route.ts`,
  `examples/uno/app/api/charge/route.ts`
- (mirrored in `examples/monopoly/lib/erc7715*.ts` for the buy-in)
</content>

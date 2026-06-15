# Mantle chain infrastructure — research notes for SteamLink / Nexus

> Why this exists: SteamLink (engine *Nexus*) runs **fully on-chain** on Mantle
> Sepolia (chain `5003`). The gas economics, data-availability model, and fee
> mechanics of Mantle directly shape how the relayer pays for gasless moves and
> how much a deployment costs. This doc captures the Mantle research that matters
> for *operating and reviewing this repo* — not a generic Mantle explainer.

## TL;DR for this repo

- Mantle is a **modular Ethereum L2** (OP-Stack–derived rollup) with **MNT** as
  the native gas token — not ETH. Every chain descriptor in this repo uses
  `nativeCurrency: { symbol: "MNT" }` for that reason.
- A Mantle transaction fee = **L2 execution fee + L1 data fee**. The **L1 data
  fee dominates contract creation** because it scales with calldata size (the
  contract bytecode). We measured ≈ **0.9 MNT per contract deployment** on Mantle
  Sepolia (see "What we observed"), which is why a full-stack deploy needs several
  MNT, not a fraction.
- Mantle's RPC `eth_estimateGas` under-estimates contract-creation storage gas, so
  our deploy uses local Foundry simulation + `--legacy --gas-estimate-multiplier`
  rather than node estimation (see "Deploying to Mantle from this repo").

## What Mantle is

Mantle Network is a **modular** Ethereum Layer-2 built on the **OP Stack**. Unlike
a monolithic chain, it separates the rollup into interoperable layers:

| Layer | Role on Mantle |
|---|---|
| **Execution** | An EVM-equivalent L2 (OP-Stack–derived) that runs transactions and produces blocks. |
| **Settlement** | Ethereum L1 — where state roots are posted and (dispute/validity) finality is anchored. |
| **Consensus / sequencing** | A sequencer orders L2 transactions and produces blocks. |
| **Data availability (DA)** | Historically **Mantle DA**, built on **EigenDA** (EigenLayer) — DA is decoupled from L1 calldata, cutting cost by **>90%** vs posting all data to Ethereum. |

**Proof evolution.** Mantle launched as an **optimistic rollup** with the
modular Mantle DA + EigenDA setup. By 2026 its architecture had moved toward
**OP-Succinct ZK validity proofs** and **Ethereum blob (EIP-4844) data
availability** — i.e. faster validity-based finality and blob-based DA. Either
way, the L2-execution + L1-data fee split below holds.

## MNT — the native gas token

`MNT` is Mantle's **native gas and governance token**. It pays transaction fees
(the "value" leg of gas) and is staked by validators in Mantle's economic model.
Consequences for this repo:

- The relayer EOA must hold **MNT** (not ETH) to pay gas for gasless redemptions.
- Player funding / "ensure players" flows send **MNT** for gas, while the x402
  **budget** token is a separate ERC-20 (we deploy a 6-decimals **TestUSDC**,
  because Mantle Sepolia has no canonical Circle USDC).

## Fee model — why deployment is the expensive part

A Mantle fee has two components:

```
total_fee = L2_execution_fee            (gas_used × L2_gas_price, paid in MNT)
          + L1_data_fee                 (cost to make the tx data available on L1)
```

The **L1 data fee** is the OP-Stack formula:

```
L1_data_fee = L1_gas_price × (tx_data_gas + fixed_overhead) × dynamic_overhead
tx_data_gas = zero_bytes × 4 + non_zero_bytes × 16
# fixed_overhead ≈ 2100, dynamic_overhead ≈ 1.0 (OP-Stack defaults)
```

Key implication: **L1 data fee scales with the size of the transaction's
calldata.** A normal move/charge is small calldata → cheap. A **contract
deployment** carries the entire contract bytecode as calldata → a large L1 data
fee, even though EigenDA/blobs make it ~90% cheaper than raw L1.

## What we observed deploying this stack (Mantle Sepolia, June 2026)

Measured on the live `DeployFull` run (relayer `0xA332…55bD`):

| Quantity | Value |
|---|---|
| World deploy — L2 execution fee | ≈ 0.056 MNT (1,123,833 gas × 50 gwei) |
| World deploy — **L1 data fee** | ≈ **0.90 MNT** |
| World deploy — total | ≈ 0.96 MNT |
| Full core stack (~13 contract creations + wiring) | ≈ **3.6 MNT** |

So **~94% of a single contract-deploy cost was the L1 data fee**, confirming the
calldata-size dominance above. A fraction of an MNT covers thousands of gasless
*moves*; it's *deployments* that need real MNT.

## Network parameters

| | Mantle (mainnet) | Mantle Sepolia (testnet) |
|---|---|---|
| Chain ID | `5000` | `5003` (`0x138b`) |
| Native / gas token | MNT | MNT (test) |
| Default RPC | `https://rpc.mantle.xyz` | `https://rpc.sepolia.mantle.xyz` |
| Explorer | `https://mantlescan.xyz` | `https://sepolia.mantlescan.xyz` |
| Faucet | — | `https://faucet.sepolia.mantle.xyz` |
| viem chain | `mantle` | `mantleSepoliaTestnet` |

These are encoded once in `packages/types/src/chain.ts` (`CHAINS`) and consumed
everywhere via the `ChainKey` (`"mantle"` | `"mantle-sepolia"`).

## Deploying to Mantle from this repo

Mantle's public RPC `eth_estimateGas` **fails on large contract creations**
(`-32000: contract creation code storage out of gas`) — the node's gas estimate
cannot cover the inflated code-deposit cost. Two practical consequences baked
into our tooling:

1. **Don't rely on node estimation.** Let Foundry simulate locally to derive gas:
   ```bash
   forge script script/DeployFull.s.sol:DeployFull \
     --rpc-url https://rpc.sepolia.mantle.xyz --private-key $PRIVATE_KEY \
     --broadcast --legacy --gas-estimate-multiplier 200 --slow
   ```
   `--legacy` (Mantle accepts legacy gas pricing), `--gas-estimate-multiplier 200`
   (headroom over the simulated gas), `--slow` (one tx at a time — avoids nonce
   races on the public sequencer).
2. **`vm.writeJson` needs the dir.** `DeployFull` writes `deployments/<chainid>.json`;
   `scripts/lib/deploy.ts:deployNexus` `mkdir`s `packages/contracts/deployments`
   first, since a fresh checkout has no such directory.

The canonical deployed addresses live in `packages/contracts/deployments/5003.json`
and per-game copies in `web/lib/<game>/deployments/mantle-sepolia.json`.

## How Mantle's design interacts with Nexus's invariants

- **Gasless moves are cheap, deployments aren't.** The single-delegation +
  relayer model means players never pay gas; the relayer absorbs MNT. Because
  per-move calldata is small, the L1 data fee per move is negligible — the model
  is economically sound on Mantle precisely because EigenDA/blob DA keeps
  per-tx data cost low.
- **x402 settles in an ERC-20, gas is MNT.** The budget caveats bound spend in
  the **USDC-equivalent TestUSDC**, independent of the MNT the relayer burns for
  gas — so a spike in MNT gas price never silently overspends a player's budget.
- **EVM-equivalence.** Mantle is OP-Stack EVM-equivalent, so the Solidity
  (NexusDelegationManager, enforcers, World, Pot) deploys unchanged; only the
  chain config, gas token, and fee handling differ from a generic EVM chain.

## Sources

- [Mantle Network: Modular L2 & Tokenomics (Bitunix)](https://blog.bitunix.com/what-is-mantle-network/)
- [Mantle Network Review 2026 (Coin Bureau)](https://coinbureau.com/review/mantle-network-review)
- [What Is Mantle Network — L2 guide (BeInCrypto)](https://beincrypto.com/learn/mantle-network-guide/)
- [Mantle (mantlenetworkio/mantle) — GitHub](https://github.com/mantlenetworkio/mantle)
- [Transaction Fees on L2 (Mantle Docs mirror)](https://github.com/LayerE/Mantle-Docs/blob/main/Transaction%20Fees%20on%20L2.md)
- [Estimate the costs of a Mantle (L2) transaction (Mantle tutorial)](https://mantlenetworkio.github.io/mantle-tutorial/sdk-estimate-gas/)
- [Transaction fees on rollups (Mantle research blog)](https://www.mantle.xyz/blog/research/transaction-fees-on-rollups)
- [Mantle Sepolia Testnet RPC & chain settings (ChainList #5003)](https://chainlist.org/chain/5003)
- [Mantle Sepolia Testnet (thirdweb)](https://thirdweb.com/mantle-sepolia-testnet)

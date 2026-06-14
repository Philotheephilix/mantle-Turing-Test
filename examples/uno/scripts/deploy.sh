#!/usr/bin/env bash
# Deploy the full Nexus stack + the UNO game to Base Sepolia using the hardcoded
# funded relayer/deployer key from examples/.shared-env.local.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHARED_ENV="$HERE/../.shared-env.local"

export PATH="$HOME/.foundry/bin:$PATH"

# Load shared env (relayer key, RPC, USDC).
set -a
# shellcheck disable=SC1090
source <(grep -E '^[A-Z_]+=' "$SHARED_ENV")
set +a

: "${NEXUS_RELAYER_PRIVATE_KEY:?missing NEXUS_RELAYER_PRIVATE_KEY}"
: "${USDC_ADDRESS:?missing USDC_ADDRESS}"
RPC="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"

# Player seat 0 = the relayer/deployer (it is also the funded payer for the demo).
export PLAYER="${NEXUS_RELAYER_ADDRESS}"
export ROOM_ID="${ROOM_ID:-1}"

cd "$HERE"
echo "Deploying UNO stack to Base Sepolia (chain 84532)…"
forge script contracts/DeployUno.s.sol:DeployUno \
  --rpc-url "$RPC" \
  --private-key "$NEXUS_RELAYER_PRIVATE_KEY" \
  --broadcast --skip-simulation

# Enrich with the deploy block (for indexer/log scans) + the relayer address, then
# write the spec'd filename. The forge script doesn't emit these two fields.
DEPLOY_BLOCK=$(python3 -c "
import json
b=json.load(open('$HERE/broadcast/DeployUno.s.sol/84532/run-latest.json'))
blocks=[int(r['blockNumber'],16) for r in b.get('receipts',[]) if r.get('blockNumber')]
print(min(blocks) if blocks else 0)
")
python3 -c "
import json
d=json.load(open('$HERE/deployments/84532.json'))
d['deployBlock']=$DEPLOY_BLOCK
d['relayer']='${NEXUS_RELAYER_ADDRESS}'
json.dump(d, open('$HERE/deployments/base-sepolia.json','w'), indent=2, sort_keys=True)
"
echo "Deployed. Addresses → examples/uno/deployments/base-sepolia.json (deployBlock $DEPLOY_BLOCK)"

#!/usr/bin/env bash
# Runs the Caliper benchmark against the running Milki network (CLAUDE.md §13 phase 10).
#   1. network up + chaincode deployed (network/scripts/up.sh or start.sh)
#   2. demo data for the read rounds:  (cd backend && npm run seed && npm run seed:demo)
#   3. ./run.sh            → report.html (and results/ summary)
# The write rounds add ~400 parcels in region "Benchmark", run on a throwaway network for a clean register.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TN="$ROOT/network/fabric-samples/test-network"
ID="$ROOT/network/identities/org1/caliper-registrar/msp"

if [[ ! -d "$ID" ]]; then "$ROOT/network/scripts/enroll.sh" caliper-registrar REGISTRAR; fi
[[ -d "$HERE/node_modules/@hyperledger/caliper-cli" ]] || (cd "$HERE" && npm install && npx caliper bind --caliper-bind-sut fabric:fabric-gateway)

KEY="$(ls "$ID"/keystore/*_sk | head -1)"
sed -e "s#__KEY__#$KEY#" -e "s#__CERT__#$ID/signcerts/cert.pem#" -e "s#__PROFILE__#$TN/organizations/peerOrganizations/org1.example.com/connection-org1.yaml#" \
  "$HERE/networks/network.template.yaml" > "$HERE/networks/network.yaml"

cd "$HERE"
npx caliper launch manager \
  --caliper-workspace . \
  --caliper-networkconfig networks/network.yaml \
  --caliper-benchconfig benchmarks/config.yaml \
  --caliper-flow-only-test \
  --caliper-report-path report.html

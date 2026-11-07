#!/usr/bin/env bash
# Deploys (or upgrades) the land-registry chaincode on land-channel for Org1, Org2 AND Org3.
#
#   ./network/scripts/deploy-cc.sh                       # first deploy: version 1.0, sequence auto (→ 1)
#   ./network/scripts/deploy-cc.sh -ccv 1.1 -ccs 2       # upgrade: bump both
#   ./network/scripts/deploy-cc.sh -ccv 1.1              # sequence auto-detected (committed + 1)
#
# network.sh deployCC only installs/approves for Org1 and Org2; this script then installs and
# approves the exact same definition for Org3 with the peer CLI, and finishes with a smoke test
# whose transaction is endorsed by Org1 + Org3 (proving Org3 can satisfy the policy).
set -euo pipefail

CC_VERSION="1.0"
CC_SEQUENCE="auto"
SKIP_SMOKE=false

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    -ccv|-v) CC_VERSION="$2"; shift 2 ;;
    -ccs|-s) CC_SEQUENCE="$2"; shift 2 ;;
    --skip-smoke) SKIP_SMOKE=true; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown option: $1" >&2; usage 1 ;;
  esac
done

# shellcheck source=env.sh
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

CC_SRC_PATH="../../../chaincode"                       # relative to test-network
CC_COLL_CONFIG="../../../chaincode/collections_config.json"
CC_END_POLICY="AND('Org1MSP.peer',OR('Org2MSP.peer','Org3MSP.peer'))"

# Keep local test/coverage output out of the chaincode package.
rm -rf "$TEST_NETWORK_HOME/$CC_SRC_PATH/.build" "$TEST_NETWORK_HOME/$CC_SRC_PATH/coverage"

cd "$TEST_NETWORK_HOME"

# ---------------------------------------------------------------------------
# 1. Org1 + Org2: package, install, approve, commit (official test-network flow)
# ---------------------------------------------------------------------------
./network.sh deployCC \
  -c "$CHANNEL_NAME" -ccn "$CC_NAME" -ccp "$CC_SRC_PATH" -ccl typescript \
  -ccv "$CC_VERSION" -ccs "$CC_SEQUENCE" \
  -ccep "$CC_END_POLICY" \
  -cccg "$CC_COLL_CONFIG"

# ---------------------------------------------------------------------------
# 2. Org3: install the same package and approve the committed definition
# ---------------------------------------------------------------------------
# test-network helpers reference unset variables, so relax nounset from here on.
set +u
# shellcheck source=/dev/null
. scripts/envVar.sh

setGlobals 1
COMMITTED=$(peer lifecycle chaincode querycommitted --channelID "$CHANNEL_NAME" --name "$CC_NAME")
SEQUENCE=$(sed -n 's/.*Sequence: \([0-9]*\),.*/\1/p' <<<"$COMMITTED")
VERSION=$(sed -n 's/^Version: \([^,]*\),.*/\1/p' <<<"$COMMITTED")
[[ -n "$SEQUENCE" ]] || fatalln "Could not read committed sequence for $CC_NAME"
infoln "Committed definition: version=$VERSION sequence=$SEQUENCE"

PACKAGE_FILE="$TEST_NETWORK_HOME/${CC_NAME}.tar.gz"
PACKAGE_ID=$(peer lifecycle chaincode calculatepackageid "$PACKAGE_FILE")

setGlobals 3
if peer lifecycle chaincode queryinstalled --output json | grep -q "\"$PACKAGE_ID\""; then
  infoln "Package already installed on peer0.org3"
else
  infoln "Installing $PACKAGE_ID on peer0.org3"
  peer lifecycle chaincode install "$PACKAGE_FILE"
fi

infoln "Approving $CC_NAME v$VERSION seq $SEQUENCE for Org3MSP"
peer lifecycle chaincode approveformyorg \
  -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile "$ORDERER_CA" \
  --channelID "$CHANNEL_NAME" --name "$CC_NAME" --version "$VERSION" --sequence "$SEQUENCE" \
  --package-id "$PACKAGE_ID" \
  --signature-policy "$CC_END_POLICY" \
  --collections-config "$CC_COLL_CONFIG"

# Approvals are recorded per org; confirm Org3 is now on the committed definition.
APPROVALS=$(peer lifecycle chaincode querycommitted --channelID "$CHANNEL_NAME" --name "$CC_NAME" --output json)
for msp in Org1MSP Org2MSP Org3MSP; do
  if ! grep -q "\"$msp\": true" <<<"$APPROVALS"; then
    fatalln "$msp has not approved $CC_NAME sequence $SEQUENCE"
  fi
done
successln "Org1, Org2 and Org3 have approved $CC_NAME v$VERSION (sequence $SEQUENCE)"

# ---------------------------------------------------------------------------
# 3. Smoke test: a transaction endorsed by Org1 + Org3 must commit as VALID
# ---------------------------------------------------------------------------
if [[ "$SKIP_SMOKE" == true ]]; then exit 0; fi

infoln "Smoke test: invoking GetContractInfo endorsed by Org1 + Org3"
parsePeerConnectionParameters 1 3
setGlobals 1
for attempt in 1 2 3 4 5; do
  # The first call to each peer builds and launches the chaincode container, which can take a while.
  if OUT=$(peer chaincode invoke \
      -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile "$ORDERER_CA" \
      -C "$CHANNEL_NAME" -n "$CC_NAME" "${PEER_CONN_PARMS[@]}" \
      -c '{"function":"GetContractInfo","Args":[]}' --waitForEvent 2>&1) \
     && grep -q "status:200" <<<"$OUT" && grep -q "committed with status (VALID)" <<<"$OUT"; then
    successln "Org1+Org3 endorsed transaction committed VALID"
    break
  fi
  [[ $attempt -eq 5 ]] && { echo "$OUT"; fatalln "Smoke test failed"; }
  warnln "Smoke test attempt $attempt failed, retrying in 10s"
  sleep 10
done

setGlobals 3
INFO=$(peer chaincode query -C "$CHANNEL_NAME" -n "$CC_NAME" -c '{"function":"GetContractInfo","Args":[]}')
successln "Query on peer0.org3 → $INFO"

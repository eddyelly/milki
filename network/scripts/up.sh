#!/usr/bin/env bash
# Brings up the Milki Fabric network: Org1 (Ministry), Org2 (Land Office), Org3 (Banks),
# Raft orderer, CAs, CouchDB, and channel land-channel. Then deploys land-registry.
#
#   ./network/scripts/up.sh            # install Fabric if needed, start network, deploy chaincode
#   ./network/scripts/up.sh --no-cc    # network only
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

DEPLOY_CC=true
[[ "${1:-}" == "--no-cc" ]] && DEPLOY_CC=false

cd "$MILKI_NETWORK_DIR"
if [[ ! -x fabric-samples/bin/peer ]] || ! fabric-samples/bin/peer version | grep -q "Version: v$FABRIC_VERSION"; then
  [[ -x install-fabric.sh ]] || { curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh; chmod +x install-fabric.sh; }
  [[ -d fabric-samples ]] && COMPONENTS="binary" || COMPONENTS="samples binary"
  # shellcheck disable=SC2086
  ./install-fabric.sh --fabric-version "$FABRIC_VERSION" --ca-version "$CA_VERSION" $COMPONENTS
fi

# Images: try the official installer (ghcr.io); fall back to Docker Hub if that registry is unreachable.
if ! docker image inspect "hyperledger/fabric-peer:$FABRIC_VERSION" >/dev/null 2>&1; then
  ./install-fabric.sh --fabric-version "$FABRIC_VERSION" --ca-version "$CA_VERSION" docker \
    && docker image inspect "hyperledger/fabric-peer:$FABRIC_VERSION" >/dev/null 2>&1 \
    || "$MILKI_NETWORK_DIR/scripts/pull-images.sh"
fi

cd "$TEST_NETWORK_HOME"
./network.sh up createChannel -c "$CHANNEL_NAME" -ca -s couchdb
(cd addOrg3 && ./addOrg3.sh up -c "$CHANNEL_NAME" -ca -s couchdb)

if [[ "$DEPLOY_CC" == true ]]; then
  "$MILKI_NETWORK_DIR/scripts/deploy-cc.sh"
fi

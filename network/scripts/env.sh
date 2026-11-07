#!/usr/bin/env bash
# Shared settings for the Milki network scripts. Source, don't execute.
# Fabric 2.5.15+ is required for Docker Engine 29+ (older peers fail chaincode builds with "broken pipe").
export FABRIC_VERSION="${FABRIC_VERSION:-2.5.16}"
export CA_VERSION="${CA_VERSION:-1.5.17}"
export CHANNEL_NAME="land-channel"
export CC_NAME="land-registry"

MILKI_NETWORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MILKI_NETWORK_DIR
export TEST_NETWORK_HOME="$MILKI_NETWORK_DIR/fabric-samples/test-network"
export PATH="$MILKI_NETWORK_DIR/fabric-samples/bin:$PATH"
export FABRIC_CFG_PATH="$MILKI_NETWORK_DIR/fabric-samples/config"

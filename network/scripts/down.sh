#!/usr/bin/env bash
# Tears down the Fabric network (all 3 orgs), removing ledgers, crypto material and chaincode images.
# The infra stack (infra/docker-compose.yml) is not touched.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

cd "$TEST_NETWORK_HOME"
(cd addOrg3 && ./addOrg3.sh down) || true
./network.sh down
rm -f "$TEST_NETWORK_HOME/${CC_NAME}.tar.gz"

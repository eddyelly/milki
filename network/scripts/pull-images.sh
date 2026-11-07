#!/usr/bin/env bash
# Pulls the pinned Fabric images from Docker Hub and tags them the way test-network expects.
#
# install-fabric.sh pulls from ghcr.io. Use this script instead when ghcr.io is unreachable
# (e.g. corporate proxies, restricted CI). It is idempotent and retries Docker Hub rate limits.
set -euo pipefail

FABRIC_VERSION="${FABRIC_VERSION:-2.5.16}"
CA_VERSION="${CA_VERSION:-1.5.17}"
NODEENV_VERSION="${NODEENV_VERSION:-2.5}"
COUCHDB_VERSION="${COUCHDB_VERSION:-3.4.2}"

pull() {
  local img="$1"
  docker image inspect "$img" >/dev/null 2>&1 && { echo "✔ $img (cached)"; return; }
  for attempt in 1 2 3 4 5; do
    if docker pull -q "$img" >/dev/null 2>&1; then echo "✔ $img"; return; fi
    echo "… $img failed (attempt $attempt), retrying in $((attempt * 10))s"
    sleep $((attempt * 10))
  done
  echo "✘ could not pull $img" >&2; exit 1
}

for c in peer orderer ccenv baseos; do
  pull "hyperledger/fabric-$c:$FABRIC_VERSION"
  docker tag "hyperledger/fabric-$c:$FABRIC_VERSION" "hyperledger/fabric-$c:2.5"
  docker tag "hyperledger/fabric-$c:$FABRIC_VERSION" "hyperledger/fabric-$c:latest"
done

pull "hyperledger/fabric-ca:$CA_VERSION"
docker tag "hyperledger/fabric-ca:$CA_VERSION" "hyperledger/fabric-ca:1.5"
docker tag "hyperledger/fabric-ca:$CA_VERSION" "hyperledger/fabric-ca:latest"

# Runtime for Node/TypeScript chaincode (peer core.yaml: $(DOCKER_NS)/fabric-nodeenv:2.5)
pull "hyperledger/fabric-nodeenv:$NODEENV_VERSION"

pull "couchdb:$COUCHDB_VERSION"

echo "Fabric images ready."

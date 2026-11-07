#!/usr/bin/env bash
# Resumes an existing network after a reboot / Docker restart, keeping all ledger data.
# (up.sh builds a NEW network; down.sh destroys it. Use this one in between.)
#
#   ./network/scripts/start.sh
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

CORE=(ca_orderer ca_org1 ca_org2 ca_org3 couchdb0 couchdb1 couchdb4 orderer.example.com)
PEERS=(peer0.org1.example.com peer0.org2.example.com peer0.org3.example.com)

missing=()
for c in "${CORE[@]}" "${PEERS[@]}"; do docker inspect "$c" >/dev/null 2>&1 || missing+=("$c"); done
if (( ${#missing[@]} )); then
  echo "These containers do not exist: ${missing[*]}" >&2
  echo "There is no network to resume — create one with ./network/scripts/up.sh" >&2
  exit 1
fi

docker start "${CORE[@]}" >/dev/null
sleep 5
docker start "${PEERS[@]}" >/dev/null

# Wait until the chaincode answers (the peers relaunch chaincode containers on demand).
cd "$TEST_NETWORK_HOME"
set +u
# shellcheck source=/dev/null
. scripts/envVar.sh >/dev/null
setGlobals 1 >/dev/null
for _ in $(seq 1 30); do
  if peer chaincode query -C "$CHANNEL_NAME" -n "$CC_NAME" -c '{"function":"GetContractInfo","Args":[]}' >/dev/null 2>&1; then
    echo "Network resumed; $CC_NAME is answering on $CHANNEL_NAME."
    exit 0
  fi
  sleep 5
done
echo "Containers started, but the chaincode did not answer within 150s." >&2
exit 1

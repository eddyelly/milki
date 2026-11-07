#!/usr/bin/env bash
# End-to-end check of the land-registry chaincode on the running network, with real CA identities:
#   register parcel → bank mortgage blocks transfer → release → full transfer with private sale data
#   → ownership moved → private data readable by Org2 officer → CouchDB rich query → history.
#
#   ./network/scripts/smoke-flow.sh        (network must be up and chaincode deployed)
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$TEST_NETWORK_HOME"
# test-network helpers reference unset variables.
set +u
# shellcheck source=/dev/null
. scripts/envVar.sh >/dev/null

ID_DIR="$MILKI_NETWORK_DIR/identities"
PARCEL="DSM-KIN-$(( RANDOM % 900 + 100 ))-$(( RANDOM % 900 + 100 ))"
TITLE="SMOKE/$PARCEL"
sha() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
pass() { printf '  \033[32m✔\033[0m %s\n' "$1"; }
die() { printf '  \033[31m✘\033[0m %s\n' "$1" >&2; exit 1; }

echo "== Enrolling smoke-test identities"
"$MILKI_NETWORK_DIR/scripts/enroll.sh" smoke_registrar REGISTRAR >/dev/null 2>&1
"$MILKI_NETWORK_DIR/scripts/enroll.sh" smoke_officer LAND_OFFICER >/dev/null 2>&1
"$MILKI_NETWORK_DIR/scripts/enroll.sh" smoke_seller CITIZEN >/dev/null 2>&1
"$MILKI_NETWORK_DIR/scripts/enroll.sh" smoke_buyer CITIZEN >/dev/null 2>&1
"$MILKI_NETWORK_DIR/scripts/enroll.sh" smoke_crdb BANK_OFFICER smoke_crdbpw CRDB >/dev/null 2>&1
pass "5 identities enrolled (role/bank attributes in certs)"

# as <org> <user>: switch the peer CLI to that identity, talking to that org's peer.
as() { setGlobals "$1" >/dev/null; export CORE_PEER_MSPCONFIGPATH="$ID_DIR/org$1/$2/msp"; }

ENDORSERS=(--peerAddresses localhost:7051 --tlsRootCertFiles "$PEER0_ORG1_CA" --peerAddresses localhost:9051 --tlsRootCertFiles "$PEER0_ORG2_CA")
invoke() { # invoke <json> [transient-json]
  local extra=()
  [[ -n "${2:-}" ]] && extra=(--transient "$2")
  peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile "$ORDERER_CA" \
    -C "$CHANNEL_NAME" -n "$CC_NAME" "${ENDORSERS[@]}" -c "$1" "${extra[@]}" --waitForEvent 2>&1
}
query() { peer chaincode query -C "$CHANNEL_NAME" -n "$CC_NAME" -c "$1" 2>&1; }
args() { jq -cn --arg f "$1" '{function:$f, Args:$ARGS.positional}' --args "${@:2}"; }
expect_ok() { grep -q "committed with status (VALID)" <<<"$2" || { echo "$2"; die "$1"; }; pass "$1"; }

echo "== Parcel $PARCEL"
as 1 smoke_registrar
PARCEL_JSON=$(jq -cn --arg id "$PARCEL" --arg t "$TITLE" --arg nida "$(sha salt:seller)" \
  '{parcelId:$id,titleNumber:$t,region:"Dar es Salaam",district:"Kinondoni",ward:"Mikocheni",blockNumber:"12",plotNumber:"45",
    area:650.5,landUse:"RESIDENTIAL",location:{latitude:-6.7631,longitude:39.2462},ownerId:"smoke_seller",ownerNidaHash:$nida}')
expect_ok "RegisterParcel (registrar, Org1+Org2 endorsed)" "$(invoke "$(args RegisterParcel "$PARCEL_JSON")")"

echo "== Encumbrance blocks transfer"
as 3 smoke_crdb
OUT=$(invoke "$(args AddEncumbrance "$PARCEL" '{"type":"MORTGAGE","lenderName":"CRDB Bank","amount":90000000,"currency":"TZS","reference":"LN-1"}')")
expect_ok "AddEncumbrance (CRDB bank officer)" "$OUT"
ENC_ID=$(query "$(args GetEncumbrances "$PARCEL")" | jq -r '.[0].encumbranceId')

SALE=$(jq -cn --arg sc "$(sha salt:+2557001)" --arg bc "$(sha salt:+2557002)" \
  '{salePrice:185000000,currency:"TZS",sellerNidaRef:"REF-S",buyerNidaRef:"REF-B",sellerContactHash:$sc,buyerContactHash:$bc}')
TRANSIENT=$(jq -cn --arg v "$(printf '%s' "$SALE" | base64 -w0)" '{transfer:$v}')
as 1 smoke_seller
OUT=$(invoke "$(args InitiateTransfer "$PARCEL" smoke_buyer "$(sha salt:buyer)")" "$TRANSIENT" || true)
grep -q "active mortgage with CRDB Bank" <<<"$OUT" || { echo "$OUT"; die "expected mortgage to block transfer"; }
pass "InitiateTransfer refused: \"This parcel has an active mortgage with CRDB Bank…\""

as 3 smoke_crdb
expect_ok "ReleaseEncumbrance" "$(invoke "$(args ReleaseEncumbrance "$ENC_ID" "Loan repaid")")"

echo "== Transfer"
as 1 smoke_seller
expect_ok "InitiateTransfer (sale price via transient → transferPrivate)" "$(invoke "$(args InitiateTransfer "$PARCEL" smoke_buyer "$(sha salt:buyer)")" "$TRANSIENT")"
TRF=$(query "$(args QueryTransfers "{\"selector\":{\"parcelId\":\"$PARCEL\"}}" 10 "")" | jq -r '.records[0].transferId')
[[ "$TRF" == TRF-* ]] || die "QueryTransfers (CouchDB) did not find the transfer"
pass "QueryTransfers via CouchDB → $TRF"

as 1 smoke_buyer;      expect_ok "AcceptTransfer (buyer)" "$(invoke "$(args AcceptTransfer "$TRF")")"
as 2 smoke_officer;    expect_ok "ConfirmPayments (land officer)" "$(invoke "$(args ConfirmPayments "$TRF" TRA-2026-1 "$(sha receipt)")")"
                       expect_ok "VerifyTransfer (land officer)" "$(invoke "$(args VerifyTransfer "$TRF" "Checked")")"
as 1 smoke_registrar;  expect_ok "ApproveTransfer (registrar)" "$(invoke "$(args ApproveTransfer "$TRF" "Approved")")"

echo "== Results"
OWNER=$(query "$(args GetParcel "$PARCEL")" | jq -r '.ownerId + " v" + (.ownershipVersion|tostring) + " " + .status')
[[ "$OWNER" == "smoke_buyer v2 ACTIVE" ]] || die "unexpected owner state: $OWNER"
pass "Parcel now owned by smoke_buyer (ownershipVersion 2, ACTIVE)"

as 2 smoke_officer
PRICE=$(query "$(args GetTransferPrivateDetails "$TRF")" | jq -r '.salePrice')
[[ "$PRICE" == "185000000" ]] || die "officer could not read private sale price"
pass "Org2 officer reads private sale price ($PRICE TZS)"

as 3 smoke_crdb
OUT=$(query "$(args GetTransferPrivateDetails "$TRF")" || true)
grep -q "FORBIDDEN" <<<"$OUT" || { echo "$OUT"; die "bank must not read sale details"; }
pass "Bank (Org3) is refused the private sale details"

as 1 smoke_registrar
HIST=$(query "$(args GetParcelHistory "$PARCEL")" | jq -r '[.[].parcel.status] | join(" → ")')
pass "History: $HIST"
COUNT=$(query "$(args QueryParcels '{"selector":{"ownerId":"smoke_buyer"}}' 100 "")" | jq '.records | length')
(( COUNT >= 1 )) || die "QueryParcels by owner returned nothing"
pass "QueryParcels by owner (CouchDB index) → $COUNT parcel(s)"

echo "All end-to-end checks passed."

#!/usr/bin/env bash
# Registers and enrolls a Fabric identity carrying the Milki `role` attribute (CLAUDE.md §2).
# Used for dev/testing with the peer CLI; the backend enrolls real users itself at registration.
#
#   ./network/scripts/enroll.sh <username> <ROLE> [secret]
#
# ROLE → org mapping:
#   CITIZEN, REGISTRAR, SUPPORT_AGENT, SYSTEM_ADMIN → Org1 (Ministry)
#   LAND_OFFICER                                    → Org2 (Land Office)
#   BANK_OFFICER                                    → Org3 (Banks)
#
# The role is written into the enrollment certificate (role=<ROLE>:ecert) so chaincode can read it
# with ctx.clientIdentity.getAttributeValue('role'). The MSP lands in network/identities/<org>/<username>/msp.
# Re-running for an existing username re-enrolls it (registration is skipped).
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

USERNAME="${1:-}"; ROLE="${2:-}"; SECRET="${3:-${USERNAME}pw}"
if [[ -z "$USERNAME" || -z "$ROLE" ]]; then sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 1; fi
[[ "$USERNAME" =~ ^[a-zA-Z0-9._-]+$ ]] || { echo "Invalid username: $USERNAME" >&2; exit 1; }

case "$ROLE" in
  CITIZEN|REGISTRAR|SUPPORT_AGENT|SYSTEM_ADMIN) ORG=1; PORT=7054; CA_CERT="$TEST_NETWORK_HOME/organizations/fabric-ca/org1/ca-cert.pem" ;;
  LAND_OFFICER) ORG=2; PORT=8054; CA_CERT="$TEST_NETWORK_HOME/organizations/fabric-ca/org2/ca-cert.pem" ;;
  BANK_OFFICER) ORG=3; PORT=11054; CA_CERT="$TEST_NETWORK_HOME/addOrg3/fabric-ca/org3/ca-cert.pem" ;;
  *) echo "Unknown role: $ROLE" >&2; exit 1 ;;
esac

CA_NAME="ca-org${ORG}"
ORG_DIR="$TEST_NETWORK_HOME/organizations/peerOrganizations/org${ORG}.example.com"
OUT_DIR="$MILKI_NETWORK_DIR/identities/org${ORG}/${USERNAME}"

# Act as the CA bootstrap admin that test-network already enrolled for this org.
export FABRIC_CA_CLIENT_HOME="$ORG_DIR"

if fabric-ca-client identity list --id "$USERNAME" --caname "$CA_NAME" --tls.certfiles "$CA_CERT" >/dev/null 2>&1; then
  echo "• $USERNAME already registered with $CA_NAME"
else
  fabric-ca-client register --caname "$CA_NAME" \
    --id.name "$USERNAME" --id.secret "$SECRET" --id.type client \
    --id.attrs "role=${ROLE}:ecert" \
    --tls.certfiles "$CA_CERT"
fi

rm -rf "$OUT_DIR"
fabric-ca-client enroll -u "https://${USERNAME}:${SECRET}@localhost:${PORT}" --caname "$CA_NAME" \
  -M "$OUT_DIR/msp" --enrollment.attrs "role" --tls.certfiles "$CA_CERT"

# Node OUs config so the peer classifies this identity as a client of the org.
cp "$ORG_DIR/msp/config.yaml" "$OUT_DIR/msp/config.yaml"

echo "✔ Enrolled $USERNAME ($ROLE) in Org${ORG}MSP → $OUT_DIR/msp"

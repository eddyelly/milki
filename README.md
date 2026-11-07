# Milki

*Ardhi yako, kumbukumbu ya kudumu* — "Your land, a permanent record."

A decentralized land transfer system on Hyperledger Fabric for the Ministry of Lands, Housing and Human Settlements Development (Tanzania). Final year project.

See [CLAUDE.md](./CLAUDE.md) for the full architecture, rules, ports and build phases.

## Quick start (Phase 1 — infra)

```bash
docker compose -f infra/docker-compose.yml up -d
./infra/verify.sh
```

| Service | URL | Login (dev) |
|---|---|---|
| Mongo Express | http://localhost:8181 | `milki` / `milki_dev` |
| RedisInsight | http://localhost:5541 | — |
| MinIO console | http://localhost:9101 | `milki` / `milki_dev_secret` |
| Mailpit | http://localhost:8126 | — |

MongoDB `localhost:27117`, Redis `localhost:6390`, MinIO API `localhost:9100`, SMTP `localhost:1126`.

Stop with `docker compose -f infra/docker-compose.yml down` (add `-v` to wipe data).

## Fabric network (Phase 2)

```bash
./network/scripts/up.sh                      # Org1 Ministry, Org2 Land Office, Org3 Banks + land-channel + chaincode
./network/scripts/deploy-cc.sh -ccv 1.2 -ccs 3   # upgrade chaincode
./network/scripts/enroll.sh registrar1 REGISTRAR # CA identity with role attribute
./network/scripts/down.sh
```

Requires Fabric 2.5.15+ on Docker Engine 29+ (pinned to 2.5.16).

## Chaincode (Phase 3)

```bash
cd chaincode && npm test            # 122 unit tests (mocha + sinon, in-memory peer)
npm run coverage                     # enforces ≥90% branch coverage
./network/scripts/smoke-flow.sh      # end-to-end transfer on the live network
```

## Backend (Phase 4)

```bash
cd backend
cp .env.example .env          # then set real secrets (see comments)
npm run seed                  # demo account per role, password Milki@2026 (dev only)
npm run dev                   # http://localhost:4100 — docs at http://localhost:4100/api/docs
npm test                      # unit/API tests (needs infra up)
npm run test:integration      # full stack on the live network (needs network + running API)
```

Sign-in sends a 6-digit code by "SMS"; in dev it lands in Mailpit at http://localhost:8126.

## Build progress

- [x] 1. Infra
- [x] 2. Fabric network
- [x] 3. Chaincode
- [x] 4. Backend core
- [ ] 5. Transfers and documents
- [ ] 6. Web portal
- [ ] 7. Mobile app
- [ ] 8. Support
- [ ] 9. Admin and partner API
- [ ] 10. Hardening

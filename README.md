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

## Build progress

- [x] 1. Infra
- [ ] 2. Fabric network
- [ ] 3. Chaincode
- [ ] 4. Backend core
- [ ] 5. Transfers and documents
- [ ] 6. Web portal
- [ ] 7. Mobile app
- [ ] 8. Support
- [ ] 9. Admin and partner API
- [ ] 10. Hardening

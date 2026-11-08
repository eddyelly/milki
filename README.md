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
./network/scripts/start.sh                   # resume after a reboot / Docker restart (keeps ledger data)
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

## Web portal (Phase 6)

```bash
cd web
cp .env.example .env.local
npm run dev                  # http://localhost:3100 (needs the API on :4100)
npm test                     # component tests (ConfirmAction, status badges)
npm run test:e2e             # Playwright: login → approve transfer on the live stack
```

Sign in with a staff demo account (e.g. `registrar@milki.dev` / `Milki@2026`); the SMS code is in Mailpit. Landowners use the mobile app.

## Mobile app (Phase 7)

```bash
cd mobile
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:4100/api/v1     # Android emulator; use your LAN IP on a phone
flutter analyze && flutter test                                  # unit, widget and full-app tests (fake API)
flutter test test/live --dart-define=API_URL=http://localhost:4100/api/v1   # contract test on the running stack
flutter test integration_test/app_test.dart \
  --dart-define=API_URL=http://10.0.2.2:4100/api/v1 --dart-define=MAILPIT_URL=http://10.0.2.2:8126   # on a device/emulator
```

Sign in as `citizen@milki.dev` (or `buyer@milki.dev`) / `Milki@2026`; the SMS code is in Mailpit. Turn on fingerprint confirmation in Settings to confirm ledger actions with biometrics. Push notifications need `flutterfire configure` (optional; without it the app uses the live socket only).

## Support (Phase 8)

- **Landowners (mobile):** Help tab → search articles (English/Swahili) → *Talk to a person* → live chat with an agent, or a ticket that is answered by push + email when no agent is online. "Get help" on parcel and transfer screens attaches the context.
- **Agents (web, `support@milki.dev`):** *Support queue* with SLA timers → ticket workspace (live chat, internal notes, canned responses, read-only parcel/transfer context, escalate to a land officer) → *Help centre* to manage articles.
- **Land officers (web, `officer@milki.dev`):** *Escalations* from support.

`npm run seed` (backend) adds the help-centre articles, canned responses and three demo tickets.

## Admin and partner API (Phase 9)

- **Admin (`admin@milki.dev`):** *Users* (create staff with a one-time password, change roles, deactivate), *Land offices*, *API clients* (keys shown once, rotate, revoke) and the read-only *Audit log*.
- **Banks (`bank@milki.dev`):** open a parcel → *Add mortgage / charge* (T3), update or release it from the *Mortgages* tab; *Encumbrances* lists the bank's book.
- **Bank systems:** create an API client, then call the partner API with the key:

```bash
curl -H "x-api-key: $MILKI_KEY" http://localhost:4100/api/v1/partner/parcels/DSM-KIN-12-45
```

```bash
curl -X POST -H "x-api-key: $MILKI_KEY" -H "content-type: application/json" \
  -d '{"nida":"19900101123450000101"}' http://localhost:4100/api/v1/partner/parcels/DSM-KIN-12-45/verify-owner
```

## Hardening, demo data and benchmarks (Phase 10)

```bash
cd backend && npm run seed && npm run seed:demo   # accounts, then 3 regions, 30 parcels, transfers in every state
```

```bash
cd web && npm run test:e2e                         # login → approve, and the full transfer flow (live stack)
```

```bash
./benchmarks/caliper/run.sh                        # Hyperledger Caliper → benchmarks/caliper/report.html
```

Latest benchmark: reads ~400 TPS at ~10 ms, writes ~25 TPS under 1 s (saturating at ~35 TPS) on a single 4-vCPU host — see [docs/benchmarks/caliper-results.md](docs/benchmarks/caliper-results.md).

## Build progress

- [x] 1. Infra
- [x] 2. Fabric network
- [x] 3. Chaincode
- [x] 4. Backend core
- [x] 5. Transfers and documents
- [x] 6. Web portal
- [x] 7. Mobile app
- [x] 8. Support
- [x] 9. Admin and partner API
- [x] 10. Hardening

# CLAUDE.md — Milki

> **Milki** (Swahili: *property, estate*). *Ardhi yako, kumbukumbu ya kudumu* — "Your land, a permanent record."
> A decentralized land transfer system on Hyperledger Fabric for the Ministry of Lands, Housing and Human Settlements Development (Tanzania).
> Final year project. Read this whole file before every task.

---

## 1. Golden rules (never break these)

1. **Scaffold with official CLIs only.** Never hand-write the boilerplate of a framework project. Use the exact commands in §4. Only write files by hand after scaffolding.
2. **Never change the ports in §5.** Every service runs on a custom port to avoid conflicts. If a port is busy, stop and tell the user. Do not pick a new one silently.
3. **The ledger is the source of truth for ownership.** MongoDB is application data plus a read cache. Any verification (ownership checks, bank queries, QR verify) must query the ledger directly.
4. **No personal data on the shared ledger.** NIDA numbers, phone numbers and sale prices go in the private data collection or MongoDB. The ledger stores salted hashes and IDs only.
5. **Files never go on-chain.** Upload them to MinIO and store only their SHA-256 hash on-chain.
6. **Chaincode must be deterministic.**
   - Use `ctx.stub.getTxTimestamp()`.
   - Never use `Date.now()`, `Math.random()`, network calls or unordered map iteration.
7. **Every mutating action needs a confirmation** following the tiers in §8. There are no exceptions on web or mobile.
8. **Nothing on the ledger is ever deleted.** "Delete" means a status change such as `CANCELLED`, `RETIRED`, `FROZEN` or `RELEASED`. Off-chain records use soft delete (`deletedAt`).
9. **Work in the phase order in §13.** Run the tests after each phase. Update this file if an architectural decision changes.
10. **TypeScript strict mode** for chaincode, backend and web. Use `flutter_lints` for mobile. Leave no `any` without a comment explaining why.

---

## 2. Architecture

```
Flutter app (landowners)      Next.js portal (officials, support, admin)      Partner API (banks)
              \                          |                                    /
               └──────────── Express API (REST /api/v1 + Socket.IO) ─────────┘
                      |            |            |              |
                   MongoDB       Redis        MinIO      Fabric Gateway client
                                                               |
                         Hyperledger Fabric 2.5 LTS — channel `land-channel`
                Org1 = Ministry   Org2 = Land Office   Org3 = Banks   (Raft orderer)
                           chaincode `land-registry` (TypeScript)
```

- The mobile app and the web portal **never** talk to Fabric directly. They only call the Express API.
- **MSP mapping** (keep the test-network names; do not rename the MSPs):
  - `Org1MSP` = Ministry. Registrars, and citizens are enrolled here.
  - `Org2MSP` = Land Office (officers).
  - `Org3MSP` = Banks.
- **Endorsement policy:** `AND('Org1MSP.peer', OR('Org2MSP.peer','Org3MSP.peer'))`.
- **Private data collection** `transferPrivate` (Org1 + Org2). Holds the sale price, NIDA references and party contact hashes.

### Roles (Fabric CA attribute `role` + JWT claim)
| Role | Where | Can do |
|---|---|---|
| `CITIZEN` | Mobile | View own parcels, initiate/accept transfers, upload docs, open support tickets |
| `LAND_OFFICER` | Web | Verify transfers, flag disputes, review documents |
| `REGISTRAR` | Web | Register/update parcels, final approve/reject, freeze/unfreeze |
| `BANK_OFFICER` | Web + Partner API | Verify ownership, add/release encumbrances |
| `SUPPORT_AGENT` | Web | Handle tickets and live chat; **read-only** view of user parcels/transfers; cannot change ledger data |
| `SYSTEM_ADMIN` | Web | Users, roles, offices, API clients, KB articles, audit logs |

---

## 3. Repository layout

```
milki/
├── CLAUDE.md
├── infra/              # docker-compose.yml for MongoDB, Redis, MinIO, Mailpit (custom ports)
├── network/            # fabric-samples (from install script) + our scripts/
│   └── scripts/        # up.sh, down.sh, deploy-cc.sh, enroll.sh
├── chaincode/          # land-registry contract (TypeScript)
├── backend/            # Express + TypeScript API
├── web/                # Next.js portal
├── mobile/             # Flutter app
└── docs/               # openapi.yaml, diagrams, report assets
```

---

## 4. Project initialization (run these exact commands)

Prerequisites: Docker, Node.js LTS, Flutter SDK, Git, jq, and Linux or WSL2.

```bash
mkdir milki && cd milki && git init
mkdir infra docs
```

### 4.1 Fabric network
```bash
mkdir network && cd network
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh --fabric-version 2.5.16 docker samples binary   # pin latest 2.5.x LTS (≥2.5.15 required for Docker Engine 29+)
cd fabric-samples/test-network
./network.sh up createChannel -c land-channel -ca -s couchdb
cd addOrg3 && ./addOrg3.sh up -c land-channel -ca -s couchdb && cd ..
```
Then write `network/scripts/deploy-cc.sh`. It must:
1. Run `./network.sh deployCC -c land-channel -ccn land-registry -ccp ../../../chaincode -ccl typescript -ccep "AND('Org1MSP.peer',OR('Org2MSP.peer','Org3MSP.peer'))" -cccg ../../../chaincode/collections_config.json`.
2. Install and approve the chaincode for **Org3** using the peer CLI, because `deployCC` only handles Org1 and Org2.
3. Accept an incrementing `-ccv` and `-ccs` for upgrades.

**Network decisions (Phase 2):**
- Fabric **2.5.16**. Peers older than 2.5.15 cannot build chaincode on Docker Engine 29+ (they fail with "write: broken pipe").
- `network/scripts/`:
  - `env.sh` holds the shared version, channel and chaincode settings.
  - `up.sh` installs Fabric, brings up Org1–Org3 and `land-channel`, then deploys the chaincode.
  - `down.sh` tears the network down.
  - `start.sh` resumes the existing containers after a reboot or Docker restart, keeping ledger data.
  - `deploy-cc.sh [-ccv X -ccs N]` deploys or upgrades for all 3 orgs. It ends with a smoke test whose transaction is endorsed by Org1 + Org3.
  - `enroll.sh <user> <ROLE>` registers a CA identity with `role=<ROLE>:ecert`.
  - `pull-images.sh` is the Docker Hub fallback when ghcr.io is unreachable.
- `transferPrivate` uses `requiredPeerCount: 0`, `maxPeerCount: 1`, `memberOnlyRead/Write: true` and `blockToLive: 0` (kept forever).

### 4.2 Chaincode
```bash
mkdir chaincode && cd chaincode
npm init -y
npm i fabric-contract-api fabric-shim
npm i -D typescript @types/node mocha chai sinon @types/mocha @types/chai @types/sinon ts-node
npx tsc --init
```
`npm i -D typescript` currently installs TypeScript 7, the native compiler. It has no JS API, so `ts-node` cannot run the tests. Tests are compiled with `tsc -p tsconfig.json` into `.build/` and run with mocha (`npm test`). The production build (`tsconfig.build.json`) compiles only `src/` into `dist/`. Fabric's legacy decorators (`experimentalDecorators` + `emitDecoratorMetadata`) work under TS 7.

### 4.3 Backend
```bash
mkdir backend && cd backend
npm init -y
npm i express @hyperledger/fabric-gateway @grpc/grpc-js mongoose ioredis bullmq socket.io @socket.io/redis-adapter \
      zod helmet cors cookie-parser jsonwebtoken bcrypt multer minio pino pino-http \
      swagger-ui-express yaml nodemailer firebase-admin express-rate-limit rate-limit-redis dotenv
npm i -D typescript tsx @types/node @types/express @types/cors @types/cookie-parser @types/jsonwebtoken \
      @types/bcrypt @types/multer @types/nodemailer @types/swagger-ui-express vitest supertest @types/supertest
npx tsc --init
npm i fabric-ca-client fabric-common     # Fabric CA register/enroll (not covered by fabric-gateway)
npm i -D socket.io-client                # integration test listens for ledger:tx
```
The backend compiles to CommonJS (`tsconfig.build.json` → `dist/`). Tests type-check separately with `test/tsconfig.json` (bundler resolution), because Vitest runs them as ESM. The Vitest configs are `.mts`.

### 4.4 Web portal
```bash
npx create-next-app@latest web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
cd web
npx shadcn@latest init
npx shadcn@latest add button card input label form dialog alert-dialog sheet table tabs badge \
      dropdown-menu select textarea avatar skeleton sonner tooltip command popover calendar \
      separator scroll-area progress breadcrumb sidebar chart
npm i motion @tanstack/react-query @tanstack/react-table axios react-hook-form @hookform/resolvers zod \
      socket.io-client next-themes lucide-react recharts lottie-react react-leaflet leaflet qrcode.react date-fns
npm i -D @types/leaflet
```

**Web decisions (Phase 6):**
- **shadcn registry:** when `ui.shadcn.com` is unreachable (it is blocked in the cloud dev sandbox), `shadcn init` cannot run.
  - Init is served dynamically (`/init?base=…`), so a mirror can't provide it.
  - Instead, `web/components.json` was written by hand (`style: new-york`, Tailwind v4, aliases `@/components`, `@/lib`, `@/hooks`).
  - Then the official CLI ran `shadcn add index` and the §4.4 `shadcn add …` list with `REGISTRY_URL` pointing at a local copy of shadcn's `new-york-v4` registry, built from github.com/shadcn-ui/ui.
  - With registry access, `npx shadcn@latest add <name>` works normally.
- **Small edits to generated components:**
  - `button.tsx` gets the `press` class (0.97 scale on press).
  - `command.tsx`: `CommandDialog` forwards `shouldFilter`.
  - `sidebar.tsx` skeleton width no longer calls `Math.random`.
  - `use-mobile.ts` uses `useSyncExternalStore`.
- **Next 16** (`cacheComponents` and `partialPrefetching` are on by default):
  - Every portal `page.tsx` is a small server file exporting `instant = false` and rendering a client `*-view.tsx`. Portal pages wait for the client session, so they cannot be prerendered.
  - Route `params` are read behind `<Suspense>`.
  - `(portal)/layout.tsx` is a server layout that suspends the client `PortalShell`.
  - Route params are Promises: `use(params)` in client views.
- **Auth in the browser:**
  - The access token is kept in memory only. The refresh token is the API's httpOnly cookie.
  - A non-sensitive `localStorage` hint (`milki_session_hint`) avoids a pointless refresh (and 401) for signed-out visitors.
  - Citizens who sign in see a "use the mobile app" screen.
- **ConfirmAction** (`src/components/confirm-action.tsx`) implements T1, T2 and T3.
  - T3: review, then re-authentication (password or SMS code), then `SealedOnLedger` (submitting → endorsing → committed with block number and txId).
  - The idempotency key is fixed for the life of one dialog.
  - Typed confirmation (`typeToConfirm`) also gates destructive T3 actions (cancel, reject, retire).
- **Records refresh live** while a dialog is open. Action buttons render from `useSnapshotWhileOpen()`, so a commit can't unmount the dialog mid-animation.
- **Read receipts** (mark notification read / all read) are UI state, not user data, so they have no confirmation. Deleting a notification is T1.
- **Live data:** Socket.IO `ledger:event`, `queue:updated` and `notification` invalidate React Query caches. `waitForCommit()` listens for `ledger:tx` and polls `GET /ledger/tx/:id` as a fallback.
- **Tables:** TanStack Table **v9** (`tableFeatures` + `useTable`), core row model only; paging and sorting are server-side. Tables are never animated.
- **Backend additions** for the portal: `GET /stats/overview` (dashboard, 60 s Redis cache), `POST /parcels/:id/disputes`, `POST /disputes/:id/notes`, `POST /disputes/:id/resolve`. Parcel history includes owner names for staff.
- **Tests:**
  - `npm test`: Vitest + Testing Library on jsdom, covering `ConfirmAction` and `StatusBadge`. There is no `@vitejs/plugin-react`, because its Babel 8 peer clashes with shadcn's Babel 7; Vitest's built-in JSX transform is used instead.
  - `npm run test:e2e`: Playwright (pinned to the installed 1.63) smoke test of login → approve transfer on the live stack. Set `PLAYWRIGHT_CHROMIUM_PATH` to use a pre-installed Chromium.
  - `@types/node` is ^22, matching Node 22 and Vitest's peer.

### 4.5 Mobile app
```bash
flutter create --org tz.milki --project-name milki_mobile --platforms android,ios mobile
cd mobile
flutter pub add flutter_riverpod go_router dio freezed_annotation json_annotation flutter_secure_storage \
      local_auth mobile_scanner file_picker image_picker crypto firebase_core firebase_messaging \
      hive_ce hive_ce_flutter flutter_animate lottie google_fonts intl socket_io_client shimmer \
      qr_flutter timeago cached_network_image
flutter pub add flutter_localizations --sdk=flutter
flutter pub add -d build_runner freezed json_serializable flutter_lints hive_ce_generator
dart pub global activate flutterfire_cli && flutterfire configure
```
Add `generate: true` under `flutter:` in `pubspec.yaml`. Then create `l10n.yaml` with English and Swahili ARB files.

**Mobile decisions (Phase 7):**
- **Toolchain:** Flutter 3.47 / Dart 3.13, Riverpod 3, go_router 18. `integration_test` was added with `flutter pub add -d integration_test --sdk=flutter`.
- **`flutterfire configure` was skipped** (it needs a Firebase login). Push is optional, like on the backend:
  - `lib/core/push.dart` calls `Firebase.initializeApp()`. Without `google-services.json` / `GoogleService-Info.plist` it fails quietly and push is skipped.
  - With a config, the app registers its FCM token (`POST /devices`) after sign-in and deletes it on sign-out. It keeps the token API (`getToken`/`onTokenRefresh`) because firebase-admin sends to registration tokens.
  - While the app is open, commits and changes still arrive over Socket.IO.
  - To enable push, run `flutterfire configure` in `mobile/`.
- **Models are hand-written** (`lib/data/models.dart`, null-safe `fromJson`), not freezed/json_serializable. They are small, read-only and need no codegen step. The codegen packages from §4.5 stay installed for later.
- **Fonts are bundled** in `assets/google_fonts/` (Plus Jakarta Sans 400–700, JetBrains Mono 400–600, with OFL licences). `GoogleFonts.config.allowRuntimeFetching = false`.
  - `monoStyle()` caps weights at 600.
  - Theme `textStyle`s must name the font, because a button theme's `textStyle` replaces `labelLarge` rather than merging with it.
- **Structure:**
  - `lib/core/`: API client, token store, theme, ledger events, re-auth, push, config.
  - `lib/data/`: models and repositories.
  - `lib/state/providers.dart`: session, settings and data providers. Lists refresh on socket `ledger:event` / `notification`.
  - `lib/router.dart`: session redirect; `/check` is public.
  - `lib/ui/screens/` and `lib/ui/widgets/`.
- **Session:**
  - The access token is in memory. The rotating refresh token, device ID and device secret are in `flutter_secure_storage` (Keystore/Keychain).
  - A 401 triggers one single-flight refresh, then a retry. A failed refresh signs the user out with a "session ended" banner.
  - Only `CITIZEN` accounts may use the app; staff are told to use the web portal.
- **Mobile T3 re-authentication (§8)** uses a **device credential**:
  - Turning on "Fingerprint / face confirmation" in Settings (T1, password once) calls `POST /auth/reauth/device`.
  - This returns a 32-byte secret, shown once. The phone keeps it in secure storage; the API stores only its SHA-256 (`reauth_devices`).
  - At each T3, `local_auth` runs (`biometricOnly: false`, so the device PIN is the fallback). Only after it succeeds does the app send `POST /auth/reauth {deviceId, deviceSecret}`, which returns the usual single-use `X-Reauth-Token`.
  - Password re-auth is always available. Sign-out and turning the setting off revoke the credential (`DELETE /auth/reauth/device/:id`).
- **`showConfirmAction(context, tier: …)`** (`lib/ui/widgets/confirm_action.dart`) is the only confirmation helper.
  - **T1:** summary, then confirm.
  - **T2 / destructive:** red, with `typeToConfirm`.
  - **T3:** impact sentence, then "permanent and publicly auditable", then re-auth, then `SealedOnLedger` (submitting → endorsing → committed with block and txId).
  - The idempotency key is fixed for the life of the sheet. Extra inputs (cancel reason, password) re-validate through `listen:` + `canConfirm`.
  - A chaincode refusal returns to the review step with the human message.
- **Public QR verification** (backend `verify` module, no sign-in, 60/min per IP, read from the ledger with the service identity):
  - `GET /verify/parcels/:id` returns status, a short owner name and encumbrance/dispute flags.
  - `GET /verify/documents/:id?sha256=` returns a hash match.
  - QR payloads: `milki:parcel:<ID>` (shown as "Share proof of ownership" on the parcel screen) and `milki:doc:<DOC-ID>:<sha256>`. Verification URLs and bare parcel IDs are accepted too.
- **Citizen flows:**
  - Initiate a transfer: find the buyer by phone, enter the price, then T3.
  - Accept (T3).
  - Cancel: T3 + typed transfer ID + reason.
  - Upload a transfer document from file or camera: T3, client SHA-256, 10 MB cap.
  - Delete a notification (T1). Mark read needs no confirmation (UI state).
- **Motion (§10)** follows `MediaQuery.disableAnimations` everywhere: drifting contour background, OTP bounce, Hero parcel card → detail, ownership chain stagger, tracker line fill + breathing step + check-draw, scanline + badge flip / shake, seal stamp.
- **Swahili:** every string is in `app_sw.arb`. `lib/core/timeago_sw.dart` adds Swahili "time ago" labels, which the timeago package lacks.
- **Platform config:**
  - Android: `MainActivity` is a `FlutterFragmentActivity` (local_auth), with AppCompat launch themes and the `androidx.appcompat` dependency.
  - Android permissions: CAMERA, USE_BIOMETRIC, POST_NOTIFICATIONS. `usesCleartextTraffic` is on for the dev HTTP API.
  - iOS: camera, Face ID and photo usage strings, plus `NSAllowsLocalNetworking`.
- **Tests** (`flutter test`):
  - Repository tests run against an in-memory Dio adapter (`test/support/fakes.dart`).
  - Widget tests cover `TransferTracker`, `showConfirmAction` (T1/T2/T3, biometric, retry with the same key, commit failure) and the verify screen.
  - `test/app_flow_test.dart` runs the full app (sign in → OTP → parcel → initiate transfer → sealed).
  - `test/live/` is a contract test against the running API and is skipped unless `--dart-define=API_URL=…` is set.
  - `integration_test/app_test.dart` runs on a device or emulator against the live stack, reading the OTP from Mailpit.

---

## 5. Ports (fixed; do not change)

| Service | Port | Default it avoids |
|---|---|---|
| Next.js web portal | **3100** | 3000 |
| Express API + Socket.IO | **4100** | 3000/5000 |
| MongoDB | **27117** | 27017 |
| Mongo Express (dev UI) | **8181** | 8081 |
| Redis | **6390** | 6379 |
| RedisInsight (dev UI) | **5541** | 5540 |
| MinIO API | **9100** | 9000 |
| MinIO console | **9101** | 9001 |
| Mailpit SMTP (dev email/OTP) | **1126** | 1025 |
| Mailpit web UI | **8126** | 8025 |

**Fabric reserved ports.** These are test-network defaults. Leave them alone, and do not bind anything else to them.
- Orderer: 7050 (admin 7053, operations 9443)
- Peers: Org1 7051, Org2 9051, Org3 11051
- CAs: Org1 7054, Org2 8054, Org3 11054
- CouchDB: 5984, 7984, 9984

**Mobile dev base URL:** `http://10.0.2.2:4100` on the Android emulator. On a physical device, use the LAN IP of the dev machine.

Add the npm scripts that pin ports:
- In `web/package.json`: `"dev": "next dev -p 3100"` and `"start": "next start -p 3100"`.

`infra/docker-compose.yml` must use the project name `milki` and named volumes. Map the ports exactly:
- `27117:27017`, `6390:6379`, `9100:9000`, `9101:9001`, `1126:1025`, `8126:8025`, `8181:8081`, `5541:5540`

**Infra decisions (Phase 1):**
- MinIO uses `pgsty/minio` (pinned release tag). Upstream `minio/minio` and `minio/mc` images were withdrawn from Docker Hub in 2025. The API is identical.
- There is no `mc` init container. The backend creates `MINIO_BUCKET` (private) at startup if it is missing.
- `infra/verify.sh` checks every port in this table with a real protocol probe. Run it after `docker compose up -d`.

---

## 6. Environment variables

Commit an `.env.example` for each app. Never commit a real `.env`.

**backend/.env.example**
```
PORT=4100
NODE_ENV=development
LOG_LEVEL=info
MONGO_URI=mongodb://milki:milki_dev@localhost:27117/milki?authSource=admin
REDIS_URL=redis://:milki_dev@localhost:6390
MINIO_ENDPOINT=localhost
MINIO_PORT=9100
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=milki
MINIO_SECRET_KEY=milki_dev_secret
MINIO_BUCKET=milki-documents
SMTP_HOST=localhost
SMTP_PORT=1126
SMTP_FROM="Milki <no-reply@milki.go.tz>"
JWT_ACCESS_SECRET=change_me_access_secret_at_least_32_chars
JWT_REFRESH_SECRET=change_me_refresh_secret_at_least_32_chars
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
# 32-byte key as 64 hex chars: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
WALLET_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
PII_HASH_SALT=change_me_pii_salt
FABRIC_CHANNEL=land-channel
FABRIC_CHAINCODE=land-registry
FABRIC_ORGS_PATH=../network/fabric-samples/test-network/organizations
FABRIC_CA_ADMIN_ID=admin
FABRIC_CA_ADMIN_SECRET=adminpw
ORG1_PEER_ENDPOINT=localhost:7051
ORG1_PEER_HOST_ALIAS=peer0.org1.example.com
ORG1_CA_URL=https://localhost:7054
ORG1_CA_NAME=ca-org1
ORG2_PEER_ENDPOINT=localhost:9051
ORG2_PEER_HOST_ALIAS=peer0.org2.example.com
ORG2_CA_URL=https://localhost:8054
ORG2_CA_NAME=ca-org2
ORG3_PEER_ENDPOINT=localhost:11051
ORG3_PEER_HOST_ALIAS=peer0.org3.example.com
ORG3_CA_URL=https://localhost:11054
ORG3_CA_NAME=ca-org3
# Set to false to run the API without a Fabric network (ledger endpoints then return 503).
FABRIC_ENABLED=true
CORS_ORIGINS=http://localhost:3100
FCM_SERVICE_ACCOUNT_PATH=./secrets/firebase.json
# Test/dev only: relax auth rate limits (requests per minute per IP).
AUTH_RATE_LIMIT_PER_MIN=20
```

**web/.env.example**
```
NEXT_PUBLIC_API_URL=http://localhost:4100/api/v1
NEXT_PUBLIC_SOCKET_URL=http://localhost:4100
```

**Mobile:** pass the API URL with `--dart-define=API_URL=http://10.0.2.2:4100/api/v1`.

---

## 7. Feature catalogue and CRUD

On-chain entities never use a hard delete; "Delete" is always a status transition. Every list endpoint supports pagination (`page`, `limit`), search (`q`), filters and sorting.

### 7.1 On-chain (chaincode functions; backend wraps each one)
| Entity | Create | Read | Update | "Delete" |
|---|---|---|---|---|
| **Parcel** | `RegisterParcel` (REGISTRAR) | `GetParcel`, `GetParcelHistory`, `QueryParcels` (rich query) | `UpdateParcel` (whitelisted fields: landUse, area correction, location) | `FreezeParcel` / `UnfreezeParcel`, `RetireParcel` |
| **Transfer** | `InitiateTransfer` (owner) | `GetTransfer`, `QueryTransfers` | `AcceptTransfer`, `ConfirmPayments`, `VerifyTransfer`, `ApproveTransfer` | `CancelTransfer` (seller, before verification), `RejectTransfer` (officer/registrar) |
| **Encumbrance** | `AddEncumbrance` (BANK) | in parcel + `GetEncumbrances` | `UpdateEncumbrance` (amount/terms) | `ReleaseEncumbrance` |
| **Dispute** | `FlagDispute` (officer) | `GetDisputes` | `AddDisputeNote` | `ResolveDispute` |
| **Document ref** | `AttachDocument` (hash + type) | in parcel/transfer | `SupersedeDocument` (new version; the old hash is kept) | — |

**Transfer state machine:**
`INITIATED → BUYER_ACCEPTED → PAYMENTS_CONFIRMED → OFFICER_VERIFIED → APPROVED → COMPLETED`, and `CANCELLED` / `REJECTED` are terminal.

**Guards:**
- Only the owner can initiate.
- One active transfer per parcel.
- No transfer while the parcel is `ENCUMBERED`, `DISPUTED` or `FROZEN`.
- The approver must have a different role from the verifier.

**Event:** every function emits a `milki.<Entity>.<Action>` event.

**Chaincode decisions (Phase 3):**
- **Layout:** `chaincode/src/services/<entity>.service.ts` holds the logic. `landRegistry.contract.ts` is a thin wrapper.
- **Errors:** every error message is JSON `{ code, message, details? }`. The backend maps it to the error envelope and shows `message` to users.
  - Codes: `INVALID_ARGUMENT`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `INVALID_STATE`, `PARCEL_ENCUMBERED`, `PARCEL_DISPUTED`, `PARCEL_FROZEN`, `PARCEL_RETIRED`, `TRANSFER_IN_PROGRESS`.
- **Identity:**
  - The caller's ID is the certificate CN (the CA enrollment ID, which equals the Milki user ID).
  - The `role` attribute must match the issuing MSP (§2). Identities without a role can only read.
  - `BANK_OFFICER` also needs a `bank` attribute (e.g. `CRDB`), because all banks share Org3MSP. Only that bank may update or release its encumbrance.
- **Parcel status is derived, never set:** `RETIRED > FROZEN > DISPUTED > ENCUMBERED > PENDING_TRANSFER > ACTIVE`. It is computed from `retired`, `frozen`, `openDisputeIds`, `activeEncumbranceIds` and `activeTransferId`.
- **IDs:** `TRF-`, `ENC-`, `DSP-` and `DOC-` followed by the first 16 hex characters of the txId, so every endorser derives the same ID. Keys are `PARCEL_<id>`, `TRANSFER_<id>`, and so on, plus a `TITLE_<titleNumber>` uniqueness index. JSON is written with sorted keys.
- **Transfer roles:**
  - `ConfirmPayments` is done by a `LAND_OFFICER`, against receipts (TRA and payments are mocked).
  - `ApproveTransfer` (`REGISTRAR`) records APPROVED and COMPLETED in the same transaction and moves ownership. It emits `milki.Transfer.Approved`.
  - `RejectTransfer`: an officer can reject until verification; after verification only a registrar can.
  - Every forward step re-checks the parcel guards and that the seller still owns the parcel (`ownershipVersion`).
- **Private sale details** go in the transient map under key `transfer`, as `{salePrice, currency, sellerNidaRef, buyerNidaRef, sellerContactHash, buyerContactHash}`. They are stored in `transferPrivate` and read with `GetTransferPrivateDetails` (parties and officials only).
- **Encumbrances** cannot be added while the parcel is frozen, retired, disputed or has a transfer in progress.
- **Disputes:** a `LAND_OFFICER` flags them. A `LAND_OFFICER` or `REGISTRAR` adds notes and resolves them.
- **Documents:**
  - Who may attach: the owner, a registrar or a land officer (parcel); the parties or officials while a transfer is open; a bank only a `MORTGAGE_DEED`, and only where it holds an active encumbrance.
  - A duplicate hash on the same target is refused.
- **Extra read functions:** `GetContractInfo`, `GetParcelTransfers`, `GetEncumbrance`, `GetDocuments`, `VerifyDocument` (hash match for QR verify), `GetTransferPrivateDetails`.
- **Indexes:** CouchDB indexes live in `chaincode/META-INF/statedb/couchdb/indexes`.
- **Tests:**
  - `npm test` (mocha + sinon) runs against an in-memory peer (`test/support/fake-ledger.ts`) with buffered, atomic commits.
  - `npm run coverage` enforces ≥90% branch coverage.
  - `network/scripts/smoke-flow.sh` runs the end-to-end flow on the live network.

### 7.2 Off-chain (MongoDB)
| Entity | C | R | U | D |
|---|---|---|---|---|
| User / profile | register (citizen), admin creates staff | ✓ | self profile, admin edits roles | deactivate (soft) |
| Land office / region | admin | ✓ | admin | soft delete |
| API client (banks) | admin creates, key shown once | ✓ | rotate key, change scopes | revoke |
| Support ticket | any user | own / agent queue | status, priority, assignee, tags | close; admin soft delete |
| Ticket message | ✓ | ✓ | edit within 5 min | delete own within 5 min |
| Canned response | agent | ✓ | ✓ | ✓ |
| KB article + category | support admin | public | ✓ | unpublish / soft delete |
| Notification | system | ✓ | mark read / all read | delete |
| Device token (FCM) | on login | — | refresh | on logout |
| Parcel/transfer cache | event listener only | ✓ | event listener only | never via API |
| Audit log | system (every mutation) | admin, read-only | — | — |

---

## 8. Confirmation system (all mutations, web + mobile)

| Tier | Used for | UX |
|---|---|---|
| **T1 Standard** | create/update off-chain data (profile, ticket, KB article, office) | Dialog showing a summary of changes → Confirm → toast |
| **T2 Destructive** | soft delete, revoke API key, close ticket, cancel/reject transfer, deactivate user | Red dialog. The user must **type the identifier** (e.g. parcel ID or "REVOKE") to enable the button. States the consequences. |
| **T3 Ledger** | anything that writes to Fabric | Review screen with a ledger impact summary ("Ownership of DSM-KIN-12-45 will move from A to B") → "This is permanent and publicly auditable" → **re-authentication** (web: OTP/password; mobile: biometric via `local_auth`, PIN fallback) → submit animation (§10) |

**Implementation:**
- Web: build one `<ConfirmAction tier=... />` component on shadcn `AlertDialog`. Use it everywhere.
- Mobile: build one `showConfirmAction(context, tier: ...)` helper.
- Disable the button while the request is pending.
- Every write request sends an `Idempotency-Key` header. The backend stores keys in Redis for 24 hours and rejects duplicates.
- **Ledger writes return `202 { txId, status: "SUBMITTED" }`.** The UI moves to "Committed" when the commit event arrives over Socket.IO or FCM.
- **Errors must be human-readable.** For example, show "This parcel has an active mortgage with CRDB Bank" rather than a raw error code.

---

## 9. Brand and design system

**Personality:** trustworthy, official, modern, warm.
**Visual motifs:**
- Topographic contour lines as subtle backgrounds.
- A seal / stamp motif for ledger confirmations.
- Chain links for history.

### 9.1 Colors
| Token | Light | Dark | Use |
|---|---|---|---|
| `primary` (Shamba Green) | `#12805C` | `#2BB585` | Primary actions, active states |
| `primary-deep` | `#0B4F3C` | `#0F3D30` | Sidebar, headers, hero areas |
| `accent` (Hati Gold) | `#E9B949` | `#F2C960` | Highlights, seals, verified badges |
| `earth` (Udongo Terracotta) | `#C2593A` | `#E07A5A` | Disputes, important callouts |
| `ink` | `#0B1220` | `#E8ECF2` | Main text |
| `muted` | `#5B6474` | `#9AA3B2` | Secondary text |
| `surface` | `#F7F5EF` (warm paper) | `#0B1220` | Page background |
| `card` | `#FFFFFF` | `#131B2C` | Cards |
| `border` | `#E4E0D5` | `#243049` | Hairlines |
| `success` / `warning` / `danger` / `info` | `#16A34A` / `#D97706` / `#DC2626` / `#2563EB` | lighter variants | System states |

**Parcel and transfer status colors:**
- `ACTIVE` = primary
- `PENDING_TRANSFER` = accent
- `ENCUMBERED` = info
- `DISPUTED` = earth
- `FROZEN` / `RETIRED` = muted
- `COMPLETED` = success
- `REJECTED` / `CANCELLED` = danger

Always pair a status color with an icon and a label, never color alone.

**Where tokens live:**
- Web: CSS variables in `globals.css` (Tailwind `@theme` + shadcn variables), with light and dark themes via `next-themes`.
- Mobile: `ThemeData` with a `ColorScheme` built from these exact hex values, plus a `ThemeExtension` for the status colors.

### 9.2 Typography
- UI and headings: **Plus Jakarta Sans** (weights 400, 500, 600, 700).
- Hashes, IDs and transaction IDs: **JetBrains Mono**.
- Web loads them with `next/font/google`; mobile uses `google_fonts`.
- Scale: 12 / 14 / 16 / 18 / 22 / 28 / 36.

### 9.3 Layout
- Corner radius 12 (cards), 10 (inputs/buttons), 999 (chips).
- 8-pt spacing grid.
- Soft shadows only on raised cards.
- Web: collapsible sidebar plus top bar with a search command palette (`⌘K`).
- Mobile: bottom navigation (Home, Parcels, Transfers, Verify, Help).
- Fully responsive web, down to tablet.
- Meet WCAG AA contrast.

---

## 10. Motion (stunning but purposeful)

**Tools:** `motion` (`motion/react`) on web; `flutter_animate`, Hero transitions and `lottie` on mobile.
Durations are 150–400 ms with ease-out curves. **Always respect reduced motion** (`useReducedMotion` on web, `MediaQuery.disableAnimations` on Flutter).

Signature animations:
1. **"Sealed on the ledger."** After a T3 action, show three stages: a pulsing gold ring ("Submitting"), then chain links snapping together ("Endorsing"), then a gold seal stamp with the block number and txId fading in ("Committed").
2. **Ownership history chain.** A vertical timeline. The connecting line draws downward on scroll, and each owner node pops in with a stagger. Tapping a node expands the tx details.
3. **Transfer tracker.** A stepper whose progress line fills between stages. The current stage breathes gently, and completed stages tick with a check-draw animation.
4. **Verification result.** Scan a QR code and an animated scanline sweeps the frame. On success, a gold "Verified on Milki" badge flips in with a hash-match check. On a mismatch, the card shakes with an earth-colored warning.
5. **Parcel card → details.** Mobile uses a Hero transition. Web uses `layoutId` shared-element transitions.
6. **Dashboard.** Count-up KPI numbers, staggered card entrance, and animated Recharts.
7. **Auth.** A slow-drifting topographic contour background on the login screen (SVG/CustomPainter), and OTP boxes that bounce on input.
8. **Micro-interactions.** Button press scale (0.97), skeleton shimmer while loading, and toast slide-ins.
9. **Support chat.** Message bubbles spring in, a typing indicator with three bouncing dots, and agent presence dots.

Do not animate data tables or anything a user reads repeatedly in long sessions.

---

## 11. Support and help center

**Goal:** any user facing an issue reaches a human quickly, and the agent has the context to help.

**Help center (web and mobile)**
- Searchable knowledge base articles grouped by category (Getting started, Transfers, Documents, Mortgages, Account).
- Articles render in English and Swahili.
- Each article has a "Was this helpful?" vote.

**Tickets**
- Ticket number format: `MLK-000123`.
- Fields: category, priority (`LOW`/`NORMAL`/`HIGH`/`URGENT`), subject, description and attachments (MinIO).
- **Context-aware:** a "Get help" button on parcel, transfer and document screens pre-attaches `parcelId` / `transferId`.
- Status flow: `OPEN → IN_PROGRESS → AWAITING_USER → RESOLVED → CLOSED`. A ticket can be reopened within 7 days of being resolved.
- Agents can assign, claim and reassign tickets, add internal notes (hidden from users), use canned responses and tags, and see an SLA timer. The SLA timer turns accent at 75% of the deadline and danger once breached.
- After resolution the user rates the ticket (1–5 stars plus a comment), giving a CSAT score.

**Live chat**
- Socket.IO namespace `/support`, using the Redis adapter, with one room per ticket.
- Features: typing indicators, read receipts, agent online presence, and file attachments.
- If no agent is online, the chat becomes ticket messages, and the user gets push and email notifications on replies.

**Agent console (web)**
- Queue view with filters, ticket detail, and a chat pane.
- A **read-only** context panel showing the user's parcels and transfers, plus a ledger history link.
- **Escalate to officer** creates an internal task for a `LAND_OFFICER`.
- Agents never mutate ledger data.

**Admin metrics:** open tickets, average first response time, average resolution time, CSAT trend and tickets by category.

**Support decisions (Phase 8):**
- **Backend modules:** `kb` (help centre) and `support` (tickets, messages, canned responses, escalations, metrics, Socket.IO namespace). All off-chain: support never touches the ledger.
  - Collections: `kb_categories`, `kb_articles`, `kb_votes`, `tickets`, `ticket_messages`, `canned_responses`, `escalations`, `counters` (ticket numbers `MLK-000123`).
  - Soft delete everywhere (`deletedAt`). KB articles and canned responses are managed by `SUPPORT_AGENT` and `SYSTEM_ADMIN`. Only `SYSTEM_ADMIN` soft-deletes tickets.
  - Every write is idempotent and audited (`support.*`, `kb.*`).
- **Help centre:** reading and "Was this helpful?" votes are public.
  - One vote per reader: the user ID, or a salted IP hash when signed out. Changing a vote moves it.
  - Articles store `{en, sw}` for title and body, both required. Search uses a Mongo text index over both languages.
  - Bodies use a tiny Markdown subset (paragraphs, `- ` lists, `**bold**`), rendered as elements on web and mobile, never as HTML.
- **SLA** by priority (first response / resolution):
  - URGENT 1 h / 8 h, HIGH 4 h / 24 h, NORMAL 24 h / 72 h, LOW 72 h / 7 d.
  - The timer is accent from 75% of the window and danger once breached. It shows icon + words, not colour alone.
  - Changing priority recalculates the due dates from creation; reopening restarts the resolution clock.
- **Status rules:**
  - An agent's first public reply sets `firstResponseAt` and moves OPEN → IN_PROGRESS, auto-assigning the agent if nobody has the ticket.
  - A requester's reply to AWAITING_USER moves it back to IN_PROGRESS.
  - Agents follow the transition table in `ticket.service.ts`. CLOSED is final, except the requester's 7-day reopen after resolution.
  - Messages can be edited or deleted by their author for 5 minutes (soft delete).
- **Live chat:** Socket.IO namespace `/support` (Redis adapter) with rooms `ticket:<id>` and `ticket:<id>:staff`; internal notes and their typing go to the staff room only.
  - Messages are written over REST (idempotent, audited) and fanned out on the socket.
  - The socket carries `typing`, `read`, `message:new|updated|deleted`, `ticket:updated`, `queue:updated` and `presence`. Presence is derived from connected staff sockets via `fetchSockets`, so it works across instances.
  - Offline fallback: when the requester is not in the ticket room, an agent reply becomes an in-app/push notification (`support.reply`, en/sw) plus an email if the user has one. Resolution sends `support.resolved`, asking for a rating.
- **Escalate to officer:** creates an `escalations` task.
  - `LAND_OFFICER`s are notified and see it under **Escalations** (web). Their answer is added to the ticket as an internal note.
  - One open escalation per ticket.
- **Agent context panel:** `GET /tickets/:id/context` (staff only, `meta.readOnly`). It returns the requester's profile, parcels and transfers from the caches, and previous tickets, with links to the read-only parcel and transfer pages.
- **Confirmation tiers:**
  - T1: creating or editing tickets, articles and canned responses; claim and assign; escalate; rate; reopen; edit or delete a message.
  - T2 (typed identifier): close a ticket (its number), delete an article or canned response, unpublish an article.
  - **Exception: sending a chat message has no dialog.** The Send button is the explicit action and the 5-minute edit/delete window is the undo. A confirmation on every chat line would make live chat unusable.
  - Read receipts and help votes are UI state or feedback, like notification read receipts.
- **Web:**
  - `/support` queue: tabs, filters, SLA-first sort, live refresh.
  - `/support/[ticketId]` workspace: chat with spring-in bubbles, typing dots and presence; reply/internal-note toggle; canned-response picker; attachments; ticket controls with a confirmed diff; read-only context.
  - `/support/canned`, `/help` (reading, en/sw toggle), `/help/manage`, `/escalations`, and support KPIs and charts on the dashboard.
  - The overview stats include `support.{unassigned, openTickets, openEscalations}` for nav badges.
- **Mobile:**
  - The Help tab now shows the knowledge base, **Talk to a person**, My tickets, New ticket (T1, with optional attachment), and the ticket chat. The chat has live bubbles, typing dots, agent presence, ✓✓ read receipts, rate (stars) and reopen.
  - "Get help" buttons on the parcel and transfer screens pre-attach `parcelId` / `transferId`.
  - Support notifications deep-link to the chat.
- **Tests:**
  - Backend `test/support.test.ts`: KB, tickets, SLA, attachments, escalations, metrics, and the `/support` namespace with real Socket.IO clients.
  - Web `test/support.test.tsx`: SLA timer, ticket badge, Markdown renderer.
  - Mobile `test/support_test.dart`, plus a live contract test that chats with an agent over `/support`.

---

## 12. Backend conventions

- **Structure:** `src/modules/<feature>/{routes,controller,service,schema,model}.ts`. Shared code goes in `src/core/`: fabric gateway pool, wallet, auth, errors, logger, queue, socket.
- **REST conventions:**
  - Base path `/api/v1`.
  - Success envelope: `{ data, meta }`.
  - Error envelope: `{ error: { code, message, details } }`.
  - Validate all input with Zod.
- **Fabric:**
  - One gateway connection per org, created at startup.
  - Pick the org from the user's role.
  - User identities are enrolled with Fabric CA at registration. Private keys are encrypted with AES-256-GCM before being stored in MongoDB.
  - Use `submitAsync` and return the txId. A commit-status listener emits Socket.IO and FCM updates.
- **Redis is used for:**
  - OTP storage (5-minute TTL)
  - The refresh-token denylist
  - Idempotency keys
  - Rate limiting
  - BullMQ queues: `notifications`, `ledger-events`, `emails`
  - The Socket.IO adapter
  - Hot caches with a 60-second TTL
- **Event listener:** subscribes to chaincode events, upserts the Mongo cache, writes an audit log entry and fans out notifications.
- **Partner API (`/api/v1/partner`):**
  - API key in the `x-api-key` header; the key is stored hashed.
  - Scopes: `parcels:verify`, `encumbrances:write`.
  - Per-client rate limit.
  - Every call is audited.
- **API docs:** keep `docs/openapi.yaml` current and serve it at `/api/docs`.
- **Logging:** use pino with request IDs. Never log tokens, keys or PII.

**Backend decisions (Phase 4):**
- **Sign-in is two steps for every role:** password, then a 6-digit SMS OTP (`POST /auth/login` → `POST /auth/otp/verify`).
  - Registration is confirmed with the same OTP step.
  - OTPs are stored hashed in Redis for 5 minutes, allow at most 5 wrong attempts, and work once.
  - SMS is mocked as email to `<phone>@sms.milki.local`, so codes appear in Mailpit.
- **Tokens:**
  - Access JWT lasts 15 minutes.
  - Refresh JWT lasts 7 days and is **single-use with rotation**: a used `jti` is denylisted in Redis.
  - The web portal receives the refresh token as an httpOnly cookie `milki_rt` (path `/api/v1/auth`). Mobile receives it in the response body.
- **T3 re-authentication:** `POST /auth/reauth` accepts a password, or a REAUTH OTP from `POST /auth/reauth/otp`. It returns a **single-use** `X-Reauth-Token` valid for 5 minutes, which every ledger write requires. Mobile biometrics (Phase 7) will unlock a device credential for this step.
- **Idempotency:**
  - A repeat of a completed **2xx** request is replayed (`Idempotent-Replayed: true`) rather than rejected, so a retried ledger write never submits twice.
  - Any error response releases the key.
  - The same key with a different body returns 422. A repeat while the first request is still running returns 409.
  - T3 middleware order: `requireRole → idempotent → requireReauth → validate`.
- **Fabric:**
  - **User IDs:** `usr_<ObjectId>`, which is also the CA enrollment ID and the on-chain owner/party ID.
  - **Wallet:** Mongo collection `wallet`. The private key is sealed with AES-256-GCM, using AAD `milki-wallet:<label>`.
  - **Enrollment** happens on OTP verification or seeding. If the CA is down, sign-in still works and enrollment happens on the first ledger call.
  - **Read-only service identity** `svc_milki_api_<org>` (no `role` attribute). Used for the event listener, health checks and public verification.
  - **Connections:** one gRPC client per org. Each request opens a lightweight Gateway with the caller's identity.
  - **CA bootstrap admin:** configured via `FABRIC_CA_ADMIN_ID/SECRET` and held in memory only.
- **Ledger writes:**
  - `submitAsync`, then `202 {txId, status:"SUBMITTED"}`. Each write is tracked in `ledger_transactions`.
  - The commit is pushed as Socket.IO `ledger:tx` to room `user:<userId>`. `GET /ledger/tx/:txId` is the polling fallback.
  - Chaincode errors map to HTTP: 400 / 403 / 404 / 409. An unreachable network returns 503 `LEDGER_UNAVAILABLE`.
- **Event listener:**
  - The checkpoint is stored in Mongo (`checkpoints`). The first start replays from block 0 to rebuild caches.
  - Every `milki.*` event refreshes its parcel in `parcel_cache` (via the service identity).
  - Handlers are registered with `onLedgerEvent()`.
- **Parcel reads:**
  - `GET /parcels/:id` and its related reads come **from the ledger**. `GET /parcels` lists from the cache.
  - Citizens can only read their own parcels; other parcels go through public verification (Phase 7).
  - Officials see the owner's name and phone. `ownerNidaHash` never leaves the backend.
- **Startup:** creates the MinIO bucket and serves `/api/docs` (Swagger UI) plus `/api/docs/openapi.json`. `GET /api/v1/health` reports the status of Mongo, Redis and the ledger.
- **Tests:**
  - `npm test`: Vitest + supertest against real Mongo/Redis from `infra/` (DB `milki_test`, Redis DB 1), with Fabric and SMS mocked.
  - `npm run test:integration`: drives the running API on the live network, reading OTPs from Mailpit.

**Backend decisions (Phase 5):**
- **Transfers API** (`/transfers`):
  - Endpoints: `POST` initiate, then `/:id/accept`, `/:id/confirm-payments`, `/:id/verify`, `/:id/approve`, `/:id/cancel`, `/:id/reject`. All are T3.
  - Cancel and reject also get the T2 typed confirmation in the UI.
  - The buyer is given as `{userId|phone|nida}`. `GET /users/lookup` returns a short display name ("Juma H.") for the review screen.
- **Private sale details:**
  - The price and currency, masked NIDA references (`NIDA••••0101`) and salted contact hashes go **only** in the transient map. They never appear in args, logs or the audit log.
  - `GET /transfers/:id` shows `sale` only to the parties, land officers and registrars. Support agents get the transfer without it; banks are refused.
- **Payment evidence:** `confirm-payments` takes `evidenceDocumentId`, a receipt already attached to that transfer. Its stored SHA-256 becomes `paymentEvidenceHash` on-chain.
- **Documents** (`/documents`):
  - Multipart field `file`, at most 10 MB. PDF, JPEG and PNG only, checked by **magic bytes**.
  - The server computes the SHA-256. If the client also sent one and it differs, the upload fails with 422 `HASH_MISMATCH`.
  - Object key: `<target>/<id>/<sha256>.<ext>` in MinIO. Metadata lives in `document_files`. If the ledger refuses the document, the object is deleted.
  - **Download** re-hashes the bytes and checks them with `VerifyDocument` on the ledger before sending (`X-Ledger-Verified`); on a mismatch it returns 409 `INTEGRITY_FAILURE`.
  - `POST /documents/:id/verify` checks a file the caller holds.
- **Event handlers**, in order: parcel cache → transfer cache (`transfer_cache`) → document status → audit (`ledger.<Entity>.<Action>`, idempotent per tx) → notifications.
  - Live socket events: `ledger:event` to the people involved, and `queue:updated` to the `LAND_OFFICER` / `REGISTRAR` role rooms.
- **Notifications:**
  - BullMQ `notifications` queue. Each one is stored in `notifications`, sent over Socket.IO as `notification`, and pushed via FCM if `FCM_SERVICE_ACCOUNT_PATH` exists (otherwise push is skipped).
  - Text is in the user's `preferredLanguage` (en/sw).
  - Sent once per txId (Redis key). Replayed events older than 1 hour update caches and audit only.
  - `/notifications` (list, mark read, mark all read, delete) and `/devices` (FCM tokens).
- **Rate limits:** `/auth/reauth*` has its own per-user limiter (30/min). The per-IP `authLimiter` covers sign-in, registration and OTP.
- **The `ledger-events` queue is not used.** Handlers run in the listener with a Mongo checkpoint, which gives at-least-once delivery. Handlers are idempotent.

---

## 13. Build phases (do in order; each ends with passing tests and a demo)

1. **Infra.** Write `infra/docker-compose.yml` and bring it up. Verify every port in §5.
2. **Network.** Install Fabric, bring up 3 orgs and `land-channel`, write and test `deploy-cc.sh`.
3. **Chaincode.** Build the parcel, transfer, encumbrance, dispute and document functions with guards and events. Unit-test every function and every illegal transition.
4. **Backend core.** Auth (register, OTP, JWT, refresh), CA enrollment and the wallet, the gateway pool, and parcel endpoints.
5. **Transfers and documents.** The full state machine via the API, MinIO uploads with hash checks, the event listener and notifications.
6. **Web portal.** Design system and tokens, layout, auth, dashboards, officer and registrar flows, the confirmation component, and the signature animations.
7. **Mobile app.** Theme, auth with biometrics, parcels, transfers, the QR verify flow, push notifications, English/Swahili, and animations.
8. **Support.** KB, tickets and live chat on both clients, plus the agent console.
9. **Admin and partner API.** Users, offices, API clients, audit logs, and the bank flows.
10. **Hardening.**
    - Rate limits and security headers.
    - A seed script with demo data: 3 regions, 30 parcels, sample transfers and tickets.
    - An end-to-end test of the full transfer flow.
    - A Hyperledger Caliper benchmark for the report.

---

## 14. Testing and definition of done

- **Chaincode:** mocha + sinon. 90% or more of guards covered.
- **Backend:** vitest + supertest. Fabric is mocked in unit tests; integration tests run against the local network.
- **Web:** component tests for `ConfirmAction` and the status badges, and a Playwright smoke test of login → approve transfer.
- **Mobile:** unit tests for repositories, widget tests for the transfer tracker and the confirmation helper, and one integration test.

**A feature is done when:**
1. All CRUD actions work.
2. Every mutation uses the right confirmation tier.
3. Loading, empty and error states are designed.
4. Light and dark mode both look right.
5. English and Swahili strings exist (mobile).
6. Audit log entries are written.
7. Tests pass.

---

## 15. Seed and demo accounts (dev only)

`backend/src/scripts/seed.ts` creates one user per role, with password `Milki@2026` and phone OTPs visible in Mailpit at http://localhost:8126. Never ship these accounts beyond the dev environment.

---

## 16. Out of scope / future work

- Houses and buildings.
- Real NIDA, TRA and payment integrations (mocked behind interfaces).
- SmartBFT ordering (Fabric 3.x).
- Non-custodial signing on the phone with Secure Enclave or Keystore keys, via Fabric Gateway offline signing.
- Land subdivision and merging.

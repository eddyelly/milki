# Milki mobile (landowners)

Flutter app for citizens: parcels, transfers, QR verification, notifications, English/Swahili.
Architecture, decisions and confirmation tiers: see `../CLAUDE.md` (§4.5 "Mobile decisions", §8, §10).

```bash
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:4100/api/v1   # Android emulator (LAN IP on a phone)
flutter analyze && flutter test
```

- `lib/core`: API client (refresh, idempotency, re-auth headers), secure token store, theme, ledger events (Socket.IO + polling), biometric re-auth, push.
- `lib/data`: models and repositories.
- `lib/state`: Riverpod providers (session, settings, data).
- `lib/ui`: screens and shared widgets (`showConfirmAction`, `SealedOnLedger`, `TransferTracker`, `OwnershipChain`).
- `test/`: repository, widget and full-app tests; `test/live` hits the running API; `integration_test/` runs on a device.

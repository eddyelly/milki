import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:milki_mobile/app.dart';
import 'package:milki_mobile/core/api/token_store.dart';
import 'package:milki_mobile/state/providers.dart';

import 'support/fakes.dart';

/// The whole app against an in-memory API: sign in → OTP → home → parcel → start a transfer (T3) → tracker.
void main() {
  setUpAll(setUpFonts);

  testWidgets('citizen signs in and starts a transfer that is sealed on the ledger', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 2.75;
    tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
    addTearDown(() {
      tester.view.reset();
      tester.platformDispatcher.clearAccessibilityFeaturesTestValue();
    });

    final api = FakeApi();
    final tokens = MemoryTokenStore();
    final reauth = FakeReauth();
    final ledger = FakeLedgerEvents(block: 77);
    const trf = 'TRF-0123456789ABCDEF';
    var initiated = false;

    api.on('POST /auth/login', (_) => Reply.ok({'challengeId': 'ch1', 'sentTo': '+2557•••001', 'expiresIn': 300}));
    api.on('POST /auth/otp/verify', (c) => c.json['code'] == '123456' ? Reply.ok({'accessToken': 'at', 'refreshToken': 'rt', 'user': userJson()}) : Reply.error(400, 'OTP_INVALID', 'That code is not correct.'));
    api.on('GET /parcels', (_) => Reply.ok([
          {'parcelId': 'DSM-KIN-12-45', 'titleNumber': 'CT-1001', 'region': 'Dar es Salaam', 'district': 'Kinondoni', 'ward': 'Mikocheni', 'area': 1200, 'landUse': 'RESIDENTIAL', 'status': initiated ? 'PENDING_TRANSFER' : 'ACTIVE'},
        ]));
    api.on('GET /transfers', (_) => Reply.ok(<Object>[]));
    api.on('GET /notifications', (_) => Reply.ok(<Object>[], meta: {'unread': 0}));
    api.on('GET /parcels/DSM-KIN-12-45', (_) => Reply.ok(parcelJson()));
    api.on('GET /parcels/DSM-KIN-12-45/history', (_) => Reply.ok([
          {'txId': 'e' * 64, 'timestamp': '2026-01-10T10:00:00Z', 'status': 'ACTIVE', 'ownerId': 'usr_1', 'ownershipVersion': 1, 'changedBy': {'role': 'REGISTRAR', 'mspId': 'Org1MSP'}},
        ]));
    api.on('GET /parcels/DSM-KIN-12-45/documents', (_) => Reply.ok(<Object>[]));
    api.on('GET /users/lookup', (_) => Reply.ok({'userId': 'usr_2', 'displayName': 'Juma H.'}));
    api.on('POST /transfers', (c) {
      initiated = true;
      return Reply.ok({'txId': 'f' * 64, 'status': 'SUBMITTED', 'transferId': trf, 'parcelId': 'DSM-KIN-12-45'}, status: 202);
    });
    api.on('GET /transfers/$trf', (_) => Reply.ok({
          'transferId': trf,
          'parcelId': 'DSM-KIN-12-45',
          'sellerId': 'usr_1',
          'buyerId': 'usr_2',
          'seller': {'userId': 'usr_1', 'fullName': 'Asha Mwakyusa'},
          'buyer': {'userId': 'usr_2', 'fullName': 'Juma Hassan'},
          'status': 'INITIATED',
          'sale': {'salePrice': 85000000, 'currency': 'TZS'},
          'history': [
            {'status': 'INITIATED', 'at': '2026-03-01T10:00:00Z', 'by': {'role': 'CITIZEN', 'mspId': 'Org1MSP'}, 'txId': 'f' * 64},
          ],
        }));
    api.on('GET /transfers/$trf/documents', (_) => Reply.ok(<Object>[]));

    await tester.pumpWidget(ProviderScope(
      overrides: [
        settingsProvider.overrideWith(() => SettingsController()),
        tokenStoreProvider.overrideWithValue(tokens),
        apiClientProvider.overrideWith((ref) => fakeClient(api, ref.watch(tokenStoreProvider), onExpired: () => ref.read(sessionProvider.notifier).expired())),
        reauthenticatorProvider.overrideWithValue(reauth),
        ledgerEventsProvider.overrideWithValue(ledger),
      ],
      child: const MilkiApp(),
    ));
    await settle(tester);

    // Sign in: password, then the SMS code.
    expect(find.text('Sign in'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('login-identifier')), 'citizen@milki.dev');
    await tester.enterText(find.byKey(const Key('login-password')), 'Milki@2026');
    await tester.tap(find.byKey(const Key('login-submit')));
    await settle(tester);
    expect(find.text('Enter your code'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('otp-field')), '000000');
    await settle(tester);
    expect(find.text('That code is not correct.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('otp-field')), '123456');
    await settle(tester);

    // Home.
    expect(find.text('Asha'), findsOneWidget);
    expect(tokens.accessToken, 'at');
    expect(find.byKey(const Key('parcel-DSM-KIN-12-45')), findsOneWidget);

    // Parcel detail (straight from the ledger) with its ownership chain.
    await tester.tap(find.byKey(const Key('parcel-DSM-KIN-12-45')));
    await settle(tester);
    expect(find.text('CT-1001'), findsWidgets);
    expect(find.text('Registered to v1'), findsOneWidget);

    // Start a transfer: find the buyer, set the price, review (T3), re-authenticate, seal.
    await tester.tap(find.byKey(const Key('start-transfer')));
    await settle(tester);
    await tester.enterText(find.byKey(const Key('buyer-phone')), '0712 000 002');
    await tester.tap(find.byKey(const Key('find-buyer')));
    await settle(tester);
    expect(find.text('Buyer: Juma H.'), findsOneWidget);
    expect(api.called('GET /users/lookup').single.query['phone'], '+255712000002');
    await tester.enterText(find.byKey(const Key('sale-price')), '85,000,000');
    await tester.ensureVisible(find.byKey(const Key('review-transfer')));
    await tester.tap(find.byKey(const Key('review-transfer')));
    await settle(tester);

    expect(find.text('Ownership of DSM-KIN-12-45 will move from Asha M. to Juma H.'), findsOneWidget);
    expect(find.text('TSh 85,000,000'), findsOneWidget);
    await tester.tap(find.byKey(const Key('confirm-continue')));
    await settle(tester);
    await tester.enterText(find.byKey(const Key('reauth-password')), 'Milki@2026');
    await tester.pump();
    await tester.tap(find.byKey(const Key('confirm-sign')));
    await settle(tester);

    final post = api.called('POST /transfers').single;
    expect(post.json['salePrice'], 85000000);
    expect(post.headers['X-Reauth-Token'], 'reauth-token');
    expect(post.headers['Idempotency-Key'], isNotNull);
    expect(find.text('Sealed on the ledger in block #77'), findsOneWidget);

    await tester.tap(find.byKey(const Key('confirm-done')));
    await settle(tester);

    // Lands on the transfer with its tracker.
    expect(find.text(trf), findsOneWidget);
    expect(find.text('Waiting for the buyer to accept.'), findsOneWidget);
    expect(find.byKey(const Key('cancel-transfer')), findsOneWidget);
  });
}
